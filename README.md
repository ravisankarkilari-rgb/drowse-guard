<img width="1919" height="1100" alt="image" src="https://github.com/user-attachments/assets/df525d33-dd3f-4f9e-a4ec-fd04f7aafd96" />
# 👁️ DrowseGuard — Advanced Driver Drowsiness Detection System

DrowseGuard is a premium, multi-tiered driver safety solution featuring real-time eye-status monitoring, edge AI computer vision tracking, an interactive visual HUD dashboard, active safety alarms, and adaptive user calibration. 

Featuring **100% mobile browser compatibility (iOS Safari & Android Chrome)**, **highly stable 3-point vertical eye aspect ratio calculations**, and **AI-powered real-time adaptive dynamic threshold calibration**, DrowseGuard ensures maximum safety out-of-the-box in any cabin, lighting, or device.

---

## 🌟 Key Features

* 🚀 **Futuristic Visual HUD Overlay:** Dynamic rounded rectangular bounding boxes around the driver's eyes. Colored green for `OPEN` eyes and transitions to flashing red for `CLOSED` eyes, complete with high-contrast text headers showing eye opening percentage.
* 🧠 **AI-Powered Adaptive Dynamic Calibration:** The system maintains a sliding history of the driver's eye aspect ratio (EAR) to dynamically determine the optimal closing threshold. It automatically adapts to individual eye shapes, distance from screen, lighting, and camera resolution.
* ⏱️ **Robust 3-Point vertical EAR Calculation:** Upgraded math averages three vertical pairs across each eye. Prevents jitter, ensures noise resistance, and accurately registers real blinks.
* 🚨 **Dual-Alarm Warning System:** Piercing alert response combining an industrial HTML5 MP3 alert sound and a hardware-native Web Audio synthesizer generating pulsing high-frequency siren beeps.
* 🚦 **Multi-State UI Status Tracking:** The alert panels dynamically track and transition between three distinct safety states:
  * 🟢 **SAFE:** Driver is fully alert and focused.
  * 🟡 **DROWSY:** heavy blinking or initial signs of fatigue are flagged with orange warnings and a yellow overhead Warning Banner.
  * 🔴 **ALARM:** Active drowsiness triggers red alert screens, banners, and auditory alarms.
* 📱 **Enterprise Mobile Compatibility:** Custom built-in touch-gesture handlers pre-unlock strict mobile audio browser locks (Safari iOS & Android Chrome), allowing complete camera and siren autoplay support on mobile devices.
* 🛡️ **Loss-of-Face Safety Reset:** Automatically resets timers, refs, and turns off active visual alarms if the driver turns their face away, gets out of frame, or covers the lens.

---

## 📂 Project Architecture

```
drowsiness_v2_supabase/
├── drowsiness_project/         ← Core Project Directory
│   ├── backend/                ← FastAPI Python Backend Server
│   │   ├── main.py             ← API with OpenCV cascades & CNN eye classifier
│   │   └── requirements.txt
│   ├── frontend/               ← React Visual HUD Dashboard (Vercel Deployed)
│   │   ├── package.json
│   │   └── src/
│   │       ├── App.jsx
│   │       └── pages/
│   │           ├── Login.jsx
│   │           └── Dashboard.jsx   ← Dynamic Dashboard & Local Edge-AI engine
│   └── model_training/         ← CNN Eye Classification Trainer
│       └── train_cnn.py
├── web_app/                    ← Lightweight, high-performance offline client
│   ├── index.html              ← Offline Edge-AI panel
│   ├── app.js                  ← Pure JS MediaPipe FaceLandmarker logic
│   └── style.css
└── README.md                   ← This document
```

---

## ⚡ Installation & Run Guide

### 1. React Web Dashboard (Local Server)
1. Navigate into the frontend project directory:
   ```bash
   cd drowsiness_project/frontend
   ```
2. Install npm dependencies:
   ```bash
   npm install
   ```
3. Start the React development server:
   ```bash
   npm start
   ```
   *The dashboard will compile and open automatically in your browser at `http://localhost:3000`.*

---

### 2. Pure Web App Client (Offline Offline Edge-AI)
Open the lightweight, pure HTML client by opening the index file directly in any browser:
* Double-click [web_app/index.html](web_app/index.html) or run a local static file server.
* It operates completely offline client-side and requires zero backend server setups!

---

### 3. FastAPI Python Backend Server (Optional)
If you wish to run OpenCV cascade filters or the CNN classification pipeline remotely:
1. Navigate into the backend directory:
   ```bash
   cd drowsiness_project/backend
   ```
2. Install the required Python packages:
   ```bash
   pip install -r requirements.txt
   ```
3. Start the Uvicorn FastAPI server:
   ```bash
   uvicorn main:app --reload --port 8000
   ```
   *The backend will run at `http://localhost:8000`.*

---

## ☁️ Deployment

DrowseGuard is optimized for one-click **Vercel** monorepo hosting.

### Git Automatic Deployments:
Simply push your commits to your GitHub branch, and Vercel will automatically trigger a production build:
```bash
git add .
git commit -m "feat: implement HUD eye boxes, active alarms, and dynamic EAR calibration"
git push origin main
```

---

## ⚙️ Calibration Tips
* **Face Alignment:** Align your face relatively centered in front of the camera stream.
* **Auto-Calibration:** Look at the screen for **2 to 3 seconds** on startup. The dynamic engine will analyze your eyes and automatically calibrate the slider threshold (visible on the right control panel) specifically for you.
* **Sensitivity adjustments:** Use the right sidebar sliders to customize the closed-duration time limits (e.g. increase time frames to prevent alerts during normal rapid blinking).
