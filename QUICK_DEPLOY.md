# 🚀 QUICK DEPLOY — Get Your Public URL in 3 Minutes

## Option 1: Railway (Recommended — Easiest)

### Step 1: Push to GitHub
```bash
cd Heart
git init
git add .
git commit -m "Initial commit"

# Create repo on GitHub, then:
git remote add origin https://github.com/YOUR_USERNAME/strokeguard-ai.git
git branch -M main
git push -u origin main
```

### Step 2: Deploy to Railway
1. Go to https://railway.app
2. Click **"Start a New Project"**
3. Click **"Deploy from GitHub repo"**
4. Select your `strokeguard-ai` repository
5. Railway auto-detects and deploys
6. Click **"Settings"** → **"Generate Domain"**

**Done! Your URL:** `https://strokeguard-production.up.railway.app`

---

## Option 2: Render (Also Free)

1. Go to https://render.com
2. Click **"New +"** → **"Web Service"**
3. Connect GitHub repo
4. Settings:
   - **Build Command:** `pip install -r requirements.txt && python ml/train_model.py`
   - **Start Command:** `gunicorn run:app`
5. Click **"Create Web Service"**

**Done! Your URL:** `https://strokeguard.onrender.com`

---

## Option 3: Heroku (Classic)

```bash
# Install Heroku CLI
# Windows: https://devcenter.heroku.com/articles/heroku-cli
# Mac: brew install heroku/brew/heroku

heroku login
heroku create strokeguard-YOUR_NAME
git push heroku main
heroku open
```

**Done! Your URL:** `https://strokeguard-YOUR_NAME.herokuapp.com`

---

## Option 4: Vercel (Serverless)

```bash
npm i -g vercel
vercel login
vercel --prod
```

**Done! Your URL:** `https://strokeguard.vercel.app`

---

## 🎯 I Recommend: Railway

**Why?**
- ✅ 100% free for small projects
- ✅ Auto HTTPS (camera works!)
- ✅ No credit card needed
- ✅ Deploy in 2 clicks
- ✅ Auto-restart on crash
- ✅ Built-in monitoring

**Just push to GitHub → Import to Railway → Get URL**

---

## After Deployment:

1. Open your URL: `https://your-app.railway.app`
2. Register an account
3. Click **"Start Camera"** (HTTPS = camera works!)
4. Share the URL with anyone

---

## Environment Variables (Optional)

If deploying to Railway/Render/Heroku, add these in dashboard:

```
SECRET_KEY=your-random-secret-key
JWT_SECRET_KEY=your-jwt-secret
FLASK_ENV=production
```

Railway/Render auto-generate these if not set.

---

## Need Help?

- Railway docs: https://docs.railway.app
- Render docs: https://render.com/docs
- Heroku docs: https://devcenter.heroku.com

**Choose Railway for fastest deployment!**
