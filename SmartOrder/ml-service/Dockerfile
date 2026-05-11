FROM python:3.11-slim

WORKDIR /app

# Installer les dépendances
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copier le code source
COPY . .

# Créer le dossier de stockage des modèles
RUN mkdir -p models_storage

# Port d'écoute
EXPOSE 8000

# Démarrer le service
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
