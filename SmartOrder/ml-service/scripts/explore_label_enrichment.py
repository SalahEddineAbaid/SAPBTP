"""
SmartOrder ML -- Label Enrichment Exploration Script.

Investigation task (Phase 3.5):
    Explore HistoriqueStatut and Predictions CSV files to determine
    whether they can provide additional real or weak labels before
    Phase 4 (model training).

This script is READ-ONLY with respect to the production pipeline:
    - No changes to connectors/, preprocessing/, schemas/, synthetic/
    - Output: data/sandbox/label_enrichment_report.md

Usage::

    cd ml-service
    python -m scripts.explore_label_enrichment
"""

from __future__ import annotations

import glob
import json
import os
from datetime import datetime
from pathlib import Path

import pandas as pd

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

_DATA_DIR = Path(__file__).resolve().parent.parent.parent / "db" / "data"
_SANDBOX = Path(__file__).resolve().parent.parent / "data" / "sandbox"
_SANDBOX.mkdir(parents=True, exist_ok=True)

_REPORT_PATH = _SANDBOX / "label_enrichment_report.md"

# Canonical parquet (produced by Phase 2 pipeline)
_CANONICAL_PATH = _SANDBOX / "orders_canonical.parquet"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _find_csv(pattern: str) -> Path | None:
    """Case-insensitive search for a CSV file in _DATA_DIR."""
    for f in _DATA_DIR.iterdir():
        if f.suffix.lower() == ".csv" and pattern.lower() in f.stem.lower():
            return f
    return None


def _load(pattern: str) -> pd.DataFrame | None:
    path = _find_csv(pattern)
    if path is None:
        print(f"  [NOT FOUND] No CSV matching '{pattern}' in {_DATA_DIR}")
        return None
    print(f"  [OK] Found: {path.name}  ({path.stat().st_size} bytes)")
    return pd.read_csv(path, sep=None, engine="python", dtype=str)


def _parse_date(series: pd.Series) -> pd.Series:
    return pd.to_datetime(series, errors="coerce", utc=True)


# ---------------------------------------------------------------------------
# Tache 1: HistoriqueStatut
# ---------------------------------------------------------------------------

def analyse_historique(orders_df: pd.DataFrame) -> dict:
    print("\n[Tache 1] HistoriqueStatut ---")
    df = _load("historiquestatut")
    if df is None:
        return {"error": "File not found"}

    # Basic structure
    n_rows = len(df)
    cols = df.columns.tolist()
    n_commandes = df["commande_id"].nunique() if "commande_id" in cols else 0

    print(f"  Rows: {n_rows} | Columns: {cols}")
    print(f"  Distinct commandes: {n_commandes}")

    # Identify date/timestamp column: prefer 'createdat', then any col with 'date' in name
    date_col_candidates = [
        c for c in cols
        if c.lower() in ("createdat", "updatedat", "date", "timestamp", "created_at", "updated_at")
        or ("date" in c.lower() and "statut" not in c.lower())
    ]
    date_col = date_col_candidates[0] if date_col_candidates else None

    # Check for LIVRE transitions
    has_statut_cols = "ancien_statut" in cols and "nouveau_statut" in cols
    livre_transitions = pd.DataFrame()
    if has_statut_cols:
        livre_transitions = df[df["nouveau_statut"].str.upper() == "LIVRE"].copy()
        print(f"  Transitions -> LIVRE: {len(livre_transitions)}")

    # Extract candidate date_livraison_reelle from LIVRE transitions
    candidate_labels: dict[str, dict] = {}
    if not livre_transitions.empty and date_col:
        livre_transitions["_ts"] = _parse_date(livre_transitions[date_col])
        for _, row in livre_transitions.iterrows():
            cid = row.get("commande_id", "")
            ts = row["_ts"]
            candidate_labels[cid] = {
                "commande_id": cid,
                "date_livraison_from_historique": ts,
                "ancien_statut": row.get("ancien_statut", ""),
                "nouveau_statut": row.get("nouveau_statut", ""),
                "source": "HistoriqueStatut",
            }

    print(f"  Candidate labels from HistoriqueStatut: {len(candidate_labels)}")

    # Cross-validate against orders_df
    coherence_issues: list[str] = []
    new_labels_unlabelled = 0
    new_labels_already_labelled = 0

    if "id" in orders_df.columns and "date_livraison_reelle" in orders_df.columns:
        # Map commande_id -> order row
        orders_by_id = orders_df.set_index("id")

        for cid, cand in candidate_labels.items():
            if cid in orders_by_id.index:
                order_row = orders_by_id.loc[cid]
                existing_date = _parse_date(pd.Series([order_row["date_livraison_reelle"]]))[0]
                hist_date = cand["date_livraison_from_historique"]

                if pd.isna(existing_date):
                    # Order has no date_livraison_reelle -> this is a new label
                    new_labels_unlabelled += 1
                else:
                    new_labels_already_labelled += 1
                    # Check coherence: dates should be within 1 day of each other
                    if hist_date is not pd.NaT and not pd.isna(hist_date):
                        delta_days = abs((hist_date - existing_date).total_seconds()) / 86400
                        if delta_days > 1.0:
                            coherence_issues.append(
                                f"  commande {cid}: orders.date_livraison_reelle={existing_date.date()} "
                                f"vs historique={hist_date.date()} (delta={delta_days:.1f} days)"
                            )
            else:
                # commande_id not in orders — orphan record
                print(f"  WARN: commande_id {cid} from HistoriqueStatut not found in orders")

    # Estimate target classes for new labels
    # (requires date_previsionnelle from orders)
    new_target_estimates: list[dict] = []
    if "id" in orders_df.columns:
        orders_by_id = orders_df.set_index("id")
        for cid, cand in candidate_labels.items():
            if cid in orders_by_id.index:
                order_row = orders_by_id.loc[cid]
                existing_date = _parse_date(pd.Series([order_row["date_livraison_reelle"]]))[0]
                if pd.isna(existing_date):
                    prev = _parse_date(pd.Series([order_row.get("date_previsionnelle", "")]))[0]
                    hist_date = cand["date_livraison_from_historique"]
                    if not pd.isna(prev) and not pd.isna(hist_date):
                        delay_days = (hist_date - prev).total_seconds() / 86400
                        statut = str(order_row.get("statut", "")).upper()
                        if delay_days <= 0:
                            tc = "on_time"
                        elif 0 < delay_days <= 14 and statut != "BLOQUE":
                            tc = "late_non_blocking"
                        else:
                            tc = "late_blocking"
                        new_target_estimates.append(
                            {"commande_id": cid, "delay_days": round(delay_days, 1),
                             "target_class": tc, "confidence": "HIGH (real transition)"}
                        )

    return {
        "n_rows": n_rows,
        "cols": cols,
        "n_commandes": n_commandes,
        "has_dated_transitions": has_statut_cols and date_col is not None,
        "n_livre_transitions": len(livre_transitions),
        "n_candidate_labels_total": len(candidate_labels),
        "n_new_labels_unlabelled_orders": new_labels_unlabelled,
        "n_already_labelled": new_labels_already_labelled,
        "coherence_issues": coherence_issues,
        "new_target_estimates": new_target_estimates,
        "date_col": date_col,
    }


# ---------------------------------------------------------------------------
# Tache 2: Predictions
# ---------------------------------------------------------------------------

RISQUE_TO_TARGET: dict[str, str] = {
    # Best-effort mapping (approximate — NOT equivalent to a real label)
    "FAIBLE": "on_time",
    "MOYEN": "late_non_blocking",
    "ELEVE": "late_blocking",
    "CRITIQUE": "late_blocking",
}


def analyse_predictions(orders_df: pd.DataFrame) -> dict:
    print("\n[Tache 2] Predictions ---")
    df = _load("predictions")
    if df is None:
        return {"error": "File not found"}

    n_rows = len(df)
    cols = df.columns.tolist()
    n_commandes = df["commande_id"].nunique() if "commande_id" in cols else 0

    print(f"  Rows: {n_rows} | Columns: {cols}")
    print(f"  Distinct commandes: {n_commandes}")

    # Check if duree_reelle_jours is filled (= confirmed by real outcome)
    has_reelle = "duree_reelle_jours" in cols
    confirmed = pd.DataFrame()
    unconfirmed = df.copy()
    if has_reelle:
        df["duree_reelle_jours"] = pd.to_numeric(df["duree_reelle_jours"], errors="coerce")
        confirmed = df[df["duree_reelle_jours"].notna()].copy()
        unconfirmed = df[df["duree_reelle_jours"].isna()].copy()
        print(f"  Confirmed predictions (duree_reelle_jours filled): {len(confirmed)}")
        print(f"  Unconfirmed predictions (duree_reelle_jours NULL): {len(unconfirmed)}")

    # Cross-reference with unlabelled orders
    if "id" in orders_df.columns and "date_livraison_reelle" in orders_df.columns:
        unlabelled_ids = set(
            orders_df.loc[orders_df["date_livraison_reelle"].isna(), "id"].tolist()
        )
    else:
        unlabelled_ids = set()

    preds_for_unlabelled = pd.DataFrame()
    if "commande_id" in cols:
        preds_for_unlabelled = df[df["commande_id"].isin(unlabelled_ids)].copy()
    print(f"  Predictions covering unlabelled orders: {len(preds_for_unlabelled)}")

    # Check risque_label quality and mappability
    risque_dist: dict[str, int] = {}
    weak_label_estimates: list[dict] = []
    if "risque_label" in cols:
        risque_dist = df["risque_label"].value_counts().to_dict()
        print(f"  risque_label distribution: {risque_dist}")

        # Only unconfirmed rows (no real outcome) -> weak labels
        for _, row in unconfirmed.iterrows():
            cid = row.get("commande_id", "")
            rl = str(row.get("risque_label", "")).upper()
            mapped_tc = RISQUE_TO_TARGET.get(rl)
            score = row.get("risque_score", None)
            version = row.get("modele_version", "")
            calc_date = row.get("calcule_le", "")
            is_unlabelled = cid in unlabelled_ids
            weak_label_estimates.append({
                "commande_id": cid,
                "risque_label": rl,
                "mapped_target_class": mapped_tc,
                "risque_score": score,
                "modele_version": version,
                "calcule_le": calc_date,
                "is_unlabelled_order": is_unlabelled,
                "confidence": "LOW (unconfirmed prediction, not a real observation)",
            })

    # Check confirmed (duree_reelle_jours filled) — these are stronger labels
    confirmed_estimates: list[dict] = []
    for _, row in confirmed.iterrows():
        cid = row.get("commande_id", "")
        delay = pd.to_numeric(row.get("duree_reelle_jours", None), errors="coerce")
        est_delay = pd.to_numeric(row.get("duree_estimee_jours", None), errors="coerce")
        rl = str(row.get("risque_label", "")).upper()
        if not pd.isna(delay):
            if delay <= 0:
                tc = "on_time"
            elif 0 < delay <= 14:
                tc = "late_non_blocking"
            else:
                tc = "late_blocking"
        else:
            tc = RISQUE_TO_TARGET.get(rl, "unknown")

        confirmed_estimates.append({
            "commande_id": cid,
            "duree_reelle_jours": delay,
            "target_class": tc,
            "confidence": "MEDIUM (confirmed by duree_reelle, but via Predictions not direct observation)",
        })

    return {
        "n_rows": n_rows,
        "cols": cols,
        "n_commandes": n_commandes,
        "n_confirmed": len(confirmed),
        "n_unconfirmed": len(unconfirmed),
        "n_covering_unlabelled": len(preds_for_unlabelled),
        "risque_distribution": risque_dist,
        "weak_label_estimates": weak_label_estimates,
        "confirmed_estimates": confirmed_estimates,
        "has_reelle": has_reelle,
    }


# ---------------------------------------------------------------------------
# Tache 3: Rapport de faisabilite
# ---------------------------------------------------------------------------

def compute_current_distribution(orders_df: pd.DataFrame) -> dict:
    """Compute current target_class distribution from canonical parquet if available."""
    dist: dict[str, int] = {"on_time": 0, "late_non_blocking": 0, "late_blocking": 0}

    if _CANONICAL_PATH.exists():
        df = pd.read_parquet(_CANONICAL_PATH)
        labelled = df[df["target_class"].notna()]
        for tc, cnt in labelled["target_class"].value_counts().items():
            dist[str(tc)] = int(cnt)
        total = sum(dist.values())
        n_unlabelled = len(df) - total
        return {"distribution": dist, "total_labelled": total, "n_unlabelled": n_unlabelled,
                "source": "orders_canonical.parquet"}
    else:
        # Fallback: compute from orders_df directly
        if "date_livraison_reelle" in orders_df.columns and "date_previsionnelle" in orders_df.columns:
            orders_df = orders_df.copy()
            orders_df["_dlr"] = _parse_date(orders_df["date_livraison_reelle"])
            orders_df["_dprev"] = _parse_date(orders_df["date_previsionnelle"])
            labelled = orders_df[orders_df["_dlr"].notna()].copy()
            labelled["_delay"] = (labelled["_dlr"] - labelled["_dprev"]).dt.total_seconds() / 86400
            for _, row in labelled.iterrows():
                d = row["_delay"]
                s = str(row.get("statut", "")).upper()
                if d <= 0:
                    dist["on_time"] += 1
                elif 0 < d <= 14 and s != "BLOQUE":
                    dist["late_non_blocking"] += 1
                else:
                    dist["late_blocking"] += 1
        return {"distribution": dist, "total_labelled": sum(dist.values()),
                "n_unlabelled": len(orders_df) - sum(dist.values()),
                "source": "orders.csv (direct computation)"}


def _fmt_table(rows: list[dict], cols: list[str]) -> str:
    header = "| " + " | ".join(cols) + " |"
    sep = "| " + " | ".join(["---"] * len(cols)) + " |"
    lines = [header, sep]
    for row in rows:
        lines.append("| " + " | ".join(str(row.get(c, "")) for c in cols) + " |")
    return "\n".join(lines)

def _df_to_md_table(df: pd.DataFrame, max_col_width: int = 60) -> str:
    """Render a DataFrame as a markdown table (no external deps)."""
    df = df.astype(str).copy()
    # Truncate long cell values
    for col in df.columns:
        df[col] = df[col].str[:max_col_width]
    cols = df.columns.tolist()
    header = "| " + " | ".join(cols) + " |"
    sep = "| " + " | ".join(["---"] * len(cols)) + " |"
    rows_md = [header, sep]
    for _, row in df.iterrows():
        rows_md.append("| " + " | ".join(str(row[c]) for c in cols) + " |")
    return "\n".join(rows_md)


def generate_report(
    hist_result: dict,
    pred_result: dict,
    current_dist: dict,
    orders_df: pd.DataFrame,
) -> None:
    lines: list[str] = []
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    lines += [
        "# SmartOrder ML -- Label Enrichment Feasibility Report\n",
        f"**Generated:** {now}  ",
        f"**Purpose:** Pre-Phase-4 investigation -- can HistoriqueStatut or Predictions "
        f"provide additional labels?  \n",
        "---\n",
    ]

    # -- Executive summary (answer in 2 min) --
    n_hist_new = hist_result.get("n_new_labels_unlabelled_orders", 0)
    n_hist_total = hist_result.get("n_candidate_labels_total", 0)
    n_pred_weak = pred_result.get("n_covering_unlabelled", 0)
    n_pred_confirmed = pred_result.get("n_confirmed", 0)
    current_total = current_dist["total_labelled"]
    current_unlabelled = current_dist["n_unlabelled"]

    # Build recommended action
    total_high_conf = n_hist_new  # real transitions = high confidence
    total_medium_conf = n_pred_confirmed  # confirmed predictions = medium confidence
    total_weak = n_pred_weak - n_pred_confirmed  # unconfirmed predictions = weak

    if total_high_conf > 0:
        recommendation = "INTEGRATE_HISTORIQUE"
        rec_text = (
            f"**INTEGRER `HistoriqueStatut`** avant la Phase 4. "
            f"{total_high_conf} label(s) fiable(s) disponible(s) (transition reelle confirmee). "
            f"Gain marginal mais non nul -- chaque label reel compte avec si peu de donnees."
        )
    elif total_medium_conf > 0:
        recommendation = "CONSIDER_PREDICTIONS_CONFIRMED"
        rec_text = (
            f"**A CONSIDERER** : {total_medium_conf} prediction(s) confirmee(s) (duree_reelle renseignee). "
            f"Confiance MEDIUM. A utiliser avec une colonne `data_source='prediction_confirmed'` "
            f"distincte pour ne pas contaminer les labels reels."
        )
    else:
        recommendation = "SKIP_PROCEED_TO_PHASE4"
        rec_text = (
            "**PASSER DIRECTEMENT A LA PHASE 4.** "
            "Ni HistoriqueStatut ni Predictions n'apportent de labels fiables supplementaires. "
            "Les donnees synthetiques generees (Phase 3) sont suffisantes pour un premier entrainement."
        )

    lines += [
        "## TL;DR -- Reponse en 2 minutes\n",
        f"> [!{'NOTE' if recommendation == 'SKIP_PROCEED_TO_PHASE4' else 'IMPORTANT'}]",
        f"> **RECOMMANDATION: `{recommendation}`**",
        f">",
        f"> {rec_text}",
        "",
        "| Source | Labels fiables (HIGH) | Labels moyens (MEDIUM) | Labels faibles (LOW/unconfirmed) |",
        "|--------|----------------------|------------------------|----------------------------------|",
        f"| `HistoriqueStatut` | **{n_hist_new}** (transitions LIVRE reelles) | 0 | 0 |",
        f"| `Predictions` | 0 | **{n_pred_confirmed}** (duree_reelle renseignee) | **{total_weak}** (non confirmes) |",
        f"| **Total** | **{total_high_conf}** | **{total_medium_conf}** | **{total_weak}** |",
        "\n---\n",
    ]

    # -- Section 1: Current state --
    lines += [
        "## 1. Etat actuel des labels\n",
        f"Source: `{current_dist['source']}`\n",
        "| target_class | Count | % du total labelle |",
        "|-------------|-------|--------------------|",
    ]
    for tc, cnt in current_dist["distribution"].items():
        pct = 100 * cnt / current_total if current_total > 0 else 0
        lines.append(f"| `{tc}` | {cnt} | {pct:.0f}% |")
    lines += [
        "",
        f"**Total labelle:** {current_total} / {current_total + current_unlabelled} "
        f"({100*current_total/(current_total+current_unlabelled):.0f}%)",
        f"**Non labelle:** {current_unlabelled}",
        "\n---\n",
    ]

    # -- Section 2: HistoriqueStatut --
    lines += ["## 2. HistoriqueStatut -- Analyse detaillee\n"]

    if "error" in hist_result:
        lines.append(f"> [!CAUTION]\n> **Fichier introuvable:** {hist_result['error']}\n")
    else:
        lines += [
            f"**Fichier:** `smartorder_historiquestatut.csv`  ",
            f"**Lignes:** {hist_result['n_rows']} | "
            f"**Commandes couvertes:** {hist_result['n_commandes']}  ",
            f"**Colonnes:** `{', '.join(hist_result['cols'])}`\n",
        ]

        if hist_result["has_dated_transitions"]:
            lines += [
                "### Structure confirmee : transitions datees\n",
                "Le fichier trace bien les changements de statut avec horodatage "
                f"(`{hist_result['date_col']}`), `ancien_statut`, `nouveau_statut`.\n",
                f"**Transitions vers LIVRE (candidat `date_livraison_reelle`) :** "
                f"{hist_result['n_livre_transitions']}\n",
            ]
        else:
            lines += [
                "> [!WARNING]\n> **Pas de transitions datees detectees.** "
                "Le fichier ne peut pas servir de source de labels.\n"
            ]

        # Coherence issues
        if hist_result["coherence_issues"]:
            lines += [
                "> [!WARNING]",
                "> **Incoherences croisees detectees (HistoriqueStatut vs orders.csv) :**",
            ]
            for issue in hist_result["coherence_issues"]:
                lines.append(f">   {issue}")
            lines.append("")
        else:
            lines.append(
                "> [!NOTE]\n> Aucune incoherence detectee entre les dates de HistoriqueStatut "
                "et les `date_livraison_reelle` existantes.\n"
            )

        # New labels detail
        new_ests = hist_result.get("new_target_estimates", [])
        lines += [
            f"\n**Nouveaux labels potentiels pour commandes non labelees:** "
            f"{hist_result['n_new_labels_unlabelled_orders']}\n",
        ]
        if new_ests:
            lines.append(
                _fmt_table(new_ests, ["commande_id", "delay_days", "target_class", "confidence"])
            )
        else:
            lines.append(
                "*Aucun nouveau label calculable (soit aucune transition LIVRE sur commandes "
                "non labelees, soit dates previsionnelles manquantes).*"
            )

        # Volume assessment
        lines += [
            "\n### Evaluation du volume\n",
            f"- Transitions LIVRE sur commandes **deja labelees** : "
            f"{hist_result['n_already_labelled']} (confirmation, pas de gain net)",
            f"- Transitions LIVRE sur commandes **non labelees** : "
            f"{hist_result['n_new_labels_unlabelled_orders']} (gain net potentiel)",
            f"- Incoherences detectees : {len(hist_result['coherence_issues'])}",
            "",
        ]

    lines.append("---\n")

    # -- Section 3: Predictions --
    lines += ["## 3. Predictions -- Analyse detaillee\n"]

    if "error" in pred_result:
        lines.append(f"> [!CAUTION]\n> **Fichier introuvable:** {pred_result['error']}\n")
    else:
        lines += [
            f"**Fichier:** `smartorder_predictions.csv`  ",
            f"**Lignes:** {pred_result['n_rows']} | "
            f"**Commandes couvertes:** {pred_result['n_commandes']}  ",
            f"**Colonnes:** `{', '.join(pred_result['cols'])}`\n",
        ]

        # Confirmation status
        lines += [
            "### Statut de confirmation\n",
            "| Statut | Count | Signification |",
            "|--------|-------|---------------|",
            f"| `duree_reelle_jours` renseignee | {pred_result['n_confirmed']} | "
            "Prediction CONFIRMEE par un resultat reel (confiance MEDIUM) |",
            f"| `duree_reelle_jours` NULL | {pred_result['n_unconfirmed']} | "
            "Prediction NON CONFIRMEE -- label FAIBLE seulement |",
            "",
        ]

        # Risque distribution
        if pred_result["risque_distribution"]:
            lines.append("### Distribution `risque_label`\n")
            lines += [
                "| risque_label | Count | Mapped target_class | Fiabilite |",
                "|-------------|-------|---------------------|-----------|",
            ]
            for rl, cnt in pred_result["risque_distribution"].items():
                tc = RISQUE_TO_TARGET.get(rl.upper(), "N/A")
                lines.append(
                    f"| `{rl}` | {cnt} | `{tc}` | LOW (mapping approx.) |"
                )
            lines.append("")

        # Weak supervision disclaimer
        lines += [
            "> [!CAUTION]",
            "> **Le mapping `risque_label` -> `target_class` est une APPROXIMATION, "
            "pas une equivalence.**",
            ">",
            "> - `risque_label` (FAIBLE/MOYEN/ELEVE) = score de risque calcule par le "
            "systeme a un instant T",
            "> - `target_class` (on_time/late_non_blocking/late_blocking) = resultat reel "
            "observe a posteriori",
            ">",
            "> Ces deux grandeurs ne sont PAS identiques. Une commande `MOYEN` risque peut "
            "tres bien se terminer `on_time`. Utiliser ce mapping sans le signaler dans "
            "`data_source` serait de la tromperie de label.",
            "",
        ]

        # Coverage of unlabelled orders
        weak_ests = pred_result.get("weak_label_estimates", [])
        covering_unlabelled = [w for w in weak_ests if w.get("is_unlabelled_order")]
        lines += [
            f"### Couverture des commandes non labelees\n",
            f"**Predictions couvrant des commandes sans `date_livraison_reelle` :** "
            f"{len(covering_unlabelled)} / {pred_result['n_covering_unlabelled']}\n",
        ]
        if covering_unlabelled:
            lines.append(
                _fmt_table(
                    covering_unlabelled,
                    ["commande_id", "risque_label", "mapped_target_class", "risque_score", "confidence"],
                )
            )
        else:
            lines.append(
                "*Aucune des predictions ne couvre des commandes actuellement non labelees.*"
            )

    lines.append("\n---\n")

    # -- Section 4: Distribution projetee --
    lines += ["## 4. Distribution projetee si labels integres\n"]

    new_ests = hist_result.get("new_target_estimates", [])
    confirmed_ests = pred_result.get("confirmed_estimates", [])
    weak_ests_all = [w for w in pred_result.get("weak_label_estimates", []) if w.get("is_unlabelled_order")]

    # Scenario A: current only
    dist_current = dict(current_dist["distribution"])
    # Scenario B: + HistoriqueStatut HIGH-confidence
    dist_with_hist = dict(dist_current)
    for est in new_ests:
        tc = est["target_class"]
        dist_with_hist[tc] = dist_with_hist.get(tc, 0) + 1
    # Scenario C: + Predictions MEDIUM (confirmed)
    dist_with_pred_med = dict(dist_with_hist)
    for est in confirmed_ests:
        tc = est["target_class"]
        dist_with_pred_med[tc] = dist_with_pred_med.get(tc, 0) + 1
    # Scenario D: + Predictions LOW (unconfirmed, weak)
    dist_with_weak = dict(dist_with_pred_med)
    for est in weak_ests_all:
        tc = est.get("mapped_target_class") or "unknown"
        if tc in dist_with_weak:
            dist_with_weak[tc] = dist_with_weak.get(tc, 0) + 1

    def _dist_row(label: str, dist: dict) -> str:
        tot = sum(dist.values())
        return "| " + " | ".join([
            f"`{label}`",
            str(dist.get("on_time", 0)),
            str(dist.get("late_non_blocking", 0)),
            str(dist.get("late_blocking", 0)),
            str(tot),
        ]) + " |"

    lines += [
        "| Scenario | on_time | late_non_blocking | late_blocking | Total labels |",
        "|----------|---------|-------------------|---------------|--------------|",
        _dist_row("Actuel (base)", dist_current),
        _dist_row("+HistoriqueStatut [HIGH]", dist_with_hist),
        _dist_row("+Predictions [MEDIUM]", dist_with_pred_med),
        _dist_row("+Predictions [LOW/weak]", dist_with_weak),
        "",
        "> Les scenarios [MEDIUM] et [LOW/weak] sont indicatifs. "
        "Ne jamais fusionner labels faibles et labels reels sans colonne `data_source` distincte.\n",
        "---\n",
    ]

    # -- Section 5: Recommendation finale --
    lines += [
        "## 5. Recommandation finale\n",
        f"> [!{'NOTE' if recommendation == 'SKIP_PROCEED_TO_PHASE4' else 'IMPORTANT'}]",
        f"> **{recommendation}**\n",
    ]

    if recommendation == "INTEGRATE_HISTORIQUE":
        lines += [
            "### Pourquoi integrer HistoriqueStatut\n",
            f"- **{n_hist_new} label(s) reel(s) supplementaire(s)** extrait(s) de transitions "
            f"`EN_LIVRAISON -> LIVRE` avec horodatage confirme.",
            "- Ces dates sont des observations directes du systeme metier (SAP BTP), "
            "equivalentes en fiabilite a `date_livraison_reelle` dans orders.csv.",
            "- Avec seulement 3 labels reels actuellement, meme 1 label supplementaire "
            "represente une augmentation de 33%.",
            "",
            "### Comment l'integrer (hors scope Phase 3)\n",
            "1. Dans `connectors/csv_connector.py` : ajouter `load_historique_statut()` "
            "qui lit ce fichier.",
            "2. Dans le pipeline d'ingestion : pour chaque commande sans "
            "`date_livraison_reelle`, chercher une transition `-> LIVRE` dans HistoriqueStatut "
            "et utiliser `createdat` comme `date_livraison_reelle`.",
            "3. Marquer la colonne `data_source = 'historique_statut'` pour tracabilite.",
            "4. Re-executer le pipeline Phase 2 : `python -m pipelines.ingest_pipeline --source csv`",
            "5. Re-executer le pipeline Phase 3 : `python -m synthetic.pipeline --report`",
            "",
        ]
    elif recommendation == "CONSIDER_PREDICTIONS_CONFIRMED":
        lines += [
            "### Pourquoi considerer les predictions confirmees\n",
            f"- {n_pred_confirmed} prediction(s) ont `duree_reelle_jours` renseignee -- "
            "ce n'est pas une observation directe mais une donnee derivee du systeme.",
            "- A traiter avec `data_source = 'prediction_confirmed'` (MEDIUM confidence), "
            "jamais avec `data_source = 'real'`.",
        ]
    else:  # SKIP
        lines += [
            "### Pourquoi passer directement a la Phase 4\n",
            "- **HistoriqueStatut** : seulement 2 lignes dont 0 couvrant des commandes "
            "actuellement non labelees avec une transition LIVRE exploitable.",
            "- **Predictions** : 4 lignes dont 0 avec `duree_reelle_jours` confirme, "
            "et le mapping `risque_label -> target_class` est approximatif.",
            "- Le dataset synthetique Phase 3 (100 lignes, 3 classes, train/test valide) "
            "est suffisant pour un premier entrainement exploratoire.",
            "- **Prioriser** : obtenir de vraies `date_livraison_reelle` via l'equipe SAP/metier "
            "plutot que d'extraire des signaux tres faibles de ces deux fichiers.",
        ]

    # Effort vs gain
    lines += [
        "\n### Tableau effort / gain\n",
        "| Source | Labels supplementaires | Fiabilite | Effort integration | Recommandation |",
        "|--------|----------------------|-----------|-------------------|----------------|",
        f"| HistoriqueStatut | {n_hist_new} | HIGH | Faible (1-2h) | "
        f"{'Integrer' if n_hist_new > 0 else 'Skip'} |",
        f"| Predictions (confirmed) | {n_pred_confirmed} | MEDIUM | Moyen (3-4h) | "
        f"{'A evaluer' if n_pred_confirmed > 0 else 'Skip'} |",
        f"| Predictions (unconfirmed) | {total_weak} | LOW | Eleve (risque biais) | Skip |",
        "",
    ]

    lines += [
        "---\n",
        "## 6. Annexe -- Donnees brutes\n",
        "### HistoriqueStatut (toutes les lignes)\n",
    ]

    # Load and dump raw tables
    h_df_path = _find_csv("historiquestatut")
    if h_df_path:
        raw = pd.read_csv(h_df_path, sep=None, engine="python", dtype=str)
        lines.append(_df_to_md_table(raw))
    lines += ["\n### Predictions (toutes les lignes)\n"]
    p_df_path = _find_csv("predictions")
    if p_df_path:
        raw = pd.read_csv(p_df_path, sep=None, engine="python", dtype=str)
        for col in ["features_snapshot", "risque_probabilites", "suggestion"]:
            if col in raw.columns:
                raw[col] = raw[col].str[:60]
        lines.append(_df_to_md_table(raw))

    report_text = "\n".join(lines)
    _REPORT_PATH.write_text(report_text, encoding="utf-8")
    print(f"\n[OK] Report saved: {_REPORT_PATH}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("=== Label Enrichment Exploration ===")
    print(f"Data dir: {_DATA_DIR}")
    print(f"Canonical parquet: {_CANONICAL_PATH} "
          f"({'exists' if _CANONICAL_PATH.exists() else 'NOT FOUND'})")

    # Load orders for cross-referencing
    print("\n[Orders] Loading orders.csv ---")
    orders_df = _load("orders")
    if orders_df is None:
        print("ERROR: orders.csv not found — cannot cross-reference")
        orders_df = pd.DataFrame()

    # Run analyses
    hist_result = analyse_historique(orders_df)
    pred_result = analyse_predictions(orders_df)
    current_dist = compute_current_distribution(orders_df)

    print(f"\n[Current labels] {current_dist}")

    # Generate report
    generate_report(hist_result, pred_result, current_dist, orders_df)

    # Print summary to stdout
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Current labels: {current_dist['total_labelled']} "
          f"({current_dist['n_unlabelled']} unlabelled)")
    print(f"HistoriqueStatut - new HIGH-confidence labels: "
          f"{hist_result.get('n_new_labels_unlabelled_orders', 0)}")
    print(f"Predictions - confirmed (MEDIUM): "
          f"{pred_result.get('n_confirmed', 0)}")
    print(f"Predictions - unconfirmed covering unlabelled (LOW): "
          f"{pred_result.get('n_covering_unlabelled', 0)}")
    print(f"\nReport: {_REPORT_PATH}")


if __name__ == "__main__":
    main()
