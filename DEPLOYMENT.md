# 🚀 AWS Deployment Guide — StrokeGuard AI

## Prerequisites
- AWS Account
- AWS CLI installed and configured (`aws configure`)
- Domain name (optional, but recommended for HTTPS)

---

## Option 1: Quick Deploy (EC2 + Free Domain)

### Step 1: Launch EC2 Instance

```bash
# Create security group
aws ec2 create-security-group \
  --group-name strokeguard-sg \
  --description "StrokeGuard security group"

# Get the security group ID
SG_ID=$(aws ec2 describe-security-groups \
  --group-names strokeguard-sg \
  --query 'SecurityGroups[0].GroupId' \
  --output text)

# Allow HTTP, HTTPS, SSH
aws ec2 authorize-security-group-ingress --group-id $SG_ID --protocol tcp --port 22 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id $SG_ID --protocol tcp --port 80 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id $SG_ID --protocol tcp --port 443 --cidr 0.0.0.0/0

# Launch Ubuntu instance (t2.micro = free tier)
aws ec2 run-instances \
  --image-id ami-0c55b159cbfafe1f0 \
  --instance-type t2.micro \
  --key-name YOUR_KEY_NAME \
  --security-group-ids $SG_ID \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=StrokeGuard}]'

# Get instance public IP
aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=StrokeGuard" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' \
  --output text
```

### Step 2: Connect and Deploy

```bash
# SSH into instance (replace with your IP and key)
ssh -i your-key.pem ubuntu@<PUBLIC_IP>

# Update system
sudo apt update && sudo apt upgrade -y

# Install dependencies
sudo apt install -y python3.11 python3.11-venv python3-pip git nginx certbot python3-certbot-nginx

# Clone your project (or upload via SCP)
git clone https://github.com/YOUR_USERNAME/strokeguard-ai.git
cd strokeguard-ai

# Or upload via SCP from your local machine:
# scp -i your-key.pem -r Heart/ ubuntu@<PUBLIC_IP>:~/strokeguard-ai/

# Create virtual environment
python3.11 -m venv venv
source venv/bin/activate

# Install Python packages
pip install -r requirements.txt

# Train ML model
python ml/train_model.py

# Create .env file
cat > .env << 'EOF'
SECRET_KEY=$(openssl rand -hex 32)
JWT_SECRET_KEY=$(openssl rand -hex 32)
FLASK_ENV=production
DATABASE_URL=sqlite:///health_monitor.db
AWS_REGION=us-east-1
SNS_TOPIC_ARN=arn:aws:sns:us-east-1:YOUR_ACCOUNT:HealthAlerts
EOF

# Create systemd service
sudo tee /etc/systemd/system/strokeguard.service > /dev/null << 'EOF'
[Unit]
Description=StrokeGuard AI Flask App
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/strokeguard-ai
Environment="PATH=/home/ubuntu/strokeguard-ai/venv/bin"
ExecStart=/home/ubuntu/strokeguard-ai/venv/bin/gunicorn --bind 0.0.0.0:8000 --workers 2 run:app
Restart=always

[Install]
WantedBy=multi-user.target
EOF

# Start service
sudo systemctl daemon-reload
sudo systemctl enable strokeguard
sudo systemctl start strokeguard

# Configure Nginx
sudo tee /etc/nginx/sites-available/strokeguard > /dev/null << 'EOF'
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/strokeguard /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx

# Get public IP
curl -s http://169.254.169.254/latest/meta-data/public-ipv4
```

**Your app is now live at:** `http://<PUBLIC_IP>`

---

## Step 3: Add HTTPS (Required for Camera)

### Option A: Use Free DuckDNS Domain

```bash
# On your local machine, register at https://www.duckdns.org
# Get a free subdomain like: strokeguard.duckdns.org

# Update DuckDNS with your EC2 IP
curl "https://www.duckdns.org/update?domains=YOUR_SUBDOMAIN&token=YOUR_TOKEN&ip=<PUBLIC_IP>"

# Back on EC2, install SSL cert
sudo certbot --nginx -d YOUR_SUBDOMAIN.duckdns.org --non-interactive --agree-tos -m your@email.com

# Auto-renew
sudo systemctl enable certbot.timer
```

**Your app is now live at:** `https://YOUR_SUBDOMAIN.duckdns.org`

### Option B: Use Your Own Domain

```bash
# Point your domain A record to EC2 public IP in your DNS provider
# Then run:
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com --non-interactive --agree-tos -m your@email.com
```

---

## Option 2: One-Click Deploy (Heroku - Easiest)

```bash
# Install Heroku CLI
curl https://cli-assets.heroku.com/install.sh | sh

# Login
heroku login

# Create app
cd Heart
heroku create strokeguard-ai-YOUR_NAME

# Add buildpack
heroku buildpacks:set heroku/python

# Create Procfile
echo "web: gunicorn run:app" > Procfile

# Update run.py (remove ssl_context for Heroku)
cat > run.py << 'EOF'
from app import create_app
app = create_app()
if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
EOF

# Deploy
git init
git add .
git commit -m "Deploy to Heroku"
git push heroku main

# Open app
heroku open
```

**Your app is live at:** `https://strokeguard-ai-YOUR_NAME.herokuapp.com`

---

## Option 3: AWS Elastic Beanstalk (Managed)

```bash
# Install EB CLI
pip install awsebcli

# Initialize
cd Heart
eb init -p python-3.11 strokeguard --region us-east-1

# Create environment
eb create strokeguard-prod --instance-type t2.small

# Deploy
eb deploy

# Get URL
eb status
```

**Your app is live at:** `http://strokeguard-prod.RANDOM.elasticbeanstalk.com`

---

## Option 4: Railway (Free, Fastest)

1. Go to https://railway.app
2. Sign in with GitHub
3. Click **"New Project"** → **"Deploy from GitHub repo"**
4. Select your `Heart` repository
5. Railway auto-detects Python and deploys
6. Click **"Generate Domain"**

**Your app is live at:** `https://strokeguard-production.up.railway.app`

---

## Recommended: Railway or Heroku

**Why?**
- ✅ Free tier available
- ✅ Auto HTTPS (camera works)
- ✅ No server management
- ✅ Deploy in 2 minutes
- ✅ Auto-scaling

**For production AWS:**
- Use EC2 + RDS + S3 + CloudFront
- Follow the CloudFormation template in `aws/cloudformation.yml`

---

## Quick Test Commands

```bash
# Check if app is running
curl http://YOUR_URL

# Check SSL
curl https://YOUR_URL

# View logs (EC2)
sudo journalctl -u strokeguard -f

# Restart app (EC2)
sudo systemctl restart strokeguard
```

---

## 🎯 Fastest Path to Public URL:

### Railway (2 minutes):
1. Push code to GitHub
2. Import to Railway
3. Get instant HTTPS URL

### Heroku (5 minutes):
```bash
heroku create
git push heroku main
heroku open
```

Choose Railway or Heroku for instant deployment with HTTPS!
