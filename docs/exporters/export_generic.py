#!/usr/bin/env python3
"""通用 Python 匯出器：把「已經算好的 PCA 結果」打包成統一 Zip。

與 export_python.py 的差別：那支是青蛙論文的重現腳本（寫死 Sherratt 2017 的檔案）；
這支是**與資料集無關**的工具，給任何在 Python 裡跑完 PCA 的人用。

    from export_generic import write_unified_zip
    write_unified_zip(
        "my.zip",
        views=[{"id": "shape", "label": "Body shape PCA",
                "scores": df_scores,        # index=species_id 的 DataFrame
                "variance": pca}],          # 或 explained_variance_ratio_ 序列
        taxa=df_taxa,                       # 含 species_id 欄的 DataFrame
        group_col="family",
        tree="tree.nwk",                    # 可選
        dataset={"title": "My PCA"},
    )

**單一檔案、零相依**：下載這一個 .py 就能用。核心只用標準函式庫；
numpy / pandas / sklearn 物件靠鴨子型別支援，沒裝也能用
（傳純 Python 的 dict / list 即可）。所有統計都必須在呼叫前算完——瀏覽器端不做統計。

也可以當 CLI 用（與 export_csv.py 同一種 config.json）：
    python3 exporters/python/export_generic.py <config.json> [--site]
"""
from __future__ import annotations

import csv
import io
import json
import os
import re
import sys
import zipfile
from datetime import datetime, timezone

GENERATOR_VERSION = "1.0.0"
SCHEMA_VERSION = "1.0"
P_MANIFEST, P_TAXA = "manifest.json", "taxa/taxa.csv"
P_TREE, P_CROSSWALK = "tree/tree.nwk", "tree/tip_crosswalk.csv"
# Okabe–Ito 色盲友善配色 + 可辨形狀（與建立精靈、其他匯出器一致）
OKABE = ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#D55E00", "#56B4E9", "#F0E442", "#000000"]
SHAPES = ["circle", "square", "triangle-up", "diamond", "star", "cross", "triangle-down", "pentagon"]


# --------------------------------------------------------------------------
# 統一 Zip 的最小寫出實作（刻意內聯，讓本檔單獨下載就能用，不需其他檔案）
# --------------------------------------------------------------------------
def csv_bytes(header, rows) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    w.writerows(rows)
    return buf.getvalue().encode("utf-8")


def build_view(view_id, label, score_header, variance) -> dict:
    pcs = [c for c in score_header if c.upper().startswith("PC")]
    inl = {pcs[i]: round(float(variance[i]), 6) for i in range(min(len(pcs), len(variance)))}
    return {
        "id": view_id, "label": label, "type": "pca", "n_components": len(pcs),
        "default_axes": ["PC1", pcs[1] if len(pcs) > 1 else "PC1"],
        "axis_labels": {pc: f"{pc} ({inl.get(pc, 0) * 100:.1f}%)" for pc in pcs},
        "variance_explained": inl,
        "scores": {"path": f"views/{view_id}/scores.csv", "id_column": "species_id"},
        "scree_path": f"views/{view_id}/variance.csv",
    }


def write_zip(out_path, manifest, files) -> None:
    d = os.path.dirname(os.path.abspath(out_path))
    if d:
        os.makedirs(d, exist_ok=True)
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(P_MANIFEST, json.dumps(manifest, indent=2, ensure_ascii=False))
        for path, data in files.items():
            zf.writestr(path, data)

# --------------------------------------------------------------------------
# 輸入正規化：把各種常見的 Python 物件轉成 (ids, pc_names, rows)
# --------------------------------------------------------------------------
def _slug(s: str) -> str:
    return re.sub(r"_+$", "", re.sub(r"^_+", "", re.sub(r"[^a-z0-9]+", "_", str(s).lower()))) or "view"


def _is_dataframe(obj) -> bool:
    return hasattr(obj, "columns") and hasattr(obj, "index") and hasattr(obj, "values")


def normalize_scores(scores, ids=None) -> tuple[list[str], list[str], list[list]]:
    """回傳 (ids, pc_names, rows)。接受 DataFrame / ndarray / dict / list-of-rows。"""
    # pandas DataFrame：index 當 species_id（或有 species_id 欄就用它）
    if _is_dataframe(scores):
        cols = [str(c) for c in scores.columns]
        if ids is None:
            if "species_id" in cols:
                i = cols.index("species_id")
                ids = [str(r[i]) for r in scores.values.tolist()]
                keep = [j for j in range(len(cols)) if j != i]
                cols = [cols[j] for j in keep]
                rows = [[r[j] for j in keep] for r in scores.values.tolist()]
            else:
                ids = [str(x) for x in scores.index.tolist()]
                rows = scores.values.tolist()
        else:
            rows = scores.values.tolist()
        pcs = [c if c.upper().startswith("PC") else f"PC{k + 1}" for k, c in enumerate(cols)]
        return [str(x) for x in ids], pcs, rows

    # dict：{species_id: [pc1, pc2, ...]}
    if isinstance(scores, dict):
        ids2 = list(scores.keys())
        rows = [list(scores[k]) for k in ids2]
        n = max((len(r) for r in rows), default=0)
        return [str(x) for x in ids2], [f"PC{i + 1}" for i in range(n)], rows

    # ndarray / list of rows：需要另外給 ids
    rows = scores.tolist() if hasattr(scores, "tolist") else [list(r) for r in scores]
    if ids is None:
        raise ValueError("scores 是矩陣時必須同時提供 ids（每列對應的 species_id）")
    n = max((len(r) for r in rows), default=0)
    return [str(x) for x in ids], [f"PC{i + 1}" for i in range(n)], rows


def normalize_variance(variance, n_pcs: int, rows: list[list]) -> tuple[list[float], bool]:
    """回傳 (每個 PC 的變異解釋比例, 是否為估算值)。

    variance 可以是：sklearn PCA 物件、explained_variance_ratio_ 序列、
    特徵值序列（會自動正規化為比例），或 None（由分數欄變異估算，僅供參考）。
    """
    vals = None
    already_proportions = False
    if variance is not None:
        if hasattr(variance, "explained_variance_ratio_"):
            # sklearn 已經給比例了，絕不可再正規化：只保留前 k 個成分時總和本來就 < 1，
            # 硬拉成 1 會把「解釋了多少變異」灌水。
            vals = [float(x) for x in variance.explained_variance_ratio_]
            already_proportions = True
        elif hasattr(variance, "explained_variance_"):
            vals = [float(x) for x in variance.explained_variance_]        # 特徵值
        else:
            vals = [float(x) for x in (variance.tolist() if hasattr(variance, "tolist") else variance)]

    estimated = False
    if not vals:
        # 沒給就用各 PC 欄的變異當描述性估算（不是重跑 PCA）
        estimated = True
        vals = []
        for j in range(n_pcs):
            xs = [float(r[j]) for r in rows if j < len(r) and r[j] not in ("", None)]
            if not xs:
                vals.append(0.0)
                continue
            m = sum(xs) / len(xs)
            vals.append(sum((x - m) ** 2 for x in xs) / len(xs))

    # 只有「總和明顯超過 1」才是特徵值/變異數，需要轉成比例。總和 ≤ 1 一律當成
    # 已經是比例並原樣保留——只匯出前 k 個 PC 時，總和本來就該小於 1。
    total = sum(vals)
    if not already_proportions and total > 1.0 + 1e-6:
        vals = [v / total for v in vals]
    return vals[:n_pcs] + [0.0] * max(0, n_pcs - len(vals)), estimated


def normalize_taxa(taxa, id_col: str = "species_id") -> tuple[list[str], list[list]]:
    """回傳 (header, rows)。接受 DataFrame / list-of-dicts / CSV 路徑。"""
    if isinstance(taxa, str):
        with open(taxa, "r", encoding="utf-8-sig", newline="") as fh:
            rows = list(csv.reader(fh))
        return rows[0], rows[1:]
    if _is_dataframe(taxa):
        header = [str(c) for c in taxa.columns]
        body = [[("" if v is None else v) for v in r] for r in taxa.values.tolist()]
        if id_col not in header and taxa.index.name:      # id 在 index 上
            header = [str(taxa.index.name)] + header
            body = [[i] + r for i, r in zip(taxa.index.tolist(), body)]
        return header, body
    seq = list(taxa)
    if seq and isinstance(seq[0], dict):
        header = list(seq[0].keys())
        return header, [[r.get(c, "") for c in header] for r in seq]
    raise ValueError("taxa 需為 DataFrame、list of dict，或 CSV 路徑")


def newick_tips(nwk: str) -> list[str]:
    # re.findall 只回傳群組內容（不像 JS 的 match 會給整段），所以不需要再切頭尾
    return [m.strip() for m in re.findall(r"[(,]([^(),:]+):", nwk)]


def auto_groups(values, field: str) -> dict:
    seen: list[str] = []
    for v in values:
        v = "" if v is None else str(v)
        if v and v not in seen:
            seen.append(v)
    return {
        "field": field,
        "members": [
            {"value": v, "label": v, "color": OKABE[i % len(OKABE)], "symbol": SHAPES[i % len(SHAPES)]}
            for i, v in enumerate(seen)
        ],
    }


# --------------------------------------------------------------------------
# 主入口
# --------------------------------------------------------------------------
def write_unified_zip(out_path, views, taxa, *, dataset=None, id_col="species_id",
                      label_col=None, group_col=None, image_col=None,
                      info_cols=(), tree=None, created_with="Python") -> tuple[str, list[str]]:
    """把已算好的 PCA 結果打包成統一 Zip。回傳 (輸出路徑, 提醒訊息清單)。

    views: [{"id","label","scores","variance"(可選),"ids"(矩陣時必填)}, ...]
    taxa : DataFrame / list of dict / CSV 路徑
    tree : Newick 字串、.nwk 路徑，或 None
    """
    warnings: list[str] = []
    files: dict[str, bytes] = {}

    # ---- taxa ----
    t_header, t_rows = normalize_taxa(taxa, id_col)
    if id_col not in t_header:
        raise ValueError(f"taxa 缺少 id 欄 {id_col!r}；實際欄位：{t_header}")
    i_id = t_header.index(id_col)
    i_label = t_header.index(label_col) if label_col and label_col in t_header else i_id
    i_group = t_header.index(group_col) if group_col and group_col in t_header else -1
    i_image = t_header.index(image_col) if image_col and image_col in t_header else -1
    info_cols = [c for c in info_cols if c in t_header]

    out_header = ["species_id", "display_label", "clade", "image"] + list(info_cols)
    taxa_ids: set[str] = set()
    out_rows: list[list] = []
    group_values: list[str] = []
    for r in t_rows:
        sid = str(r[i_id]).strip()
        if not sid:
            continue
        taxa_ids.add(sid)
        gv = str(r[i_group]) if i_group >= 0 and i_group < len(r) else ""
        group_values.append(gv)
        row = [sid, r[i_label] if i_label < len(r) else sid, gv,
               r[i_image] if i_image >= 0 and i_image < len(r) else ""]
        row += [r[t_header.index(c)] if t_header.index(c) < len(r) else "" for c in info_cols]
        out_rows.append(row)
    files[P_TAXA] = csv_bytes(out_header, out_rows)

    # ---- views ----
    manifest_views = []
    for k, v in enumerate(views):
        vid = _slug(v.get("id") or v.get("label") or f"view{k + 1}")
        ids, pcs, rows = normalize_scores(v["scores"], v.get("ids"))
        if len(ids) != len(rows):
            raise ValueError(f"view[{vid}]：ids 筆數（{len(ids)}）與分數列數（{len(rows)}）不符")
        missing = [s for s in ids if s not in taxa_ids]
        if missing:
            warnings.append(f"view[{vid}] 有 {len(missing)} 個物種不在 taxa，例：{missing[:3]}")
        props, estimated = normalize_variance(v.get("variance"), len(pcs), rows)
        if estimated:
            warnings.append(f"view[{vid}] 未提供 variance，已由分數欄變異估算（相對值，僅供參考）")

        files[f"views/{vid}/scores.csv"] = csv_bytes(
            ["species_id"] + pcs, [[s] + list(r) for s, r in zip(ids, rows)])
        cum, var_rows = 0.0, []
        for i, p in enumerate(props):
            cum += p
            var_rows.append([pcs[i], p, cum])
        files[f"views/{vid}/variance.csv"] = csv_bytes(["PC", "variance_explained", "cumulative"], var_rows)
        manifest_views.append(build_view(vid, v.get("label") or vid, ["species_id"] + pcs, props))

    # ---- tree（可選）----
    manifest_tree = None
    if tree:
        nwk = tree
        if isinstance(tree, str) and ("\n" not in tree and ";" not in tree) and os.path.exists(tree):
            with open(tree, "r", encoding="utf-8") as fh:
                nwk = fh.read()
        nwk = nwk.strip()
        if nwk:
            files[P_TREE] = (nwk + "\n").encode("utf-8")
            tips = newick_tips(nwk)
            files[P_CROSSWALK] = csv_bytes(["tip_label", "species_id"], [[t, t] for t in tips])
            off = [t for t in tips if t not in taxa_ids]
            if off:
                warnings.append(f"樹有 {len(off)} 個 tip 不在 taxa（tip 標籤需等於 species_id），例：{off[:3]}")
            manifest_tree = {"path": P_TREE, "format": "newick", "tip_id_map": P_CROSSWALK}

    # ---- manifest ----
    ds = dict(dataset or {})
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "dataset": {
            "title": ds.get("title") or "PCA dataset",
            "doi": ds.get("doi", ""),
            "citation": ds.get("citation", ""),
            "source_url": ds.get("source_url", ""),
            "created_with": created_with,
            "generator_version": GENERATOR_VERSION,
            "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        "id_policy": {"canonical_field": "species_id", "normalization": ["verbatim"], "match_mode": "exact"},
        "views": manifest_views,
        "taxa": {
            "path": P_TAXA, "id_column": "species_id",
            "display_label_column": "display_label", "image_column": "image",
            "info_fields": ([{"column": "clade", "label": group_col or "Group"}] if group_col else [])
                           + [{"column": c, "label": c} for c in info_cols],
        },
        "groups": auto_groups(group_values, group_col or "clade"),
    }
    if manifest_tree:
        manifest["tree"] = manifest_tree
    if not manifest["groups"]["members"]:
        # 驗證器要求 groups.members 非空；沒有分組欄時給一個「全部」的單一群組
        manifest["groups"] = {"field": "clade",
                              "members": [{"value": "", "label": "All", "color": OKABE[0], "symbol": SHAPES[0]}]}

    write_zip(out_path, manifest, files)
    return out_path, warnings


# --------------------------------------------------------------------------
# CLI：吃與 export_csv.py 相同的 config.json
# --------------------------------------------------------------------------
def _cli(argv: list[str]) -> int:
    if not argv:
        print(__doc__.strip().splitlines()[-2])
        print("用法：python3 exporters/python/export_generic.py <config.json> [--site]")
        return 2
    cfg_path = argv[0]
    with open(cfg_path, "r", encoding="utf-8") as fh:
        cfg = json.load(fh)
    base = os.path.dirname(os.path.abspath(cfg_path))
    rel = lambda p: p if os.path.isabs(p) else os.path.join(base, p)  # noqa: E731

    views = []
    for v in cfg["views"]:
        with open(rel(v["scores_csv"]), "r", encoding="utf-8-sig", newline="") as fh:
            rows = list(csv.reader(fh))
        header, body = rows[0], rows[1:]
        ids = [r[0] for r in body]
        vals = [[_num(x) for x in r[1:]] for r in body]
        variance = None
        if v.get("variance_csv"):
            with open(rel(v["variance_csv"]), "r", encoding="utf-8-sig", newline="") as fh:
                vr = list(csv.reader(fh))
            vh = vr[0]
            vi = vh.index("variance_explained") if "variance_explained" in vh else 1
            variance = [_num(r[vi]) for r in vr[1:]]
        views.append({"id": v.get("id") or v.get("label"), "label": v.get("label"),
                      "ids": ids, "scores": vals, "variance": variance})

    out = rel(cfg.get("out", "build/out.zip"))
    path, warns = write_unified_zip(
        out, views, rel(cfg["taxa_csv"]),
        dataset=cfg.get("dataset"), id_col=cfg.get("id_column", "species_id"),
        label_col=cfg.get("label_column"), group_col=cfg.get("group_column"),
        image_col=cfg.get("image_column"), info_cols=cfg.get("info_columns", []),
        tree=rel(cfg["tree"]) if cfg.get("tree") else None,
        created_with=cfg.get("created_with", "Python"))
    for w in warns:
        print("  ⚠️", w)
    # 驗證器是選配（放在建置 repo 的 exporters/common/unified_zip.py）；沒有就只回報產出
    try:
        import unified_zip as U           # noqa: PLC0415
    except ImportError:
        print("✓ 已產生：" + path + "（未找到驗證器，略過檢查）")
        return 0
    ok, errs, info = U.validate_zip(path)
    print(("✓ 已產生並驗證通過：" if ok else "✗ 產生了但驗證失敗：") + path)
    for e in errs:
        print("   -", e)
    if ok:
        print(f"   物種={info.get('n_taxa')} 樹tip={info.get('n_tree_tips')} 來源={info.get('created_with')}")
    return 0 if ok else 1


def _num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return x


if __name__ == "__main__":
    raise SystemExit(_cli(sys.argv[1:]))
