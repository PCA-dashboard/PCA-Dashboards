# ============================================================================
# 通用 R 匯出器：把「已經算好的 PCA 結果」打包成統一 Zip。
#
# 與 export_r.R 的差別：那支是青蛙論文的重現腳本（寫死 Sherratt 2017 的檔案）；
# 這支是**與資料集無關**的工具，給任何在 R 裡跑完 PCA 的人用。
#
#   source("exporters/r/unified_zip.R")
#   pca <- prcomp(my_matrix)
#   write_unified_zip(
#     out       = "build/my.zip",
#     views     = list(list(id = "shape", label = "Body shape PCA", scores = pca)),
#     taxa      = my_taxa_df,          # 含 species_id 欄的 data.frame
#     group_col = "family",
#     tree      = my_phylo,            # ape 的 phylo 物件／Newick 字串／.nwk 路徑（可選）
#     dataset   = list(title = "My PCA")
#   )
#
# 只用 base R：JSON 自己序列化（結構單純、我們自己控制），不需要 jsonlite；
# 樹若傳 phylo 物件才需要 ape。壓縮用 utils::zip()（需系統有 zip 指令）。
#
# 所有統計都必須在呼叫前算完——Dashboard 端不做統計。
# ============================================================================

UZ_SCHEMA_VERSION <- "1.0"
UZ_GENERATOR_VERSION <- "1.0.0"
# Okabe–Ito 色盲友善配色 + 可辨形狀（與建立精靈、Python 匯出器一致）
UZ_OKABE <- c("#0072B2", "#E69F00", "#009E73", "#CC79A7",
              "#D55E00", "#56B4E9", "#F0E442", "#000000")
UZ_SHAPES <- c("circle", "square", "triangle-up", "diamond",
               "star", "cross", "triangle-down", "pentagon")

# ---- 極簡 JSON 序列化（只處理我們自己組出來的結構）------------------------
.uz_json_escape <- function(s) {
  s <- gsub("\\\\", "\\\\\\\\", s)
  s <- gsub('"', '\\\\"', s)
  s <- gsub("\n", "\\\\n", s)
  s <- gsub("\r", "\\\\r", s)
  s <- gsub("\t", "\\\\t", s)
  s
}
.uz_to_json <- function(x, indent = 0) {
  pad <- strrep("  ", indent); pad2 <- strrep("  ", indent + 1)
  if (is.null(x)) return("null")
  if (inherits(x, "uz_raw")) return(unclass(x))
  if (is.list(x)) {
    nms <- names(x)
    if (!is.null(nms) && all(nzchar(nms))) {          # 物件
      if (length(x) == 0) return("{}")
      parts <- vapply(seq_along(x), function(i)
        paste0(pad2, '"', .uz_json_escape(nms[i]), '": ', .uz_to_json(x[[i]], indent + 1)),
        character(1))
      return(paste0("{\n", paste(parts, collapse = ",\n"), "\n", pad, "}"))
    }
    if (length(x) == 0) return("[]")                   # 陣列
    parts <- vapply(x, function(v) paste0(pad2, .uz_to_json(v, indent + 1)), character(1))
    return(paste0("[\n", paste(parts, collapse = ",\n"), "\n", pad, "]"))
  }
  if (length(x) != 1) {                                # 純量向量 → 陣列
    parts <- vapply(x, function(v) .uz_to_json(v, indent + 1), character(1))
    return(paste0("[", paste(parts, collapse = ", "), "]"))
  }
  if (is.logical(x)) return(if (isTRUE(x)) "true" else "false")
  if (is.numeric(x)) {
    if (!is.finite(x)) return("null")
    return(format(x, scientific = FALSE, trim = TRUE))
  }
  paste0('"', .uz_json_escape(as.character(x)), '"')
}

.uz_slug <- function(s) {
  s <- tolower(as.character(s)[1])
  s <- gsub("[^a-z0-9]+", "_", s)
  s <- gsub("^_+|_+$", "", s)
  if (!nzchar(s)) "view" else s
}

# ---- 從常見 R 物件抽出分數與變異 ------------------------------------------
#' 回傳 list(ids, pcs, mat)
.uz_scores <- function(scores, ids = NULL) {
  if (inherits(scores, "prcomp") || inherits(scores, "gm.prcomp") || !is.null(attr(scores, "x"))) {
    m <- scores$x
  } else if (is.data.frame(scores)) {
    if (is.null(ids) && "species_id" %in% names(scores)) {
      ids <- as.character(scores[["species_id"]])
      scores <- scores[, setdiff(names(scores), "species_id"), drop = FALSE]
    }
    m <- as.matrix(scores)
  } else {
    m <- as.matrix(scores)
  }
  if (is.null(ids)) ids <- rownames(m)
  if (is.null(ids)) stop("找不到 species_id：分數沒有 rownames，也沒有傳 ids")
  cn <- colnames(m)
  pcs <- if (!is.null(cn) && all(grepl("^PC", cn, ignore.case = TRUE))) cn
         else paste0("PC", seq_len(ncol(m)))
  list(ids = as.character(ids), pcs = pcs, mat = m)
}

#' 回傳 list(props, estimated)
.uz_variance <- function(variance, scores_obj, n_pcs, mat) {
  vals <- NULL; already_prop <- FALSE
  if (is.null(variance)) {
    if (inherits(scores_obj, "prcomp")) {
      vals <- scores_obj$sdev^2                        # 特徵值
    } else if (!is.null(scores_obj$d)) {
      vals <- as.numeric(scores_obj$d)                 # geomorph::gm.prcomp
    }
  } else {
    vals <- as.numeric(variance)
  }
  estimated <- FALSE
  if (is.null(vals) || !length(vals)) {
    estimated <- TRUE                                   # 描述性估算，不是重跑 PCA
    vals <- apply(mat, 2, function(col) {
      col <- col[is.finite(col)]
      if (!length(col)) 0 else sum((col - mean(col))^2) / length(col)
    })
  }
  vals <- as.numeric(vals)
  # 只有總和明顯 > 1 才是特徵值，需要轉比例；≤ 1 一律視為已是比例並原樣保留
  # （只匯出前 k 個 PC 時，總和本來就該小於 1，硬拉成 1 會灌水）。
  tot <- sum(vals, na.rm = TRUE)
  if (!already_prop && is.finite(tot) && tot > 1 + 1e-9) vals <- vals / tot
  if (length(vals) < n_pcs) vals <- c(vals, rep(0, n_pcs - length(vals)))
  list(props = vals[seq_len(n_pcs)], estimated = estimated)
}

.uz_newick_tips <- function(nwk) {
  m <- gregexpr("[(,]([^(),:]+):", nwk)
  hits <- regmatches(nwk, m)[[1]]
  if (!length(hits)) return(character(0))
  trimws(substr(hits, 2, nchar(hits) - 1))
}

.uz_write_csv <- function(path, header, rows) {
  df <- as.data.frame(rows, stringsAsFactors = FALSE)
  names(df) <- header
  utils::write.csv(df, path, row.names = FALSE, na = "", fileEncoding = "UTF-8")
}

# ---- 主入口 ----------------------------------------------------------------
#' 把已算好的 PCA 結果打包成統一 Zip
#'
#' @param out       輸出的 .zip 路徑
#' @param views     list，每個元素 list(id, label, scores, variance=可選, ids=可選)。
#'                  scores 可為 prcomp / gm.prcomp / matrix / data.frame。
#' @param taxa      data.frame（含 id 欄）或 CSV 路徑
#' @param dataset   list(title, doi, citation, source_url)，除 title 外皆可省略
#' @param id_col    taxa 的 id 欄名，預設 "species_id"
#' @param label_col 顯示名稱欄（可選）
#' @param group_col 分組著色欄（可選）
#' @param image_col 圖片欄（可選）
#' @param info_cols 資訊卡要顯示的欄位（character vector）
#' @param tree      ape 的 phylo 物件、Newick 字串，或 .nwk 路徑（可選）
#' @return 隱形回傳 list(path, warnings)
write_unified_zip <- function(out, views, taxa, dataset = list(),
                              id_col = "species_id", label_col = NULL,
                              group_col = NULL, image_col = NULL,
                              info_cols = character(0), tree = NULL,
                              created_with = "R") {
  warns <- character(0)
  stage <- file.path(tempdir(), paste0("uz_", as.integer(runif(1, 1e6, 9e6))))
  dir.create(stage, recursive = TRUE, showWarnings = FALSE)
  on.exit(unlink(stage, recursive = TRUE), add = TRUE)

  # ---- taxa ----
  if (is.character(taxa) && length(taxa) == 1 && file.exists(taxa)) {
    taxa <- utils::read.csv(taxa, stringsAsFactors = FALSE, check.names = FALSE)
  }
  if (!is.data.frame(taxa)) stop("taxa 需為 data.frame 或 CSV 路徑")
  if (!id_col %in% names(taxa)) {
    if (!is.null(rownames(taxa)) && !identical(rownames(taxa), as.character(seq_len(nrow(taxa))))) {
      taxa[[id_col]] <- rownames(taxa)                  # R 常見：id 放在 rownames
    } else {
      stop(sprintf("taxa 缺少 id 欄 '%s'；實際欄位：%s", id_col, paste(names(taxa), collapse = ", ")))
    }
  }
  sid <- trimws(as.character(taxa[[id_col]]))
  keep <- nzchar(sid)
  taxa <- taxa[keep, , drop = FALSE]; sid <- sid[keep]
  gv <- if (!is.null(group_col) && group_col %in% names(taxa)) as.character(taxa[[group_col]]) else rep("", length(sid))
  gv[is.na(gv)] <- ""
  lbl <- if (!is.null(label_col) && label_col %in% names(taxa)) as.character(taxa[[label_col]]) else sid
  img <- if (!is.null(image_col) && image_col %in% names(taxa)) as.character(taxa[[image_col]]) else rep("", length(sid))
  info_cols <- info_cols[info_cols %in% names(taxa)]

  dir.create(file.path(stage, "taxa"), recursive = TRUE, showWarnings = FALSE)
  taxa_out <- data.frame(species_id = sid, display_label = lbl, clade = gv, image = img,
                         stringsAsFactors = FALSE)
  for (c in info_cols) taxa_out[[c]] <- as.character(taxa[[c]])
  utils::write.csv(taxa_out, file.path(stage, "taxa", "taxa.csv"),
                   row.names = FALSE, na = "", fileEncoding = "UTF-8")
  taxa_ids <- unique(sid)

  # ---- views ----
  mviews <- list()
  for (k in seq_along(views)) {
    v <- views[[k]]
    vid <- .uz_slug(if (!is.null(v$id)) v$id else if (!is.null(v$label)) v$label else paste0("view", k))
    s <- .uz_scores(v$scores, v$ids)
    n_pc <- length(s$pcs)
    if (length(s$ids) != nrow(s$mat))
      stop(sprintf("view[%s]：ids 筆數（%d）與分數列數（%d）不符", vid, length(s$ids), nrow(s$mat)))
    miss <- setdiff(s$ids, taxa_ids)
    if (length(miss))
      warns <- c(warns, sprintf("view[%s] 有 %d 個物種不在 taxa，例：%s",
                                vid, length(miss), paste(utils::head(miss, 3), collapse = ", ")))
    vr <- .uz_variance(v$variance, v$scores, n_pc, s$mat)
    if (vr$estimated)
      warns <- c(warns, sprintf("view[%s] 未提供 variance，已由分數欄變異估算（相對值，僅供參考）", vid))

    vdir <- file.path(stage, "views", vid)
    dir.create(vdir, recursive = TRUE, showWarnings = FALSE)
    sc <- as.data.frame(s$mat, stringsAsFactors = FALSE)
    names(sc) <- s$pcs
    sc <- cbind(species_id = s$ids, sc, stringsAsFactors = FALSE)
    utils::write.csv(sc, file.path(vdir, "scores.csv"), row.names = FALSE, na = "", fileEncoding = "UTF-8")
    utils::write.csv(data.frame(PC = s$pcs, variance_explained = vr$props,
                                cumulative = cumsum(vr$props), stringsAsFactors = FALSE),
                     file.path(vdir, "variance.csv"), row.names = FALSE, na = "", fileEncoding = "UTF-8")

    vinl <- stats::setNames(as.list(round(vr$props, 6)), s$pcs)
    axis <- stats::setNames(as.list(sprintf("%s (%.1f%%)", s$pcs, vr$props * 100)), s$pcs)
    mviews[[length(mviews) + 1]] <- list(
      id = vid, label = if (!is.null(v$label)) v$label else vid, type = "pca",
      n_components = n_pc,
      default_axes = c("PC1", if (n_pc > 1) s$pcs[2] else "PC1"),
      axis_labels = axis, variance_explained = vinl,
      scores = list(path = sprintf("views/%s/scores.csv", vid), id_column = "species_id"),
      scree_path = sprintf("views/%s/variance.csv", vid))
  }

  # ---- 樹（可選）----
  mtree <- NULL
  if (!is.null(tree)) {
    nwk <- NULL
    if (inherits(tree, "phylo")) {
      if (!requireNamespace("ape", quietly = TRUE))
        stop("傳入 phylo 物件需要 ape 套件；或改傳 Newick 字串／.nwk 路徑")
      nwk <- paste(ape::write.tree(tree), collapse = "")
    } else if (is.character(tree) && length(tree) == 1 && !grepl(";", tree) && file.exists(tree)) {
      nwk <- paste(readLines(tree, warn = FALSE), collapse = "")
    } else {
      nwk <- paste(as.character(tree), collapse = "")
    }
    nwk <- trimws(nwk)
    if (nzchar(nwk)) {
      dir.create(file.path(stage, "tree"), showWarnings = FALSE)
      writeLines(nwk, file.path(stage, "tree", "tree.nwk"), useBytes = TRUE)
      tips <- .uz_newick_tips(nwk)
      utils::write.csv(data.frame(tip_label = tips, species_id = tips, stringsAsFactors = FALSE),
                       file.path(stage, "tree", "tip_crosswalk.csv"),
                       row.names = FALSE, na = "", fileEncoding = "UTF-8")
      off <- setdiff(tips, taxa_ids)
      if (length(off))
        warns <- c(warns, sprintf("樹有 %d 個 tip 不在 taxa（tip 標籤需等於 species_id），例：%s",
                                  length(off), paste(utils::head(off, 3), collapse = ", ")))
      mtree <- list(path = "tree/tree.nwk", format = "newick", tip_id_map = "tree/tip_crosswalk.csv")
    }
  }

  # ---- groups ----
  uniq <- unique(gv[nzchar(gv)])
  members <- if (length(uniq)) lapply(seq_along(uniq), function(i) list(
    value = uniq[i], label = uniq[i],
    color = UZ_OKABE[((i - 1) %% length(UZ_OKABE)) + 1],
    symbol = UZ_SHAPES[((i - 1) %% length(UZ_SHAPES)) + 1]))
    else list(list(value = "", label = "All", color = UZ_OKABE[1], symbol = UZ_SHAPES[1]))

  info_fields <- c(
    if (!is.null(group_col)) list(list(column = "clade", label = group_col)) else list(),
    lapply(info_cols, function(c) list(column = c, label = c)))

  manifest <- list(
    schema_version = UZ_SCHEMA_VERSION,
    dataset = list(
      title = if (!is.null(dataset$title)) dataset$title else "PCA dataset",
      doi = if (!is.null(dataset$doi)) dataset$doi else "",
      citation = if (!is.null(dataset$citation)) dataset$citation else "",
      source_url = if (!is.null(dataset$source_url)) dataset$source_url else "",
      created_with = created_with,
      generator_version = UZ_GENERATOR_VERSION,
      generated_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC")),
    id_policy = list(canonical_field = "species_id",
                     normalization = I(list("verbatim")), match_mode = "exact"),
    views = mviews,
    taxa = list(path = "taxa/taxa.csv", id_column = "species_id",
                display_label_column = "display_label", image_column = "image",
                info_fields = info_fields),
    groups = list(field = if (!is.null(group_col)) group_col else "clade", members = members))
  if (!is.null(mtree)) manifest$tree <- mtree

  writeLines(.uz_to_json(manifest), file.path(stage, "manifest.json"), useBytes = TRUE)

  # ---- 壓縮 ----
  out <- normalizePath(out, mustWork = FALSE)
  dir.create(dirname(out), recursive = TRUE, showWarnings = FALSE)
  if (file.exists(out)) unlink(out)
  wd <- setwd(stage); on.exit(setwd(wd), add = TRUE)
  rc <- utils::zip(out, list.files(".", recursive = TRUE, all.files = FALSE), flags = "-q9X")
  setwd(wd)
  if (rc != 0 || !file.exists(out))
    stop("壓縮失敗（utils::zip 需要系統的 zip 指令）。Linux/macOS 通常內建；Windows 請裝 Rtools。")

  for (w in warns) message("  ⚠️ ", w)
  message(sprintf("✓ 已寫出統一 Zip：%s（%d 物種、%d 個視圖）",
                  out, length(taxa_ids), length(mviews)))
  invisible(list(path = out, warnings = warns))
}
