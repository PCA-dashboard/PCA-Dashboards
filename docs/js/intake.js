/* 智慧投入：判讀「使用者整包丟進來的檔案」哪些能用來做網頁、缺什麼。
   設計與決策見 Source repo `docs/intake_design.md`。

   **這個模組刻意不碰 DOM**，才能在 Node 直接 require 來跑語料庫測試
   （判讀的正確性沒辦法用眼睛顧，只能用一堆髒資料夾釘住）。UI 在 builder.js。

   輸入只要檔名、大小、前 64KB 文字：不讀整包，幾百個檔也很快。
   四層判斷（前面便宜、後面才貴）：
     A 嗅探    副檔名 + 內容開頭（Newick 的括號平衡最可靠）
     B 表頭    欄名樣式（PC1.. / variance_explained / tip_label）+ 欄位統計
     C 交叉    各檔 ID 集合的重疊率 ← 決定性訊號，把「猜」變成「可驗證」
     D 推論    ID 幾乎相同的多個分數檔 → 多視圖
*/
(function (global) {
  "use strict";

  // ---- 角色 ----
  // scores/variance/taxa/tree/crosswalk：可用
  // raw：原始資料（最高原則 3，瀏覽器不算統計）→ 導流到 R/Python 匯出器
  // image/archive/xlsx/ignore/unknown：其餘
  var PC_RE = /^(pc|comp|dim|axis|pco|rda|cs)[._\- ]?\d+$/i;
  var VAR_RE = /^(variance[_ ]?explained|explained[_ ]?variance|proportion([_ ]?of[_ ]?variance)?|prop[_ ]?var|eigenvalue|eigen|sdev|stdev|cumulative|cum[_ ]?prop)$/i;
  var ID_NAME_RE = /^(species[_ ]?id|id|taxon|taxa|tip[_ ]?label|label|name|gensp|binomial|specimen)$/i;
  var TAXON_NAME_RE = /^(genus|species|family|subfamily|order|class|phylum|clade|group|taxon|tribe|habitat|ecology|region|locality|period|system)/i;
  var LANDMARK_RE = /^([xyz]\d+|l\d+[._\-]?[xyz]|v\d+|coord\d+|lm\d+([._\-]?[xyz])?)$/i;
  var IMAGE_EXT_RE = /\.(jpe?g|png|svg|webp|gif|tiff?|heic|heif|bmp)$/i;
  var TREE_EXT_RE = /\.(nwk|tre|newick|tree|phy)$/i;
  var SHEET_EXT_RE = /\.(xlsx|xlsm|xls|ods)$/i;
  var JUNK_RE = /(^|\/)(\.ds_store|thumbs\.db|desktop\.ini|\.gitignore|\.gitattributes)$|(^|\/)__macosx\//i;
  var DOC_EXT_RE = /\.(md|markdown|pdf|docx?|pptx?|rtf|html?|r|rmd|py|ipynb|log|json|yml|yaml|bib|tex)$/i;

  function baseName(p) { return String(p || "").split("/").pop(); }
  function stripExt(n) { return baseName(n).replace(/\.[^.]+$/, ""); }

  // ---- 分隔符偵測 ----
  // parseCSV（zip-loader）只吃逗號；真實資料夾常見 TSV 與歐陸的分號 CSV，
  // 所以這裡自備一個會挑分隔符的極簡解析器（只要前幾列，不求完整）。
  function sniffDelimiter(head) {
    var lines = String(head || "").split(/\r?\n/).filter(function (l) { return l.trim(); }).slice(0, 12);
    if (!lines.length) return null;
    var best = null;
    [",", "\t", ";", "|"].forEach(function (d) {
      var counts = lines.map(function (l) { return splitLine(l, d).length; });
      var n = counts[0];
      if (n < 2) return;
      // 每列欄數一致才算數：這是「真的是這個分隔符」最強的證據
      var consistent = counts.filter(function (c) { return c === n; }).length / counts.length;
      var score = consistent * 100 + n;
      if (consistent >= 0.8 && (!best || score > best.score)) best = { delim: d, cols: n, score: score };
    });
    return best;
  }

  /** 單列切欄（處理雙引號包住的分隔符）。 */
  function splitLine(line, d) {
    var out = [], cur = "", q = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (q) {
        if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === d) { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out.map(function (s) { return s.trim(); });
  }

  function parseHead(head, delim, maxRows) {
    var lines = String(head || "").replace(/^﻿/, "").split(/\r?\n/);
    var rows = [];
    for (var i = 0; i < lines.length && rows.length < (maxRows || 200); i++) {
      if (!lines[i].trim()) continue;
      rows.push(splitLine(lines[i], delim));
    }
    // 前 64KB 可能把最後一列切斷，丟掉它才不會誤判欄數
    if (rows.length > 2 && rows[rows.length - 1].length !== rows[0].length) rows.pop();
    return rows;
  }

  function isNumeric(v) {
    if (v == null || v === "") return false;
    return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(String(v).trim());
  }

  /** 每欄的統計：數值比例、相異值數、是否像 ID。只看前幾十列就夠。 */
  function columnStats(header, body) {
    return header.map(function (name, i) {
      var vals = body.map(function (r) { return r[i]; }).filter(function (v) { return v != null && v !== ""; });
      var nums = vals.filter(isNumeric).length;
      var uniq = {}, u = 0;
      vals.forEach(function (v) { if (!uniq[v]) { uniq[v] = 1; u++; } });
      return {
        name: name, index: i,
        n: vals.length,
        numericFrac: vals.length ? nums / vals.length : 0,
        unique: u,
        uniqueFrac: vals.length ? u / vals.length : 0,
        looksLikeFile: vals.length ? vals.filter(function (v) { return IMAGE_EXT_RE.test(v); }).length / vals.length : 0,
        sample: vals.slice(0, 3)
      };
    });
  }

  /** 挑最像 join key 的欄：字串、幾乎每列都不重複。 */
  function pickIdColumn(stats) {
    var cands = stats.filter(function (s) {
      return s.numericFrac < 0.5 && s.uniqueFrac > 0.9 && s.n > 0;
    });
    if (!cands.length) return null;
    // 欄名叫 species_id 之類的優先，其次取最左邊（R 的 write.csv 會寫成空表頭的第一欄）
    var named = cands.filter(function (s) { return ID_NAME_RE.test(s.name); });
    return (named[0] || cands[0]);
  }

  function norm(s) {
    return String(s == null ? "" : s).trim().toLowerCase()
      .replace(/\.[a-z0-9]{2,5}$/i, "")      // 去副檔名（圖檔比對用）
      .replace(/[\s\-.]+/g, "_")             // 空白/連字號/點 → 底線
      .replace(/_+/g, "_").replace(/^_|_$/g, "");
  }

  function jaccard(a, b) {
    if (!a || !b || !a.length || !b.length) return 0;
    var set = {}, hit = 0;
    b.forEach(function (x) { set[x] = 1; });
    a.forEach(function (x) { if (set[x]) hit++; });
    return hit / (a.length + b.length - hit);
  }
  /** a 有多少比例能在 b 裡找到（涵蓋率，不對稱）。 */
  function coverage(a, b) {
    if (!a || !a.length || !b || !b.length) return 0;
    var set = {};
    b.forEach(function (x) { set[x] = 1; });
    return a.filter(function (x) { return set[x]; }).length / a.length;
  }

  // ---- A 層：Newick ----
  function looksLikeNewick(head) {
    var t = String(head || "").trim();
    if (!t || t[0] !== "(") return false;
    if (!/;\s*$/.test(t) && t.length < 60000) return false;   // 被 64KB 截斷的大樹沒有結尾分號，放行
    var depth = 0;
    for (var i = 0; i < t.length; i++) {
      if (t[i] === "(") depth++;
      else if (t[i] === ")") { depth--; if (depth < 0) return false; }
    }
    return t.length > 60000 ? true : depth === 0;
  }

  function newickTips(nwk) {
    var m = String(nwk).match(/[(,]\s*([^(),:;]+)\s*(?=[:,)])/g) || [];
    return m.map(function (s) { return s.replace(/^[(,]\s*/, "").trim(); })
            .filter(function (s) { return s && !/^\d+(\.\d+)?$/.test(s); });
  }

  // ---- B 層：單檔判角色 ----
  function classifyOne(f) {
    var name = baseName(f.name), head = f.head || "";
    var out = { name: f.name, size: f.size || 0, role: "unknown", confidence: 0, reasons: [], detail: {} };

    if (JUNK_RE.test(f.name)) { out.role = "ignore"; out.confidence = 1; out.reasons.push("系統產生的檔案"); return out; }
    if (IMAGE_EXT_RE.test(name)) {
      out.role = "image"; out.confidence = 1;
      out.detail.key = norm(name);
      out.reasons.push("影像副檔名");
      if (/\.(heic|heif)$/i.test(name)) out.reasons.push("HEIC：瀏覽器可能解不開，建議先轉成 JPEG");
      return out;
    }
    if (SHEET_EXT_RE.test(name)) {
      out.role = "xlsx"; out.confidence = 1;
      out.reasons.push("試算表格式，這一版不解析：請先另存成 CSV");
      return out;
    }
    if (/\.zip$/i.test(name)) {
      out.role = "archive"; out.confidence = 0.6;
      out.reasons.push("壓縮檔：如果這已經是統一 Zip，直接用檢視器載入即可");
      return out;
    }
    if (looksLikeNewick(head)) {
      out.role = "tree"; out.confidence = TREE_EXT_RE.test(name) ? 1 : 0.9;
      out.detail.tips = newickTips(head);
      out.detail.idsRaw = out.detail.tips;
      out.detail.ids = out.detail.tips.map(norm);
      out.reasons.push("內容是括號平衡的 Newick" + (out.detail.tips.length ? "，" + out.detail.tips.length + " 個 tip" : ""));
      return out;
    }
    if (TREE_EXT_RE.test(name)) {
      out.role = "unknown"; out.confidence = 0.3;
      out.reasons.push("副檔名像樹檔，但內容不是有效的 Newick");
      return out;
    }

    var sniff = sniffDelimiter(head);
    if (!sniff) {
      out.role = DOC_EXT_RE.test(name) ? "ignore" : "unknown";
      out.confidence = DOC_EXT_RE.test(name) ? 0.9 : 0.2;
      out.reasons.push(DOC_EXT_RE.test(name) ? "文件/程式碼，不是資料表" : "看不出是表格資料");
      return out;
    }

    var rows = parseHead(head, sniff.delim, 200);
    if (rows.length < 2) { out.role = "unknown"; out.confidence = 0.2; out.reasons.push("表格只有表頭或空白"); return out; }
    var header = rows[0].map(function (h) { return h == null ? "" : h; });
    var body = rows.slice(1);
    var stats = columnStats(header, body);
    out.detail.delimiter = sniff.delim;
    out.detail.header = header;
    out.detail.rowsSeen = body.length;

    var pcCols = header.filter(function (h) { return PC_RE.test(h); });
    var varCols = header.filter(function (h) { return VAR_RE.test(h); });
    var idCol = pickIdColumn(stats);
    if (idCol) {
      out.detail.idColumn = idCol.name;
      // 同時留下原樣與正規化後的值：比對用正規化的，**顯示給使用者一律用原樣**，
      // 否則畫面上會出現我們自己改過的字串（Ghost_sp1 變成 ghost_sp1），等於默默改資料。
      out.detail.idsRaw = body.map(function (r) { return r[idCol.index]; })
                              .filter(function (v) { return v != null && v !== ""; });
      out.detail.ids = out.detail.idsRaw.map(norm);
    }

    // variance：欄名有 variance_explained 之類，列數少（＝PC 個數）
    if (varCols.length) {
      out.role = "variance"; out.confidence = 0.95;
      out.reasons.push("有 " + varCols.join("／") + " 欄");
      out.detail.nPC = body.length;
      return out;
    }
    // crosswalk：tip_label + species_id
    if (header.length <= 4 &&
        header.some(function (h) { return /^tip[_ ]?label$/i.test(h); }) &&
        header.some(function (h) { return /^species[_ ]?id$/i.test(h); })) {
      out.role = "crosswalk"; out.confidence = 0.95;
      out.reasons.push("有 tip_label 與 species_id 兩欄");
      return out;
    }
    // scores：≥2 個 PC 樣式欄
    if (pcCols.length >= 2) {
      out.role = "scores"; out.confidence = 0.95;
      out.detail.pcs = pcCols;
      out.reasons.push(pcCols.length + " 個 PC 欄（" + pcCols.slice(0, 3).join("、") + (pcCols.length > 3 ? "…" : "") + "）");
      if (idCol) out.reasons.push("ID 欄推測為「" + (idCol.name || "第 1 欄（無表頭）") + "」");
      return out;
    }

    var numericCols = stats.filter(function (s) { return s.numericFrac > 0.9; });
    var catCols = stats.filter(function (s) {
      return s.numericFrac < 0.5 && s.unique >= 2 && s.unique <= 40 && s.uniqueFrac < 0.9;
    });

    // 原始資料：數值欄很多但沒有 PC 命名 → 瀏覽器不能算（最高原則 3）
    var landmarkish = header.filter(function (h) { return LANDMARK_RE.test(h); }).length;
    if (landmarkish >= 4 || (numericCols.length >= 8 && !pcCols.length && catCols.length === 0)) {
      out.role = "raw"; out.confidence = landmarkish >= 4 ? 0.9 : 0.6;
      out.reasons.push(landmarkish >= 4
        ? landmarkish + " 個欄位像地標座標（x1、y1…）"
        : numericCols.length + " 個數值欄但沒有 PC 命名");
      out.reasons.push("這看起來是原始資料。瀏覽器不做統計，請先用 R／Python 通用匯出器算好 PCA");
      return out;
    }

    // taxa：有 ID 欄 + 至少一個低基數類別欄
    if (idCol && catCols.length) {
      out.role = "taxa"; out.confidence = 0.8;
      out.detail.groupCandidates = catCols.map(function (s) { return s.name; });
      out.detail.imageCandidates = stats.filter(function (s) { return s.looksLikeFile > 0.5; })
                                        .map(function (s) { return s.name; });
      var taxonish = header.filter(function (h) { return TAXON_NAME_RE.test(h); });
      if (taxonish.length) out.reasons.push("有分類欄位（" + taxonish.slice(0, 3).join("、") + "）");
      out.reasons.push("ID 欄推測為「" + (idCol.name || "第 1 欄（無表頭）") + "」，" +
                       catCols.length + " 個欄位可當分組");
      return out;
    }

    out.role = "unknown"; out.confidence = 0.3;
    out.reasons.push("是表格，但看不出角色（" + header.length + " 欄）");
    return out;
  }

  // ---- C／D 層：跨檔比對 + 組裝計畫 ----
  function classify(files) {
    return crossLink((files || []).map(classifyOne));
  }

  /** 使用者手動改判角色後重算。C／D 層只吃角色與 detail，不需要重讀檔案。 */
  function reclassify(prev) {
    return crossLink(prev.files);
  }

  function crossLink(results) {
    // C 層會把「ID 有 X% 對得到分類檔」這種理由 push 進去。改判角色後要重跑，
    // 所以先還原成單檔判讀時的理由，否則每重跑一次就多累積一份。
    results.forEach(function (r) {
      if (r.baseReasons) r.reasons = r.baseReasons.slice();
      else r.baseReasons = r.reasons.slice();
    });
    var by = function (role) { return results.filter(function (r) { return r.role === role; }); };

    var scores = by("scores"), taxa = by("taxa"), trees = by("tree"), variances = by("variance");
    var images = by("image");

    // taxa 有多個候選時，取「最能涵蓋分數檔 ID」的那個
    var taxaPick = null;
    if (taxa.length === 1) taxaPick = taxa[0];
    else if (taxa.length > 1) {
      taxaPick = taxa.slice().sort(function (a, b) {
        var sa = scores.reduce(function (m, s) { return m + coverage(s.detail.ids, a.detail.ids); }, 0);
        var sb = scores.reduce(function (m, s) { return m + coverage(s.detail.ids, b.detail.ids); }, 0);
        return sb - sa;
      })[0];
      taxaPick.reasons.push("多個分類檔候選中，這個最能涵蓋分數檔的 ID");
    }

    // C 層：把涵蓋率寫回每個檔，這同時是判讀信心也是「缺什麼」的內容
    var tid = taxaPick && taxaPick.detail.ids;
    function unmatched(f, ref) {
      var out = [];
      (f.detail.ids || []).forEach(function (x, i) {
        if (ref.indexOf(x) < 0) out.push((f.detail.idsRaw || [])[i] || x);
      });
      return out;
    }
    scores.forEach(function (s) {
      if (!tid) return;
      s.detail.coverage = coverage(s.detail.ids, tid);
      s.detail.missingIds = unmatched(s, tid).slice(0, 5);
      s.reasons.push("ID 有 " + Math.round(s.detail.coverage * 100) + "% 對得到分類檔");
      if (s.detail.coverage > 0.8) s.confidence = Math.min(1, s.confidence + 0.05);
    });
    trees.forEach(function (t) {
      if (!tid) return;
      t.detail.coverage = coverage(t.detail.ids, tid);
      t.detail.missingIds = unmatched(t, tid).slice(0, 5);
      t.reasons.push("tip 有 " + Math.round(t.detail.coverage * 100) + "% 對得到分類檔");
    });
    images.forEach(function (im) {
      im.detail.matched = tid ? tid.indexOf(im.detail.key) >= 0 : false;
    });

    // variance 配對：檔名共同前綴優先，只有一組時直接配
    variances.forEach(function (v) {
      if (scores.length === 1) { v.detail.pairedWith = scores[0].name; return; }
      var vb = norm(stripExt(v.name)).replace(/_?(variance|var|scree|eigen)_?/g, "");
      var hit = scores.filter(function (s) {
        var sb = norm(stripExt(s.name)).replace(/_?(scores?|pca?|pc)_?/g, "");
        return vb && sb && (vb.indexOf(sb) >= 0 || sb.indexOf(vb) >= 0);
      })[0];
      if (hit) { v.detail.pairedWith = hit.name; v.reasons.push("檔名對應到 " + baseName(hit.name)); }
    });

    // D 層：多個分數檔且 ID 幾乎相同 → 多視圖；差很多 → 疑似不同專案
    var groups = [];
    if (scores.length > 1) {
      var pairwise = [];
      for (var i = 0; i < scores.length; i++)
        for (var j = i + 1; j < scores.length; j++)
          pairwise.push(jaccard(scores[i].detail.ids, scores[j].detail.ids));
      var minJ = Math.min.apply(null, pairwise);
      if (minJ < 0.3) {
        groups = scores.map(function (s) { return baseName(s.name); });
      }
    }

    var plan = {
      views: scores.map(function (s) {
        var v = variances.filter(function (x) { return x.detail.pairedWith === s.name; })[0];
        return { label: viewLabel(s.name, scores), scoresFile: s.name, varianceFile: v ? v.name : null };
      }),
      taxaFile: taxaPick ? taxaPick.name : null,
      idColumn: taxaPick ? (taxaPick.detail.idColumn || "") : null,
      groupColumn: taxaPick ? (taxaPick.detail.groupCandidates || [])[0] || null : null,
      imageColumn: taxaPick ? (taxaPick.detail.imageCandidates || [])[0] || null : null,
      treeFile: trees.length ? trees[0].name : null,
      crosswalkFile: (by("crosswalk")[0] || {}).name || null,
      multipleDatasets: groups
    };

    return { files: results, plan: plan, missing: missingList(results, plan, taxaPick) };
  }

  /** 視圖名：多個分數檔時剝掉共同前後綴，剩下的才是「側視／背視」這種區別。 */
  function viewLabel(name, all) {
    var base = stripExt(name);
    if (all.length < 2) return base.replace(/[_\-]?(scores?|pca)$/i, "") || base;
    var others = all.map(function (s) { return stripExt(s.name); });
    var pre = others.reduce(function (p, s) {
      var k = 0; while (k < p.length && k < s.length && p[k] === s[k]) k++;
      return p.slice(0, k);
    });
    var out = base.slice(pre.length).replace(/^[_\-. ]+/, "").replace(/[_\-]?(scores?|pca)$/i, "");
    return out || base;
  }

  /** 缺什麼：規則要跟 exporters/common/unified_zip.py 的驗證器一致。 */
  function missingList(results, plan, taxaPick) {
    var out = [];
    function need(key, how) { out.push({ level: "required", key: key, how: how }); }
    function opt(key, how) { out.push({ level: "optional", key: key, how: how }); }

    if (!plan.views.length) need("scores", "需要一份「物種 × PC 分數」CSV：第一欄是 species_id，其餘是 PC1、PC2…");
    if (!plan.taxaFile) need("taxa", "需要一份分類 CSV：一欄 species_id，加上至少一個可分組的欄位（科、棲地…）");
    else if (!plan.groupColumn) need("group", "分類檔裡找不到適合分組的欄位（相異值 2～40 的類別欄）");

    plan.views.forEach(function (v) {
      var s = results.filter(function (r) { return r.name === v.scoresFile; })[0];
      if (s && s.detail.coverage != null && s.detail.coverage < 0.99) {
        need("join:" + baseName(v.scoresFile),
             baseName(v.scoresFile) + " 有 " + Math.round((1 - s.detail.coverage) * 100) +
             "% 的 ID 不在分類檔裡" + (s.detail.missingIds.length ? "，例如 " + s.detail.missingIds.join("、") : ""));
      }
    });
    if (plan.treeFile) {
      var t = results.filter(function (r) { return r.name === plan.treeFile; })[0];
      if (t && t.detail.coverage != null && t.detail.coverage < 0.99) {
        opt("join:tree", "樹有 " + Math.round((1 - t.detail.coverage) * 100) + "% 的 tip 對不到分類檔" +
            (t.detail.missingIds.length ? "，例如 " + t.detail.missingIds.join("、") : "") + "；對不到的分支不會被高亮");
      }
    }
    if (!plan.views.some(function (v) { return v.varianceFile; }))
      opt("variance", "沒有 variance CSV，各 PC 的變異解釋比例會由分數估算");
    if (!plan.treeFile) opt("tree", "沒有 Newick 樹檔，網頁不會有親緣樹面板（其餘功能不受影響）");
    if (!results.some(function (r) { return r.role === "image"; }))
      opt("images", "沒有圖片，物種資訊卡會顯示佔位圖（或由學名自動去 GBIF 找代表照）");

    var raw = results.filter(function (r) { return r.role === "raw"; });
    if (raw.length && !plan.views.length) {
      need("raw", "偵測到 " + raw.length + " 份原始資料。瀏覽器不做統計，請先用 R／Python 通用匯出器算好 PCA 再回來");
    }
    return out;
  }

  var Intake = {
    classify: classify, classifyOne: classifyOne, crossLink: crossLink, reclassify: reclassify,
    sniffDelimiter: sniffDelimiter, parseHead: parseHead,
    looksLikeNewick: looksLikeNewick, newickTips: newickTips,
    norm: norm, jaccard: jaccard, coverage: coverage, viewLabel: viewLabel
  };

  if (global) { global.FrogDash = global.FrogDash || {}; global.FrogDash.Intake = Intake; }
  if (typeof module !== "undefined" && module.exports) module.exports = Intake;   // Node 測試用
})(typeof window !== "undefined" ? window : null);
