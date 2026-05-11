# SmartOrder ML Service

Service de Machine Learning pour la prédiction des risques de commandes.

## Architecture

```
ml-service/
├── main.py                  # FastAPI application (point d'entrée)
├── models/                  # Pydantic DTOs
│   ├── feature_dto.py       # Features d'entrée (9 features)
│   ├── prediction_dto.py    # Résultat de prédiction
│   └── retrain_dto.py       # Requête/réponse réentraînement
├── services/                # Logique métier
│   ├── feature_builder.py   # Transformation features + score composite
│   ├── predict_service.py   # Prédiction (ML + fallback heuristique)
│   └── retrain_service.py   # Pipeline réentraînement scikit-learn
├── models_storage/          # Stockage des modèles .pkl (créé automatiquement)
├── requirements.txt         # Dépendances Python
└── Dockerfile               # Image Docker pour Cloud Foundry
```

## Endpoints

| Méthode | URL             | Description                        |
|---------|-----------------|------------------------------------|
| POST    | `/predict`      | Prédiction unitaire                |
| POST    | `/predict/batch` | Prédiction par lot (max 500)      |
| POST    | `/retrain`      | Réentraîner les modèles           |
| GET     | `/health`       | Health check                       |
| GET     | `/model/info`   | Informations sur le modèle courant |

## Développement local

```bash
cd ml-service
pip install -r requirements.txt
python main.py
# → http://localhost:8000
# → Swagger UI: http://localhost:8000/docs
```

## Premier réentraînement

Au premier démarrage, aucun modèle n'est disponible. Le service fonctionne en mode **heuristique** (règles métier).
Pour entraîner les modèles :

```bash
curl -X POST http://localhost:8000/retrain
```

Cela génère des données synthétiques et sauvegarde les modèles `.pkl` dans `models_storage/`.
