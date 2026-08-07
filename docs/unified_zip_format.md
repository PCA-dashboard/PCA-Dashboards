# 統一 Zip 格式規格（v1.0）

Dashboard 與三個匯出器（R / Python / CSV）之間的**唯一契約**。所有統計都在匯出端
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
