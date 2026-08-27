/* 建立精靈：讀取使用者 CSV/樹 → 建統一 Zip → 即時預覽 → 下載 / 打包成 Pages 網站。
   全程瀏覽器內完成，無伺服器。 */
(function (global) {
  "use strict";
  var FD = global.FrogDash, Store = FD.Store, UB = FD.UnifiedBuild;
  function T(k, p) { return FD.t ? FD.t(k, p) : k; }

  // 打包時要抓進成品的檢視器檔案（同源，Pages/http 皆可 fetch）。
  // 只列出「進入點」；其餘 css/js/vendor 由 collectAppFiles() 直接從 HTML 掃出來，
  // 避免日後新增模組時忘了加進清單，打包出 404 的壞站。
  // format.html 是用 <a> 連過去的（不是 script/link），不會被自動掃到，所以列為進入點；
  // 它的 markdown.js 等相依就會跟著被收進來。
  var ENTRY_PAGES = ["index.html", "builder.html", "format.html"];
  // 非必要、但帶著更完整的檔案（缺了不算失敗）：讓打包出的站也能看格式說明
  var EXTRA_FILES = ["unified_zip_format.md", "unified_zip_format.en.md",
                     "exporters/unified_zip.R", "exporters/export_generic.py",
                     "exporters/example_generic.R", "exporters/example_generic.py",
                     "sample/scores.csv", "sample/taxa.csv", "sample/variance.csv", "sample/tree.nwk"];

  /** 把相對路徑正規化成以站台根為基準（處理 ../）。 */
  function resolvePath(base, rel) {
    if (/^\//.test(rel)) return rel.replace(/^\/+/, "");
    var dir = base.indexOf("/") >= 0 ? base.replace(/\/[^/]*$/, "").split("/") : [];
    rel.split("/").forEach(function (seg) {
      if (seg === "." || seg === "") return;
      if (seg === "..") dir.pop();
      else dir.push(seg);
    });
    return dir.join("/");
  }
  function packable(p) {
    // 略過內嵌 data:、外部網址、以及打包時才產生的烤入資料
    return p && !/^(data:|https?:|\/\/|#)/i.test(p) && p !== "data/baked.js";
  }

  /** 掃描進入點 HTML 的 <script src>/<link href>，再遞迴追 CSS 的 @import 與 url()，
   *  組出完整打包清單（含 vendored 字型），避免手動清單漏檔導致打包出 404 的壞站。 */
  function collectAppFiles() {
    var files = ENTRY_PAGES.slice();
    function add(p) { if (files.indexOf(p) < 0) { files.push(p); return true; } return false; }

    function scanCss(cssPath) {
      return fetch(cssPath).then(function (r) {
        if (!r.ok) throw new Error("抓取失敗：" + cssPath + "（HTTP " + r.status + "）");
        return r.text();
      }).then(function (css) {
        var re = /url\(\s*['"]?([^'")]+)['"]?\s*\)|@import\s+['"]([^'"]+)['"]/gi, m, nested = [];
        while ((m = re.exec(css))) {
          var raw = (m[1] || m[2] || "").split("?")[0].split("#")[0];
          if (!packable(raw)) continue;
          var p = resolvePath(cssPath, raw);
          if (add(p) && /\.css$/i.test(p)) nested.push(scanCss(p));
        }
        return Promise.all(nested);
      });
    }

    return Promise.all(ENTRY_PAGES.map(function (page) {
      return fetch(page).then(function (r) {
        if (!r.ok) throw new Error("抓取失敗：" + page + "（HTTP " + r.status + "）");
        return r.text();
      }).then(function (html) {
        var re = /<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*"([^"]+)"/gi, m, css = [];
        while ((m = re.exec(html))) {
          var p = m[1].split("?")[0].split("#")[0];
          if (!packable(p)) continue;
          if (add(resolvePath(page, p)) && /\.css$/i.test(p)) css.push(scanCss(resolvePath(page, p)));
        }
        return Promise.all(css);
      });
    })).then(function () { return files; });
  }

  var lastZipBlob = null;
  var taxaText = null, taxaHeader = [];

  function readFileText(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
      r.readAsText(file);
    });
  }
  function el(id) { return document.getElementById(id); }

  /** 自訂檔案選擇：選完後把檔名寫回去，並標記已選狀態。 */
  function syncFilePick(input) {
    var box = input.closest(".filepick");
    if (!box) return;
    var nameEl = box.querySelector(".filepick-name");
    var f = input.files && input.files[0];
    if (nameEl) {
      // 已選檔案時要拔掉 data-i18n，否則切語言時 translateDom() 會把檔名蓋成「未選擇檔案」
      if (f) nameEl.removeAttribute("data-i18n");
      else nameEl.setAttribute("data-i18n", "bld.noFile");
      nameEl.textContent = f ? f.name : T("bld.noFile");
    }
    box.classList.toggle("has-file", !!f);
  }
  function msg(text, kind) {
    var m = el("build-msg");
    m.className = "build-msg" + (kind ? " " + kind : "");
    m.innerHTML = text || "";
  }

  // ---- 視圖列 ----
  var viewSeq = 0;
  function addViewRow(label) {
    viewSeq++;
    var wrap = document.createElement("div");
    wrap.className = "view-row";
    // 這些字串是 JS 動態產生的，一定要帶 data-i18n 屬性：切語言時 translateDom()
    // 只認屬性，寫死的文字會永遠停在建立當下的語言（曾經就是這樣不同步）。
    function pick(cls) {
      return '<span class="filepick">' +
        '<input type="file" class="' + cls + '" accept=".csv" />' +
        '<span class="filepick-btn" data-i18n="bld.pickFile">' + esc(T("bld.pickFile")) + '</span>' +
        '<span class="filepick-name" data-i18n="bld.noFile">' + esc(T("bld.noFile")) + '</span></span>';
    }
    wrap.innerHTML =
      '<div class="view-row-head">' +
        '<input type="text" class="v-label" data-i18n-ph="bld.viewName" placeholder="' + esc(T("bld.viewName")) + '" value="' + esc(label || "") + '" />' +
        '<button class="btn small v-del" data-i18n-title="bld.vDel" title="' + esc(T("bld.vDel")) + '" aria-label="' + esc(T("bld.vDel")) + '">✕</button>' +
      '</div>' +
      '<label class="mini"><span data-i18n="bld.vScores">' + esc(T("bld.vScores")) + '</span>' + pick("v-scores") + '</label>' +
      '<label class="mini"><span data-i18n="bld.vVar">' + esc(T("bld.vVar")) + '</span>' + pick("v-var") + '</label>';
    wrap.querySelector(".v-del").addEventListener("click", function () { wrap.remove(); });
    el("views-list").appendChild(wrap);
  }

  // ---- 分類欄位對應 ----
  // fallbackIdx 給 null 代表「猜不到就不要選」（用於可留空的欄位，如圖片欄）
  function guess(header, cands, fallbackIdx) {
    for (var i = 0; i < cands.length; i++) {
      var idx = header.findIndex(function (h) { return h.toLowerCase() === cands[i]; });
      if (idx >= 0) return header[idx];
    }
    if (fallbackIdx == null) return "";
    return header[fallbackIdx] != null ? header[fallbackIdx] : header[0];
  }
  function fillSelect(sel, header, chosen, allowNone) {
    sel.innerHTML = "";
    if (allowNone) { var o = document.createElement("option"); o.value = ""; o.textContent = T("bld.none"); sel.appendChild(o); }
    header.forEach(function (h, i) {
      var o = document.createElement("option");
      o.value = h;
      // R 的 write.csv 會把 row names 欄寫成空表頭；值仍必須保持原樣才 join 得到
      o.textContent = h === "" ? T("bld.firstCol", { i: i + 1 }) : h;
      if (h === chosen) o.selected = true; sel.appendChild(o);
    });
  }
  /** 切語言後把欄位下拉重畫一次，保留目前選到的欄位。 */
  function relabelSelects() {
    if (!taxaHeader.length) return;
    [["m-id", false], ["m-label", false], ["m-group", false], ["m-image", true]]
      .forEach(function (p) {
        var sel = el(p[0]);
        if (sel) fillSelect(sel, taxaHeader, sel.value, p[1]);
      });
  }

  /* ---- 用 DOI 帶入資料集資訊 ----
     一個 doi.org 內容協商端點同時吃期刊（Crossref）與資料集（DataCite）DOI，
     所以不必判斷 DOI 屬於誰。已經填好的標題不覆蓋，避免蓋掉使用者自己打的字。 */
  function initDoiFetch() {
    var btn = el("doi-fetch"), input = el("f-doi"), out = el("doi-msg");
    if (!btn || !input) return;
    function say(text, kind) {
      if (!out) return;
      out.className = "dim small" + (kind ? " " + kind : "");
      out.innerHTML = text;
      out.hidden = !text;
    }
    function run() {
      var DOI = FD.DOI;
      var doi = DOI ? DOI.normalize(input.value) : "";
      if (!doi) { say('<span class="err">' + esc(T("bld.doiBad")) + "</span>"); return; }
      say(esc(T("bld.doiLoading")));
      btn.disabled = true;
      Promise.all([DOI.meta(doi), DOI.cite(doi).catch(function () { return null; })])
        .then(function (r) {
          var m = r[0], apa = r[1];
          if (!el("f-title").value.trim() && m.title) el("f-title").value = m.title;
          if (!el("f-source").value.trim() && m.url) el("f-source").value = m.url;
          if (!el("f-cite").value.trim() && apa) el("f-cite").value = apa;
          input.value = m.doi;
          var extra = [];
          if (m.license) extra.push(esc(T("bld.doiLicense", { l: m.license.label })));
          say('<span class="ok">' + esc(T("bld.doiOk", { t: m.title || m.doi })) + "</span>" +
              (extra.length ? " · " + extra.join(" · ") : ""));
          // 論文 ↔ 資料 DOI：查得到就提示另一個，讓使用者知道還有一半可以填
          return DOI.related(doi).then(function (rel) {
            var other = rel.paper || rel.data;
            if (!other) return;
            var k = rel.paper ? "bld.doiPaper" : "bld.doiData";
            out.innerHTML += ' · ' + esc(T(k)) + ' <a href="https://doi.org/' + esc(other) +
              '" target="_blank" rel="noopener">' + esc(other) + "</a>";
          }).catch(function () {});
        })
        .catch(function (e) {
          say('<span class="err">' + esc(T("bld.doiFail", { msg: e.message || e })) + "</span>");
        })
        .then(function () { btn.disabled = false; });
    }
    btn.addEventListener("click", run);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); run(); } });
  }

  /** 切語言時要跟著處理的動態內容。 */
  function onLangChange() {
    relabelSelects();
    // 狀態訊息是即時拼出來的字串（含檔名、標題、錯誤訊息），沒辦法用屬性重譯；
    // 留著就會變成「中文介面配英文訊息」或反過來。當下狀態已經過去了，直接清掉。
    [el("doi-msg"), el("build-msg")].forEach(function (m) {
      if (!m) return;
      m.innerHTML = "";
      if (m.id === "doi-msg") m.hidden = true;
    });
  }

  function onTaxaFile(file) {
    readFileText(file).then(function (text) {
      taxaText = text;
      var rows = FD.parseCSV(text);
      taxaHeader = (rows[0] || []).map(function (h) { return h == null ? "" : h; });
      fillSelect(el("m-id"), taxaHeader, guess(taxaHeader, ["species_id", "id", "gensp"], 0));
      fillSelect(el("m-label"), taxaHeader, guess(taxaHeader, ["display_label", "gensp", "name", "label"], 0));
      fillSelect(el("m-group"), taxaHeader, guess(taxaHeader, ["clade", "fam.subfam", "subfamily", "family", "group"], Math.min(1, taxaHeader.length - 1)));
      fillSelect(el("m-image"), taxaHeader, guess(taxaHeader, ["image", "img", "photo"], null), true);
      // 資訊欄位複選
      var box = el("m-info"); box.innerHTML = "";
      taxaHeader.forEach(function (h) {
        var lab = document.createElement("label"); lab.className = "chip-pick";
        lab.innerHTML = '<input type="checkbox" value="' + h.replace(/"/g, "&quot;") + '" /> ' + h;
        box.appendChild(lab);
      });
      el("taxa-map").hidden = false;
    }).catch(function (e) {
      console.error(e);
      msg('<span class="err">' + esc(T("bld.errTaxa", { msg: e.message || e })) + "</span>");
    });
  }

  // ---- 收集輸入 ----
  function collectInputs() {
    if (!taxaText) throw uiErr(T("bld.needTaxa"));
    var rows = Array.prototype.slice.call(document.querySelectorAll("#views-list .view-row"));
    if (!rows.length) throw uiErr(T("bld.needView"));

    var infoCols = Array.prototype.slice.call(document.querySelectorAll("#m-info input:checked"))
      .map(function (c) { return c.value; });

    var viewFilePromises = rows.map(function (r) {
      var label = r.querySelector(".v-label").value.trim();
      var sf = r.querySelector(".v-scores").files[0];
      var vf = r.querySelector(".v-var").files[0];
      if (!sf) throw uiErr(T("bld.needScores", { label: label || T("bld.unnamed") }));
      return Promise.all([readFileText(sf), vf ? readFileText(vf) : Promise.resolve(null)])
        .then(function (res) { return { label: label || sf.name.replace(/\.csv$/i, ""), scoresText: res[0], varianceText: res[1] }; });
    });

    var treeFile = el("f-tree").files[0];
    var treePromise = treeFile ? readFileText(treeFile) : Promise.resolve(null);

    return Promise.all([Promise.all(viewFilePromises), treePromise]).then(function (r) {
      return {
        dataset: {
          title: el("f-title").value.trim(), doi: el("f-doi").value.trim(),
          citation: el("f-cite").value.trim(), source_url: el("f-source").value.trim()
        },
        views: r[0],
        taxa: {
          text: taxaText, idCol: el("m-id").value, labelCol: el("m-label").value,
          groupCol: el("m-group").value, imageCol: el("m-image").value || null, infoCols: infoCols
        },
        tree: { newick: r[1] }
      };
    });
  }

  // ---- 建立 & 預覽 ----
  function buildBlob() {
    return collectInputs().then(function (inputs) {
      return UB.buildZipBlob(inputs);
    });
  }

  function preview() {
    msg(T("bld.building"));
    buildBlob().then(function (out) {
      lastZipBlob = out.blob;
      return FD.Loader.fromBlob(out.blob).then(function (model) {
        Store.setData(model);
        el("preview-empty").hidden = true;
        el("dashboard").hidden = false;
        el("btn-zip").disabled = false;
        el("btn-package").disabled = false;
        // 有資料了，搜尋/清除才有意義；提示也不再需要
        var hint = el("builder-hint"); if (hint) hint.hidden = true;
        var sw = el("search-wrap"); if (sw) sw.hidden = false;
        var cb = el("clear-btn"); if (cb) cb.hidden = false;
        // 建立預覽鈕在左欄底部，右欄可能還停在上次的捲動位置——拉回頂端才看得到 PCA 圖
        var pv = document.querySelector(".builder-preview"); if (pv) pv.scrollTop = 0;
        setTimeout(function () { global.dispatchEvent(new Event("resize")); if (FD.TreeView) FD.TreeView.resize(); }, 60);
        var w = out.warnings.length
          ? '<div class="warn">' + esc(T("bld.warnN", { n: out.warnings.length })) + '<br>' + out.warnings.slice(0, 6).map(esc).join("<br>") + '</div>'
          : "";
        msg('<span class="ok">' + esc(T("bld.ok", { n: model.joinReport.nTaxa })) + '</span>' + w, "");
      });
    }).catch(function (e) {
      console.error(e);
      msg('<span class="err">' + esc(T("bld.errBuild", { msg: e.userFacing ? e.message : (e.message || e) })) + "</span>", "");
    });
  }

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a"); a.href = url; a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function downloadZip() {
    if (lastZipBlob) downloadBlob(lastZipBlob, (slugTitle() || "dataset") + "_unified.zip");
  }

  // ---- 打包成 Pages 網站 ----
  function blobToBase64(blob) {
    return blob.arrayBuffer().then(function (buf) {
      var b = new Uint8Array(buf), CHUNK = 0x8000, s = "";
      for (var i = 0; i < b.length; i += CHUNK) s += String.fromCharCode.apply(null, b.subarray(i, i + CHUNK));
      return btoa(s);
    });
  }
  function packageSite() {
    if (!lastZipBlob) { msg('<span class="err">' + esc(T("bld.needPreview")) + '</span>'); return; }
    msg(T("bld.packing"));
    var out = new JSZip();
    collectAppFiles()
      .then(function (appFiles) {
        var required = appFiles.map(function (path) {
          return fetch(path).then(function (r) {
            if (!r.ok) throw new Error("抓取失敗：" + path + "（HTTP " + r.status + "）");
            return r.blob().then(function (b) { out.file(path, b); });
          });
        });
        var optional = EXTRA_FILES.map(function (path) {
          return fetch(path).then(function (r) {
            return r.ok ? r.blob().then(function (b) { out.file(path, b); }) : null;
          }).catch(function () { return null; });
        });
        return Promise.all(required.concat(optional));
      })
      .then(function () { return blobToBase64(lastZipBlob); })
      .then(function (b64) {
        out.file("data/baked.js",
          "/* 內嵌資料（統一 Zip，base64）：本站開啟即自動載入，觀看者不需再上傳。*/\n" +
          'window.FROG_BAKED_ZIP_BASE64="' + b64 + '";\n');
        out.file(".nojekyll", "");
        return out.generateAsync({ type: "blob", compression: "DEFLATE" });
      })
      .then(function (siteBlob) {
        var fname = (slugTitle() || "my-pca-dashboard") + "_site.zip";
        el("tut-filename").textContent = fname;
        downloadBlob(siteBlob, fname);
        el("tutorial-modal").hidden = false;
        msg('<span class="ok">' + esc(T("bld.dlDone", { name: fname })) + '</span>');
      })
      .catch(function (e) { console.error(e); msg('<span class="err">' + esc(T("bld.errPack", { msg: e.message || e })) + "</span>"); });
  }

  function slugTitle() {
    return (el("f-title").value.trim() || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function uiErr(m) { var e = new Error(m); e.userFacing = true; return e; }

  function initPreviewControls() {
    document.addEventListener("click", function (e) {
      var dl = e.target.closest(".dl");
      if (dl) {
        var vid = dl.dataset.view;
        Plotly.downloadImage(el(vid + "-plot"), { format: "png", width: 1000, height: 800, filename: vid + "_pca" });
      }
    });
    var seg = el("tree-mode");
    if (seg) seg.addEventListener("click", function (e) {
      var b = e.target.closest(".seg-btn"); if (!b) return;
      seg.querySelectorAll(".seg-btn").forEach(function (x) { x.classList.toggle("active", x === b); });
      FD.TreeView.setMode(b.dataset.mode);
    });
    var fit = document.querySelector(".fit-tree"); if (fit) fit.addEventListener("click", function () { FD.TreeView.resize(); });
    var exp = document.querySelector(".expand-tree"); if (exp) exp.addEventListener("click", function () {
      var e = FD.TreeView.toggleExpandAll(); exp.textContent = T(e ? "tree.collapse" : "tree.expandAll");
    });
    var dlt = document.querySelector(".dl-tree"); if (dlt) dlt.addEventListener("click", function () { FD.TreeView.exportPNG(); });
    var clr = el("clear-btn"); if (clr) clr.addEventListener("click", function () { Store.clearHighlight(); });
  }

  function main() {
    // 先綁表單，再初始化預覽模組：任何預覽模組出狀況都不該讓整個精靈失去互動。
    addViewRow("");
    el("add-view").addEventListener("click", function () { addViewRow(""); });
    // 所有檔案選擇器（含動態新增的視圖列）統一用委派更新檔名顯示
    document.addEventListener("change", function (e) {
      if (e.target && e.target.type === "file") syncFilePick(e.target);
    });
    el("f-taxa").addEventListener("change", function (e) { if (e.target.files[0]) onTaxaFile(e.target.files[0]); });
    initDoiFetch();
    el("btn-preview").addEventListener("click", preview);
    el("btn-zip").addEventListener("click", downloadZip);
    el("btn-package").addEventListener("click", packageSite);
    document.querySelectorAll("[data-close-tut]").forEach(function (x) {
      x.addEventListener("click", function () { el("tutorial-modal").hidden = true; });
    });

    // 切語言時重建欄位下拉：選項文字裡有「（無）」「（第 N 欄，無標題）」這種
    // 翻譯字串，是 JS 塞進 option 的，translateDom() 碰不到，得自己重畫。
    new MutationObserver(onLangChange).observe(document.documentElement,
      { attributes: true, attributeFilter: ["data-lang"] });

    // 預覽用模組（重用檢視器）：即使某個模組初始化失敗，左側表單仍可正常操作。
    try {
      FD.initPCA(); FD.TreeView.init(); FD.initInfoPanel(); FD.initSearch();
      initPreviewControls();
    } catch (e) {
      console.error(e);
      msg('<span class="err">' + esc(T("bld.errInit", { msg: e.message || e })) + "</span>");
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", main);
  else main();
})(window);
