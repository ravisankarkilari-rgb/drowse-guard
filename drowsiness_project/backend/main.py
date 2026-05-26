import base64
import io
import os
import time
from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import cv2
import numpy as np
import tensorflow as tf
from scipy.spatial import distance

app = FastAPI(title="Drowsiness Detector API")

# Configure CORS: allow_origins=["*"], all methods, all headers
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration settings
IMG_SIZE = (64, 64)

# State tracking dictionary
state = {
    "eye_status": "unknown",
    "drowsy": False,
    "alarm": False,
    "closed_frames": 0,
    "frame_count": 0,
    "threshold": 3,
    "prev_face_center": None
}

# Load CNN Eye Classification Model
model_path = os.path.join(os.path.dirname(__file__), "eye_model.h5")
if not os.path.exists(model_path):
    model_path = "eye_model.h5"  # Try current working directory as fallback

model = None
if os.path.exists(model_path):
    try:
        model = tf.keras.models.load_model(model_path)
        print(f"Successfully loaded CNN eye classification model from {model_path}.")
    except Exception as e:
        print(f"Error loading CNN eye model: {e}. Falling back to cascade heuristic.")
else:
    print(f"CNN model 'eye_model.h5' not found at {model_path}. Falling back to cascade heuristic.")

# Load Haar Cascades using the built-in cv2.data.haarcascades prefix
face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
eye_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_eye.xml")

def eye_aspect_ratio(eye_points):
    """
    Standard EAR calculation using Euclidean distances for 6 landmarks.
    Included for general completeness and utility.
    """
    A = distance.euclidean(eye_points[1], eye_points[5])
    B = distance.euclidean(eye_points[2], eye_points[4])
    C = distance.euclidean(eye_points[0], eye_points[3])
    return (A + B) / (2.0 * C)

def preprocess_eye(eye_img: np.ndarray) -> np.ndarray:
    """
    Preprocess the cropped eye region: resize to 64x64, normalize (divide by 255),
    and adjust channels based on model expectations.
    """
    # Resize eye crop to 64x64
    resized = cv2.resize(eye_img, IMG_SIZE)
    channels = 1
    if model is not None:
        try:
            input_shape = model.input_shape
            if input_shape is not None and len(input_shape) == 4:
                channels = input_shape[-1]
        except Exception:
            pass

    if channels == 3:
        # Use MobileNetV2 preprocessing for 3-channel models
        preprocess_input = tf.keras.applications.mobilenet_v2.preprocess_input
        color_img = cv2.cvtColor(resized, cv2.COLOR_GRAY2BGR)
        processed_img = preprocess_input(color_img.astype(np.float32))
        processed = np.expand_dims(processed_img, axis=0)
    else:
        # Ensure single channel grayscale dimension (1, 64, 64, 1)
        normalized = resized / 255.0
        if len(normalized.shape) == 2:
            normalized = np.expand_dims(normalized, axis=-1)
        processed = np.expand_dims(normalized, axis=0)

    return processed

def process_frame(frame: np.ndarray) -> np.ndarray:
    """
    Performs preprocessing, face & eye detection, CNN eye classification (with fallback),
    state updates, and image annotations.
    """
    if frame is None:
        return frame

    # Save the frame to disk so we can see what the backend is actually receiving!
    cv2.imwrite("debug_frame.jpg", frame)

    # Preprocessing: Convert frame to grayscale, apply CLAHE (clipLimit=2.0, tileGridSize=(8,8))
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)

    # Face detection using Haar Cascades
    faces = face_cascade.detectMultiScale(gray, scaleFactor=1.3, minNeighbors=5, minSize=(80, 80))

    eye_status = "unknown"

    for (fx, fy, fw, fh) in faces:
        # Green rect around face
        cv2.rectangle(frame, (fx, fy), (fx+fw, fy+fh), (0, 255, 0), 2)

        roi_gray = gray[fy:fy+fh, fx:fx+fw]
        
        # Prevent OpenCV getScaleData crash if ROI is too small
        if roi_gray.shape[0] < 20 or roi_gray.shape[1] < 20:
            continue

        face_center = (fx + fw/2.0, fy + fh/2.0)
        is_shaking = False
        if state.get("prev_face_center") is not None:
            px, py = state["prev_face_center"]
            dist = np.sqrt((face_center[0] - px)**2 + (face_center[1] - py)**2)
            if dist > min(fw, fh) * 0.08:
                is_shaking = True
                cv2.putText(frame, "SHAKING", (fx, fy-25), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 165, 255), 2)
        state["prev_face_center"] = face_center

        # Eye detection within face ROI
        eyes = eye_cascade.detectMultiScale(roi_gray, scaleFactor=1.1, minNeighbors=10)
        # Sort by area (w*h) descending to get the most likely real eyes
        eyes = sorted(eyes, key=lambda x: x[2]*x[3], reverse=True)
        # Limit processing to first 2 detected eyes
        eyes = eyes[:2]

        if model is not None:
            # CNN Eye Classification
            eye_labels = []
            for (ex, ey, ew, eh) in eyes:
                eye_crop = roi_gray[ey:ey+eh, ex:ex+ew]
                processed_eye = preprocess_eye(eye_crop)
                
                try:
                    pred = model.predict(processed_eye, verbose=0)[0][0]
                    print(f"CNN Prediction: {pred:.4f} ( <0.5 means CLOSED )")
                    # closed if pred < 0.5 else open
                    label = "closed" if pred < 0.5 else "open"
                except Exception as e:
                    print(f"Error during CNN prediction: {e}")
                    label = "open"  # Safe default if prediction fails
                
                eye_labels.append(label)

                # Blue rect around open eye, Red around closed eye
                color = (0, 0, 255) if label == "closed" else (255, 0, 0)
                cv2.rectangle(frame, (fx+ex, fy+ey), (fx+ex+ew, fy+ey+eh), color, 2)
                cv2.putText(frame, label.upper(), (fx+ex, fy+ey-5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)

            if len(eye_labels) > 0:
                # Require ALL detected eyes to be closed to prevent false alarms from a single misclassification
                if all(label == "closed" for label in eye_labels):
                    eye_status = "closed"
                else:
                    eye_status = "open"
            else:
                # Face detected, but eye cascade did not find eye regions. 
                # This almost always means the eyes are completely closed or looking away.
                # If shaking/moving fast, keep previous state to avoid false alarms.
                if is_shaking:
                    eye_status = state["eye_status"]
                else:
                    eye_status = "closed"
        else:
            # Fallback to cascade frame count heuristic:
            # If eyes are successfully detected by cascade -> OPEN
            # If face is detected but 0 eyes are found -> CLOSED
            if len(eyes) > 0:
                eye_status = "open"
                for (ex, ey, ew, eh) in eyes:
                    # Blue rect around open eye
                    cv2.rectangle(frame, (fx+ex, fy+ey), (fx+ex+ew, fy+ey+eh), (255, 0, 0), 2)
                    cv2.putText(frame, "OPEN", (fx+ex, fy+ey-5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 0, 0), 1)
            else:
                if is_shaking:
                    eye_status = state["eye_status"]
                else:
                    eye_status = "closed"

        # Break after processing the first detected face to optimize performance
        break
    else:
        state["prev_face_center"] = None

    # Closed frames counter: if eye closed, increment closed_frames. Else, reset to 0.
    if eye_status == "closed":
        state["closed_frames"] += 1
    else:
        state["closed_frames"] = 0

    # State updates
    # Drowsy when closed_frames >= 10, alarm when closed_frames >= 20 (or dynamic threshold)
    state["drowsy"] = state["closed_frames"] >= (state["threshold"] // 2)
    state["alarm"] = state["closed_frames"] >= state["threshold"]
    state["eye_status"] = eye_status
    state["frame_count"] += 1

    # Frame Annotation: Text "Eyes: OPEN/CLOSED" top left.
    text_color = (0, 0, 255) if eye_status == "closed" else (0, 255, 0)
    cv2.putText(frame, f"Eyes: {eye_status.upper()}", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, text_color, 2)

    # "DROWSINESS DETECTED!" in red when alarm
    # Red border (8px) around entire frame when alarm
    if state["alarm"]:
        cv2.putText(frame, "DROWSINESS DETECTED!", (10, 70), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 255), 3)
        cv2.rectangle(frame, (0, 0), (frame.shape[1], frame.shape[0]), (0, 0, 255), 8)

    return frame

# ── Endpoints ─────────────────────────────────────

@app.get("/")
def get_root():
    return {"message": "Drowsiness Detector API running"}

@app.get("/status")
def get_status():
    return {
        "eye_status": state["eye_status"],
        "drowsy": state["drowsy"],
        "alarm": state["alarm"],
        "closed_frames": state["closed_frames"],
        "frame_count": state["frame_count"],
        "threshold": state["threshold"]
    }

@app.post("/predict")
async def predict(file: UploadFile = File(...)):
    contents = await file.read()
    nparr = np.frombuffer(contents, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if frame is None:
        raise HTTPException(status_code=400, detail="Invalid or corrupt image file.")

    processed = process_frame(frame)
    _, buffer = cv2.imencode(".jpg", processed)
    img_b64 = base64.b64encode(buffer).decode("utf-8")

    return {
        "frame": img_b64,
        "eye_status": state["eye_status"],
        "drowsy": state["drowsy"],
        "alarm": state["alarm"],
        "closed_frames": state["closed_frames"],
        "frame_count": state["frame_count"],
        "threshold": state["threshold"]
    }

def generate_stream():
    stream_url = "http://192.168.1.5:8080/video"
    cap = cv2.VideoCapture(stream_url)
    
    if not cap.isOpened():
        print("Could not open IP Webcam stream at http://192.168.1.5:8080/video. Falling back to local camera (0)...")
        cap = cv2.VideoCapture(0)

    consecutive_failures = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            consecutive_failures += 1
            if consecutive_failures > 100:
                print("Failed to read frames from camera consecutively. Terminating camera stream.")
                break
            time.sleep(0.03)
            continue

        consecutive_failures = 0
        processed = process_frame(frame)
        _, buffer = cv2.imencode(".jpg", processed)
        
        yield (b"--frame\r\n"
               b"Content-Type: image/jpeg\r\n\r\n" + buffer.tobytes() + b"\r\n")
        
        # Target ~30 FPS
        time.sleep(0.033)

    cap.release()

@app.get("/stream")
def get_stream():
    return StreamingResponse(
        generate_stream(),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )

@app.put("/config")
def update_config(ear_frames: int = Query(20, description="Frames eye must stay closed to alarm")):
    state["threshold"] = ear_frames
    return {
        "message": "Configuration updated successfully",
        "threshold": state["threshold"]
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
