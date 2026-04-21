# 🫀 StrokeGuard AI — Real-Time Health Monitoring & Stroke Risk Prediction

[![Python](https://img.shields.io/badge/Python-3.11-blue)](https://python.org)
[![Flask](https://img.shields.io/badge/Flask-2.3-green)](https://flask.palletsprojects.com)
[![AWS](https://img.shields.io/badge/AWS-EC2%20%7C%20RDS%20%7C%20S3%20%7C%20SNS-orange)](https://aws.amazon.com)
[![ML](https://img.shields.io/badge/ML-XGBoost%20%7C%20RandomForest-red)](https://xgboost.readthedocs.io)

A production-ready web application that monitors health metrics in real time, predicts stroke risk using Machine Learning, and sends emergency alerts via AWS SNS.

---

## 📁 Project Structure

```
Heart/
├── run.py                          # Flask entry point
├── requirements.txt
├── .env                            # Environment variables
├── Dockerfile
├── docker-compose.yml
│
├── app/
│   ├── __init__.py                 # App factory
│   ├── routes/
│   │   ├── auth.py                 # Register / Login / Logout
│   │   ├── dashboard.py            # Dashboard & History pages
│   │   └── api.py                  # REST API endpoints
│   ├── models/
│   │   └── models.py               # SQLAlchemy DB models
│   ├── utils/
│   │   ├── predictor.py            # ML prediction engine
│   │   └── alerts.py               # AWS SNS alerts
│   ├── templates/
│   │   ├── base.html
│   │   ├── home.html
│   │   ├── auth/
│   │   │   ├── login.html
│   │   │   └── register.html
│   │   └── dashboard/
│   │       ├── dashboard.html
│   │       └── history.html
│   └── static/
│       ├── css/style.css
│       └── js/dashboard.js
│
├── ml/
│   ├── train_model.py              # ML training script
│   └── model/
│       └── stroke_model.pkl        # Saved model (generated)
│
└── aws/
    ├── deploy_ec2.sh               # EC2 deployment script
    └── cloudformation.yml          # AWS infrastructure as code
```

---

## 🚀 Local Setup

### Prerequisites
- Python 3.11+
- pip

### Step 1 — Install dependencies
```bash
cd Heart
python -m venv venv

# Windows
venv\Scripts\activate

# Linux/Mac
source venv/bin/activate

pip install -r requirements.txt
```

### Step 2 — Configure environment
```bash
# Edit .env with your settings (SQLite works out of the box)
# No changes needed for local development
```

### Step 3 — Train the ML model
```bash
python ml/train_model.py
```
> Downloads synthetic data automatically. Place `healthcare-dataset-stroke-data.csv` from Kaggle in `ml/` for real data.

### Step 4 — Run the application
```bash
python run.py
```

Open: **http://localhost:5000**

---

## 🐳 Docker Setup

```bash
# Build and run with Docker Compose (includes MySQL)
docker-compose up --build

# App available at http://localhost:5000
```

---

## ☁️ AWS Deployment

### Architecture
```
Internet → Elastic IP → EC2 (Nginx + Gunicorn + Flask)
                              ↓
                         Amazon RDS (MySQL)
                              ↓
                         Amazon S3 (ML Models)
                              ↓
                         Amazon SNS (Alerts)
```

### Step 1 — Deploy Infrastructure
```bash
aws cloudformation create-stack \
  --stack-name strokeguard \
  --template-body file://aws/cloudformation.yml \
  --parameters ParameterKey=DBPassword,ParameterValue=YourSecurePass123 \
  --capabilities CAPABILITY_NAMED_IAM
```

### Step 2 — Launch EC2
- AMI: Ubuntu 22.04 LTS
- Instance type: t3.small (minimum)
- Attach IAM role: `StrokeGuardEC2Role`
- Security group: Allow HTTP (80), HTTPS (443), SSH (22)
- Assign Elastic IP

### Step 3 — Deploy Application
```bash
# SSH into EC2
ssh -i your-key.pem ubuntu@<elastic-ip>

# Upload project
scp -r Heart/ ubuntu@<elastic-ip>:~/strokeguard/

# Run deployment script
chmod +x aws/deploy_ec2.sh
./aws/deploy_ec2.sh
```

### Step 4 — Configure .env on EC2
```bash
nano .env
# Set DATABASE_URL to RDS endpoint
# Set SNS_TOPIC_ARN from CloudFormation outputs
```

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Home page |
| GET/POST | `/login` | User login |
| GET/POST | `/register` | User registration |
| GET | `/logout` | Logout |
| GET | `/dashboard` | Live dashboard |
| GET | `/history` | Prediction history |
| POST | `/api/predict` | Run ML prediction |
| GET | `/api/simulate` | Get simulated health data |
| GET | `/api/history` | JSON prediction history |
| GET | `/api/stats` | User statistics |
| GET/PUT | `/api/profile` | User profile |

### POST /api/predict — Request Body
```json
{
  "age": 55,
  "gender": "Male",
  "hypertension": 1,
  "heart_disease": 0,
  "ever_married": "Yes",
  "work_type": "Private",
  "Residence_type": "Urban",
  "avg_glucose_level": 145.5,
  "bmi": 28.3,
  "smoking_status": "formerly smoked"
}
```

### Response
```json
{
  "probability": 67.4,
  "risk_level": "HIGH",
  "advice": ["⚠️ SEEK MEDICAL ATTENTION IMMEDIATELY.", "..."],
  "timestamp": "2024-01-15 14:30:22"
}
```

---

## 🤖 ML Model Details

| Property | Value |
|----------|-------|
| Algorithm | XGBoost (fallback: Random Forest) |
| Dataset | Kaggle Stroke Prediction (5110 records) |
| Features | 10 (age, BMI, glucose, hypertension, etc.) |
| Imbalance handling | SMOTE oversampling |
| Evaluation | ROC-AUC, Precision, Recall, F1 |

### Risk Classification
| Risk Level | Probability |
|------------|-------------|
| 🟢 LOW | < 30% |
| 🟡 MEDIUM | 30% – 60% |
| 🔴 HIGH | > 60% |

---

## 🔔 Alert System

When risk is HIGH:
1. UI shows animated alert modal
2. AWS SNS sends SMS/email to subscribed endpoints
3. Emergency call button (108) is prominently displayed
4. Saved emergency contact can be called directly

---

## 🔐 Security

- Passwords hashed with bcrypt
- JWT tokens for API authentication
- Flask-Login for session management
- IAM roles (no hardcoded AWS credentials)
- Environment variables for all secrets
- Input validation on all endpoints

---

## 📊 Features Summary

- ✅ User Authentication (Register/Login/Logout)
- ✅ Real-time dashboard (updates every 3 seconds)
- ✅ ML stroke risk prediction (XGBoost)
- ✅ Risk gauge (green/yellow/red)
- ✅ Live trend chart (Chart.js)
- ✅ Prediction history with charts
- ✅ Personalized health advice
- ✅ HIGH risk alert modal
- ✅ AWS SNS alerts (SMS/email)
- ✅ Emergency call button (108)
- ✅ Docker support
- ✅ AWS CloudFormation IaC
- ✅ Responsive Bootstrap UI

---

## ⚠️ Disclaimer

This application is for **educational and informational purposes only**. It is NOT a substitute for professional medical advice, diagnosis, or treatment. Always consult a qualified healthcare provider.

---

*Built with ❤️ using Flask, XGBoost, Bootstrap, Chart.js, and AWS*
