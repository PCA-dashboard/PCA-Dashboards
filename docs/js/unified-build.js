/* 瀏覽器內建立「統一 Zip」（與 exporters/common/unified_zip.py 的 schema 一致）。
   供建立精靈（builder）使用；全程在瀏覽器完成，不需伺服器。 */
(function (global) {
  "use strict";
  var parseCSV = global.FrogDash.parseCSV;

  var SCHEMA_VERSION = "1.0";
  // Okabe–Ito 色盲友善配色 + 可辨形狀
  var OKABE = ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#D55E00", "#56B4E9", "#F0E442", "#000000"];
  var SHAPES = ["circle", "square", "triangle-up", "diamond", "star", "cross", "triangle-down", "pentagon"];

  function slug(s) {
    return String(s || "view").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "view";
  }
  function csvEscape(v) {
    v = (v == null) ? "" : String(v);
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function toCSV(header, rows) {
    return [header.map(csvEscape).join(",")].concat(
      rows.map(function (r) { return r.map(csvEscape).join(","); })
    ).join("\n") + "\n";
  }
  function rowsFromText(text) {
    var rows = parseCSV(text);
    return { header: rows[0] || [], body: rows.slice(1) };
  }

  // 各 PC 欄的變異解釋比例（相對於所提供的 PC；descriptive，非重算 PCA）
  function colVariance(body, colIdx) {
    var vars = colIdx.map(function (ci) {
      var xs = body.map(function (r) { return parseFloat(r[ci]); }).filter(function (x) { return !isNaN(x); });
      var n = xs.length || 1, mean = xs.reduce(function (a, b) { return a + b; }, 0) / n;
      var v = xs.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / n;
      return v;
    });
    var tot = vars.reduce(function (a, b) { return a + b; }, 0) || 1;
    return vars.map(function (v) { return v / tot; });
  }

  function autoGroups(values) {
    var seen = [], set = {};
    values.forEach(function (v) { if (v != null && v !== "" && !set[v]) { set[v] = 1; seen.push(v); } });
    return {
      field: "clade",
      members: seen.map(function (v, i) {
        return { value: v, label: v, color: OKABE[i % OKABE.length], symbol: SHAPES[i % SHAPES.length] };
      })
    };
  }

  // 從 Newick 抽 tip 標籤
  function newickTips(nwk) {
    var m = nwk.match(/[(,]([^(),:]+):/g) || [];
    return m.map(function (s) { return s.slice(1, -1).trim(); });
  }

  /**
   * 由使用者輸入建立統一 Zip。
   * inputs = {
   *   dataset:{title,doi,citation,source_url},
   *   views:[{label, scoresText, varianceText?}],
   *   taxa:{text, idCol, labelCol, groupCol, imageCol?, infoCols:[...]},
   *   tree:{newick?},  // 可選
   *   images:{ mode:"loose"|"embed", entries:[{out, blob, sids:[...]}] }  // 可選
   * }
   * 回傳 { blob, warnings:[...] }
   */
  function buildZipBlob(inputs) {
    var warnings = [];
    var zip = new JSZip();
    var files = {};
    var idColOut = "species_id";

    // ---- taxa ----
    var t = rowsFromText(inputs.taxa.text);
    var idIdx = t.header.indexOf(inputs.taxa.idCol);
    var labelIdx = t.header.indexOf(inputs.taxa.labelCol);
    var groupIdx = t.header.indexOf(inputs.taxa.groupCol);
    var imgIdx = inputs.taxa.imageCol ? t.header.indexOf(inputs.taxa.imageCol) : -1;
    var infoCols = inputs.taxa.infoCols || [];
    if (idIdx < 0) throw uiErr("找不到 species_id 欄：" + inputs.taxa.idCol);

    // 圖片：entries 由 images.js 處理好（已縮圖、已改名）。有 entries 時 image 欄一律
    // 改寫成我們的輸出檔名，不能沿用使用者原本欄位裡的舊檔名——檔案已經被改名了。
    var img = inputs.images || {};
    var imgEntries = img.entries || [];
    var sidToOut = {};
    imgEntries.forEach(function (e) {
      (e.sids || []).forEach(function (sid) { sidToOut[sid] = e.out; });
    });
    var hasImgEntries = imgEntries.length > 0;

    var taxaHeader = ["species_id", "display_label", "clade", "image"].concat(infoCols);
    var groupValues = [];
    var taxaIds = {};
    var taxaRows = t.body.filter(function (r) { return r[idIdx] != null && r[idIdx] !== ""; }).map(function (r) {
      var sid = String(r[idIdx]).trim();
      taxaIds[sid] = 1;
      var gv = groupIdx >= 0 ? r[groupIdx] : "";
      groupValues.push(gv);
      var imgVal = hasImgEntries ? (sidToOut[sid] || "") : (imgIdx >= 0 ? r[imgIdx] : "");
      var base = [sid, labelIdx >= 0 ? r[labelIdx] : sid, gv, imgVal];
      infoCols.forEach(function (c) { base.push(r[t.header.indexOf(c)]); });
      return base;
    });
    files["taxa/taxa.csv"] = toCSV(taxaHeader, taxaRows);
    var groups = autoGroups(groupValues);

    // ---- views ----
    var views = [];
    (inputs.views || []).forEach(function (v, vi) {
      var id = slug(v.id || v.label || ("view" + (vi + 1)));
      var sc = rowsFromText(v.scoresText);
      if (sc.header.length < 2) throw uiErr("視圖「" + (v.label || id) + "」的分數 CSV 欄位不足");
      var pcIdx = [], pcNames = [];
      for (var c = 1; c < sc.header.length; c++) { pcIdx.push(c); pcNames.push("PC" + c); }
      // scores.csv
      var scoreRows = sc.body.filter(function (r) { return r[0] != null && r[0] !== ""; }).map(function (r) {
        var sid = String(r[0]).trim();
        if (!taxaIds[sid]) warnings.push("視圖[" + id + "] 物種不在 taxa：" + sid);
        return [sid].concat(pcIdx.map(function (ci) { return r[ci]; }));
      });
      files["views/" + id + "/scores.csv"] = toCSV(["species_id"].concat(pcNames), scoreRows);
      // variance
      var props;
      if (v.varianceText) {
        var vr = rowsFromText(v.varianceText);
        var vi2 = vr.header.indexOf("variance_explained");
        props = vr.body.map(function (r) { return parseFloat(r[vi2 >= 0 ? vi2 : 1]); }).filter(function (x) { return !isNaN(x); });
      } else {
        props = colVariance(sc.body, pcIdx);
        warnings.push("視圖[" + id + "] 未提供 variance，已由分數欄變異估算（相對值）");
      }
      var cum = 0;
      files["views/" + id + "/variance.csv"] = toCSV(["PC", "variance_explained", "cumulative"],
        props.map(function (p, i) { cum += p; return ["PC" + (i + 1), p, cum]; }));
      var vinl = {}, axis = {};
      pcNames.forEach(function (p, i) {
        if (props[i] != null) { vinl[p] = Math.round(props[i] * 1e6) / 1e6; }
        axis[p] = p + (props[i] != null ? " (" + (props[i] * 100).toFixed(1) + "%)" : "");
      });
      views.push({
        id: id, label: v.label || id, type: "pca", n_components: pcNames.length,
        default_axes: ["PC1", pcNames[1] || "PC1"], axis_labels: axis,
        variance_explained: vinl,
        scores: { path: "views/" + id + "/scores.csv", id_column: "species_id" },
        scree_path: "views/" + id + "/variance.csv"
      });
    });

    // ---- tree（可選）----
    var manifestTree = null;
    if (inputs.tree && inputs.tree.newick && inputs.tree.newick.trim()) {
      files["tree/tree.nwk"] = inputs.tree.newick.trim() + "\n";
      var tips = newickTips(inputs.tree.newick);
      files["tree/tip_crosswalk.csv"] = toCSV(["tip_label", "species_id"], tips.map(function (x) { return [x, x]; }));
      var miss = tips.filter(function (x) { return !taxaIds[x]; });
      if (miss.length) warnings.push("樹有 " + miss.length + " 個 tip 不在 taxa（tip 標籤需與 species_id 一致），例：" + miss.slice(0, 3).join(", "));
      manifestTree = { path: "tree/tree.nwk", format: "newick", tip_id_map: "tree/tip_crosswalk.csv" };
    }

    // ---- manifest ----
    var manifest = {
      schema_version: SCHEMA_VERSION,
      dataset: {
        title: inputs.dataset.title || "PCA dataset",
        doi: inputs.dataset.doi || "",
        citation: inputs.dataset.citation || "",
        source_url: inputs.dataset.source_url || "",
        created_with: "Builder",   // 由瀏覽器建立精靈產生（有別於 R / Python / CSV 匯出器）
        generator_version: "0.3.0",
        generated_at: new Date().toISOString().replace(/\.\d+Z$/, "Z")
      },
      id_policy: { canonical_field: "species_id", normalization: ["verbatim"], match_mode: "exact" },
      views: views,
      taxa: {
        path: "taxa/taxa.csv", id_column: "species_id", display_label_column: "display_label",
        image_column: "image",
        info_fields: [{ column: "clade", label: "分組" }].concat(infoCols.map(function (c) { return { column: c, label: c }; }))
      },
      groups: groups
    };
    if (manifestTree) manifest.tree = manifestTree;

    if (hasImgEntries) {
      if (img.mode === "embed") {
        // 內嵌：只適合少量小圖。JPEG 已經壓過了，再 DEFLATE 只是浪費 CPU，用 STORE。
        imgEntries.forEach(function (e) { zip.file("images/" + e.out, e.blob, { compression: "STORE" }); });
      } else {
        // 散檔：圖片放在站台的 img/，資料包只記路徑。一律相對路徑——多數人用的是
        // https://user.github.io/<repo>/ 這種 project page，絕對路徑會全部破圖。
        manifest.taxa.image_base_url = "img/";
      }
    }

    zip.file("manifest.json", JSON.stringify(manifest, null, 2));
    Object.keys(files).forEach(function (p) { zip.file(p, files[p]); });

    return zip.generateAsync({ type: "blob", compression: "DEFLATE" }).then(function (blob) {
      return { blob: blob, warnings: warnings, manifest: manifest };
    });
  }

  function uiErr(m) { var e = new Error(m); e.userFacing = true; return e; }

  global.FrogDash = global.FrogDash || {};
  global.FrogDash.UnifiedBuild = {
    SCHEMA_VERSION: SCHEMA_VERSION, buildZipBlob: buildZipBlob,
    autoGroups: autoGroups, newickTips: newickTips
  };
})(window);
