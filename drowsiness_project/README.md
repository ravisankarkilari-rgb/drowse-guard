# DrowseGuard — Driver Drowsiness Detection System

DrowseGuard is a complete, multi-tiered driver safety solution featuring real-time eye status monitoring, Keras-based CNN classifier inference, live video streaming, a premium React web dashboard, and an Expo React Native mobile application. All authentication and session synchronization is managed natively through Supabase.

## Features

- **Real-Time Video Capture**: Reads stream from IP Webcam (http://192.168.1.5:8080/video) or falls back to a standard USB webcam.
- **Grayscale + CLAHE Preprocessing**: Enhances low-light and low-contrast conditions for dark cabins or night driving.
- **Face & Eye Detection**: Employs Haar Cascade Classifiers (`haarcascade_frontalface_default.xml`, `haarcascade_eye.xml`) to localize regions of interest.
- **CNN Classification**: Runs eye state inference through a Keras Convolutional Neural Network (`eye_model.h5`) classifying eyes as `OPEN` or `CLOSED`.
- **Drowsiness State Engine**: Counts consecutive closed frames; alerts at 10 frames and triggers full alarm at 20 frames.
- **Live Annotated MJPEG Stream**: Serves processed video frames with bounding boxes and alarms dynamically overlaid.
- **Web & Mobile Dashboards**: Stunning glassmorphic panels displaying live eye status, closed frames counts, alarm alerts, and historical logs.
- **Supabase Security**: Seamless Google OAuth and Email/Password sign-ups and logins.

---

## Folder Structure

```
drowsiness_project/
├── backend/                  ← FastAPI Python Server
│   ├── main.py
│   └── requirements.txt
├── frontend/                 ← React Web Dashboard
│   ├── public/
│   │   └── index.html
│   ├── package.json
│   └── src/
│       ├── index.js
│       ├── App.jsx
│       ├── supabase/
│       │   └── config.js
│       └── pages/
│           ├── Login.jsx
│           └── Dashboard.jsx
├── mobile/                   ← Expo React Native Mobile App
│   ├── App.js
│   ├── package.json
│   ├── supabase/
│   │   └── config.js
│   └── screens/
│       ├── LoginScreen.js
│       └── DashboardScreen.js
├── model_training/           ← CNN Keras Model Trainer
│   └── train_cnn.py
├── dataset_collector/        ← Grayscale Crop Collector
│   └── collect_dataset.py
└── README.md                 ← This document
```

---

## Installation & Running

### Step 1: Start the Backend API
1. Navigate to the backend directory and install Python requirements:
   ```bash
   cd backend
   pip install -r requirements.txt
   ```
2. Launch the FastAPI Uvicorn server:
   ```bash
   uvicorn main:app --reload --port 8000
   ```
   *The API will run at http://localhost:8000.*

### Step 2: Start the Web Dashboard
1. Navigate to the frontend directory and install NPM packages:
   ```bash
   cd frontend
   npm install
   ```
2. Start the React development server:
   ```bash
   npm start
   ```
   *The dashboard will run at http://localhost:3000.*

### Step 3: Start the Mobile Dashboard
1. Navigate to the mobile directory and install NPM packages:
   ```bash
   cd mobile
   npm install
   ```
2. Start Expo:
   ```bash
   npx expo start
   ```

### Step 4: Model Training
If you wish to train or update the CNN:
1. Navigate to `dataset_collector` and run `collect_dataset.py` to capture grayscale eye crops.
2. Navigate to `model_training` and run `train_cnn.py` to compile, train, and export `eye_model.h5`.
3. Copy `eye_model.h5` to the `backend/` directory for live classification.
