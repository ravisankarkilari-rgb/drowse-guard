"""
train_cnn.py — Train eye open/closed classifier for DrowseGuard
"""

import tensorflow as tf
from tensorflow.keras import layers, models
from tensorflow.keras.preprocessing.image import ImageDataGenerator
from tensorflow.keras.optimizers import Adam
from tensorflow.keras.callbacks import EarlyStopping, ReduceLROnPlateau, ModelCheckpoint
import matplotlib.pyplot as plt
import os
import sys

# ── Config ──────────────────────────────────────
# Make paths robust and independent of CWD
SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
DATASET_DIR  = os.path.abspath(os.path.join(SCRIPT_DIR, "../dataset_collector/dataset"))
MODEL_OUTPUT = os.path.abspath(os.path.join(SCRIPT_DIR, "../backend/eye_model.h5"))
IMG_SIZE     = (64, 64)
BATCH_SIZE   = 32
EPOCHS       = 20
# ────────────────────────────────────────────────

print(f"Dataset path: {DATASET_DIR}")
print(f"Model output path: {MODEL_OUTPUT}")

# Verify dataset directory exists and is populated
open_path = os.path.join(DATASET_DIR, "open")
closed_path = os.path.join(DATASET_DIR, "closed")

if not os.path.exists(open_path) or not os.path.exists(closed_path) or \
   len(os.listdir(open_path)) == 0 or len(os.listdir(closed_path)) == 0:
    print(f"\nError: Dataset directory must contain non-empty 'open' and 'closed' subdirectories.")
    print(f"Expected paths:\n  - {open_path}\n  - {closed_path}")
    print("Please collect eye crop images using the dataset collector first.")
    print("Exiting training script.")
    sys.exit(1)

# Ensure backend directory exists programmatically before saving model
os.makedirs(os.path.dirname(MODEL_OUTPUT), exist_ok=True)

print("Loading dataset and setting up ImageDataGenerator...")

# Sets up ImageDataGenerator with validation split of 0.2, rescale 1/255, and robust augmentation options
datagen = ImageDataGenerator(
    rescale=1.0 / 255.0,
    validation_split=0.2,
    rotation_range=10,
    zoom_range=0.1,
    horizontal_flip=True
)

# Load training images
train_data = datagen.flow_from_directory(
    DATASET_DIR,
    target_size=IMG_SIZE,
    color_mode="grayscale",
    batch_size=BATCH_SIZE,
    class_mode="binary",
    subset="training",
    shuffle=True
)

# Load validation images
val_data = datagen.flow_from_directory(
    DATASET_DIR,
    target_size=IMG_SIZE,
    color_mode="grayscale",
    batch_size=BATCH_SIZE,
    class_mode="binary",
    subset="validation",
    shuffle=False
)

print(f"Classes: {train_data.class_indices}")
print(f"Training samples: {train_data.samples}")
print(f"Validation samples: {val_data.samples}")

def build_model():
    model = models.Sequential([
        # Input layer (64x64, grayscale, single-channel)
        layers.Input(shape=(64, 64, 1)),
        
        # Conv block 1
        layers.Conv2D(32, (3, 3), activation="relu", padding="same"),
        layers.BatchNormalization(),
        layers.MaxPooling2D((2, 2)),
        layers.Dropout(0.25),
        
        # Conv block 2
        layers.Conv2D(64, (3, 3), activation="relu", padding="same"),
        layers.BatchNormalization(),
        layers.MaxPooling2D((2, 2)),
        layers.Dropout(0.25),
        
        # Conv block 3
        layers.Conv2D(128, (3, 3), activation="relu", padding="same"),
        layers.BatchNormalization(),
        layers.MaxPooling2D((2, 2)),
        layers.Dropout(0.4),
        
        # Classifier
        layers.Flatten(),
        layers.Dense(256, activation="relu"),
        layers.Dropout(0.5),
        layers.Dense(1, activation="sigmoid")
    ])
    return model

model = build_model()
model.summary()

# Compile with Adam(0.001) optimizer, binary cross-entropy loss, and accuracy metrics
model.compile(
    optimizer=Adam(learning_rate=0.001),
    loss="binary_crossentropy",
    metrics=["accuracy"]
)

# Callbacks: EarlyStopping, ReduceLROnPlateau, and ModelCheckpoint (best weight/model only)
callbacks = [
    EarlyStopping(monitor="val_loss", patience=5, restore_best_weights=True, verbose=1),
    ReduceLROnPlateau(monitor="val_loss", factor=0.5, patience=3, verbose=1),
    ModelCheckpoint(filepath=MODEL_OUTPUT, monitor="val_loss", save_best_only=True, verbose=1)
]

print("\nStarting CNN training...")
history = model.fit(
    train_data,
    validation_data=val_data,
    epochs=EPOCHS,
    callbacks=callbacks,
    verbose=1
)

# Plot training results performance curve: training vs validation accuracy and loss
plt.figure(figsize=(12, 5))

# Accuracy plot
plt.subplot(1, 2, 1)
plt.plot(history.history["accuracy"], label="Train Accuracy", color="#2c3e50", linewidth=2)
plt.plot(history.history["val_accuracy"], label="Val Accuracy", color="#e74c3c", linewidth=2)
plt.title("Training vs Validation Accuracy", fontsize=12, fontweight="bold")
plt.xlabel("Epochs")
plt.ylabel("Accuracy")
plt.legend(loc="lower right")
plt.grid(True, linestyle="--", alpha=0.6)

# Loss plot
plt.subplot(1, 2, 2)
plt.plot(history.history["loss"], label="Train Loss", color="#2c3e50", linewidth=2)
plt.plot(history.history["val_loss"], label="Val Loss", color="#e74c3c", linewidth=2)
plt.title("Training vs Validation Loss", fontsize=12, fontweight="bold")
plt.xlabel("Epochs")
plt.ylabel("Loss")
plt.legend(loc="upper right")
plt.grid(True, linestyle="--", alpha=0.6)

plt.tight_layout()
results_plot_path = os.path.join(SCRIPT_DIR, "training_results.png")
plt.savefig(results_plot_path, dpi=300)
plt.close()

print(f"\nTraining curve plot saved to: {results_plot_path}")
print(f"Model saved successfully to: {MODEL_OUTPUT}")

# Evaluate model and print final validation accuracy
val_loss, val_acc = model.evaluate(val_data, verbose=0)
print(f"\nFinal Validation Loss: {val_loss:.4f}")
print(f"Final Validation Accuracy: {val_acc * 100:.2f}%")
