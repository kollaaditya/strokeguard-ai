import json
import random
from datetime import datetime
from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user
from app import db
from app.models.models import HealthRecord, User
from app.utils.predictor import predict
from app.utils.alerts import send_alert

api_bp = Blueprint("api", __name__)


@api_bp.route("/predict", methods=["POST"])
@login_required
def predict_risk():
    data = request.get_json(force=True)
    if not data:
        return jsonify({"error": "No data provided"}), 400

    required = ["age", "avg_glucose_level", "bmi"]
    for field in required:
        if field not in data:
            return jsonify({"error": f"Missing field: {field}"}), 400

    try:
        result = predict(data)
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 503
    except Exception as e:
        return jsonify({"error": f"Prediction error: {str(e)}"}), 500

    # Save to DB
    record = HealthRecord(
        user_id=current_user.id,
        age=float(data.get("age", 0)),
        gender=data.get("gender", "Male"),
        hypertension=int(data.get("hypertension", 0)),
        heart_disease=int(data.get("heart_disease", 0)),
        ever_married=data.get("ever_married", "No"),
        work_type=data.get("work_type", "Private"),
        residence_type=data.get("Residence_type", "Urban"),
        avg_glucose_level=float(data.get("avg_glucose_level", 100)),
        bmi=float(data.get("bmi", 25)),
        smoking_status=data.get("smoking_status", "never smoked"),
        risk_probability=result["probability"],
        risk_level=result["risk_level"],
        advice=json.dumps(result["advice"]),
    )
    db.session.add(record)
    db.session.commit()

    # Send SNS alert for HIGH risk
    if result["risk_level"] == "HIGH":
        send_alert(current_user.email, result["probability"], current_user.username)

    return jsonify({
        "record_id": record.id,
        "probability": result["probability"],
        "risk_level": result["risk_level"],
        "advice": result["advice"],
        "timestamp": record.timestamp.strftime("%Y-%m-%d %H:%M:%S"),
    })


@api_bp.route("/history", methods=["GET"])
@login_required
def get_history():
    limit = min(int(request.args.get("limit", 20)), 100)
    records = (
        HealthRecord.query
        .filter_by(user_id=current_user.id)
        .order_by(HealthRecord.timestamp.desc())
        .limit(limit)
        .all()
    )
    return jsonify([r.to_dict() for r in records])


@api_bp.route("/simulate", methods=["GET"])
@login_required
def simulate_data():
    """Return simulated health data based on user profile."""
    user = current_user
    base_age = user.age or 45
    base_glucose = random.uniform(85, 180)
    base_bmi = random.uniform(20, 38)

    simulated = {
        "gender": user.gender or "Male",
        "age": base_age + random.uniform(-0.5, 0.5),
        "hypertension": random.choices([0, 1], weights=[75, 25])[0],
        "heart_disease": random.choices([0, 1], weights=[85, 15])[0],
        "ever_married": "Yes" if base_age > 30 else "No",
        "work_type": random.choice(["Private", "Self-employed", "Govt_job"]),
        "Residence_type": random.choice(["Urban", "Rural"]),
        "avg_glucose_level": round(base_glucose + random.uniform(-10, 10), 2),
        "bmi": round(base_bmi + random.uniform(-1, 1), 1),
        "smoking_status": random.choice(["never smoked", "formerly smoked", "smokes"]),
    }
    return jsonify(simulated)


@api_bp.route("/profile", methods=["GET", "PUT"])
@login_required
def profile():
    if request.method == "GET":
        return jsonify(current_user.to_dict())

    data = request.get_json(force=True)
    user = User.query.get(current_user.id)
    if data.get("full_name"):
        user.full_name = data["full_name"]
    if data.get("age"):
        user.age = int(data["age"])
    if data.get("gender"):
        user.gender = data["gender"]
    if data.get("emergency_contact"):
        user.emergency_contact = data["emergency_contact"]
    db.session.commit()
    return jsonify({"message": "Profile updated", "user": user.to_dict()})


@api_bp.route("/stats", methods=["GET"])
@login_required
def stats():
    """Return summary stats for the current user."""
    records = HealthRecord.query.filter_by(user_id=current_user.id).all()
    if not records:
        return jsonify({"total": 0, "high": 0, "medium": 0, "low": 0, "avg_probability": 0})

    total = len(records)
    high = sum(1 for r in records if r.risk_level == "HIGH")
    medium = sum(1 for r in records if r.risk_level == "MEDIUM")
    low = sum(1 for r in records if r.risk_level == "LOW")
    avg_prob = sum(r.risk_probability for r in records) / total

    # Last 10 for chart
    last_10 = sorted(records, key=lambda r: r.timestamp)[-10:]
    chart_data = {
        "labels": [r.timestamp.strftime("%H:%M:%S") for r in last_10],
        "probabilities": [r.risk_probability for r in last_10],
        "risk_levels": [r.risk_level for r in last_10],
    }

    return jsonify({
        "total": total,
        "high": high,
        "medium": medium,
        "low": low,
        "avg_probability": round(avg_prob, 2),
        "chart_data": chart_data,
    })
