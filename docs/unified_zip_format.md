# 統一 Zip 格式規格（v1.0）

Dashboard 與所有匯出器（建立精靈 / R / Python / CSV）之間的**唯一契約**。所有統計都在匯出端
算好；Dashboard 只讀結果作圖，**瀏覽器端不做任何統計運算**。

## 目錄結構
```
manifest.json                 契約本體（見下）
views/<id>/scores.csv         物種 × PC 分數；第一欄 species_id，其後 PC1..PCn
views/<id>/variance.csv       完整 scree：欄 PC, variance_explained, cumulative
tree/tree.nwk                 Newick 樹
tree/tip_crosswalk.csv        欄 tip_label, species_id（樹葉 → join key 映射）
taxa/taxa.csv                 物種中介資料；含 species_id 等欄
images/<file>                 物種圖片（可選；缺圖時 Dashboard 用佔位圖）
```

## manifest.json
```jsonc
{
  "schema_version": "1.0",                 // 格式契約版本（Dashboard 會檢查）
  "dataset": {
    "title",                                 // 必填
    "doi", "citation", "source_url",         // 選填（鍵要在，值可為空字串）
    "created_with": "R | Python | CSV | Builder",
    "generator_version", "generated_at"
  },
  "id_policy": {                           // join key 政策
    "canonical_field": "species_id",
    "normalization": ["verbatim"],         // 此資料集標籤跨源逐字一致
    "match_mode": "exact"
  },
  "views": [{
    "id": "tadpole", "label": "...", "type": "pca",
    "n_components": 10,
    "default_axes": ["PC1", "PC2"],
    "axis_labels": { "PC1": "PC1 (40.5%)", ... },
    "variance_explained": { "PC1": 0.4054, ... },   // 已匯出 PC 的比例
    "scores": { "path": "views/tadpole/scores.csv", "id_column": "species_id" },
    "scree_path": "views/tadpole/variance.csv"      // 完整變異譜（scree plot 用）
  }, { "id": "adult", ... }],
  "tree": { "path": "tree/tree.nwk", "format": "newick",
            "tip_id_map": "tree/tip_crosswalk.csv" },
  "taxa": {
    "path": "taxa/taxa.csv",
    "id_column": "species_id",
    "display_label_column": "display_label",
    "image_column": "image",                 // 主照片欄（檔名指向 images/）；可選
    "image_caption_column": "image_credit",  // 照片標註/來源授權；可選
    "outline_column": "outline",             // 形態輪廓欄（與照片並存顯示）；可選
    "info_fields": [ { "column": "...", "label": "..." } ]   // 資訊視窗顯示欄位（有序）
  },
  "groups": {                               // 圖例 / 著色 / 形狀（色盲友善）
    "field": "clade",
    "members": [ { "value", "label", "color", "symbol" } ]
  }
}
```

## 關鍵約束：join key 一致性
`species_id` 必須在以下三方完全一致，否則視為錯誤：
1. 每個 view 的 `scores.csv`
2. 樹的 tip（經 `tip_crosswalk.csv` 映射為 `species_id`）
3. `taxa.csv`

匯出端與載入端都會驗證。本資料集（166 物種）三方逐字一致、無遺漏無重複。

## 設計重點
- **`groups` 同時帶 `color` 與 `symbol`**：顏色之外也用形狀區辨，色盲友善由結構保證，
  非事後補丁。配色採 Okabe–Ito。
- **`info_fields` 是有序白名單**：資訊視窗只顯示指定欄位，新增 taxa 欄位不會洩漏到 UI。
- **影像可選、可雙圖**：`image_column`（照片）與 `outline_column`（形態輪廓）各自獨立、
  可並存於資訊卡/側邊面板；`image_caption_column` 提供照片的來源與授權標註。多物種可共用
  同一張圖檔（如「同科代表標本」照），載入端會去重、只解一次。皆缺時優雅降級為佔位圖。
- **scores 與 variance 分離**：`scores.csv` 含前 N 個 PC（軸切換用）；`variance.csv`
  含完整 scree 譜。

## 驗證器
```
python3 exporters/common/unified_zip.py validate <zip>
```
檢查格式、必填欄位、與三方 join key 一致性。

---

## 怎麼產生統一 Zip

有四條路，產出的 Zip 完全等價，Dashboard 一律無差別讀取。

| 路徑 | 適合誰 | 需要什麼 |
|------|--------|----------|
| **建立精靈**（瀏覽器） | 手上已經是 CSV | 什麼都不用裝，開網頁就能用 |
| **通用 R 匯出器** | 在 R 裡跑完 PCA | 只要 base R（傳 `phylo` 物件才需要 ape）· [↓ 下載](exporters/unified_zip.R) |
| **通用 Python 匯出器** | 在 Python 裡跑完 PCA | 只要標準函式庫（numpy/pandas/sklearn 可選）· [↓ 下載](exporters/export_generic.py) |
| **CSV 匯出器**（命令列） | 要腳本化、可重跑 | Python 3 |

> 瀏覽器裡**不可能**跑 R 或 Python——本站是純靜態、無伺服器的。所以建立精靈只吃
> 「已經算好的分數 CSV」；還在 R/Python 裡的資料請用下面的通用匯出器直接產 Zip。

### 建立精靈（瀏覽器，零安裝）
開 `builder.html`：上傳分數 CSV → 分類 CSV →（可選）Newick 樹 → 建立預覽 →
下載統一 Zip，或直接打包成一個可放 GitHub Pages 的完整網站。全程在你的瀏覽器內完成，
資料不會上傳到任何伺服器。

### 通用 R 匯出器

**[↓ 下載 unified_zip.R](exporters/unified_zip.R)** — 單一檔案、只用 base R，
放進專案 `source()` 就能用（傳 `phylo` 物件才需要 ape）。

`scores` 吃 `prcomp` / `gm.prcomp` / matrix / data.frame；沒傳 `variance` 時自動取
`sdev^2`（`gm.prcomp` 取 `$d`）。

```r
source("unified_zip.R")   # 下載後放在手邊即可
pca <- prcomp(my_matrix)                  # 或 geomorph::gm.prcomp(...)
write_unified_zip(
  out       = "build/my.zip",
  views     = list(list(id = "shape", label = "Body shape PCA", scores = pca)),
  taxa      = my_taxa_df,                 # 含 species_id 欄的 data.frame
  group_col = "family",
  tree      = my_phylo,                   # phylo 物件／Newick 字串／.nwk 路徑，可省略
  dataset   = list(title = "My PCA")
)
```

### 通用 Python 匯出器

**[↓ 下載 export_generic.py](exporters/export_generic.py)** — 單一檔案、零相依，
下載這一個 `.py` 就能用（numpy / pandas / sklearn 有裝就自動支援，沒裝也能跑）。

`scores` 吃 DataFrame / ndarray / dict / list-of-rows；`variance` 可直接傳 fitted 的
sklearn `PCA`。

```python
from export_generic import write_unified_zip
write_unified_zip("my.zip",
    views=[{"id": "shape", "label": "Body shape PCA",
            "scores": df_scores,       # index=species_id 的 DataFrame
            "variance": pca}],         # fitted sklearn PCA，或比例序列
    taxa=df_taxa, group_col="family", tree="tree.nwk",
    dataset={"title": "My PCA"})
```

傳 fitted PCA 時取的是 `explained_variance_ratio_`，且**不會重新正規化**：只保留前
k 個成分時總和本來就小於 1，硬拉成 1 會把「解釋了多少變異」灌水。傳特徵值
（總和大於 1）才會轉換成比例。

### 多個形態空間
`views` 給多筆就會有多張連動的 PCA 圖（例如耳石的側視＋背視、扇貝的左瓣＋右瓣）。
各視圖的 `species_id` 都必須落在 `taxa` 內。

## 常見地雷

- **`species_id` 三方要一致**：scores、taxa、樹的 tip 標籤必須是同一組字串。
  這是最常見的失敗原因，驗證器會直接指出是哪幾筆對不上。
- **R 的 `write.csv` 會多一個空表頭**：row names 那欄的標題是空字串。建立精靈認得
  這種格式（會顯示成「第 1 欄，無標題」），但自己寫程式處理時要留意。
- **`doi` / `citation` / `source_url` 是選填**：沒有 DOI 的資料集（未發表、自己的
  分析）留空即可，鍵存在就好。
- **PC 數量**：`scores.csv` 放前 N 個 PC 就好（軸切換用）；完整 scree 放 `variance.csv`。
