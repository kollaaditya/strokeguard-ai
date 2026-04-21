#!/bin/bash
# ============================================================
# AWS Deployment Script for StrokeGuard AI
# Run on Amazon EC2 (Ubuntu 22.04 LTS)
# ============================================================

set -e

echo "===== StrokeGuard AI - AWS EC2 Setup ====="

# 1. Update system
sudo apt-get update -y
sudo apt-get upgrade -y

# 2. Install Python 3.11
sudo apt-get install -y python3.11 python3.11-venv python3-pip git nginx

# 3. Clone / copy project
# git clone https://github.com/<your-username>/strokeguard-ai.git /home/ubuntu/strokeguard
# cd /home/ubuntu/strokeguard

# 4. Create virtual environment
python3.11 -m venv venv
source venv/bin/activate

# 5. Install dependencies
pip install --upgrade pip
pip install -r requirements.txt

# 6. Set environment variables (edit .env with your values)
cp .env.example .env
# nano .env  ← Edit with your RDS endpoint, SNS ARN, etc.

# 7. Train ML model
python ml/train_model.py

# 8. Upload model to S3 (optional)
# aws s3 cp ml/model/stroke_model.pkl s3://<your-bucket>/models/stroke_model.pkl

# 9. Create systemd service
sudo tee /etc/systemd/system/strokeguard.service > /dev/null <<EOF
[Unit]
Description=StrokeGuard AI Flask App
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/strokeguard
Environment="PATH=/home/ubuntu/strokeguard/venv/bin"
ExecStart=/home/ubuntu/strokeguard/venv/bin/gunicorn --bind 0.0.0.0:5000 --workers 2 run:app
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable strokeguard
sudo systemctl start strokeguard

# 10. Configure Nginx reverse proxy
sudo tee /etc/nginx/sites-available/strokeguard > /dev/null <<EOF
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/strokeguard /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx

echo "===== Deployment Complete! ====="
echo "App running at: http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)"
