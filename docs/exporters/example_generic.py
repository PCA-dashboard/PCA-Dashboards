#!/usr/bin/env python3
"""通用 Python 匯出器的可執行範例 —— 自帶合成資料，下載下來直接就能跑。

    python3 example_generic.py

需要 export_generic.py 放在同一個資料夾（兩個檔都能從線上說明頁下載）。
產出 example_Python.zip，可直接拖進 Dashboard 的檢視器看結果。

沒裝 numpy / pandas / sklearn 也能跑（會走純標準函式庫那條路）。
"""
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

try:
    from export_generic import write_unified_zip
except ImportError:
    raise SystemExit("找不到 export_generic.py；請把它和本範例放在同一個資料夾"
                     "（皆可從線上說明頁下載）。")

OUT = os.path.join(HERE, "example_Python.zip")


def synth_taxa():
    """17 個假物種、3 個科、2 種棲地。固定亂數種子，結果可重現。"""
    random.seed(42)
    counts = [("A", "Alphidae", 6), ("B", "Betidae", 6), ("C", "Gammidae", 5)]
    taxa, clade = [], []
    for key, family, n in counts:
        for i in range(1, n + 1):
            sid = f"Genus_{key}_sp{i}"
            clade.append(key)
            taxa.append({
                "species_id": sid,
                "display_label": sid.replace("_", " "),
                "family": family,
                "habitat": "terrestrial" if key == "C" else "aquatic",
                "body_mass": random.randint(5, 900),
            })
    return taxa, clade


def synth_newick(names):
    """把物種兩兩配對成一棵平衡樹。tip 標籤必須等於 species_id。"""
    cur = [f"{n}:1.0" for n in names]
    while len(cur) > 1:
        nxt = [f"({cur[i]},{cur[i + 1]}):1.0" for i in range(0, len(cur) - 1, 2)]
        if len(cur) % 2:
            nxt.append(cur[-1])
        cur = nxt
    return cur[0] + ";"


def main() -> int:
    taxa, clade = synth_taxa()
    ids = [t["species_id"] for t in taxa]
    order = {k: i for i, k in enumerate(dict.fromkeys(clade))}

    try:
        import numpy as np
        import pandas as pd
        from sklearn.decomposition import PCA

        rng = np.random.default_rng(42)
        X = rng.normal(size=(len(taxa), 10))
        X += np.array([order[c] * 1.6 for c in clade])[:, None]   # 讓三個科分開一點
        pca = PCA(n_components=5).fit(X)                          # ← 你的統計在這裡做完
        scores = pd.DataFrame(pca.transform(X), index=ids,
                              columns=[f"PC{i + 1}" for i in range(5)])
        view = {"id": "shape", "label": "Body shape PCA", "scores": scores, "variance": pca}
        print("  （偵測到 pandas + sklearn，直接把 fitted PCA 交給匯出器）")
    except ImportError:
        # 純標準函式庫：自己造幾個 PC 分數，variance 也直接給
        random.seed(7)
        scores = [[random.gauss(order[c] * 1.6, 1) for _ in range(3)] for c in clade]
        view = {"id": "shape", "label": "Body shape PCA",
                "ids": ids, "scores": scores, "variance": [0.55, 0.28, 0.11]}
        print("  （沒有 pandas/sklearn，改走純標準函式庫那條路）")

    path, warns = write_unified_zip(
        OUT, views=[view], taxa=taxa,
        label_col="display_label", group_col="family",
        info_cols=["habitat", "body_mass"],
        tree=synth_newick(ids),
        dataset={"title": "Example (generic Python exporter)"})
    for w in warns:
        print("  ⚠️", w)
    print("✓ 已寫出", path)
    print("\n把 example_Python.zip 拖進 Dashboard 的檢視器就能看結果。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
