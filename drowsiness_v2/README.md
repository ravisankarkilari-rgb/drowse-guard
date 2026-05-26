# Driver Drowsiness Detector — Complete Project

## Project Structure

```
drowsiness_project/
├── backend/                  ← FastAPI Python server (serves CNN model)
├── frontend/                 ← React web app (dashboard + login)
├── mobile/                   ← React Native app (Android + iPhone)
├── dataset_collector/        ← Script to collect real-time eye images
├── model_training/           ← CNN training code
└── README.md                 ← This file
```

---

## Step 1 — Firebase Setup (Do this first)

1. Go to https://console.firebase.google.com
2. Click "Add project" → name it "drowsiness-detector"
3. Go to Authentication → Sign-in method → Enable:
   - Email/Password
   - Google
4. Go to Project Settings → Your apps → Add Web App
5. Copy your config — looks like this:
```js
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```
6. Paste this config into:
   - `frontend/src/firebase/config.js`
   - `mobile/firebase/config.js`

---

## Step 2 — Backend Setup

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Backend runs at: http://localhost:8000

---

## Step 3 — Train Your Model First

```bash
cd model_training
pip install tensorflow opencv-python numpy matplotlib
python train_cnn.py
```

This saves `eye_model.h5` → copy it to `backend/eye_model.h5`

---

## Step 4 — Frontend (React Web App)

```bash
cd frontend
npm install
npm start
```

Website runs at: http://localhost:3000

---

## Step 5 — Mobile App

```bash
cd mobile
npm install
npx expo start
```

Scan QR code with Expo Go app on your phone.

---

## Step 6 — Connect Phone Camera

1. Install IP Webcam app on Android
2. Start server in app
3. Note the IP shown (e.g. 192.168.1.5:8080)
4. Update PHONE_IP in `backend/main.py`
5. Run backend → it reads your phone camera and runs detection

---

## Deployment

- Frontend → Vercel (free): `npm run build` then drag-drop to vercel.com
- Backend → Railway (free): connect GitHub repo, auto-deploys
- Mobile → Expo Go for testing, Expo Build for APK

---

## Resume Points

- "Built full-stack web + mobile app with React and React Native"
- "Firebase Authentication with Google OAuth and Email/Password"
- "CNN model served via FastAPI REST API, deployed on Railway"
- "Real-time drowsiness detection from live phone camera feed"
- "EAR (Eye Aspect Ratio) logic with configurable threshold"
