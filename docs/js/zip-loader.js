/* 統一 Zip 載入器：解析 manifest 與各檔、驗證 join key、建立資料模型。
   與 exporters/common/unified_zip.py 的驗證規則一致。 */
(function (global) {
  "use strict";

  var SCHEMA_VERSION = "1.0";

  // --- 極簡 CSV 解析（支援雙引號、逗號、跳脫引號）---
  function parseCSV(text) {
    var rows = [], row = [], field = "", i = 0, inQ = false, c;
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // 去 BOM
    while (i < text.length) {
      c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQ = true; i++; continue; }
      if (c === ",") { row.push(field); field = ""; i++; continue; }
      if (c === "\r") { i++; continue; }
      if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      field += c; i++;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.length > 1 || (r.length === 1 && r[0] !== ""); });
  }

  function toObjects(text) {
    var rows = parseCSV(text);
    if (!rows.length) return { header: [], rows: [] };
    var header = rows[0];
    var objs = rows.slice(1).map(function (r) {
      var o = {};
      header.forEach(function (h, j) { o[h] = r[j]; });
      return o;
    });
    return { header: header, rows: objs };
  }

  function err(msg) { var e = new Error(msg); e.userFacing = true; return e; }

  function buildModel(zip) {
    function readText(path) {
      var f = zip.file(path);
      if (!f) throw err("Zip 內缺少檔案：" + path);
      return f.async("string");
    }

    var model = {};
    return readText("manifest.json").then(function (mtext) {
      var manifest;
      try { manifest = JSON.parse(mtext); }
      catch (e) { throw err("manifest.json 解析失敗：" + e.message); }
      if (manifest.schema_version !== SCHEMA_VERSION)
        throw err("schema_version 不符（得到 " + manifest.schema_version + "，需 " + SCHEMA_VERSION + "）");

      model.manifest = manifest;
      model.dataset = manifest.dataset || {};
      model.groups = (manifest.groups && manifest.groups.members) || [];
      model.groupField = (manifest.groups && manifest.groups.field) || "clade";
      model.groupByValue = {};
      model.groups.forEach(function (g) { model.groupByValue[g.value] = g; });

      var taxaMeta = manifest.taxa || {};
      model.idCol = taxaMeta.id_column || "species_id";
      model.displayLabelCol = taxaMeta.display_label_column || "display_label";
      model.imageCol = taxaMeta.image_column || "image";
      model.imageBaseUrl = taxaMeta.image_base_url || null;    // 設定時：照片為站上散檔，按需載入＋瀏覽器原生快取
      model.outlineCol = taxaMeta.outline_column || null;      // 形態輪廓（可選，與照片並存）
      model.imageCaptionCol = taxaMeta.image_caption_column || null;  // 照片標註/來源授權
      model.infoFields = taxaMeta.info_fields || [];

      var jobs = [];

      // taxa
      jobs.push(readText(taxaMeta.path).then(function (t) {
        var parsed = toObjects(t);
        model.taxa = {};
        model.taxaOrder = [];
        parsed.rows.forEach(function (r) {
          var sid = r[model.idCol];
          model.taxa[sid] = r;
          model.taxaOrder.push(sid);
        });
      }));

      // views
      model.views = {};
      model.viewOrder = [];
      (manifest.views || []).forEach(function (v) {
        model.viewOrder.push(v.id);
        jobs.push(Promise.all([
          readText(v.scores.path),
          v.scree_path ? readText(v.scree_path) : Promise.resolve(null)
        ]).then(function (res) {
          var sc = toObjects(res[0]);
          var idc = (v.scores.id_column) || "species_id";
          var pcs = sc.header.filter(function (h) { return /^PC\d+$/i.test(h); });
          var scores = {}, ids = [];
          sc.rows.forEach(function (r) {
            var sid = r[idc]; ids.push(sid);
            var o = {};
            pcs.forEach(function (p) { o[p] = parseFloat(r[p]); });
            scores[sid] = o;
          });
          var variance = [];
          if (res[1]) {
            toObjects(res[1]).rows.forEach(function (r) {
              variance.push(parseFloat(r.variance_explained));
            });
          }
          model.views[v.id] = {
            id: v.id, label: v.label, pcs: pcs, ids: ids, scores: scores,
            variance: variance, axisLabels: v.axis_labels || {},
            defaultAxes: v.default_axes || [pcs[0], pcs[1]],
            varianceExplained: v.variance_explained || {}
          };
        }));
      });

      // tree + crosswalk（可選：沒有樹的純 PCA 資料集也支援）
      var treeMeta = manifest.tree || {};
      model.treeNewick = null;
      model.tipToSpecies = {};        // tip → 代表 species（供著色/hover；1:1 或多對一取其一）
      model.tipToSpeciesList = {};    // tip → 該 tip 對應的所有 species（支援科級樹一對多）
      model.speciesToTip = {};
      model.hasTree = !!(treeMeta.path && zip.file(treeMeta.path));
      if (model.hasTree) {
        jobs.push(readText(treeMeta.path).then(function (t) { model.treeNewick = t; }));
        if (treeMeta.tip_id_map && zip.file(treeMeta.tip_id_map)) {
          jobs.push(readText(treeMeta.tip_id_map).then(function (t) {
            toObjects(t).rows.forEach(function (r) {
              model.tipToSpecies[r.tip_label] = r.species_id;
              (model.tipToSpeciesList[r.tip_label] || (model.tipToSpeciesList[r.tip_label] = [])).push(r.species_id);
              model.speciesToTip[r.species_id] = r.tip_label;
            });
          }));
        }
      }

      // images（可選）：照片與形態輪廓各自一欄，可並存
      model.imageURLs = {};       // 照片（image_column；三葉蟲為「同科代表標本」照）
      model.outlineURLs = {};     // 形態輪廓（outline_column；逐物種）
      var imgJobs = [];
      // 延後到 taxa 載入後處理；此處先佔位

      // 圖片 blob 快取：同一檔（如共用的科代表照）只解一次
      var blobCache = {};
      function loadInto(col, target, baseUrl) {
        if (!col) return;
        Object.keys(model.taxa).forEach(function (sid) {
          var rel = model.taxa[sid][col];
          if (!rel) return;
          if (baseUrl) { target[sid] = baseUrl + rel; return; }   // 站上散檔：直接當 URL，<img> 按需抓、瀏覽器原生快取
          if (blobCache[rel]) {
            imgJobs.push(blobCache[rel].then(function (u) { target[sid] = u; }));
            return;
          }
          var f = zip.file("images/" + rel) || zip.file(rel);
          if (!f) return;
          var p;
          if (/\.svg$/i.test(rel)) {
            // SVG 需正確 MIME，<img> 才會渲染
            p = f.async("string").then(function (txt) {
              return URL.createObjectURL(new Blob([txt], { type: "image/svg+xml" }));
            });
          } else {
            var mime = /\.png$/i.test(rel) ? "image/png" : /\.jpe?g$/i.test(rel) ? "image/jpeg" : "application/octet-stream";
            p = f.async("uint8array").then(function (u8) {
              return URL.createObjectURL(new Blob([u8], { type: mime }));
            });
          }
          blobCache[rel] = p;
          imgJobs.push(p.then(function (u) { target[sid] = u; }));
        });
      }

      return Promise.all(jobs).then(function () {
        loadInto(model.imageCol, model.imageURLs, model.imageBaseUrl);
        loadInto(model.outlineCol, model.outlineURLs);
        return Promise.all(imgJobs);
      }).then(function () {
        validateJoinKeys(model);
        return model;
      });
    });
  }

  // 瀏覽器端 join key 驗證：scores ∩ 樹(crosswalk) ∩ taxa
  // 樹可為物種級（tip↔species 1:1）或科級（tip↔多 species）。硬性錯誤只在
  // 「交叉表映射到的 species 不存在於 taxa」；反向「taxa 未上樹」僅作提示（科級樹或
  // 局部樹本就可能有物種無對應 tip，如無樹目的類群）。
  function validateJoinKeys(model) {
    var taxaIds = new Set(Object.keys(model.taxa));
    var mappedSpecies = new Set(Object.keys(model.speciesToTip));  // 有對應 tip 的 species
    var tipCount = Object.keys(model.tipToSpeciesList || {}).length;
    var problems = [], warnings = [];

    if (model.hasTree && mappedSpecies.size) {
      mappedSpecies.forEach(function (id) { if (!taxaIds.has(id)) problems.push("樹交叉表物種不在 taxa：" + id); });
      taxaIds.forEach(function (id) { if (!mappedSpecies.has(id)) warnings.push("taxa 物種未對應樹 tip：" + id); });
    }
    model.viewOrder.forEach(function (vid) {
      model.views[vid].ids.forEach(function (id) {
        if (!taxaIds.has(id)) problems.push("view[" + vid + "] 物種不在 taxa：" + id);
      });
    });

    model.joinReport = {
      nTaxa: taxaIds.size, nTree: model.hasTree ? tipCount : 0,
      problems: problems.slice(0, 20), problemCount: problems.length,
      warningCount: warnings.length
    };
    if (problems.length)
      throw err("join key 不一致（" + problems.length + " 處），例：\n  " + problems.slice(0, 5).join("\n  "));
  }

  var Loader = {
    fromBlob: function (blob) {
      return JSZip.loadAsync(blob).then(buildModel);
    },
    fromArrayBuffer: function (buf) {
      return JSZip.loadAsync(buf).then(buildModel);
    },
    fromUrl: function (url) {
      return fetch(url).then(function (r) {
        if (!r.ok) throw err("無法取得 " + url + "（HTTP " + r.status + "）");
        return r.arrayBuffer();
      }).then(function (b) { return JSZip.loadAsync(b); }).then(buildModel);
    }
  };

  global.FrogDash = global.FrogDash || {};
  global.FrogDash.Loader = Loader;
  global.FrogDash.parseCSV = parseCSV;
})(window);
