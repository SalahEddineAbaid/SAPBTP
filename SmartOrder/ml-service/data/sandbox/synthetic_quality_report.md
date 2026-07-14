# SmartOrder ML -- Synthetic Data Quality Report

**Generated:** 2026-07-11 14:40:28  
**Method:** `rule_only`  

---

## 1. Examples by Data Source

| Source | Count | % of Total | Notes |
|--------|-------|------------|-------|
| `rule_based` | 60 | 60.0% | **HYPOTHESIS** -- business rule (see disclaimer below) |
| `perturbation` | 37 | 37.0% | Gaussian noise perturbation (fallback) |
| `real` | 3 | 3.0% | Observed orders from CSV seed |

> [!CAUTION]
> **Synthetic ratio is 97%** -- above the 95% warning threshold.  A model trained on this dataset may overfit to synthetic patterns.

---

## 2. Generation Method and Counts per Class

> This table answers: *how many rows per class, by which method?*

| Class | Real | Rule-based | CTGAN | SMOTE | Perturbation | Total | Method used | Notes |
|-------|------|------------|-------|-------|-------------|-------|-------------|-------|
| `on_time` | 2 | 0 | 0 | 0 | 18 | **20** | `perturbation` | - |
| `late_non_blocking` | 0 | 60 | 0 | 0 | 0 | **60** | `rule_based` | - |
| `late_blocking` | 1 | 0 | 0 | 0 | 19 | **20** | `perturbation` | - |

---

## 3. Train / Test Split Composition

> Guarantees >= 1 example per class in both train and test sets.

| Class | Train | Test | Real in test |
|-------|-------|------|-------------|
| `on_time` | 15 | 5 | 2 |
| `late_non_blocking` | 47 | 13 | 0 |
| `late_blocking` | 15 | 5 | 1 |

---

## 4. IMPORTANT: `late_non_blocking` Class Disclaimer

> [!CAUTION]
> **ALL `late_non_blocking` examples are synthetic hypotheses, NOT observed data.**
>
> **No real orders with this label exist in the source CSV.**
>
> The label is assigned by the following business rule:
>   - Delay `d` where `1 <= d <= 14` days past `date_previsionnelle`
>   - Order is **not** in BLOQUE status
>   - Does NOT have `postes_en_retard > 0` AND urgence in {HAUTE, CRITIQUE}
>
> **This threshold is configured in `config/model_config.yaml::synthetic.late_non_blocking_threshold_days`.**
>
> **BEFORE PRODUCTION:** obtain real observed examples of this class and retrain the model.

---

## 5. Feature Distribution Comparison (Real vs Synthetic)

| Feature | Real mean | Real std | Synth mean | Synth std | Delta mean |
|---------|-----------|----------|------------|-----------|------------|
| `montant_total` | 122833.33 | 162182.69 | 201902.52 | 310039.07 | 79069.18 [!] |
| `nb_lignes` | 0.67 | 0.58 | 0.89 | 0.35 | 0.22 |
| `taux_livraison` | 0.33 | 0.58 | 0.09 | 0.29 | 0.24 [!] |
| `fournisseur_taux_retard` | 0.16 | 0.11 | 0.12 | 0.24 | 0.04 |
| `fournisseur_score_perf` | 0.84 | 0.10 | 0.94 | 0.09 | 0.10 |

> **[!]** = synthetic mean deviates >50% from real mean -- review.

---

## 6. Validation Summary

### `perturbation_on_time`

```
Synthetic validation: 18/18 rows accepted
  Rejected (schema):     0
  Rejected (business):   0
  Rejected (near-dup):   0
```

### `rule_based_late_non_blocking`

```
Synthetic validation: 60/60 rows accepted
  Rejected (schema):     0
  Rejected (business):   0
  Rejected (near-dup):   0
```

### `perturbation_late_blocking`

```
Synthetic validation: 19/19 rows accepted
  Rejected (schema):     0
  Rejected (business):   0
  Rejected (near-dup):   0
```

---

## 7. Summary (Audit Answer)

| Metric | Value |
|--------|-------|
| Total training rows | 100 |
| Real (observed) | 3 |
| Rule-based (`late_non_blocking`) | 60 |
| CTGAN-generated | 0 |
| SMOTE-generated | 0 |
| Perturbation-generated | 37 |
| Synthetic total | 97 |
| Synthetic ratio | 97.0% |

> **Answer to the audit question:**  
> *3 rows are real observations.*  
> *60 rows are business-rule hypotheses (`late_non_blocking`).*  
> *0 rows are statistically generated (CTGAN).*  
> *0 rows are statistically generated (SMOTE).*  
> *37 rows are Gaussian perturbations (fallback).*  