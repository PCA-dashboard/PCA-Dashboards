/* 雙語（繁中 / English）。靜態 DOM 以 data-i18n / data-i18n-ph / data-i18n-title 標記；
   動態字串由各模組呼叫 FD.t(key, params)。切換語言時重譯 DOM 並重繪動態內容。純 vanilla。 */
(function (global) {
  "use strict";
  var FD = global.FrogDash = global.FrogDash || {};

  var DICT = {
    zh: {
      "nav.overview": "概覽", "nav.analytics": "分析", "nav.load": "載入資料", "nav.builder": "建立精靈",
      "btn.panel": "側邊面板", "btn.summary": "資料總覽", "btn.clear": "清除選取", "btn.close": "關閉",
      "search.ph": "搜尋物種…",
      "set.title": "設定", "set.theme": "主題 / Theme", "set.light": "淺色", "set.dark": "深色", "set.auto": "自動",
      "set.accent": "主視覺色 / Accent", "set.lang": "語言 / Language",
      "dataset.label": "資料集",
      "welcome.title": "載入資料以開始",
      "welcome.body": "本工具讀取「統一 Zip」格式（由 R / Python / CSV 匯出器產生）。所有統計已在匯出端算好，瀏覽器端只負責互動式呈現。",
      "welcome.drop": "拖放 .zip 到此處，或用上方「載入資料」。",
      "welcome.demo": "載入青蛙範例資料",
      "welcome.demoHint": "（範例：Sherratt et al. 2017，澳洲青蛙與蝌蚪，166 物種）",
      "welcome.ownQ": "想用自己的 PCA 資料做一個像這樣的網頁？",
      "welcome.buildLink": "用建立精靈打包成自己的網站 →",
      "group.by": "分組依", "group.settings": "顏色/形狀", "group.customTitle": "自訂顏色與形狀", "group.reset": "重設為預設",
      "pca.select": "框選", "pca.png": "下載此圖 PNG",
      "pca.selTip": "開啟後拖曳可框選多個點（框選中按住 Shift 可加選）；未開啟時按住 Shift 拖曳也能臨時框選，平常拖曳＝平移、滾輪＝縮放",
      "tree.title": "親緣關係樹", "tree.sub": "（點分支高亮整個 clade）",
      "tree.rect": "矩形", "tree.circ": "環狀", "tree.clado": "整齊對齊", "tree.phylo": "分支長度",
      "tree.labels": "標籤", "tree.collapse": "收合深層", "tree.expandAll": "展開全部", "tree.fit": "自動縮放", "tree.png": "PNG",
      "tree.fallback1": "⚠️ 此環境無法使用 WebGL，無法繪製互動式親緣樹。",
      "tree.fallback2": "PCA 圖仍可正常使用；點擊樹分支高亮 clade 的功能在此環境停用。",
      "tree.titleTip": "矩形佈局（適合小樹、便於閱讀標籤）", "tree.circTip": "環狀佈局（適合大樹、一眼看全貌）",
      "tree.cladoTip": "對齊 tips、依拓樸均勻鋪滿，最易辨認", "tree.phyloTip": "依實際演化分支長度繪製（時間樹）",
      "recent.title": "近期檢視的物種", "recent.sub": "最近在形態空間中點選 / 釘選的物種 — 點卡片開啟側邊詳細資訊",
      "side.title": "物種資訊", "drawer.title": "資料集總覽",
      "ov.title": "形態空間總覽",
      "ov.basedOn": "— 基於 {n} 個{unit}{author}", "unit.species": "物種", "unit.objects": "物件",
      "ov.groupChip": "分組：{field}", "ov.viewsChip": "{v} 個視圖 · {g} 組",
      "ov.insightTitle": "資料洞察",
      "ov.insightText": "{label} 的前 4 個主成分累積解釋 <b>{p}%</b> 的形態變異。",
      "ov.insightFallback": "互動式形態空間，點擊任一點高亮。",
      "ov.statTotal": "物種總數", "ov.statTotalPts": "資料點總數", "ov.groupsN": "{g} 組",
      "ov.gaugeCum": "{label} 累積", "ov.first4": "前 4 主成分",
      "ov.summary": "資料集摘要", "ov.srcPaper": "來源論文",
      "ov.varTitle": "主成分變異解釋 · {label}", "ov.perGroup": "各{field}項目數",
      "ov.linkedTree": "樹與形態空間已連動 · 點擊任一點高亮", "ov.linked": "形態空間互動 · 點擊任一點高亮",
      "st.loadingDefault": "載入中",
      "st.loading": "{label}…",
      "st.loaded": "已載入：{n} 物種、{v} 個 PCA 視圖、{tree} 個樹葉（join key 一致 ✓）",
      "st.failed": "載入失敗：{msg}",
      "meta.source": "原始資料來源", "meta.madeWith": "產生方式：{w}",
      "legend.hidden": "（隱藏）",
      "dl.btn": "↓ 下載資料",
      "dl.tip": "下載這個 Dashboard 的原始資料（統一 Zip），可當成自製資料的格式範本",
      "dl.title": "下載這份資料，照著做自己的",
      "dl.lead": "這個 Dashboard 讀的就是下面這個「統一 Zip」。下載後解開來看，就知道自己的資料要長成什麼樣子。",
      "dl.getZip": "↓ 下載此資料集的統一 Zip", "dl.getSpec": "↓ 格式說明文件",
      "dl.structTitle": "Zip 裡面長這樣",
      "dl.cManifest": "← 資料集資訊、視圖清單、分組配色",
      "dl.cScores": "← 每列一物種：species_id, PC1, PC2, …",
      "dl.cVar": "← 每個 PC 解釋的變異比例",
      "dl.cTaxa": "← species_id, display_label, 分組欄, 其他資訊欄",
      "dl.cTree": "←（可選）Newick 樹，tip 標籤＝species_id",
      "dl.joinKey": "關鍵：species_id 是 join key，scores／taxa／樹三邊必須一致。所有統計（PCA/GPA）都在匯出端算好，瀏覽器只負責呈現。",
      "dl.toBuilder": "用建立精靈做我自己的 →", "dl.close": "關閉",
      "dl.fetching": "取得資料中…", "dl.done": "✔ 已下載 {name}（約 {size} KB）",
      "dl.failed": "✗ 下載失敗：{msg}", "dl.none": "目前沒有已載入的資料集。",
      "doc.pageTitle": "統一 Zip 格式與匯出器 — PCA Dashboard", "doc.title": "統一 Zip 格式與匯出器", "doc.subtitle": "Dashboard 與各匯出器之間的唯一契約",
      "doc.toViewer": "← 回檢視器", "doc.toBuilder": "建立精靈", "doc.raw": "↓ 原始 .md",
      "doc.toc": "目錄", "doc.loading": "載入說明文件中…", "doc.failed": "載入說明文件失敗",
      "bld.peSample": "想先試跑看看？下載這組範例資料（17 物種／3 科／含樹），直接照著上面三步走一遍：",
      "bld.peRpy": "資料還在 R 或 Python 裡？瀏覽器不能跑 R/Python（無伺服器），但本專案有通用匯出器可以直接從 prcomp / gm.prcomp / sklearn PCA 產出同一種統一 Zip，再拖進檢視器即可。",
      "bld.peRpyLink": "看格式與匯出器說明 →",
      "bld.pickFile": "選擇檔案", "bld.noFile": "未選擇檔案",
      "bld.hintPreviewFirst": "先按「建立預覽」，下載與打包才會開啟",
      "bld.peStep1": "上傳「物種 × PC 分數」CSV——第一欄是 species_id，其餘是 PC1、PC2…",
      "bld.peStep2": "上傳分類 CSV，選好要用哪一欄分組著色；有親緣樹再加 Newick（可略）",
      "bld.peStep3": "按「建立預覽」確認沒問題，再下載統一 Zip 或直接打包成網站",
      "bld.peShapeCap": "分數 CSV 長這樣：",
      "bld.title": "建立精靈",
      "bld.subtitle": "上傳 PCA 資料 → 即時互動預覽 → 打包成可放 GitHub Pages 的無伺服器網頁",
      "bld.openViewer": "開啟檢視器",
      "bld.s1": "① 資料集資訊", "bld.fTitle": "標題", "bld.phTitle": "例：My frog PCA",
      "bld.fDoi": "DOI（可選）", "bld.fSource": "來源網址（可選）", "bld.fCite": "引用（可選）",
      "bld.s2": "② PCA 視圖",
      "bld.s2hint": "每個視圖上傳一份「物種 × PC 分數」CSV（第一欄為 species_id，其餘為各 PC）。可選附上 variance CSV（欄 variance_explained）；未提供時自動由分數估算。",
      "bld.addView": "＋ 新增視圖", "bld.viewName": "視圖名稱（例：Tadpole PCA）",
      "bld.vScores": "分數 CSV", "bld.vVar": "variance（可選）", "bld.vDel": "移除",
      "bld.s3": "③ 物種／分類資料", "bld.fTaxa": "分類 CSV",
      "bld.mId": "species_id 欄", "bld.mLabel": "顯示名稱欄",
      "bld.mGroup": "分組欄（著色／形狀）", "bld.mImage": "圖片欄（可選）",
      "bld.mInfo": "資訊視窗顯示欄位（可複選）", "bld.none": "（無）", "bld.firstCol": "（第 {i} 欄，無標題）",
      "bld.s4": "④ 親緣樹（可選）", "bld.fTree": "Newick 樹檔",
      "bld.s4hint": "樹的 tip 標籤需與 species_id 一致。無樹時只顯示 PCA。",
      "bld.preview": "建立預覽 ▶",
      "bld.dlZip": "↓ 只下載資料（統一 Zip）",
      "bld.dlZipSub": "只有你的資料，幾 KB。給檢視器讀，或存檔／分享。",
      "bld.package": "⬇ 打包成完整網站",
      "bld.packageSub": "資料＋整個檢視器，約 2 MB。解壓上傳 GitHub 就能上線。",
      "bld.emptyTitle": "👀 即時預覽會出現在這裡",
      "bld.emptyBody": "填好左側、按「建立預覽」。所有處理都在你的瀏覽器內完成，資料不會上傳到任何伺服器。",
      "bld.building": "建立中…", "bld.packing": "打包中…（抓取檢視器與函式庫）",
      "bld.ok": "✔ 預覽已更新（{n} 物種）", "bld.warnN": "⚠️ {n} 項提醒：",
      "bld.errBuild": "✗ 建立失敗：{msg}", "bld.errTaxa": "✗ 讀取分類 CSV 失敗：{msg}",
      "bld.errPack": "打包失敗：{msg}", "bld.errInit": "預覽模組初始化失敗：{msg}",
      "bld.needTaxa": "請先上傳分類 CSV", "bld.needView": "請至少新增一個 PCA 視圖",
      "bld.needScores": "視圖「{label}」尚未選擇分數 CSV", "bld.unnamed": "未命名",
      "bld.needPreview": "請先建立預覽", "bld.dlDone": "✔ 已下載 {name}",
      "tut.title": "✅ 打包完成！接著把它變成你的網頁",
      "tut.lead1": "下載的", "tut.lead2": "就是一個完整的無伺服器網站。三步驟上線：",
      "tut.step1": "建立 GitHub repo：到 GitHub 按 New repository，取個名字（例如 my-pca），建立。",
      "tut.step2": "上傳檔案：解壓下載的 zip，把裡面所有檔案與資料夾（index.html、css/、js/、vendor/、data/、.nojekyll）拖到 repo 的「Add file → Upload files」，Commit。",
      "tut.step3": "啟用 Pages：repo → Settings → Pages → Source 選 Deploy from a branch → Branch 選 main、Folder 選 /(root) → Save。約 1–2 分鐘後你的網頁就上線了。",
      "tut.note": "整個網站純靜態、無伺服器、可離線開啟；資料已內嵌，觀看者不需再上傳。日後要換資料，回到本精靈重新打包即可。",
      "tut.ok": "我知道了"
    },
    en: {
      "nav.overview": "Overview", "nav.analytics": "Analytics", "nav.load": "Load data", "nav.builder": "Builder",
      "btn.panel": "Panel", "btn.summary": "Summary", "btn.clear": "Clear", "btn.close": "Close",
      "search.ph": "Search species name or ID…",
      "set.title": "Settings", "set.theme": "主題 / Theme", "set.light": "Light", "set.dark": "Dark", "set.auto": "Auto",
      "set.accent": "主視覺色 / Accent", "set.lang": "語言 / Language",
      "dataset.label": "Dataset",
      "welcome.title": "Load data to begin",
      "welcome.body": "This tool reads the “unified Zip” format (produced by the R / Python / CSV exporters). All statistics are computed at export time; the browser only handles interactive display.",
      "welcome.drop": "Drop a .zip here, or use “Load data” above.",
      "welcome.demo": "Load frog sample data",
      "welcome.demoHint": "(Sample: Sherratt et al. 2017, Australian frogs & tadpoles, 166 species)",
      "welcome.ownQ": "Want to build a page like this from your own PCA data?",
      "welcome.buildLink": "Package your own site with the Builder →",
      "group.by": "Group by", "group.settings": "Colors/shapes", "group.customTitle": "Customize colors & shapes", "group.reset": "Reset to defaults",
      "pca.select": "Box select", "pca.png": "Download this plot as PNG",
      "pca.selTip": "Turn on to box-select several points by dragging (hold Shift while selecting to add more); with it off, hold Shift and drag for a one-off selection — plain drag pans, scroll zooms",
      "tree.title": "Phylogenetic tree", "tree.sub": "(click a branch to highlight a clade)",
      "tree.rect": "Rect", "tree.circ": "Circular", "tree.clado": "Aligned", "tree.phylo": "Branch length",
      "tree.labels": "Labels", "tree.collapse": "Collapse", "tree.expandAll": "Expand all", "tree.fit": "Fit", "tree.png": "PNG",
      "tree.fallback1": "⚠️ WebGL is unavailable here, so the interactive tree can’t be drawn.",
      "tree.fallback2": "The PCA plots still work; clade-highlighting by clicking branches is disabled in this environment.",
      "tree.titleTip": "Rectangular layout (good for small trees, readable labels)", "tree.circTip": "Circular layout (good for large trees, see it all at once)",
      "tree.cladoTip": "Align tips, spread evenly by topology — easiest to read", "tree.phyloTip": "Draw by actual evolutionary branch lengths (time tree)",
      "recent.title": "Recently viewed species", "recent.sub": "Species you recently clicked / pinned in the morphospace — click a card to open details",
      "side.title": "Species info", "drawer.title": "Dataset summary",
      "ov.title": "Morphospace Overview",
      "ov.basedOn": "— Based on {n} {unit}{author}", "unit.species": "species", "unit.objects": "objects",
      "ov.groupChip": "Grouped: {field}", "ov.viewsChip": "{v} views · {g} groups",
      "ov.insightTitle": "Data insight",
      "ov.insightText": "The first 4 PCs of {label} explain <b>{p}%</b> of shape variance.",
      "ov.insightFallback": "Interactive morphospace — click any point to highlight.",
      "ov.statTotal": "Total species", "ov.statTotalPts": "Total points", "ov.groupsN": "{g} groups",
      "ov.gaugeCum": "{label} cumulative", "ov.first4": "First 4 PCs",
      "ov.summary": "Dataset summary", "ov.srcPaper": "Source paper",
      "ov.varTitle": "PC variance explained · {label}", "ov.perGroup": "Count per {field}",
      "ov.linkedTree": "Tree linked to morphospace · click a point to highlight", "ov.linked": "Interactive morphospace · click a point to highlight",
      "st.loadingDefault": "Loading",
      "st.loading": "{label}…",
      "st.loaded": "Loaded: {n} species, {v} PCA views, {tree} tree leaves (join keys consistent ✓)",
      "st.failed": "Load failed: {msg}",
      "meta.source": "Data source", "meta.madeWith": "Made with: {w}",
      "legend.hidden": " (hidden)",
      "dl.btn": "↓ Get data",
      "dl.tip": "Download this dashboard's source data (unified Zip) — use it as a template for your own",
      "dl.title": "Download this data and build your own",
      "dl.lead": "This dashboard reads exactly the unified Zip below. Download it, unzip it, and you'll see what your own data needs to look like.",
      "dl.getZip": "↓ Download this dataset's unified Zip", "dl.getSpec": "↓ Format specification",
      "dl.structTitle": "What's inside the Zip",
      "dl.cManifest": "← dataset info, view list, group colours",
      "dl.cScores": "← one row per species: species_id, PC1, PC2, …",
      "dl.cVar": "← variance explained by each PC",
      "dl.cTaxa": "← species_id, display_label, grouping column, extra info columns",
      "dl.cTree": "← (optional) Newick tree; tip labels = species_id",
      "dl.joinKey": "Key point: species_id is the join key and must match across scores, taxa and the tree. All statistics (PCA/GPA) are computed at export time; the browser only renders.",
      "dl.toBuilder": "Build my own with the wizard →", "dl.close": "Close",
      "dl.fetching": "Fetching data…", "dl.done": "✔ Downloaded {name} (~{size} KB)",
      "dl.failed": "✗ Download failed: {msg}", "dl.none": "No dataset is currently loaded.",
      "doc.pageTitle": "Unified Zip format & exporters — PCA Dashboard", "doc.title": "Unified Zip format & exporters", "doc.subtitle": "The single contract between the dashboard and every exporter",
      "doc.toViewer": "\u2190 Back to viewer", "doc.toBuilder": "Build wizard", "doc.raw": "\u2193 Raw .md",
      "doc.toc": "Contents", "doc.loading": "Loading the specification\u2026", "doc.failed": "Could not load the specification",
      "bld.peSample": "Want to try it first? Download this sample dataset (17 species / 3 families / with a tree) and walk through the three steps above:",
      "bld.peRpy": "Still in R or Python? The browser cannot run R/Python (it is serverless), but this project ships generic exporters that turn prcomp / gm.prcomp / sklearn PCA straight into the same unified Zip — then just drop it into the viewer.",
      "bld.peRpyLink": "Format and exporter docs \u2192",
      "bld.pickFile": "Choose file", "bld.noFile": "No file selected",
      "bld.hintPreviewFirst": "Build a preview first — download and packaging unlock after that",
      "bld.peStep1": "Upload a \u201cspecies \u00d7 PC scores\u201d CSV \u2014 first column species_id, the rest PC1, PC2\u2026",
      "bld.peStep2": "Upload a taxonomy CSV and pick the column to colour by; add a Newick tree if you have one (optional)",
      "bld.peStep3": "Hit \u201cBuild preview\u201d to check it, then download the unified Zip or package a whole site",
      "bld.peShapeCap": "A scores CSV looks like this:",
      "bld.title": "Build wizard",
      "bld.subtitle": "Upload PCA data → live interactive preview → package a serverless site for GitHub Pages",
      "bld.openViewer": "Open viewer",
      "bld.s1": "① Dataset info", "bld.fTitle": "Title", "bld.phTitle": "e.g. My frog PCA",
      "bld.fDoi": "DOI (optional)", "bld.fSource": "Source URL (optional)", "bld.fCite": "Citation (optional)",
      "bld.s2": "② PCA views",
      "bld.s2hint": "Upload one \"species × PC scores\" CSV per view (first column species_id, the rest PCs). Optionally add a variance CSV (column variance_explained); if omitted it is estimated from the scores.",
      "bld.addView": "＋ Add view", "bld.viewName": "View name (e.g. Tadpole PCA)",
      "bld.vScores": "Scores CSV", "bld.vVar": "variance (optional)", "bld.vDel": "Remove",
      "bld.s3": "③ Species / taxonomy", "bld.fTaxa": "Taxonomy CSV",
      "bld.mId": "species_id column", "bld.mLabel": "Display label column",
      "bld.mGroup": "Grouping column (colour / shape)", "bld.mImage": "Image column (optional)",
      "bld.mInfo": "Fields shown in the info card (multi-select)", "bld.none": "(none)", "bld.firstCol": "(column {i}, no header)",
      "bld.s4": "④ Phylogenetic tree (optional)", "bld.fTree": "Newick tree file",
      "bld.s4hint": "Tree tip labels must match species_id. Without a tree only the PCA is shown.",
      "bld.preview": "Build preview ▶",
      "bld.dlZip": "\u2193 Data only (unified Zip)",
      "bld.dlZipSub": "Just your data, a few KB. Feed it to the viewer, or archive/share it.",
      "bld.package": "\u2193 Package a whole site",
      "bld.packageSub": "Data plus the entire viewer, ~2 MB. Unzip, upload to GitHub, it is live.",
      "bld.emptyTitle": "👀 Your live preview appears here",
      "bld.emptyBody": "Fill in the form on the left, then hit \"Build preview\". Everything runs in your browser — nothing is uploaded to any server.",
      "bld.building": "Building…", "bld.packing": "Packaging… (fetching viewer and libraries)",
      "bld.ok": "✔ Preview updated ({n} species)", "bld.warnN": "⚠️ {n} notice(s):",
      "bld.errBuild": "✗ Build failed: {msg}", "bld.errTaxa": "✗ Could not read taxonomy CSV: {msg}",
      "bld.errPack": "Packaging failed: {msg}", "bld.errInit": "Preview modules failed to initialise: {msg}",
      "bld.needTaxa": "Please upload a taxonomy CSV first", "bld.needView": "Please add at least one PCA view",
      "bld.needScores": "View \"{label}\" has no scores CSV selected", "bld.unnamed": "untitled",
      "bld.needPreview": "Build a preview first", "bld.dlDone": "✔ Downloaded {name}",
      "tut.title": "✅ Packaged! Now turn it into your own web page",
      "tut.lead1": "The downloaded", "tut.lead2": "is a complete serverless website. Three steps to go live:",
      "tut.step1": "Create a GitHub repo: on GitHub click New repository, give it a name (e.g. my-pca), create it.",
      "tut.step2": "Upload the files: unzip the download and drag everything inside (index.html, css/, js/, vendor/, data/, .nojekyll) into the repo via \"Add file → Upload files\", then commit.",
      "tut.step3": "Enable Pages: repo → Settings → Pages → Source: Deploy from a branch → Branch: main, Folder: /(root) → Save. Your page is live in about 1–2 minutes.",
      "tut.note": "The whole site is static, serverless and works offline; the data is embedded so viewers never upload anything. To swap data later, come back to this wizard and repackage.",
      "tut.ok": "Got it"
    }
  };

  var lang = "zh";
  try { var s = localStorage.getItem("mp-lang"); if (s === "zh" || s === "en") lang = s; } catch (e) {}

  function t(key, params) {
    var s = (DICT[lang] && DICT[lang][key]);
    if (s == null) s = (DICT.zh[key] != null ? DICT.zh[key] : key);
    if (params) s = s.replace(/\{(\w+)\}/g, function (_, k) { return params[k] != null ? params[k] : ""; });
    return s;
  }

  function translateDom(rootEl) {
    var root = rootEl || document;
    root.querySelectorAll("[data-i18n]").forEach(function (el) { el.textContent = t(el.getAttribute("data-i18n")); });
    root.querySelectorAll("[data-i18n-ph]").forEach(function (el) { el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph"))); });
    root.querySelectorAll("[data-i18n-title]").forEach(function (el) { el.setAttribute("title", t(el.getAttribute("data-i18n-title"))); });
  }

  function setLang(l) {
    if (l !== "zh" && l !== "en") return;
    lang = l;
    try { localStorage.setItem("mp-lang", l); } catch (e) {}
    document.documentElement.setAttribute("lang", l === "zh" ? "zh-Hant" : "en");
    document.documentElement.setAttribute("data-lang", l);
    translateDom();
    // 重繪動態內容
    var Store = FD.Store;
    if (Store && Store.data) {
      if (FD.renderOverview) try { FD.renderOverview(Store.data); } catch (e) {}
      if (FD.Legend && FD.Legend.rerender) try { FD.Legend.rerender(); } catch (e) {}
    }
    if (FD.syncLangUI) FD.syncLangUI();
  }

  FD.i18n = { t: t, setLang: setLang, get lang() { return lang; }, translateDom: translateDom };
  FD.t = t;

  // 初次套用語言屬性 + 翻譯（DOM ready 後）
  document.documentElement.setAttribute("data-lang", lang);
  document.documentElement.setAttribute("lang", lang === "zh" ? "zh-Hant" : "en");
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { translateDom(); });
  else translateDom();
})(window);
