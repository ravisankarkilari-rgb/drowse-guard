"""
collect_dataset.py — Collect real-time eye images from phone camera / webcam
Controls:
  O → save as OPEN eye
  C → save as CLOSED eye
  Q → quit
"""

import cv2
import os
import sys

PHONE_IP = "192.168.1.5"   # Change to your phone IP
PORT     = "8080"
IMG_SIZE = (64, 64)

# Get current file directory
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SAVE_DIR   = os.path.join(SCRIPT_DIR, "dataset")

open_dir   = os.path.join(SAVE_DIR, "open")
closed_dir = os.path.join(SAVE_DIR, "closed")

# Ensure dataset directories are created programmatically
os.makedirs(open_dir,   exist_ok=True)
os.makedirs(closed_dir, exist_ok=True)

# Haar Cascade classifiers
face_cascade = cv2.CascadeClassifier(
    cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
eye_cascade  = cv2.CascadeClassifier(
    cv2.data.haarcascades + "haarcascade_eye.xml")

if face_cascade.empty() or eye_cascade.empty():
    print("Error: Could not load OpenCV Haar Cascades.")
    sys.exit(1)

def is_stream_reachable(url: str, timeout: float = 0.5) -> bool:
    """
    Quickly checks if a stream URL is reachable via socket connection to bypass
    OpenCV's extremely long blocking network timeouts.
    """
    import socket
    from urllib.parse import urlparse
    try:
        parsed = urlparse(url)
        host = parsed.hostname
        port = parsed.port or (80 if parsed.scheme == 'http' else 443)
        if not host:
            return False
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except Exception:
        return False

stream_url = f"http://{PHONE_IP}:{PORT}/video"
if is_stream_reachable(stream_url, timeout=0.5):
    print(f"Connecting to IP Webcam stream URL: {stream_url}")
    cap = cv2.VideoCapture(stream_url)
else:
    print(f"IP Webcam stream unreachable or offline. Falling back instantly to default webcam (cv2.VideoCapture(0))...")
    cap = cv2.VideoCapture(0)

if not cap.isOpened():
    print("Error: Could not access webcam or phone camera stream.")
    sys.exit(1)

open_count = 0
closed_count = 0

# Count existing images in directories to avoid overwriting and start sequential counts
if os.path.exists(open_dir):
    existing_open = [f for f in os.listdir(open_dir) if f.startswith("open_") and f.endswith(".jpg")]
    if existing_open:
        try:
            open_count = max([int(f.split("_")[1].split(".")[0]) for f in existing_open]) + 1
        except Exception:
            open_count = len(existing_open)

if os.path.exists(closed_dir):
    existing_closed = [f for f in os.listdir(closed_dir) if f.startswith("closed_") and f.endswith(".jpg")]
    if existing_closed:
        try:
            closed_count = max([int(f.split("_")[1].split(".")[0]) for f in existing_closed]) + 1
        except Exception:
            closed_count = len(existing_closed)

print(f"Initial counts loaded: Open: {open_count}, Closed: {closed_count}")
print("Controls:")
print("  Press 'O' or 'o' to save crop as OPEN eye")
print("  Press 'C' or 'c' to save crop as CLOSED eye")
print("  Press 'Q' or 'q' to quit")

while True:
    ret, frame = cap.read()
    if not ret:
        print("Error: Failed to grab frame.")
        break

    # Convert to grayscale
    gray  = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    
    # Preprocess frames with CLAHE (clipLimit=2.0, tileGridSize=(8,8))
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray  = clahe.apply(gray)
    
    # Haar face detection
    faces = face_cascade.detectMultiScale(gray, scaleFactor=1.3, minNeighbors=5, minSize=(80, 80))
    eye_crop = None

    for (fx, fy, fw, fh) in faces:
        # Draw face overlay box
        cv2.rectangle(frame, (fx, fy), (fx+fw, fy+fh), (0, 255, 0), 2)
        
        roi_gray = gray[fy:fy+fh, fx:fx+fw]
        # Detect eyes within the face ROI
        eyes = eye_cascade.detectMultiScale(roi_gray, scaleFactor=1.1, minNeighbors=10, minSize=(20, 20))
        
        for (ex, ey, ew, eh) in eyes[:1]: # crop at least one eye
            if ew > 0 and eh > 0:
                # Crop and resize to 64x64 grayscale
                eye_crop = cv2.resize(roi_gray[ey:ey+eh, ex:ex+ew], IMG_SIZE)
                
                # Draw eye overlay box
                cv2.rectangle(frame,
                    (fx+ex, fy+ey), (fx+ex+ew, fy+ey+eh), (255, 0, 0), 2)
        break # Process the first face detected

    # Display counts and controls on screen
    cv2.putText(frame, f"Open: {open_count}  Closed: {closed_count}",
        (15, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2)
    cv2.putText(frame, "O: Save Open | C: Save Closed | Q: Quit",
        (15, 65), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
    
    # Display the crop preview if available
    if eye_crop is not None:
        h_f, w_f, _ = frame.shape
        preview_sz = 100
        
        # Ensure frame is large enough for the preview
        if h_f > preview_sz + 35 and w_f > preview_sz + 20:
            # Resize crop for better visibility in preview
            preview_eye = cv2.resize(eye_crop, (preview_sz, preview_sz))
            preview_eye_color = cv2.cvtColor(preview_eye, cv2.COLOR_GRAY2BGR)
            
            # Place preview at top right corner
            frame[10:10+preview_sz, w_f - preview_sz - 10: w_f - 10] = preview_eye_color
            cv2.rectangle(frame, (w_f - preview_sz - 10, 10), (w_f - 10, 10+preview_sz), (0, 255, 255), 1)
            cv2.putText(frame, "Crop Preview", (w_f - preview_sz - 10, 125), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 255), 1)

    cv2.imshow("DrowseGuard Dataset Collector", frame)

    key = cv2.waitKey(1) & 0xFF
    if key in (ord('o'), ord('O')) and eye_crop is not None:
        filename = f"open_{open_count:04d}.jpg"
        cv2.imwrite(os.path.join(open_dir, filename), eye_crop)
        print(f"Saved open crop to {os.path.join(open_dir, filename)}")
        open_count += 1
    elif key in (ord('c'), ord('C')) and eye_crop is not None:
        filename = f"closed_{closed_count:04d}.jpg"
        cv2.imwrite(os.path.join(closed_dir, filename), eye_crop)
        print(f"Saved closed crop to {os.path.join(closed_dir, filename)}")
        closed_count += 1
    elif key in (ord('q'), ord('Q')):
        print("Exit key pressed.")
        break

cap.release()
cv2.destroyAllWindows()
print(f"\nFinal captured counts:")
print(f"  Open: {open_count}")
print(f"  Closed: {closed_count}")
