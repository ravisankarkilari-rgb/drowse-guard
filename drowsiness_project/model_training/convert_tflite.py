import tensorflow as tf
import os
import shutil

# Paths
base_dir = os.path.dirname(os.path.abspath(__file__))
model_path = os.path.join(base_dir, "../backend/eye_model.h5")
tflite_path = os.path.join(base_dir, "eye_model.tflite")
assets_path = os.path.join(base_dir, "../mobile/assets/eye_model.tflite")

print(f"Loading model from {model_path}...")
model = tf.keras.models.load_model(model_path)

print("Converting to TensorFlow Lite...")
converter = tf.lite.TFLiteConverter.from_keras_model(model)
# Optimize for size and latency
converter.optimizations = [tf.lite.Optimize.DEFAULT]
tflite_model = converter.convert()

print(f"Saving TFLite model to {tflite_path}...")
with open(tflite_path, "wb") as f:
    f.write(tflite_model)

print(f"Copying to mobile assets: {assets_path}...")
os.makedirs(os.path.dirname(assets_path), exist_ok=True)
shutil.copy(tflite_path, assets_path)

print("Conversion complete! The TFLite model is ready for Edge AI.")
