"""
ML Training Script - Stroke Risk Prediction
Dataset: https://www.kaggle.com/datasets/fedesoriano/stroke-prediction-dataset
Run: python ml/train_model.py
"""

import os
import pickle
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.metrics import classification_report, roc_auc_score
from sklearn.pipeline import Pipeline
from imblearn.over_sampling import SMOTE

try:
    from xgboost import XGBClassifier
    USE_XGB = True
except ImportError:
    USE_XGB = False

MODEL_DIR = os.path.join(os.path.dirname(__file__), "model")
os.makedirs(MODEL_DIR, exist_ok=True)


def generate_synthetic_dataset(n=5000):
    """Generate synthetic stroke dataset matching Kaggle schema."""
    np.random.seed(42)
    age = np.random.normal(50, 15, n).clip(18, 90)
    hypertension = np.random.binomial(1, 0.3, n)
    heart_disease = np.random.binomial(1, 0.2, n)
    avg_glucose = np.random.normal(110, 40, n).clip(55, 300)
    bmi = np.random.normal(28, 6, n).clip(15, 55)
    gender = np.random.choice(["Male", "Female"], n)
    ever_married = np.where(age > 30, np.random.choice(["Yes", "No"], n, p=[0.8, 0.2]),
                            np.random.choice(["Yes", "No"], n, p=[0.2, 0.8]))
    work_type = np.random.choice(["Private", "Self-employed", "Govt_job", "children", "Never_worked"], n)
    residence_type = np.random.choice(["Urban", "Rural"], n)
    smoking_status = np.random.choice(["never smoked", "formerly smoked", "smokes", "Unknown"], n)

    # Risk score to simulate realistic stroke probability
    risk = (
        0.03 * (age - 18) / 72 * 10
        + 2.0 * hypertension
        + 1.5 * heart_disease
        + 0.02 * (avg_glucose - 55) / 245 * 10
        + 0.5 * (bmi > 30).astype(int)
        + 1.0 * (smoking_status == "smokes").astype(int)
        + 0.5 * (smoking_status == "formerly smoked").astype(int)
    )
    prob = 1 / (1 + np.exp(-(risk - 4)))
    stroke = np.random.binomial(1, prob.clip(0.01, 0.95), n)

    return pd.DataFrame({
        "gender": gender,
        "age": age.round(1),
        "hypertension": hypertension,
        "heart_disease": heart_disease,
        "ever_married": ever_married,
        "work_type": work_type,
        "Residence_type": residence_type,
        "avg_glucose_level": avg_glucose.round(2),
        "bmi": bmi.round(1),
        "smoking_status": smoking_status,
        "stroke": stroke
    })


def load_dataset():
    """Load Kaggle dataset if available, else use synthetic data."""
    kaggle_path = os.path.join(os.path.dirname(__file__), "healthcare-dataset-stroke-data.csv")
    if os.path.exists(kaggle_path):
        print("[INFO] Loading Kaggle dataset...")
        df = pd.read_csv(kaggle_path)
        df.drop(columns=["id"], errors="ignore", inplace=True)
    else:
        print("[INFO] Kaggle dataset not found. Generating synthetic data...")
        df = generate_synthetic_dataset(5000)
    return df


def preprocess(df):
    """Clean and encode features."""
    df = df.copy()

    # Fill missing BMI with median
    df["bmi"] = df["bmi"].fillna(df["bmi"].median())

    # Drop rows with other nulls
    df.dropna(inplace=True)

    # Remove 'Other' gender if present
    df = df[df["gender"] != "Other"]

    # Encode categoricals
    cat_cols = ["gender", "ever_married", "work_type", "Residence_type", "smoking_status"]
    encoders = {}
    for col in cat_cols:
        le = LabelEncoder()
        df[col] = le.fit_transform(df[col].astype(str))
        encoders[col] = le

    feature_cols = [
        "gender", "age", "hypertension", "heart_disease",
        "ever_married", "work_type", "Residence_type",
        "avg_glucose_level", "bmi", "smoking_status"
    ]
    X = df[feature_cols]
    y = df["stroke"]
    return X, y, encoders, feature_cols


def train():
    df = load_dataset()
    X, y, encoders, feature_cols = preprocess(df)

    print(f"[INFO] Dataset shape: {X.shape}, Stroke cases: {y.sum()} ({y.mean()*100:.1f}%)")

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    # Handle class imbalance with SMOTE
    smote = SMOTE(random_state=42)
    X_train_res, y_train_res = smote.fit_resample(X_train, y_train)

    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train_res)
    X_test_scaled = scaler.transform(X_test)

    # Train XGBoost (preferred) or Random Forest
    if USE_XGB:
        print("[INFO] Training XGBoost...")
        model = XGBClassifier(
            n_estimators=100,
            max_depth=4,
            learning_rate=0.1,
            subsample=0.8,
            colsample_bytree=0.8,
            use_label_encoder=False,
            eval_metric="logloss",
            random_state=42,
            n_jobs=1
        )
    else:
        print("[INFO] Training Random Forest...")
        model = RandomForestClassifier(
            n_estimators=100,
            max_depth=8,
            min_samples_split=5,
            random_state=42,
            n_jobs=1
        )

    model.fit(X_train_scaled, y_train_res)

    # Evaluate
    y_pred = model.predict(X_test_scaled)
    y_prob = model.predict_proba(X_test_scaled)[:, 1]
    print("\n[RESULTS]")
    print(classification_report(y_test, y_pred))
    print(f"ROC-AUC: {roc_auc_score(y_test, y_prob):.4f}")

    # Feature importance
    importances = dict(zip(feature_cols, model.feature_importances_))
    print("\n[FEATURE IMPORTANCE]")
    for feat, imp in sorted(importances.items(), key=lambda x: -x[1]):
        print(f"  {feat}: {imp:.4f}")

    # Save artifacts
    artifacts = {
        "model": model,
        "scaler": scaler,
        "encoders": encoders,
        "feature_cols": feature_cols,
        "model_type": "XGBoost" if USE_XGB else "RandomForest"
    }
    model_path = os.path.join(MODEL_DIR, "stroke_model.pkl")
    with open(model_path, "wb") as f:
        pickle.dump(artifacts, f)

    print(f"\n[INFO] Model saved to {model_path}")
    return artifacts


if __name__ == "__main__":
    train()
