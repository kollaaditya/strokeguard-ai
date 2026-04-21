"""
Stroke Risk Predictor - loads saved model and returns risk classification.
"""

import os
import pickle
import numpy as np

# __file__ is app/utils/predictor.py → go up 2 levels to project root, then ml/model/
MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "ml", "model", "stroke_model.pkl")

_artifacts = None


def _load_model():
    global _artifacts
    if _artifacts is None:
        if not os.path.exists(MODEL_PATH):
            raise FileNotFoundError(
                "Model not found. Run: python ml/train_model.py"
            )
        with open(MODEL_PATH, "rb") as f:
            _artifacts = pickle.load(f)
    return _artifacts


def classify_risk(probability: float) -> str:
    if probability < 0.30:
        return "LOW"
    elif probability < 0.60:
        return "MEDIUM"
    return "HIGH"


def get_advice(risk_level: str, data: dict) -> list:
    base = {
        "LOW": [
            "Maintain your healthy lifestyle.",
            "Exercise at least 30 minutes daily.",
            "Keep monitoring your blood pressure regularly.",
            "Eat a balanced diet rich in fruits and vegetables.",
        ],
        "MEDIUM": [
            "Consult your doctor for a detailed check-up.",
            "Reduce sodium and sugar intake immediately.",
            "Monitor blood pressure and glucose daily.",
            "Avoid smoking and limit alcohol consumption.",
            "Manage stress through yoga or meditation.",
        ],
        "HIGH": [
            "⚠️ SEEK MEDICAL ATTENTION IMMEDIATELY.",
            "Call emergency services or go to the nearest hospital.",
            "Do NOT drive yourself — call someone or dial 108.",
            "Avoid any physical exertion right now.",
            "Inform a family member or caregiver immediately.",
        ],
    }
    advice = list(base[risk_level])

    # Personalized additions
    if data.get("hypertension") == 1:
        advice.append("Take your blood pressure medication as prescribed.")
    if data.get("heart_disease") == 1:
        advice.append("Follow your cardiologist's treatment plan strictly.")
    if float(data.get("avg_glucose_level", 0)) > 140:
        advice.append("Your glucose is elevated — check for diabetes.")
    if float(data.get("bmi", 0)) > 30:
        advice.append("Work on weight management with a nutritionist.")
    if data.get("smoking_status") in ["smokes", "1"]:
        advice.append("Quit smoking — it significantly increases stroke risk.")

    return advice


def predict(data: dict) -> dict:
    """
    data keys: gender, age, hypertension, heart_disease, ever_married,
               work_type, Residence_type, avg_glucose_level, bmi, smoking_status
    Returns: { probability, risk_level, advice }
    """
    arts = _load_model()
    model = arts["model"]
    scaler = arts["scaler"]
    encoders = arts["encoders"]
    feature_cols = arts["feature_cols"]

    # Encode categoricals
    cat_map = {
        "gender": data.get("gender", "Male"),
        "ever_married": data.get("ever_married", "No"),
        "work_type": data.get("work_type", "Private"),
        "Residence_type": data.get("Residence_type", "Urban"),
        "smoking_status": data.get("smoking_status", "never smoked"),
    }
    encoded = {}
    for col, val in cat_map.items():
        le = encoders[col]
        try:
            encoded[col] = le.transform([val])[0]
        except ValueError:
            encoded[col] = 0  # fallback for unseen labels

    row = [
        encoded["gender"],
        float(data.get("age", 45)),
        int(data.get("hypertension", 0)),
        int(data.get("heart_disease", 0)),
        encoded["ever_married"],
        encoded["work_type"],
        encoded["Residence_type"],
        float(data.get("avg_glucose_level", 100)),
        float(data.get("bmi", 25)),
        encoded["smoking_status"],
    ]

    X = np.array(row).reshape(1, -1)
    X_scaled = scaler.transform(X)
    prob = float(model.predict_proba(X_scaled)[0][1])
    risk = classify_risk(prob)
    advice = get_advice(risk, data)

    return {
        "probability": round(prob * 100, 2),
        "risk_level": risk,
        "advice": advice,
    }
