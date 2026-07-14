# SmartOrder ML — Data Quality Report

**Generated:** 2026-07-09 13:57:32  
**Source:** `csv`  

---

## 1. Pipeline Step Counts

| Step | Rows |
|------|------|
| Raw input (after connector fetch) | 61 |
| After duplicate removal | 61 |
| After drop missing essentials | 61 |
| After filter ANNULÉ | 60 |
| After all cleaning steps | 60 |
| **After Pydantic mapping (canonical)** | **60** |

---

## 2. Rejected Rows

| # | numero_sap | reason |
|---|-----------|--------|
| 1 | `4500001007` | cancelled |

---

## 3. Outlier Capping

### `montant_total`

| Metric | Value |
|--------|-------|
| Pre-clamp threshold (business bound) | 1,000,000,000 |
| Rows pre-clamped | 3 |
| Q1 (post pre-clamp) | 347.25 |
| Q3 (post pre-clamp) | 224500.0 |
| IQR×3 upper cap | 896958.25 |
| Rows IQR-capped | 13 |

> **Note:** Values above the pre-clamp threshold are treated as data-entry
> errors (e.g., 2 000 000 000 MAD for a single PO). Adjust
> `MAX_MONTANT_PRE_CLAMP` / `MAX_POIDS_PRE_CLAMP` in `cleaner.py` if
> your domain has legitimately large orders.

### `poids_total`

| Metric | Value |
|--------|-------|
| Pre-clamp threshold (business bound) | 1,000,000 |
| Rows pre-clamped | 0 |
| Q1 (post pre-clamp) | 0.0 |
| Q3 (post pre-clamp) | 282.5 |
| IQR×3 upper cap | 1130.0 |
| Rows IQR-capped | 1 |

> **Note:** Values above the pre-clamp threshold are treated as data-entry
> errors (e.g., 2 000 000 000 MAD for a single PO). Adjust
> `MAX_MONTANT_PRE_CLAMP` / `MAX_POIDS_PRE_CLAMP` in `cleaner.py` if
> your domain has legitimately large orders.

---

## 4. Target Class Distribution

| target_class | Count | % |
|-------------|-------|---|
| `None (unlabelled)` | 57 | 95.0% |
| `on_time` | 2 | 3.3% |
| `late_blocking` | 1 | 1.7% |

**Total labelled (non-None):** 3 / 60

> [!CAUTION]
> **Only 3 labelled examples** — far below the minimum of 20 recommended for reliable ML training.
> 
> **Actions required before training:**
> 1. Generate synthetic data (Phase 5 — CTGAN/SMOTE) to reach ≥200 labelled examples.
> 2. Collect more real orders with completed delivery dates (`date_livraison_reelle`).
> 3. Do NOT train any model on this data alone — results would be meaningless.

---

## 5. Summary

| Metric | Value |
|--------|-------|
| Orders processed (canonical) | 60 |
| Labelled (has target_class) | 3 |
| Unlabelled (in-flight / no delivery date) | 57 |
| Mapping errors | 0 |
| Cleaning rejections | 1 |
