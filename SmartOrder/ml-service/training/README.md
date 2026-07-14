# SmartOrder ML — Training Guide for Google Colab

This document explains how to train the SmartOrder ML models in a Google Colab
notebook and push the results to MLflow Model Registry so the production API can
load them automatically.

---

## Overview

Training is **intentionally separated** from the ml-service API code:

```
ml-service/         ← production API (FastAPI + inference only)
├── training/
│   ├── train.py    ← model LOADER stub (no training logic here)
│   └── README.md   ← this file

Google Colab        ← training happens here
    ↕  MLflow Tracking Server (local or remote)
    ↕  MLflow Model Registry
```

---

## Step 1 — Import `feature_engineer.py` in Colab

### Option A — via pip (recommended for teams)

If the repo is on GitHub/GitLab and the `ml-service/` folder has a `pyproject.toml`:

```bash
pip install -e "git+https://github.com/<org>/SmartOrder.git#egg=smartorder-ml&subdirectory=ml-service"
```

Then in Python:
```python
from features.feature_engineer import FeatureEngineer
from schemas.canonical import OrderCanonical
```

### Option B — via sys.path (quick local mount)

If you have the repo mounted in Colab (e.g., Google Drive):

```python
import sys
sys.path.insert(0, "/content/drive/MyDrive/SmartOrder/ml-service")

from features.feature_engineer import FeatureEngineer
from schemas.canonical import OrderCanonical
from schemas.enums import TargetClassEnum
```

### Option C — via Colab file upload

Upload the `ml-service/` folder as a zip and extract:

```python
import zipfile, sys
zipfile.ZipFile("ml-service.zip").extractall("/content/ml-service")
sys.path.insert(0, "/content/ml-service")
```

---

## Step 2 — Load the canonical Parquet

The ingest pipeline produces `data/sandbox/orders_canonical.parquet`.
Upload it to Colab or load from Google Drive:

```python
import pandas as pd

# From Google Drive
df = pd.read_parquet("/content/drive/MyDrive/SmartOrder/ml-service/data/sandbox/orders_canonical.parquet")

# Filter to labelled rows only
labelled = df[df["target_class"].notna()].copy()
print(f"Labelled examples: {len(labelled)}")
```

---

## Step 3 — Feature Engineering

```python
from features.feature_engineer import FeatureEngineer
from datetime import date

fe = FeatureEngineer(reference_date=date.today())
X = fe.transform_dataframe(labelled)
y_clf = labelled["target_class"]           # classification target
y_reg = labelled["target_delay_days"]      # regression target
```

---

## Step 4 — MLflow Setup

### Local tracking (for development)

```python
import mlflow

mlflow.set_tracking_uri("file:///content/mlruns")
mlflow.set_experiment("smartorder-ml-colab")
```

### Remote tracking (for production push)

```python
import mlflow
import os

os.environ["MLFLOW_TRACKING_URI"] = "https://<your-mlflow-server>"
os.environ["MLFLOW_TRACKING_TOKEN"] = "<your-token>"

mlflow.set_tracking_uri(os.environ["MLFLOW_TRACKING_URI"])
mlflow.set_experiment("smartorder-ml")
```

---

## Step 5 — Train and Log

```python
from sklearn.linear_model import LogisticRegression, ElasticNet
from sklearn.model_selection import cross_val_score
import mlflow.sklearn

with mlflow.start_run(run_name="clf-logreg-v1") as run:
    # Train
    clf = LogisticRegression(max_iter=1000, class_weight="balanced")
    clf.fit(X_train, y_train_clf)

    # Log metrics
    scores = cross_val_score(clf, X, y_clf, cv=3, scoring="f1_macro")
    mlflow.log_metric("cv_f1_macro_mean", scores.mean())
    mlflow.log_metric("cv_f1_macro_std", scores.std())

    # Log model
    mlflow.sklearn.log_model(clf, artifact_path="model")

    print(f"Run ID: {run.info.run_id}")
```

---

## Step 6 — Register to Model Registry

```python
import mlflow

# Register the model (creates or updates the registered model)
model_uri = f"runs:/{run.info.run_id}/model"

result = mlflow.register_model(
    model_uri=model_uri,
    name="smartorder-clf",
)
print(f"Model version: {result.version}")

# Optional: transition to Production stage
client = mlflow.tracking.MlflowClient()
client.transition_model_version_stage(
    name="smartorder-clf",
    version=result.version,
    stage="Production",
)
```

---

## Required Model Tags (before pushing to Production)

Add these tags to the model version so the API can validate compatibility:

```python
client.set_model_version_tag(
    name="smartorder-clf",
    version=result.version,
    key="feature_schema_version",
    value="1.0",          # must match FeatureEngineer.get_feature_names() output
)
client.set_model_version_tag(
    name="smartorder-clf",
    version=result.version,
    key="training_rows",
    value=str(len(X_train)),
)
client.set_model_version_tag(
    name="smartorder-clf",
    version=result.version,
    key="cv_f1_macro",
    value=str(round(scores.mean(), 4)),
)
```

---

## MLflow Experiment Naming Convention

| Experiment Name | Purpose |
|----------------|---------|
| `smartorder-ml` | Production-candidate runs |
| `smartorder-ml-colab` | Colab exploration / prototyping |
| `smartorder-ml-synthetic` | Runs trained on synthetic data only |

---

## Model Loading in Production API

The production API (`api/main.py`) loads models via `training/train.py`:

```python
# Called automatically at FastAPI startup
from training.train import load_model

clf, reg = load_model(
    clf_uri="models:/smartorder-clf/Production",
    reg_uri="models:/smartorder-reg/Production",
)
```

To point the API at a specific version instead of the Production stage:

```python
clf, reg = load_model(
    clf_uri="models:/smartorder-clf/3",
    reg_uri="models:/smartorder-reg/2",
)
```

---

## Do NOT touch

These modules are stubs intentionally left empty until training is complete:
- `synthetic/` — CTGAN/SMOTE data generation (Phase 5)
- `evaluation/` — metrics and reporting (Phase 7-8)
- `explainability/` — SHAP integration (Phase 9)
- `monitoring/` — drift detection (Phase 11)
