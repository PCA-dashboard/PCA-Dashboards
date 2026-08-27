# Unified Zip format specification (v1.0)

> Keep this file in sync with `unified_zip_format.md` (the Traditional Chinese original).
> Both are rendered by `format.html`; the section structure must match.

The **single contract** between the dashboard and every exporter (build wizard / R / Python / CSV).
All statistics are computed at export time; the dashboard only plots the results and
**never runs any statistics in the browser**.

## Directory layout
```
manifest.json                 the contract itself (see below)
views/<id>/scores.csv         species × PC scores; first column species_id, then PC1..PCn
views/<id>/variance.csv       full scree: columns PC, variance_explained, cumulative
tree/tree.nwk                 Newick tree
tree/tip_crosswalk.csv        columns tip_label, species_id (tree leaf → join key mapping)
taxa/taxa.csv                 species metadata; includes species_id and other columns
images/<file>                 species images (optional; a placeholder is shown when missing)
```

## manifest.json
```jsonc
{
  "schema_version": "1.0",                 // contract version (the dashboard checks it)
  "dataset": {
    "title",                                 // required
    "doi", "citation", "source_url",         // optional (key must exist, value may be "")
    "created_with": "R | Python | CSV | Builder",
    "generator_version", "generated_at"
  },
  "id_policy": {                           // join key policy
    "canonical_field": "species_id",
    "normalization": ["verbatim"],         // labels match verbatim across sources here
    "match_mode": "exact"
  },
  "views": [{
    "id": "tadpole", "label": "...", "type": "pca",
    "n_components": 10,
    "default_axes": ["PC1", "PC2"],
    "axis_labels": { "PC1": "PC1 (40.5%)", ... },
    "variance_explained": { "PC1": 0.4054, ... },   // proportions for exported PCs
    "scores": { "path": "views/tadpole/scores.csv", "id_column": "species_id" },
    "scree_path": "views/tadpole/variance.csv"      // full spectrum (for the scree plot)
  }, { "id": "adult", ... }],
  "tree": { "path": "tree/tree.nwk", "format": "newick",
            "tip_id_map": "tree/tip_crosswalk.csv" },
  "taxa": {
    "path": "taxa/taxa.csv",
    "id_column": "species_id",
    "display_label_column": "display_label",
    "image_column": "image",                 // main photo column (filename under images/); optional
    "image_caption_column": "image_credit",  // photo credit / licence; optional
    "outline_column": "outline",             // shape outline column (shown next to the photo); optional
    "info_fields": [ { "column": "...", "label": "..." } ]   // fields shown in the info card (ordered)
  },
  "groups": {                               // legend / colour / shape (colourblind friendly)
    "field": "clade",
    "members": [ { "value", "label", "color", "symbol" } ]
  }
}
```

## The key constraint: join key consistency
`species_id` must match exactly across all three of these, otherwise the Zip is invalid:
1. every view's `scores.csv`
2. the tree tips (mapped to `species_id` through `tip_crosswalk.csv`)
3. `taxa.csv`

Both the exporter and the loader validate this.

## Design decisions
- **`groups` carries both `color` and `symbol`**: shape distinguishes groups as well as colour,
  so colourblind accessibility is guaranteed structurally rather than patched on afterwards.
  The palette is Okabe–Ito.
- **`info_fields` is an ordered allowlist**: the info card shows only the listed fields, so adding
  a column to `taxa` never leaks into the UI by accident.
- **Images are optional and can be paired**: `image_column` (photo) and `outline_column` (shape
  outline) are independent and can appear together in the info card and side panel;
  `image_caption_column` supplies the photo's source and licence. Several species may share one
  image file (e.g. a family-representative specimen) — the loader de-duplicates and decodes it once.
  With none present it degrades gracefully to a placeholder.
- **scores and variance are separate**: `scores.csv` holds the first N PCs (for axis switching);
  `variance.csv` holds the complete scree spectrum.

## Validator
```
python3 exporters/common/unified_zip.py validate <zip>
```
Checks the format, the required fields, and join key consistency across all three sources.

---

## How to produce a unified Zip

There are four routes. The Zips they produce are equivalent — the dashboard reads them all the same way.

| Route | Who it suits | What you need |
|-------|--------------|---------------|
| **Build wizard** (browser) | Your data is already CSV | Nothing to install, just open the page |
| **Generic R exporter** | You ran the PCA in R | Base R only (ape only if you pass a `phylo` object) · [↓ Download](exporters/unified_zip.R) |
| **Generic Python exporter** | You ran the PCA in Python | Standard library only (numpy/pandas/sklearn optional) · [↓ Download](exporters/export_generic.py) |
| **CSV exporter** (command line) | You want it scripted and repeatable | Python 3 |

> The browser **cannot** run R or Python — this site is fully static and serverless. That is why the
> build wizard only accepts already-computed score CSVs; if your data is still in R or Python, use
> one of the generic exporters below to write the Zip directly.

### Build wizard (browser, nothing to install)
Want to try it right away? Grab this sample dataset: **[↓ scores.csv](sample/scores.csv)**,
**[↓ taxa.csv](sample/taxa.csv)**, **[↓ variance.csv](sample/variance.csv)**,
**[↓ tree.nwk](sample/tree.nwk)** (17 species / 3 families / with a tree).

Open `builder.html`: type a DOI and press Fetch to fill in the title, citation and source URL automatically (it asks doi.org, which handles both journal and dataset DOIs); then upload the scores CSV → the taxonomy CSV → (optionally) a Newick tree →
build a preview → download the unified Zip, or package a complete site you can drop on GitHub
Pages. Everything happens inside your browser; nothing is uploaded to any server.

### Generic R exporter

**[↓ Download unified_zip.R](exporters/unified_zip.R)** — a single file using base R only,
just `source()` it from your project (ape is needed only if you pass a `phylo` object).
There is also a runnable example, **[↓ example_generic.R](exporters/example_generic.R)**, which
generates its own synthetic data: put it beside `unified_zip.R` and `Rscript example_generic.R`
writes a Zip you can drop straight into the viewer.

`scores` accepts `prcomp` / `gm.prcomp` / a matrix / a data.frame; when `variance` is omitted it is
taken from `sdev^2` (or `$d` for `gm.prcomp`).

```r
source("unified_zip.R")   # just keep it next to your script
pca <- prcomp(my_matrix)                  # or geomorph::gm.prcomp(...)
write_unified_zip(
  out       = "build/my.zip",
  views     = list(list(id = "shape", label = "Body shape PCA", scores = pca)),
  taxa      = my_taxa_df,                 # a data.frame with a species_id column
  group_col = "family",
  tree      = my_phylo,                   # phylo object / Newick string / .nwk path, optional
  dataset   = list(title = "My PCA")
)
```

### Generic Python exporter

**[↓ Download export_generic.py](exporters/export_generic.py)** — a single file with zero
dependencies; downloading just this one `.py` is enough (numpy / pandas / sklearn are supported
automatically when installed, and it still runs without them).
There is also a runnable example, **[↓ example_generic.py](exporters/example_generic.py)**, which
generates its own synthetic data: put it beside `export_generic.py` and `python3 example_generic.py`
writes a Zip you can drop straight into the viewer.

`scores` accepts a DataFrame / ndarray / dict / list-of-rows; `variance` can be a fitted sklearn
`PCA` object.

```python
from export_generic import write_unified_zip
write_unified_zip("my.zip",
    views=[{"id": "shape", "label": "Body shape PCA",
            "scores": df_scores,       # DataFrame indexed by species_id
            "variance": pca}],         # fitted sklearn PCA, or a sequence of proportions
    taxa=df_taxa, group_col="family", tree="tree.nwk",
    dataset={"title": "My PCA"})
```

When you pass a fitted PCA the exporter reads `explained_variance_ratio_` and **does not
renormalise it**: keeping only the first k components legitimately sums to less than 1, and forcing
it to 1 would inflate how much variance you claim to explain. Eigenvalues (summing to more than 1)
are converted to proportions instead.

### Multiple morphospaces
Give `views` more than one entry and you get several linked PCA plots (for example the lateral and
dorsal views of an otolith, or the left and right valves of a scallop). Every view's `species_id`
values must exist in `taxa`.

## Common pitfalls

- **`species_id` must agree in all three places**: scores, taxa, and the tree tip labels have to be
  the same strings. This is the most common failure, and the validator names the exact rows that
  do not line up.
- **R's `write.csv` adds an empty header**: the row-names column gets an empty string as its title.
  The build wizard understands this (it shows up as "column 1, no header"), but watch for it when
  you parse the file yourself.
- **`doi` / `citation` / `source_url` are optional**: datasets without a DOI (unpublished work, your
  own analysis) can leave them empty — the keys just need to exist.
- **How many PCs**: put the first N PCs in `scores.csv` (that is what axis switching uses); the full
  scree spectrum belongs in `variance.csv`.
