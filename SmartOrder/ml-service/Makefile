# ============================================================
# SmartOrder ML — Makefile
# ============================================================
.PHONY: install install-dev test lint type-check serve train clean docker-build docker-run

PYTHON := python
PIP := pip
VENV := .venv

# --- Setup ---
install:
	$(PIP) install -r requirements.txt

install-dev:
	$(PIP) install -r requirements-dev.txt

venv:
	$(PYTHON) -m venv $(VENV)
	$(VENV)/Scripts/activate && $(PIP) install -r requirements-dev.txt

# --- Quality ---
lint:
	ruff check .
	ruff format --check .

format:
	ruff check --fix .
	ruff format .

type-check:
	mypy config schemas connectors preprocessing features api

test:
	pytest tests/ -v --tb=short -x

test-cov:
	pytest tests/ -v --cov --cov-report=html --cov-report=term-missing

# --- Run ---
serve:
	uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload

serve-prod:
	uvicorn api.main:app --host 0.0.0.0 --port 8000 --workers 2

# --- ML ---
train:
	$(PYTHON) -m pipelines.train_pipeline

ingest:
	$(PYTHON) -m pipelines.ingest_pipeline

# --- Docker ---
docker-build:
	docker build -t smartorder-ml:latest .

docker-run:
	docker run -p 8000:8000 --env-file .env smartorder-ml:latest

# --- Cleanup ---
clean:
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete 2>/dev/null || true
	rm -rf .pytest_cache htmlcov .mypy_cache .ruff_cache
