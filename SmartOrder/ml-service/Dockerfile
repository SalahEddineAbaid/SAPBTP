# ============================================================
# SmartOrder ML — Dockerfile (Multi-stage)
# Python 3.12 | Production-ready for SAP BTP Cloud Foundry
# ============================================================

# --- Stage 1: Builder ---
FROM python:3.12-slim AS builder

WORKDIR /build

# System deps for hdbcli and psycopg2
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# --- Stage 2: Runtime ---
FROM python:3.12-slim AS runtime

WORKDIR /app

# Runtime-only system libs
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -r mluser && useradd -r -g mluser mluser

# Copy installed packages from builder
COPY --from=builder /install /usr/local

# Copy application code
COPY . .

# Create data directories
RUN mkdir -p data/real data/sandbox data/synthetic models mlruns \
    && chown -R mluser:mluser /app

USER mluser

# Environment
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    ML_ENV=production \
    PORT=8000

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import httpx; r = httpx.get('http://localhost:8000/health'); r.raise_for_status()"

CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
