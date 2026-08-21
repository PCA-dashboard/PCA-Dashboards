# PCA-Dashboards — 專案記憶 / Project Memory

> 給任何冷啟動的 Claude session:先讀這份,再動手。全專案對話一律用**繁體中文**。

## 這是什麼
一個「無伺服器、可離線、可永久保存」的互動式 **PCA morphospace(形態空間)Dashboard**,
收錄 9 篇科學論文的資料,部署在 GitHub Pages。使用者在瀏覽器裡探索形態空間散點圖 +
互動式親緣樹 + 物種資訊卡。

- 公開站:https://pca-dashboard.github.io/PCA-Dashboards/
- 部署來源:`main` 分支的 `docs/`(見 `.github/workflows/deploy-pages.yml`)。**推上 `main` 就會自動重新部署。**
- 私有的前處理/建置腳本在另一個 repo **`PCA-Dashboards-Source`**(見下方)。

## 最高原則(不可違反)
1. **無伺服器**:純靜態站,任何功能都不得依賴後端。
2. **無 CDN**:所有函式庫一律 vendored 在 `docs/vendor/`(JSZip、Plotly、Phylocanvas、字型)。禁止 `<script src="https://cdn...">`。
3. **瀏覽器不做統計**:所有 PCA / GPA / variance 都在**匯出端(R/Python)**算好,烤進 zip;瀏覽器只負責互動呈現。
4. **色盲友善**:配色用 Okabe–Ito 類調色盤,並且**色+形雙編碼**(不只靠顏色區分群組)。
5. **可離線 / 永久保存**:開啟即看,不需連網也能用既有資料。
6. 全介面**雙語(zh/en)**,預設繁中。

## 技術風格
- Vanilla JS,IIFE 模組掛在 `window.FrogDash`(別名 `FD`),**無 build step**。
- 快取破壞:所有 `<script>`/`<link>` 用 `?v=N`,改版時整批 +1(目前 **v=22**)。
- 主題系統:`<html data-theme=dark|light data-accent=lime|cyan|violet|amber|coral>`,localStorage 記憶,head 內有 inline script 防閃爍。
- i18n:`data-i18n` / `-ph` / `-title` 屬性 + `FD.t(key,params)`;字典在 `docs/js/i18n.js`。
  說明文件頁 `format.html` 的**正文**不走字典,而是依 `<html data-lang>` 抓 `unified_zip_format.md`(中)或 `unified_zip_format.en.md`(英);改一份就要同步另一份,章節結構必須一致。

## 9 個案例(`docs/data/catalog.json`)
| id | 論文 | 圖片供應模式 |
|----|------|-------------|
| frogs | Sherratt et al. 2017(澳洲蛙/蝌蚪,166) | GBIF |
| trilobites | Drage & Pates 2025(三葉蟲頭部,762,無樹) | 散檔鏡像 `docs/data/img/trilobites/` |
| fishes | Torgersen et al. 2023(內陸魚體型,232) | GBIF |
| otoliths | Van Damme et al. 2024(耳石,697) | GBIF |
| turtles | Stayton et al. 2018(龜殼,274) | GBIF |
| forams | Kahanamoku et al. 2024(底棲有孔蟲,36 種) | 散檔鏡像 `docs/data/img/forams/` |
| forams-objects | 同上(逐物件,23,210) | Zenodo Range 即時抓取 |
| characiforms | Burns & Sidlauskas 2019(脂鯉,116) | GBIF |
| scallops | Sherratt, Serb & Adams 2017(扇貝,123,左右瓣) | GBIF(`scientific_name` 欄) |

## 三種圖片供應模式(全部「按需抓取 + 前端快取」,不建伺服器)
1. **live_range_fetch(Zenodo)** — Zenodo 有 CORS `*` 且支援 HTTP Range。用「remote zip」技巧:抓 central directory→算 offset→Range 抓單一 entry→`DecompressionStream('deflate-raw')` 解壓→存 IndexedDB(DB `morpho-img`)。設定在 catalog 的 `remote_images.index_url`。程式:`docs/js/remote-image.js`。
2. **on_demand_mirror** — 論文原圖(來自 OSF/Dryad,兩者對瀏覽器不可直接 fetch)在 build 端鏡像成散檔放到 Pages,靠 zip 內 taxa 的 `image_base_url` 指向;瀏覽器原生快取。程式:`docs/js/zip-loader.js`。
3. **gbif_fallback** — 沒有原圖時,用學名去 GBIF 查代表照(iNaturalist/ALA,CC 授權)。`species/match`→`usageKey`→`occurrence/search?mediaType=StillImage`。`<img>` 顯示不需 CORS。程式:`docs/js/gbif-image.js`。catalog 用 `gbif_fallback: true`(查 display_label)或 `{name_field: "..."}`。

> CORS 現實備忘:Zenodo=可瀏覽器抓;Dryad=無 CORS+下載要 OAuth+Anubis 擋 bot;OSF=檔案 bytes 轉址到簽章版 GCS 無 CORS。三者都有 server-side REST API(僅 build 端可用)。

## 前處理腳本(私有 repo `PCA-Dashboards-Source`)
- `image_pipeline/` — 各來源(Zenodo/OSF/Dryad/GBIF)抓圖、建 offset index、鏡像散檔的腳本。
- `case_builds/` — 各案例的建置腳本,含 R geomorph 的 GPA/PCA(如 `oto_gpa.R`、`turtle_gpa.R`)。
- 「統一 Zip」格式:物種×PC 分數 CSV + variance CSV + 分類 CSV + Newick 樹,由匯出器打包;瀏覽器端 `docs/js/zip-loader.js` 讀取。

## 關鍵檔案地圖(`docs/`)
- `index.html` 檢視器 · `builder.html` 建立精靈(讓別人上傳自己的 PCA 打包成站)
- `css/style.css` 全站樣式(含主題 token、RWD)
- PCA 圖的拖曳只有一個,平移與框選分時共用:預設 `dragmode='pan'`,面板上的「框選」鈕切成 `select`(此時 Shift＝Plotly 原生加選),沒開框選時按住 Shift 拖曳＝臨時框選。回平移時**必須**把 `_fullLayout.selections` 清空,否則殘留的選取框會把拖曳吃掉去搬動它,平移完全沒反應。
- `js/`:`app.js`(主流程)、`state.js`、`zip-loader.js`、`remote-image.js`、`gbif-image.js`、`i18n.js`、`theme.js`、`overview.js`、`pca-view.js`、`tree-view.js`、`info-panel.js`、`legend.js`、`groups.js`、`search.js`
- `data/catalog.json` 案例清單 · `data/*.zip` 各案例資料 · `data/img/**` 鏡像散檔 · `data/foram_obj_images.json` Zenodo offset index

## 隱私注意
使用者曾要求**資料不可被他人看見**。歷史上處理過 git-history purge + 換私有 repo。改動涉及公開任何原始資料前先確認。

## 部署/推送慣例
- 開發分支:見任務指定(常見 `claude/pca-dashboard-serverless-i00715`);最終要上線一律進 `main`。
- Commit 身分:`git config user.email noreply@anthropic.com && git config user.name Claude`。
- 沙盒 Chromium **無對外網路**(所有 browser→外部 fetch 會失敗);要驗證抓圖用 `curl` 走 agent proxy,別靠 Playwright 連外。
