# ============================================================================
# 通用 R 匯出器的可執行範例 —— 自帶合成資料，下載下來直接就能跑。
#
#   Rscript example_generic.R
#
# 需要 unified_zip.R 放在同一個資料夾（兩個檔都能從線上說明頁下載）。
# 產出 example_R.zip，可直接拖進 Dashboard 的檢視器看結果。
# ============================================================================

# 找到同層的 unified_zip.R（Rscript 下 sys.frame 不可靠，改用 --file=）
a <- commandArgs(trailingOnly = FALSE)
sf <- sub("^--file=", "", a[grepl("^--file=", a)])
here <- if (length(sf)) dirname(normalizePath(sf)) else getwd()
uz <- file.path(here, "unified_zip.R")
if (!file.exists(uz))
  stop("找不到 unified_zip.R；請把它和本範例放在同一個資料夾（皆可從線上說明頁下載）。")
source(uz)

# ---- 合成資料：17 個假物種、3 個科、2 種棲地 --------------------------------
set.seed(42)                                   # 固定亂數，結果可重現
fams  <- c(A = "Alphidae", B = "Betidae", C = "Gammidae")
counts <- c(A = 6, B = 6, C = 5)
species <- unlist(lapply(names(counts), function(k) sprintf("Genus_%s_sp%d", k, seq_len(counts[[k]]))))
clade <- rep(names(counts), counts)

taxa <- data.frame(
  species_id    = species,
  display_label = gsub("_", " ", species),
  family        = unname(fams[clade]),
  habitat       = ifelse(clade == "C", "terrestrial", "aquatic"),
  body_mass     = sample(5:900, length(species), replace = TRUE),
  stringsAsFactors = FALSE
)

# 假裝這是形態測量矩陣（實務上是你的地標/測量資料）
X <- matrix(rnorm(length(species) * 10), nrow = length(species),
            dimnames = list(species, NULL))
# 讓三個科在形態空間裡稍微分開，圖比較好看
X <- X + matrix(rep(match(clade, names(counts)) * 1.6, 10), nrow = length(species))

pca <- prcomp(X)                                # ← 你的統計在這裡做完

# ---- 合成一棵樹（tip 標籤必須等於 species_id）------------------------------
build_newick <- function(names) {
  cur <- paste0(names, ":1.0")
  while (length(cur) > 1) {
    nxt <- character(0)
    i <- 1
    while (i + 1 <= length(cur)) {
      nxt <- c(nxt, sprintf("(%s,%s):1.0", cur[i], cur[i + 1])); i <- i + 2
    }
    if (i == length(cur)) nxt <- c(nxt, cur[i])
    cur <- nxt
  }
  paste0(cur, ";")
}
nwk <- build_newick(species)

# ---- 匯出 ------------------------------------------------------------------
write_unified_zip(
  out   = file.path(here, "example_R.zip"),
  views = list(list(id = "shape", label = "Body shape PCA", scores = pca)),
  taxa  = taxa,
  label_col = "display_label",
  group_col = "family",
  info_cols = c("habitat", "body_mass"),
  tree      = nwk,
  dataset   = list(title = "Example (generic R exporter)")
)

cat("\n把 example_R.zip 拖進 Dashboard 的檢視器就能看結果。\n")
