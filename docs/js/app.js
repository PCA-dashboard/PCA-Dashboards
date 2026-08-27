/* 主程式：整合各模組、處理載入（上傳 / 拖放 / 範例 / 烤入資料）、狀態與下載。 */
(function (global) {
  "use strict";
  var FD = global.FrogDash, Store = FD.Store;

  var statusEl, welcomeEl, dashboardEl;

  function T(k, p) { return FD.t ? FD.t(k, p) : k; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // 目前資料集的來源，供「下載資料」使用：{ url } 或 { blob }（烤入 / 上傳的情況）
  var currentSource = null;

  function setStatus(msg, kind) {
    if (!msg) { statusEl.hidden = true; statusEl.className = "status"; return; }
    statusEl.hidden = false;
    statusEl.className = "status " + (kind || "");
    statusEl.textContent = msg;
  }

  function showDashboard() {
    welcomeEl.hidden = true;
    dashboardEl.hidden = false;
    // Plotly 需在容器可見後重新計算尺寸
    setTimeout(function () {
      window.dispatchEvent(new Event("resize"));
      if (FD.TreeView) FD.TreeView.resize();
    }, 50);
  }

  function loadVia(promise, label, remoteCfg, gbifField) {
    var T = function (k, p) { return FD.t ? FD.t(k, p) : k; };
    if (FD.setupRemoteImages) FD.setupRemoteImages(remoteCfg || null);  // 依資料集設定遠端影像
    FD.gbifFallback = gbifField || null;                                 // GBIF 學名備援欄位（無則關閉）
    setStatus(T("st.loading", { label: label || T("st.loadingDefault") }), "loading");
    return promise.then(function (model) {
      Store.setData(model);
      var subtitle = document.getElementById("dataset-subtitle");
      if (subtitle && model.dataset.title) subtitle.textContent = model.dataset.title;
      var rep = model.joinReport;
      setStatus(T("st.loaded", { n: rep.nTaxa, v: model.viewOrder.length, tree: rep.nTree }), "success");
      showDashboard();
      setTimeout(function () { setStatus(null); }, 4000);
    }).catch(function (e) {
      console.error(e);
      setStatus(T("st.failed", { msg: (e.userFacing ? e.message : (e.message || e)) }), "error");
    });
  }

  function initLoaders() {
    document.getElementById("zip-input").addEventListener("change", function (e) {
      var f = e.target.files[0];
      if (f) { currentSource = { blob: f, name: f.name }; loadVia(FD.Loader.fromBlob(f), "讀取 " + f.name); }
    });
    var demoBtn = document.getElementById("demo-btn");
    if (demoBtn) demoBtn.addEventListener("click", function () {
      currentSource = { url: "data/frog_demo.zip", name: "frog_demo.zip" };
      loadVia(FD.Loader.fromUrl("data/frog_demo.zip"), "載入青蛙範例");
    });

    // 拖放
    var drop = welcomeEl;
    ["dragenter", "dragover"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("drag"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("drag"); });
    });
    drop.addEventListener("drop", function (e) {
      var f = e.dataTransfer.files[0];
      if (f && /\.zip$/i.test(f.name)) {
        currentSource = { blob: f, name: f.name };
        loadVia(FD.Loader.fromBlob(f), "讀取 " + f.name);
      }
    });
  }

  // 烤入資料（單一資料集自包含站）：存在則直接載入
  function loadBaked() {
    var bin = atob(global.FROG_BAKED_ZIP_BASE64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    currentSource = { blob: new Blob([bytes], { type: "application/zip" }), name: "dataset.zip" };
    loadVia(FD.Loader.fromArrayBuffer(bytes.buffer), "載入內嵌資料");
  }

  // ---- Gallery：多資料集選單（data/catalog.json）----
  var catalog = null, currentId = null;
  function hashId() {
    var m = /(?:^|[#&])dataset=([^&]+)/.exec(location.hash || "");
    return m ? decodeURIComponent(m[1]) : null;
  }
  function selectDataset(id, updateHash) {
    if (!catalog) return;
    var ds = catalog.datasets.filter(function (d) { return d.id === id; })[0];
    if (!ds) ds = catalog.datasets[0];
    currentId = ds.id;
    var picker = document.getElementById("dataset-picker");
    if (picker) picker.value = ds.id;
    if (updateHash) location.hash = "dataset=" + ds.id;
    var gbifField = ds.gbif_fallback === true ? "display_label" : (ds.gbif_fallback && ds.gbif_fallback.name_field) || null;
    currentSource = { url: ds.zip, name: ds.id + ".zip", ds: ds };
    loadVia(FD.Loader.fromUrl(ds.zip), "載入 " + (ds.short || ds.title), ds.remote_images, gbifField);
  }
  function initGallery() {
    return fetch("data/catalog.json").then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cat) {
        if (!cat || !cat.datasets || !cat.datasets.length) return false;
        catalog = cat;
        var picker = document.getElementById("dataset-picker");
        picker.innerHTML = "";
        cat.datasets.forEach(function (ds) {
          var o = document.createElement("option");
          o.value = ds.id; o.textContent = ds.short || ds.title; o.title = ds.description || "";
          picker.appendChild(o);
        });
        document.getElementById("dataset-switch").hidden = false;
        picker.addEventListener("change", function () { selectDataset(picker.value, true); });
        window.addEventListener("hashchange", function () {
          var id = hashId(); if (id && id !== currentId) selectDataset(id, false);
        });
        selectDataset(hashId() || cat.default || cat.datasets[0].id, false);
        return true;
      }).catch(function () { return false; });
  }

  // ---- 下載此資料集的統一 Zip（讓看完 demo 的人照著格式做自己的）----
  function saveBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }
  function downloadCurrentData() {
    var T = function (k, p) { return FD.t ? FD.t(k, p) : k; };
    var note = document.getElementById("dl-note");
    if (!currentSource) { if (note) note.textContent = T("dl.none"); return; }
    var name = currentSource.name || "dataset.zip";
    if (currentSource.blob) { saveBlob(currentSource.blob, name); return; }
    if (note) note.textContent = T("dl.fetching");
    fetch(currentSource.url).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.blob();
    }).then(function (b) {
      saveBlob(b, name);
      if (note) note.textContent = T("dl.done", { name: name, size: (b.size / 1024).toFixed(0) });
    }).catch(function (e) {
      console.error(e);
      if (note) note.textContent = T("dl.failed", { msg: e.message || e });
    });
  }
  function initDataDownload() {
    var btn = document.getElementById("download-data");
    var modal = document.getElementById("data-modal");
    if (!btn || !modal) return;
    // 格式說明文件在「精靈打包出來的站」裡不存在，探測不到就把連結收起來
    var spec = document.getElementById("dl-spec");
    if (spec) fetch(spec.getAttribute("href"), { method: "HEAD" })
      .then(function (r) { spec.hidden = !r.ok; })
      .catch(function () { spec.hidden = true; });

    btn.addEventListener("click", function () {
      var note = document.getElementById("dl-note");
      if (note) note.textContent = "";
      modal.hidden = false;
    });
    modal.querySelectorAll("[data-close-data]").forEach(function (x) {
      x.addEventListener("click", function () { modal.hidden = true; });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !modal.hidden) modal.hidden = true;
    });
    var zipBtn = document.getElementById("dl-zip");
    if (zipBtn) zipBtn.addEventListener("click", downloadCurrentData);
  }

  /* ---- 引用視窗：APA / BibTeX / RIS ----
     全部由 doi.org 內容協商即時取得（一個端點同時吃 Crossref 與 DataCite DOI），
     結果快取在 localStorage。查不到就在視窗裡說明並附上 doi.org 連結，不擋其他功能。 */
  function initCite() {
    var modal = document.getElementById("cite-modal");
    if (!modal) return;
    var FIELDS = [["cite-apa", "cite"], ["cite-bibtex", "bibtex"], ["cite-ris", "ris"]];

    function fill(doi) {
      var DOI = FD.DOI, err = document.getElementById("cite-err");
      err.hidden = true; err.textContent = "";
      FIELDS.forEach(function (f) {
        var el = document.getElementById(f[0]);
        el.setAttribute("data-i18n", "cite.loading");
        el.textContent = T("cite.loading");
        el.classList.add("dim");
        DOI[f[1]](doi).then(function (txt) {
          // 拿到內容就把 data-i18n 拔掉，否則切語言時 translateDom() 會把引用字串
          // 蓋回「查詢中…」（跟建立精靈的檔名是同一類坑）
          el.removeAttribute("data-i18n");
          el.textContent = txt;
          el.classList.remove("dim");
        }).catch(function (e) {
          el.removeAttribute("data-i18n");
          el.textContent = "—";
          err.hidden = false;
          err.innerHTML = esc(T("cite.failed", { msg: e.message || e })) +
            ' <a href="https://doi.org/' + esc(doi) + '" target="_blank" rel="noopener">https://doi.org/' + esc(doi) + "</a>";
        });
      });
    }

    // 圖例條會重繪，引用鈕用委派綁
    document.addEventListener("click", function (e) {
      if (!e.target.closest("#cite-btn")) return;
      var d = Store.data && Store.data.dataset;
      if (!d || !d.doi) return;
      modal.hidden = false;
      fill(d.doi);
    });
    modal.querySelectorAll("[data-close-cite]").forEach(function (x) {
      x.addEventListener("click", function () { modal.hidden = true; });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !modal.hidden) modal.hidden = true;
    });

    modal.addEventListener("click", function (e) {
      var copy = e.target.closest(".cite-copy"), dl = e.target.closest(".cite-dl");
      var btn = copy || dl; if (!btn) return;
      var txt = document.getElementById(btn.dataset.target).textContent;
      if (!txt || txt === "—") return;
      if (copy) {
        var done = function () {
          var old = btn.textContent;
          btn.textContent = T("cite.copied");
          setTimeout(function () { btn.textContent = old; }, 1200);
        };
        // clipboard API 在非安全來源（純 http 開檔）不存在，退回 textarea + execCommand
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(txt).then(done).catch(function () { legacyCopy(txt); done(); });
        } else { legacyCopy(txt); done(); }
        return;
      }
      var name = ((Store.data && Store.data.dataset && Store.data.dataset.title) || "citation")
        .replace(/[^\w.-]+/g, "_").slice(0, 60);
      saveText(txt, name + "." + btn.dataset.ext);
    });
  }
  function legacyCopy(txt) {
    var ta = document.createElement("textarea");
    ta.value = txt; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta);
  }
  function saveText(txt, filename) {
    var url = URL.createObjectURL(new Blob([txt], { type: "text/plain;charset=utf-8" }));
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function initButtons() {
    document.getElementById("clear-btn").addEventListener("click", function () {
      Store.clearHighlight();
    });
    // PCA 面板為動態產生，用事件委派綁定下載
    document.addEventListener("click", function (e) {
      var btn = e.target.closest(".dl"); if (!btn) return;
      var vid = btn.dataset.view;
      Plotly.downloadImage(document.getElementById(vid + "-plot"), {
        format: "png", width: 1000, height: 800, filename: vid + "_pca"
      });
    });
    var dlTree = document.querySelector(".dl-tree");
    if (dlTree) dlTree.addEventListener("click", function () { FD.TreeView.exportPNG(); });
    var fitTree = document.querySelector(".fit-tree");
    if (fitTree) fitTree.addEventListener("click", function () { FD.TreeView.resize(); });
    var expandTree = document.querySelector(".expand-tree");
    if (expandTree) expandTree.addEventListener("click", function () {
      var expanded = FD.TreeView.toggleExpandAll();
      expandTree.textContent = FD.t(expanded ? "tree.collapse" : "tree.expandAll");
    });
    var modeSeg = document.getElementById("tree-mode");
    if (modeSeg) modeSeg.addEventListener("click", function (e) {
      var btn = e.target.closest(".seg-btn"); if (!btn) return;
      modeSeg.querySelectorAll(".seg-btn").forEach(function (b) { b.classList.toggle("active", b === btn); });
      FD.TreeView.setMode(btn.dataset.mode);
    });
    var layoutSeg = document.getElementById("tree-layout");
    if (layoutSeg) layoutSeg.addEventListener("click", function (e) {
      var btn = e.target.closest(".seg-btn"); if (!btn) return;
      layoutSeg.querySelectorAll(".seg-btn").forEach(function (b) { b.classList.toggle("active", b === btn); });
      FD.TreeView.setLayout(btn.dataset.layout);
    });
    var labelsBtn = document.querySelector(".labels-tree");
    if (labelsBtn) {
      labelsBtn.addEventListener("click", function () {
        labelsBtn.classList.toggle("active", FD.TreeView.toggleLabels());
      });
      // 縮放時自動顯示/隱藏標籤 → 同步按鈕高亮
      FD.TreeView._onLabelsAuto = function (on) { labelsBtn.classList.toggle("active", on); };
    }

    // 載入資料後，同步樹工具列（佈局/標籤/收合）狀態到目前資料集的自適應預設
    Store.on("data", function () {
      setTimeout(function () {
        var tv = FD.TreeView;
        if (layoutSeg) layoutSeg.querySelectorAll(".seg-btn").forEach(function (b) {
          b.classList.toggle("active", b.dataset.layout === tv.layout);
        });
        if (labelsBtn) labelsBtn.classList.toggle("active", !!tv.labelsOn);
        var ex = document.querySelector(".expand-tree");
        if (ex) ex.textContent = FD.t(tv.expandedAll ? "tree.collapse" : "tree.expandAll");
      }, 60);
    });
  }

  function main() {
    statusEl = document.getElementById("status");
    welcomeEl = document.getElementById("welcome");
    dashboardEl = document.getElementById("dashboard");

    FD.initPCA();
    FD.TreeView.init();
    FD.initInfoPanel();
    FD.initSearch();
    if (FD.initOverview) FD.initOverview();
    initLoaders();
    initButtons();
    initDataDownload();
    initCite();

    // 載入來源優先序：烤入資料（單站）→ gallery 目錄 → 上傳畫面
    if (global.FROG_BAKED_ZIP_BASE64) loadBaked();
    else initGallery();  // 失敗則保留 welcome 上傳畫面
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", main);
  else main();
})(window);
