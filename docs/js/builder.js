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

  var taxaReady = null;                 // 最近一次 onTaxaFile 的 promise，套用計畫時要等它

  /* ---- ⓪ 智慧投入 ----
     判讀核心在 intake.js（純函式、不碰 DOM，用 Node 語料庫測試）。這裡只負責
     讀檔頭、畫表、把計畫填回步驟 ①～④。

     填回去的方式是用 DataTransfer 把 File 塞進原本的 <input type="file"> 再觸發 change，
     所以既有的整條處理管線（syncFilePick / onTaxaFile / collectInputs）原封不動重用，
     不會出現「投入路徑」與「手動路徑」兩套行為不一致的問題。 */
  var HEAD_BYTES = 64 * 1024;
  var intakeFiles = [];        // File 物件，key 為相對路徑
  var intakeResult = null;

  function readHead(file) {
    return file.slice(0, HEAD_BYTES).text
      ? file.slice(0, HEAD_BYTES).text()
      : new Promise(function (res) {
          var r = new FileReader();
          r.onload = function () { res(r.result); };
          r.onerror = function () { res(""); };
          r.readAsText(file.slice(0, HEAD_BYTES));
        });
  }

  function relPath(f) { return f.webkitRelativePath || f.name; }

  /** 拖進來的可能是資料夾：用 webkitGetAsEntry 遞迴展開。 */
  function filesFromDataTransfer(dt) {
    var items = dt.items;
    if (!items || !items.length || !items[0].webkitGetAsEntry) {
      return Promise.resolve(Array.prototype.slice.call(dt.files));
    }
    var roots = [];
    for (var i = 0; i < items.length; i++) {
      var e = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
      if (e) roots.push(e);
    }
    var out = [];
    function walk(entry, prefix) {
      if (entry.isFile) {
        return new Promise(function (res) {
          entry.file(function (f) {
            try { f.__rel = prefix + entry.name; } catch (e) {}
            out.push(f); res();
          }, res);
        });
      }
      var reader = entry.createReader(), all = [];
      function batch() {
        return new Promise(function (res) {
          reader.readEntries(function (ents) {
            if (!ents.length) return res();
            all = all.concat(ents);
            batch().then(res);
          }, res);
        });
      }
      return batch().then(function () {
        return Promise.all(all.map(function (c) { return walk(c, prefix + entry.name + "/"); }));
      });
    }
    return Promise.all(roots.map(function (r) { return walk(r, ""); })).then(function () { return out; });
  }

  function intakeMsg(text, kind) {
    var m = el("intake-msg");
    if (!m) return;
    m.className = "dim small" + (kind ? " " + kind : "");
    m.innerHTML = text || "";
    m.hidden = !text;
  }

  function runIntake(files) {
    if (!files.length) return;
    intakeMsg(esc(T("itk.reading", { n: files.length })));
    intakeFiles = files;
    Promise.all(files.map(function (f) {
      return readHead(f).then(function (head) {
        return { name: f.__rel || relPath(f), size: f.size, head: head };
      }).catch(function () { return { name: f.__rel || relPath(f), size: f.size, head: "" }; });
    })).then(function (descs) {
      descs.forEach(function (d, i) { files[i].__rel = d.name; });
      intakeResult = FD.Intake.classify(descs);
      renderIntake();
      intakeMsg("");
    }).catch(function (e) {
      console.error(e);
      intakeMsg('<span class="err">' + esc(T("itk.failed", { msg: e.message || e })) + "</span>");
    });
  }

  var ROLE_ORDER = ["scores", "variance", "taxa", "tree", "crosswalk", "raw", "image", "xlsx", "archive", "unknown", "ignore"];
  function roleLabel(r) { return T("itk.role." + r); }

  function renderIntake() {
    var res = intakeResult, box = el("intake-result"), tbl = el("intake-table");
    if (!res || !box || !tbl) return;
    box.hidden = false;

    var usable = res.files.filter(function (f) { return ROLE_ORDER.indexOf(f.role) < 5; }).length;
    var imgs = res.files.filter(function (f) { return f.role === "image"; }).length;
    el("intake-count").textContent = T("itk.count", { total: res.files.length, usable: usable, images: imgs });

    // 缺什麼：必要在前、可選在後，每項都附「怎麼補」
    var mbox = el("intake-missing");
    var req = res.missing.filter(function (m) { return m.level === "required"; });
    var opt = res.missing.filter(function (m) { return m.level === "optional"; });
    var mh = "";
    if (req.length) {
      mh += '<div class="miss-grp err"><b>' + esc(T("itk.missRequired")) + "</b><ul>" +
        req.map(function (m) { return "<li>" + esc(m.how) + "</li>"; }).join("") + "</ul></div>";
    } else {
      mh += '<div class="miss-grp ok"><b>' + esc(T("itk.ready")) + "</b></div>";
    }
    if (opt.length) {
      mh += '<div class="miss-grp"><b>' + esc(T("itk.missOptional")) + "</b><ul>" +
        opt.map(function (m) { return "<li>" + esc(m.how) + "</li>"; }).join("") + "</ul></div>";
    }
    if (res.plan.multipleDatasets.length) {
      mh = '<div class="miss-grp warn"><b>' +
        esc(T("itk.multi", { n: res.plan.multipleDatasets.length })) + "</b><ul>" +
        res.plan.multipleDatasets.map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("") +
        "</ul></div>" + mh;
    }
    mbox.innerHTML = mh;
    mbox.hidden = false;
    renderImages();
    el("intake-apply").disabled = req.length > 0;

    // 判讀表：一律攤開，但可以「全部接受」一鍵通過（決定 4）
    var rows = res.files.slice().sort(function (a, b) {
      return ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.name.localeCompare(b.name);
    });
    var shown = rows.filter(function (r) { return r.role !== "ignore"; });
    var hidden = rows.length - shown.length;
    tbl.innerHTML =
      "<thead><tr><th>" + esc(T("itk.thFile")) + "</th><th>" + esc(T("itk.thRole")) +
      "</th><th>" + esc(T("itk.thWhy")) + "</th></tr></thead><tbody>" +
      shown.map(function (f, i) {
        var sel = '<select class="itk-role" data-i="' + res.files.indexOf(f) + '">' +
          ROLE_ORDER.map(function (r) {
            return '<option value="' + r + '"' + (r === f.role ? " selected" : "") + ">" + esc(roleLabel(r)) + "</option>";
          }).join("") + "</select>";
        return '<tr class="itk-' + f.role + '"><td class="itk-name" title="' + esc(f.name) + '">' +
          esc(f.name) + "</td><td>" + sel + '</td><td class="itk-why">' +
          esc(f.reasons.join("；")) + "</td></tr>";
      }).join("") +
      (hidden ? '<tr class="itk-ignore"><td colspan="3" class="dim">' +
        esc(T("itk.hidden", { n: hidden })) + "</td></tr>" : "") +
      "</tbody>";
  }

  /** 使用者改判某個檔的角色 → 重跑跨檔比對（涵蓋率、計畫、缺什麼都會跟著變）。
      C／D 層只吃角色與已算好的 detail，不必重讀檔案，所以很快。 */
  function overrideRole(idx, role) {
    if (!intakeResult) return;
    var f = intakeResult.files[idx];
    if (!f || f.role === role) return;
    f.role = role;
    f.confidence = 1;
    f.baseReasons = [T("itk.manual")];     // crossLink 會由此還原，不能只改 reasons
    intakeResult = FD.Intake.reclassify(intakeResult);
    renderIntake();
  }

  /** 把 File 塞進既有的 <input type="file"> 並觸發 change，重用整條既有管線。 */
  function assign(input, file) {
    if (!input) return false;
    try {
      var dt = new DataTransfer();
      if (file) dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    } catch (e) { console.error("assign", e); return false; }
  }
  function fileByName(name) {
    for (var i = 0; i < intakeFiles.length; i++) if (intakeFiles[i].__rel === name) return intakeFiles[i];
    return null;
  }

  function applyPlan() {
    var p = intakeResult && intakeResult.plan;
    if (!p) return;
    // 視圖列全部重建，數量對齊計畫
    el("views-list").innerHTML = "";
    p.views.forEach(function (v) { addViewRow(v.label); });
    var rows = Array.prototype.slice.call(document.querySelectorAll("#views-list .view-row"));
    p.views.forEach(function (v, i) {
      if (!rows[i]) return;
      assign(rows[i].querySelector(".v-scores"), fileByName(v.scoresFile));
      if (v.varianceFile) assign(rows[i].querySelector(".v-var"), fileByName(v.varianceFile));
    });
    if (p.treeFile) assign(el("f-tree"), fileByName(p.treeFile));

    if (!p.taxaFile) { msg('<span class="ok">' + esc(T("itk.applied")) + "</span>"); return; }
    assign(el("f-taxa"), fileByName(p.taxaFile));
    // onTaxaFile 是非同步的：要等下拉填好，選欄位才有效
    (taxaReady || Promise.resolve()).then(function () {
      function pick(id, val) {
        var sel = el(id);
        if (sel && val != null && Array.prototype.some.call(sel.options, function (o) { return o.value === val; })) sel.value = val;
      }
      pick("m-group", p.groupColumn);
      pick("m-image", p.imageColumn);
      msg('<span class="ok">' + esc(T("itk.applied")) + "</span>");
    }).catch(function () {});
  }

  function initIntake() {
    var drop = el("intake-drop");
    if (!drop || !FD.Intake) return;
    el("intake-pick-dir").addEventListener("click", function () { el("intake-dir").click(); });
    el("intake-pick-files").addEventListener("click", function () { el("intake-files").click(); });
    ["intake-dir", "intake-files"].forEach(function (id) {
      el(id).addEventListener("change", function (e) {
        runIntake(Array.prototype.slice.call(e.target.files));
      });
    });
    ["dragenter", "dragover"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("over"); });
    });
    drop.addEventListener("drop", function (e) {
      e.preventDefault();
      filesFromDataTransfer(e.dataTransfer).then(runIntake);
    });
    el("intake-apply").addEventListener("click", applyPlan);
    el("img-resize").addEventListener("change", renderImages);
    el("img-mode").addEventListener("change", function () { imgDone = null; });
    el("intake-reset").addEventListener("click", function () {
      intakeFiles = []; intakeResult = null;
      el("intake-result").hidden = true; intakeMsg("");
    });
    el("intake-table").addEventListener("change", function (e) {
      var sel = e.target.closest(".itk-role");
      if (sel) overrideRole(+sel.dataset.i, sel.value);
    });
  }

  function onTaxaFile(file) {
    taxaReady = readFileText(file).then(function (text) {
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
    return taxaReady;
  }

  // ---- 收集輸入 ----

  /* ---- 圖片（第 3 期）----
     規劃／命名／預算在 images.js（純函式，Node 測試釘住）；這裡只負責 UI 與時機。
     圖片目前只從「投入」進來——手動路徑沒有地方放一整個資料夾。 */
  var imgPlan = null;            // planImages() 的結果
  var imgDone = null;            // { resize, entries } 處理結果快取，設定沒變就不重做

  function imgFiles() {
    if (!intakeResult) return [];
    return intakeResult.files.filter(function (f) { return f.role === "image"; })
      .map(function (f) { return { name: f.name, size: f.size }; });
  }

  /** 判讀完（或改判、或改設定）後重算圖片計畫與預算。 */
  function renderImages() {
    var panel = el("img-panel");
    if (!panel || !FD.Images) return;
    var Im = FD.Images;
    var files = imgFiles();
    var taxa = intakeResult && intakeResult.plan.taxaFile
      ? intakeResult.files.filter(function (f) { return f.name === intakeResult.plan.taxaFile; })[0] : null;
    if (!files.length || !taxa) { panel.hidden = true; imgPlan = null; return; }
    panel.hidden = false;

    var resize = el("img-resize").checked;
    imgPlan = Im.planImages(files, taxa.detail.idsRaw || [], { resize: resize });
    var est = Im.estimate(imgPlan.pairs.map(function (p) { return p.size; }), { resize: resize });

    el("img-summary").textContent = T("img.summary", {
      n: files.length, covered: imgPlan.covered, total: imgPlan.total, size: Im.humanBytes(est.outBytes)
    });

    // 內嵌只適合少量小圖：超過就擋住，並說明為什麼
    var mode = el("img-mode");
    var embedOk = imgPlan.pairs.length <= 50 && est.outBytes <= 20 * 1024 * 1024;
    mode.options[1].disabled = !embedOk;
    if (!embedOk && mode.value === "embed") mode.value = "loose";

    var notes = [];
    est.warnings.forEach(function (w) {
      notes.push('<div class="note ' + (w.level === "error" ? "err" : "warn") + '">' +
        esc(T("img.warn." + w.key, { v: Im.humanBytes(w.value), n: w.value })) + "</div>");
    });
    if (imgPlan.extra.length) {
      notes.push('<div class="note dim">' + esc(T("img.extra", { n: imgPlan.extra.length })) +
        " " + esc(imgPlan.extra.slice(0, 3).map(function (x) { return x.split("/").pop(); }).join("、")) +
        (imgPlan.extra.length > 3 ? "…" : "") + "</div>");
    }
    if (imgPlan.dupes.length) {
      notes.push('<div class="note dim">' + esc(T("img.dupes", { n: imgPlan.dupes.length })) + "</div>");
    }
    if (imgPlan.ambiguous && imgPlan.ambiguous.length) {
      notes.push('<div class="note warn">' + esc(T("img.ambiguous", {
        n: imgPlan.ambiguous.length, ids: imgPlan.ambiguous[0].ids.join(" / ")
      })) + "</div>");
    }
    if (!embedOk) notes.push('<div class="note dim">' + esc(T("img.embedOff")) + "</div>");
    el("img-notes").innerHTML = notes.join("");
    imgDone = null;                       // 設定變了，之前處理好的不算數
  }

  /** 真的把圖片處理成 blob。回傳 buildZipBlob 要的 inputs.images。 */
  function ensureImages() {
    if (!imgPlan || !imgPlan.pairs.length) return Promise.resolve(null);
    var resize = el("img-resize").checked, mode = el("img-mode").value;
    if (imgDone && imgDone.resize === resize) return Promise.resolve({ mode: mode, entries: imgDone.entries });
    msg(T("img.processing", { n: imgPlan.pairs.length, done: 0 }));
    return FD.Images.processAll(imgPlan, fileByName, { resize: resize }, function (done, total) {
      if (done % 10 === 0 || done === total) msg(T("img.processing", { n: total, done: done }));
    }).then(function (res) {
      imgDone = { resize: resize, entries: res.entries };
      if (res.failed.length) {
        // 解不開的檔（HEIC、損毀檔）不讓整批失敗，但也絕不靜默跳過
        warnFromImages = T("img.failed", {
          n: res.failed.length,
          names: res.failed.slice(0, 3).map(function (x) { return x.file.split("/").pop(); }).join("、")
        });
      } else warnFromImages = null;
      return { mode: mode, entries: res.entries };
    });
  }
  var warnFromImages = null;

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
      return ensureImages().then(function (images) {
        if (images) inputs.images = images;
        return UB.buildZipBlob(inputs);
      });
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
        // 圖片解不開（HEIC、損毀檔）不讓整批失敗，但一定要說出來
        if (warnFromImages) w += '<div class="warn">' + esc(warnFromImages) + "</div>";
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
        // 散檔圖片：跟著站台一起進 zip，解開後 git add . 就一併上去。
        // JPEG 已經壓過了，再 DEFLATE 只是浪費 CPU。
        if (imgDone && el("img-mode").value === "loose") {
          imgDone.entries.forEach(function (e) {
            out.file("img/" + e.out, e.blob, { compression: "STORE" });
          });
        }
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
    initIntake();
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
