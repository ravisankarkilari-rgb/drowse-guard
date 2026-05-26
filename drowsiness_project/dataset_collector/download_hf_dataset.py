import os
import cv2
import numpy as np
from datasets import load_dataset

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SAVE_DIR   = os.path.join(SCRIPT_DIR, "dataset")

open_dir   = os.path.join(SAVE_DIR, "open")
closed_dir = os.path.join(SAVE_DIR, "closed")

os.makedirs(open_dir,   exist_ok=True)
os.makedirs(closed_dir, exist_ok=True)

face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
eye_cascade  = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_eye.xml")

print("Downloading dataset from HuggingFace...")
dataset = load_dataset("MichalMlodawski/closed-open-eyes", split="train")

open_count = 0
closed_count = 0
max_per_class = 1000

print(f"Total samples in dataset: {len(dataset)}")

for item in dataset:
    # Stop if we have enough
    if open_count >= max_per_class and closed_count >= max_per_class:
        break

    label = item.get("Label", "").lower()
    
    # Check where the image data is located
    img_data = item.get("Image_data", {})
    if isinstance(img_data, dict) and "file" in img_data:
        pil_img = img_data["file"]
    else:
        # Fallback if structure is different
        pil_img = item.get("Image", None) or img_data

    if pil_img is None:
        continue

    img_arr = np.array(pil_img)
    if len(img_arr.shape) == 3:
        img_arr = cv2.cvtColor(img_arr, cv2.COLOR_RGB2BGR)
        gray = cv2.cvtColor(img_arr, cv2.COLOR_BGR2GRAY)
    else:
        gray = img_arr

    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)

    faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30))
    eye_crop = None
    
    for (fx, fy, fw, fh) in faces:
        roi_gray = gray[fy:fy+fh, fx:fx+fw]
        eyes = eye_cascade.detectMultiScale(roi_gray, scaleFactor=1.1, minNeighbors=5, minSize=(10, 10))
        for (ex, ey, ew, eh) in eyes[:1]:
            if ew > 0 and eh > 0:
                eye_crop = cv2.resize(roi_gray[ey:ey+eh, ex:ex+ew], (64, 64))
        if eye_crop is not None:
            break

    if eye_crop is None:
        continue

    if "open" in label and open_count < max_per_class:
        filename = f"open_{open_count:04d}.jpg"
        cv2.imwrite(os.path.join(open_dir, filename), eye_crop)
        open_count += 1
    elif "close" in label and closed_count < max_per_class:
        filename = f"closed_{closed_count:04d}.jpg"
        cv2.imwrite(os.path.join(closed_dir, filename), eye_crop)
        closed_count += 1

print(f"Download complete!")
print(f"Saved {open_count} open eyes to {open_dir}")
print(f"Saved {closed_count} closed eyes to {closed_dir}")
