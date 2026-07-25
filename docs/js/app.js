/* 主程式：整合各模組、處理載入（上傳 / 拖放 / 範例 / 烤入資料）、狀態與下載。 */
(function (global) {
  "use strict";
  var FD = global.FrogDash, Store = FD.Store;

  var statusEl, welcomeEl, dashboardEl;

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

  function loadVia(promise, label, remoteCfg) {
    var T = function (k, p) { return FD.t ? FD.t(k, p) : k; };
    if (FD.setupRemoteImages) FD.setupRemoteImages(remoteCfg || null);  // 依資料集設定遠端影像
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
      var f = e.target.files[0]; if (f) loadVia(FD.Loader.fromBlob(f), "讀取 " + f.name);
    });
    var demoBtn = document.getElementById("demo-btn");
    if (demoBtn) demoBtn.addEventListener("click", function () {
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
      if (f && /\.zip$/i.test(f.name)) loadVia(FD.Loader.fromBlob(f), "讀取 " + f.name);
    });
  }

  // 烤入資料（單一資料集自包含站）：存在則直接載入
  function loadBaked() {
    var bin = atob(global.FROG_BAKED_ZIP_BASE64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
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
    loadVia(FD.Loader.fromUrl(ds.zip), "載入 " + (ds.short || ds.title), ds.remote_images);
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

    // 載入來源優先序：烤入資料（單站）→ gallery 目錄 → 上傳畫面
    if (global.FROG_BAKED_ZIP_BASE64) loadBaked();
    else initGallery();  // 失敗則保留 welcome 上傳畫面
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", main);
  else main();
})(window);
