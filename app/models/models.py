from datetime import datetime
from flask_login import UserMixin
from app import db, bcrypt


class User(UserMixin, db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    full_name = db.Column(db.String(120))
    age = db.Column(db.Integer)
    gender = db.Column(db.String(10))
    emergency_contact = db.Column(db.String(20))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    records = db.relationship("HealthRecord", backref="user", lazy=True, cascade="all, delete-orphan")

    def set_password(self, password):
        self.password_hash = bcrypt.generate_password_hash(password).decode("utf-8")

    def check_password(self, password):
        return bcrypt.check_password_hash(self.password_hash, password)

    def to_dict(self):
        return {
            "id": self.id,
            "username": self.username,
            "email": self.email,
            "full_name": self.full_name,
            "age": self.age,
            "gender": self.gender,
        }


class HealthRecord(db.Model):
    __tablename__ = "health_records"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

    # Input features
    age = db.Column(db.Float)
    gender = db.Column(db.String(10))
    hypertension = db.Column(db.Integer, default=0)
    heart_disease = db.Column(db.Integer, default=0)
    ever_married = db.Column(db.String(5))
    work_type = db.Column(db.String(30))
    residence_type = db.Column(db.String(10))
    avg_glucose_level = db.Column(db.Float)
    bmi = db.Column(db.Float)
    smoking_status = db.Column(db.String(30))

    # Prediction output
    risk_probability = db.Column(db.Float)
    risk_level = db.Column(db.String(10))
    advice = db.Column(db.Text)

    def to_dict(self):
        return {
            "id": self.id,
            "timestamp": self.timestamp.strftime("%Y-%m-%d %H:%M:%S"),
            "age": self.age,
            "gender": self.gender,
            "hypertension": self.hypertension,
            "heart_disease": self.heart_disease,
            "avg_glucose_level": self.avg_glucose_level,
            "bmi": self.bmi,
            "smoking_status": self.smoking_status,
            "risk_probability": self.risk_probability,
            "risk_level": self.risk_level,
            "advice": self.advice,
        }
