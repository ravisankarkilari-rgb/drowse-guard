import cv2
import os
import glob
import numpy as np
import tensorflow as tf

def preprocess_eye(eye_img, model=None):
    resized = cv2.resize(eye_img, (64, 64))
    
    channels = 1
    if model is not None:
        try:
            input_shape = model.input_shape
            if input_shape is not None and len(input_shape) == 4:
                channels = input_shape[-1]
        except:
            pass
            
    if channels == 3:
        preprocess_input = tf.keras.applications.mobilenet_v2.preprocess_input
        color_img = cv2.cvtColor(resized, cv2.COLOR_GRAY2BGR)
        processed = preprocess_input(color_img.astype(np.float32))
        processed = np.expand_dims(processed, axis=0)
    else:
        normalized = resized / 255.0
        if len(normalized.shape) == 2:
            normalized = np.expand_dims(normalized, axis=-1)
        processed = np.expand_dims(normalized, axis=0)
        
    return processed, resized

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    dataset_dir = os.path.join(script_dir, "dataset")
    open_dir = os.path.join(dataset_dir, "open")
    closed_dir = os.path.join(dataset_dir, "closed")
    
    os.makedirs(open_dir, exist_ok=True)
    os.makedirs(closed_dir, exist_ok=True)
    
    # Get current counts to avoid overwriting
    def get_max_count(folder, prefix):
        files = [f for f in os.listdir(folder) if f.startswith(prefix) and f.endswith(".jpg")]
        if not files: return 0
        try:
            return max([int(f.split("_")[1].split(".")[0]) for f in files]) + 1
        except:
            return len(files)
            
    open_count = get_max_count(open_dir, "open_")
    closed_count = get_max_count(closed_dir, "closed_")

    # Load Cascades
    face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    eye_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_eye.xml")
    
    # Load Model from backend to auto-classify
    model_path = os.path.join(script_dir, "..", "backend", "eye_model.h5")
    model = None
    if os.path.exists(model_path):
        model = tf.keras.models.load_model(model_path)
        print(f"Loaded model from {model_path} for auto-labeling")
    else:
        print("Model not found. Will default to saving all unknown eyes to 'closed' for review.")

    image_paths = glob.glob(os.path.join(script_dir, "temp_dataset_images", "*.png"))
    
    for img_path in image_paths:
        print(f"Processing {os.path.basename(img_path)}...")
        frame = cv2.imread(img_path)
        if frame is None: continue
        
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        gray = clahe.apply(gray)
        
        faces = face_cascade.detectMultiScale(gray, scaleFactor=1.2, minNeighbors=4, minSize=(60, 60))
        
        for (fx, fy, fw, fh) in faces:
            roi_gray = gray[fy:fy+fh, fx:fx+fw]
            eyes = eye_cascade.detectMultiScale(roi_gray, scaleFactor=1.1, minNeighbors=8)
            
            eye_crops = []
            
            if len(eyes) > 0:
                # Use detected eyes
                for (ex, ey, ew, eh) in eyes[:2]:
                    eye_crops.append(roi_gray[ey:ey+eh, ex:ex+ew])
            else:
                # Geometric fallback if eyes not found (likely closed)
                # Upper half of face, divided into left and right
                top_offset = int(fh * 0.2)
                bottom_offset = int(fh * 0.5)
                
                # Left eye
                left_ex, left_ew = int(fw * 0.15), int(fw * 0.35)
                eye_crops.append(roi_gray[top_offset:bottom_offset, left_ex:left_ex+left_ew])
                
                # Right eye
                right_ex, right_ew = int(fw * 0.5), int(fw * 0.35)
                eye_crops.append(roi_gray[top_offset:bottom_offset, right_ex:right_ex+right_ew])
                
            for eye_crop in eye_crops:
                if eye_crop.shape[0] < 10 or eye_crop.shape[1] < 10:
                    continue
                    
                processed, resized = preprocess_eye(eye_crop, model)
                
                label = "closed"
                if model is not None:
                    pred = model.predict(processed, verbose=0)[0][0]
                    label = "closed" if pred < 0.5 else "open"
                
                if label == "open":
                    filename = f"open_{open_count:04d}.jpg"
                    cv2.imwrite(os.path.join(open_dir, filename), resized)
                    open_count += 1
                else:
                    filename = f"closed_{closed_count:04d}.jpg"
                    cv2.imwrite(os.path.join(closed_dir, filename), resized)
                    closed_count += 1
                    
    print(f"Extraction complete. New Open eyes: {open_count}, New Closed eyes: {closed_count}")

if __name__ == "__main__":
    main()
