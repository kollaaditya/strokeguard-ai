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

    # Live vitals advice
    bpm  = float(data.get("_bpm",  0))
    spo2 = float(data.get("_spo2", 99))
    br   = float(data.get("_breath", 0))
    if bpm > 100:
        advice.append(f"💓 High heart rate detected ({int(bpm)} BPM) — rest immediately.")
    elif bpm > 0 and bpm < 50:
        advice.append(f"💓 Low heart rate detected ({int(bpm)} BPM) — consult a doctor.")
    if spo2 < 95:
        advice.append(f"💧 Low SpO₂ ({int(spo2)}%) — seek oxygen support immediately.")
    if br > 25:
        advice.append(f"🌬 Rapid breathing ({int(br)} br/min) — try to calm down and breathe slowly.")

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

    # Fine-tune with live camera vitals only when clearly abnormal
    bpm    = float(data.get("_bpm",    0))
    spo2   = float(data.get("_spo2",   99))
    breath = float(data.get("_breath", 0))

    if bpm > 0:
        if bpm > 120:                          # severe tachycardia only
            prob = min(0.95, prob + 0.05)
        elif bpm < 45:                         # severe bradycardia only
            prob = min(0.95, prob + 0.04)
        # normal range 50-100: no adjustment

    if spo2 > 0 and spo2 < 92:               # only dangerously low SpO2
        prob = min(0.95, prob + 0.06)

    if breath > 0 and breath > 28:            # only very rapid breathing
        prob = min(0.95, prob + 0.03)

    risk   = classify_risk(prob)
    advice = get_advice(risk, data)

    return {
        "probability": round(prob * 100, 2),
        "risk_level":  risk,
        "advice":      advice,
        "live_vitals": {
            "bpm":    int(bpm)    if bpm    > 0 else None,
            "spo2":   int(spo2)   if spo2   > 0 else None,
            "breath": int(breath) if breath > 0 else None,
        }
    }
