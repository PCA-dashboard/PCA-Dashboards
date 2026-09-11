# PCA-Dashboards — 專案記憶 / Project Memory

> 給任何冷啟動的 Claude session:先讀這份,再動手。全專案對話一律用**繁體中文**。

## 這是什麼
一個「無伺服器、可離線、可永久保存」的互動式 **PCA morphospace(形態空間)Dashboard**,
收錄 9 篇科學論文的資料,部署在 GitHub Pages。使用者在瀏覽器裡探索形態空間散點圖 +
互動式親緣樹 + 物種資訊卡。

- 公開站:https://pca-dashboard.github.io/PCA-Dashboards/
- 部署來源:`main` 分支的 `docs/`(見 `.github/workflows/deploy-pages.yml`)。**推上 `main` 就會自動重新部署。**
- 私有的前處理/建置腳本在另一個 repo **`PCA-Dashboards-Source`**(見下方)。

## 最高原則

> 這份 CLAUDE.md 是歷任 session 寫的**摘要**,不是使用者的原話記錄。
> 底下分兩段:第一段違反了東西幾年內就會壞掉,第二段是設計決定——**附理由,要改先問使用者**,
> 別當成物理定律去繞路。

### 不可違反
1. **無伺服器**:純靜態站,任何功能都不得依賴後端。
2. **無 CDN**:所有函式庫一律 vendored 在 `docs/vendor/` 並鎖版本(JSZip、Plotly、Phylocanvas、字型)。禁止 `<script src="https://cdn...">`。

> 這兩條是「要能長久存在」的直接後果:別人的伺服器和 CDN 連結都會消失,我們的不能跟著死。
> 第 2 條就是第 1 條套用在相依套件上,不是獨立的偏好。

### 設計決定(附理由,可以討論,但要先問過使用者)
3. **瀏覽器不做統計**:所有 PCA / GPA / variance 都在**匯出端(R/Python)**算好,烤進 zip;瀏覽器只負責互動呈現。
   - 理由:站上的數字要**跟論文逐位相符**。階段一用 geomorph 4.0.6 重現 Sherratt 2017,
     成體 4 PC 累積 82.479% vs 論文 82.479%,差 0.000 pp(見 Source repo `docs/phase1_notes.md`)。
     改成瀏覽器用 JS 重算就得自己實作 GPA/Procrustes,一有偏差,站上的數字就不再是論文的數字。
   - 純靜態網站**技術上完全可以**用 JS 算 PCA,所以這是選擇,不是限制。
   - **使用者已於 2026-09-11 確認維持。** 後果:使用者丟原始地標/測量矩陣進來時,
     要明確判讀成「這不能直接用」並導流到 `docs/exporters/` 的 R/Python 通用匯出器,不可靜默忽略。
4. **色盲友善**:配色用 Okabe–Ito 類調色盤,並且**色+形雙編碼**(不只靠顏色區分群組)。
5. **核心可離線 / 永久保存**:既有資料開啟即看,不需連網。
   - 實際狀態:**加值功能可以連網,但必須優雅降級**。目前有兩個——GBIF 抓圖(`gbif-image.js`)、
     DOI 查詢(`doi.js`)。兩者都是「查到才加值、查不到就當沒事」,離線時畫面照常。
   - 新增任何對外請求都必須照這個模式,否則就是真的破壞這一條。
6. **全介面雙語(zh/en)**,預設繁中。

## 技術風格
- Vanilla JS,IIFE 模組掛在 `window.FrogDash`(別名 `FD`),**無 build step**。
- 快取破壞:所有 `<script>`/`<link>` 用 `?v=N`,改版時整批 +1(目前 **v=24**)。
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
- DOI 接入(`docs/js/doi.js`,`FD.DOI`):全部走有 CORS 的公開 API,結果快取 localStorage(30 天)。
  `doi.org` 內容協商一個端點同時吃 Crossref(期刊)與 DataCite(資料集)DOI,`Accept` 換格式就換輸出:
  CSL-JSON(中繼資料/授權)、`text/x-bibliography; style=apa`(引用字串)、`application/x-bibtex`、
  `application/x-research-info-systems`(RIS)。論文↔資料 DOI 互查用 DataCite **搜尋**端點
  (`?query=doi:"X" OR relatedIdentifiers.relatedIdentifier:"X"`),不要用 `GET /dois/<doi>`——
  後者對期刊 DOI 回 404,console 會留紅字;搜尋一律 200 且一次涵蓋兩個方向。
  用途:檢視器的授權徽章 + 論文/資料 DOI + 引用視窗(APA/BibTeX/RIS),建立精靈的「帶入」。
  **查不到一律安靜降級**,離線時仍用 zip 內既有的 doi/citation。
- 動態產生的文字若要能切語言,一定要帶 `data-i18n` 屬性(`translateDom()` 只認屬性);
  已填入的即時內容(檔名、引用字串)要**把屬性拔掉**,否則會被翻譯蓋掉;
  拼字串的狀態訊息無法重譯,切語言時直接清掉。
- `js/`:`app.js`(主流程)、`state.js`、`zip-loader.js`、`remote-image.js`、`gbif-image.js`、`i18n.js`、`theme.js`、`overview.js`、`pca-view.js`、`tree-view.js`、`info-panel.js`、`legend.js`、`groups.js`、`search.js`
- `data/catalog.json` 案例清單 · `data/*.zip` 各案例資料 · `data/img/**` 鏡像散檔 · `data/foram_obj_images.json` Zenodo offset index

## 隱私注意
使用者曾要求**資料不可被他人看見**。歷史上處理過 git-history purge + 換私有 repo。改動涉及公開任何原始資料前先確認。

## 部署/推送慣例
- 開發分支:見任務指定(常見 `claude/pca-dashboard-serverless-i00715`);最終要上線一律進 `main`。
- Commit 身分:`git config user.email noreply@anthropic.com && git config user.name Claude`。
- 沙盒 Chromium **無對外網路**(所有 browser→外部 fetch 會失敗);要驗證抓圖用 `curl` 走 agent proxy,別靠 Playwright 連外。
