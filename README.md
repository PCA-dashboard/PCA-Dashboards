# PCA Dashboards — 無伺服器互動式 PCA 形態空間 Dashboard（多案例）

把科學論文的 PCA 分析做成「可永久保存、可離線開啟」的互動式 Dashboard。
**一個網站可放多個論文案例**，用右上角「資料集」選單切換；網址 `#dataset=<id>`
可記憶/分享。線上版部署在 GitHub Pages。

- 公開站：**<https://pca-dashboard.github.io/PCA-Dashboards/>**
- 目前案例：
  | id | 論文 | 內容 |
  |----|------|------|
  | `frogs` | Sherratt et al. 2017 | 澳洲青蛙與蝌蚪，166 物種，蝌蚪 PCA + 成體 PCA + 親緣樹（三視圖連動）。Dryad [doi:10.5061/dryad.23j6t](https://doi.org/10.5061/dryad.23j6t) |
  | `trilobites` | Drage & Pates 2025 | 三葉蟲頭部形態空間，762 物種，單一 PCA、無樹，依 Order 著色（viridis） |
  | `fishes` | Torgersen et al. 2023 | 下密西西比魚類體型 3D 幾何形態測量，232 標本，單一形態空間 + **科級親緣樹**（一個科 tip 對應該科所有標本），依主要類群 clade 著色。[doi:10.1038/s41598-023-48086-5](https://doi.org/10.1038/s41598-023-48086-5) |
  | `otoliths` | Van Damme et al. 2024 | 魚類 sagitta 耳石形態，697 種，**側視＋背視兩個形態空間** + 物種級親緣樹，GPA+PCA 由 R geomorph 於匯出階段算好；依體型分色、10 個生態欄位可切換分組。[doi:10.1093/biolinnean/blae085](https://doi.org/10.1093/biolinnean/blae085) |
  | `turtles` | Stayton et al. 2018 | 硬殼龜殼形態，274 種（2722 標本、53 個 3D 地標），3D GPA→物種平均→PCA 由 R geomorph 算好 + 物種級親緣樹；依棲地（水生/陸生）分色，Family 可切換。[doi:10.1111/evo.13561](https://doi.org/10.1111/evo.13561) |
  | `forams` | Kahanamoku et al. 2024 | 聖塔芭芭拉盆地底棲有孔蟲 AutoMorph 2D 形態，36 種（合併 2.3 萬物件、每物種平均 9 個 2D 屬性），相關矩陣 PCA（大小取 log）於匯出階段用 Python 算好，無樹、依屬分色。另有 `forams-objects`（逐物件，23,210 點）。[doi:10.1038/s41597-024-02934-9](https://doi.org/10.1038/s41597-024-02934-9) |
  | `characiforms` | Burns & Sidlauskas 2019 | 脂鯉目（Characiformes）魚類體型幾何形態測量，116 種（PC1-5 已算好）+ 物種級親緣樹（nexus 修剪至本樣本），依科分色（13 科）。[doi:10.1111/evo.13658](https://doi.org/10.1111/evo.13658) |
  | `scallops` | Sherratt, Serb & Adams 2017 | 扇貝殼形態演化，123 種（202 個 3D 地標、859+933 標本）；**左瓣＋右瓣兩個形態空間**，Procrustes 對齊→每物種平均→PCA 於匯出階段用 Python 算好 + 物種級親緣樹（86 tips），依生活習性（附著/自由/游泳/半埋/膠著/棲隙）分色。[doi:10.1186/s12862-017-1098-5](https://doi.org/10.1186/s12862-017-1098-5) |

## 最高原則
1. **無伺服器**：最終成品是純靜態網站，可直接放 GitHub Pages 永久運作，開啟不需後端、
   不需重新上傳資料。
2. **永久保存**：所有 JS 函式庫一律 vendor 到 repo 本地並鎖版本，**禁用 CDN**。
3. **瀏覽器端不做統計**：所有 GPA、PCA、log-shape ratio… 都在「產生統一 Zip」階段算好；
   Dashboard 只讀結果作圖。
4. **直覺好用**：物種搜尋、清楚圖例、色盲友善（顏色＋形狀）、下載按鈕、載入/錯誤狀態、手機版 RWD（漢堡選單、自適應圖表高度）。

## 架構：統一 Zip 是唯一契約
所有案例都收斂成同一種**統一 Zip**；Dashboard 只認這個格式。三種輸入（R / Python /
純 CSV）各自產出同一種統一 Zip。格式契約見
[`docs/unified_zip_format.md`](docs/unified_zip_format.md)。

```
原始資料 ──(R / Python / CSV 匯出器)──▶ 統一 Zip ──▶ Dashboard（靜態網站）
        統計都在這裡完成                  契約          只讀結果、互動呈現
```

統一 Zip 重點：`manifest.json`（dataset、views[] 每個 PCA 視圖、taxa、groups、
**tree 可選**）＋ `scores.csv` ＋ `taxa.csv`（＋可選 `tree.nwk` / 影像）。
`species_id` 是 join key，必須在 scores／taxa／(樹 crosswalk) 三方一致。

**建立精靈（`docs/builder.html`）**：對已算好的 PCA（CSV）而言，整個「上傳 → 互動預覽 →
打包成 GitHub Pages 網站」可**全程在瀏覽器內**完成，不需任何後端。需要跑統計的原始
資料（尤其 R/geomorph）則先用本機匯出器產生統一 Zip，再用精靈預覽/打包。

## 多案例 gallery
- `docs/data/catalog.json` 列出所有案例（id、title、short、description、zip 路徑）。
- 每個案例一個統一 Zip：`docs/data/<id>.zip`。
- Dashboard 右上「資料集」選單切換；網址 `#dataset=<id>` 可記憶/分享。
- 載入優先序（`docs/js/app.js`）：烤入資料（單站自包含）→ `catalog.json`（gallery）→ 上傳畫面。

### 用建立精靈新增自己的資料集
對已算好的 PCA（CSV）而言，`docs/builder.html`（**建立精靈**）可全程在瀏覽器內完成：
上傳「PC 分數 CSV（每列一物種：id 欄 + PC1..PCn）+ 分類欄位」（有樹再加 Newick，tip 標籤
= species_id）→ 互動預覽 → 下載統一 Zip / 打包成可部署網站。不需任何後端。

## 本地預覽
```bash
cd docs && python3 -m http.server 8099   # 開 http://127.0.0.1:8099/
```

## 部署
見 [`docs/deploy_github_pages.md`](docs/deploy_github_pages.md)。`docs/` 由
`.github/workflows/deploy-pages.yml` 發佈到 Pages（Source 選 **GitHub Actions**），只部署
`docs/`，不碰整個 repo。

## 函式庫（全本地，禁 CDN）
plotly.js 2.35.2 · JSZip 3.10.1 · phylocanvas.gl 1.64.0（含 deck.gl/luma.gl，esbuild 打包）。
