from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import cv2
import numpy as np
import tensorflow as tf
from scipy.spatial import distance
import base64
import io
import time
import threading

app = FastAPI(title="Drowsiness Detector API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Config ──────────────────────────────────────
PHONE_IP   = "192.168.1.5"      # Change to your phone IP
PORT       = "8080"
EAR_THRESH = 0.25               # Below this = eye closed
EAR_FRAMES = 20                 # Frames eye must stay closed to alarm
IMG_SIZE   = (64, 64)
# ────────────────────────────────────────────────

# Load model
try:
    model = tf.keras.models.load_model("eye_model.h5")
    print("Model loaded successfully")
except Exception as e:
    print(f"Model not found: {e}. Using EAR only.")
    model = None

# Load cascades
face_cascade = cv2.CascadeClassifier(
    cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
eye_cascade = cv2.CascadeClassifier(
    cv2.data.haarcascades + "haarcascade_eye.xml")

# State
state = {
    "ear": 0.0,
    "eye_status": "unknown",
    "drowsy": False,
    "alarm": False,
    "closed_frames": 0,
    "frame_count": 0,
    "fps": 0,
}

def eye_aspect_ratio(eye_points):
    A = distance.euclidean(eye_points[1], eye_points[5])
    B = distance.euclidean(eye_points[2], eye_points[4])
    C = distance.euclidean(eye_points[0], eye_points[3])
    return (A + B) / (2.0 * C)

def preprocess_eye(eye_img):
    eye_img = cv2.resize(eye_img, IMG_SIZE)
    eye_img = eye_img / 255.0
    return np.expand_dims(np.expand_dims(eye_img, axis=-1), axis=0)

def classify_eye(eye_img):
    if model is None:
        return "unknown", 0.0
    processed = preprocess_eye(eye_img)
    pred = model.predict(processed, verbose=0)[0][0]
    label = "closed" if pred > 0.5 else "open"
    return label, float(pred)

def process_frame(frame):
    gray  = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray  = clahe.apply(gray)

    faces = face_cascade.detectMultiScale(gray, 1.3, 5, minSize=(80, 80))

    eye_status = "no face"
    ear_val    = 0.0

    for (fx, fy, fw, fh) in faces:
        cv2.rectangle(frame, (fx, fy), (fx+fw, fy+fh), (0, 255, 0), 2)
        roi_gray = gray[fy:fy+fh, fx:fx+fw]
        eyes     = eye_cascade.detectMultiScale(roi_gray, 1.1, 10)

        eye_labels = []
        for (ex, ey, ew, eh) in eyes[:2]:
            eye_crop = roi_gray[ey:ey+eh, ex:ex+ew]
            label, conf = classify_eye(eye_crop)
            eye_labels.append(label)
            color = (0, 0, 255) if label == "closed" else (0, 255, 255)
            cv2.rectangle(frame,
                (fx+ex, fy+ey), (fx+ex+ew, fy+ey+eh), color, 2)
            cv2.putText(frame, label,
                (fx+ex, fy+ey-5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)

        if eye_labels:
            eye_status = "closed" if eye_labels.count("closed") > len(eye_labels) / 2 else "open"
        break

    if eye_status == "closed":
        state["closed_frames"] += 1
    else:
        state["closed_frames"] = 0

    state["alarm"]      = state["closed_frames"] >= EAR_FRAMES
    state["drowsy"]     = state["closed_frames"] >= EAR_FRAMES // 2
    state["eye_status"] = eye_status
    state["ear"]        = round(ear_val, 3)

    # Overlay
    status_color = (0, 0, 255) if state["alarm"] else (0, 255, 0)
    cv2.putText(frame, f"Eyes: {eye_status.upper()}",
        (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, status_color, 2)
    cv2.putText(frame, f"Closed frames: {state['closed_frames']}/{EAR_FRAMES}",
        (10, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 200), 1)

    if state["alarm"]:
        cv2.putText(frame, "DROWSINESS DETECTED!",
            (10, 100), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 255), 3)
        cv2.rectangle(frame, (0, 0),
            (frame.shape[1], frame.shape[0]), (0, 0, 255), 8)

    state["frame_count"] += 1
    return frame


# ── Routes ──────────────────────────────────────

@app.get("/")
def root():
    return {"message": "Drowsiness Detector API running"}

@app.get("/status")
def get_status():
    return {
        "eye_status":    state["eye_status"],
        "drowsy":        state["drowsy"],
        "alarm":         state["alarm"],
        "closed_frames": state["closed_frames"],
        "threshold":     EAR_FRAMES,
        "ear":           state["ear"],
        "frame_count":   state["frame_count"],
    }

@app.post("/predict")
async def predict_frame(file: UploadFile = File(...)):
    contents = await file.read()
    nparr    = np.frombuffer(contents, np.uint8)
    frame    = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=400, detail="Invalid image")

    processed = process_frame(frame)
    _, buffer  = cv2.imencode(".jpg", processed)
    img_b64    = base64.b64encode(buffer).decode("utf-8")

    return {
        "frame":         img_b64,
        "eye_status":    state["eye_status"],
        "drowsy":        state["drowsy"],
        "alarm":         state["alarm"],
        "closed_frames": state["closed_frames"],
    }

def generate_stream():
    stream_url = f"http://{PHONE_IP}:{PORT}/video"
    cap = cv2.VideoCapture(stream_url)
    if not cap.isOpened():
        cap = cv2.VideoCapture(0)

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        processed = process_frame(frame)
        _, buffer  = cv2.imencode(".jpg", processed,
            [cv2.IMWRITE_JPEG_QUALITY, 70])
        yield (b"--frame\r\nContent-Type: image/jpeg\r\n\r\n"
               + buffer.tobytes() + b"\r\n")
        time.sleep(0.033)

    cap.release()

@app.get("/stream")
def video_stream():
    return StreamingResponse(
        generate_stream(),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )

@app.put("/config")
def update_config(ear_frames: int = EAR_FRAMES, ear_thresh: float = EAR_THRESH):
    global EAR_FRAMES, EAR_THRESH
    EAR_FRAMES = ear_frames
    EAR_THRESH = ear_thresh
    return {"updated": True, "ear_frames": EAR_FRAMES, "ear_thresh": EAR_THRESH}
