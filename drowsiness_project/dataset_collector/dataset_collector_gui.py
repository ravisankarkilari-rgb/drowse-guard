import cv2
import os
import sys
import customtkinter as ctk
from PIL import Image

# Configuration
PHONE_IP = "192.168.1.5"
PORT     = "8080"
IMG_SIZE = (64, 64)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SAVE_DIR   = os.path.join(SCRIPT_DIR, "dataset")
open_dir   = os.path.join(SAVE_DIR, "open")
closed_dir = os.path.join(SAVE_DIR, "closed")

os.makedirs(open_dir,   exist_ok=True)
os.makedirs(closed_dir, exist_ok=True)

# Haar Cascade classifiers
face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
eye_cascade  = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_eye.xml")

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


class DatasetCollectorApp(ctk.CTk):
    def __init__(self):
        super().__init__()

        self.title("DrowseGuard Dataset Collector")
        self.geometry("900x600")
        self.protocol("WM_DELETE_WINDOW", self.on_closing)

        # Variables
        self.cap = None
        self.stream_url = ctk.StringVar(value=f"http://{PHONE_IP}:{PORT}/video")
        self.open_count = self.get_initial_count(open_dir, "open_")
        self.closed_count = self.get_initial_count(closed_dir, "closed_")
        self.current_eye_crop = None
        self.is_running = False

        self.setup_ui()
        self.bind("<Key>", self.handle_keypress)

    def get_initial_count(self, directory, prefix):
        if not os.path.exists(directory):
            return 0
        files = [f for f in os.listdir(directory) if f.startswith(prefix) and f.endswith(".jpg")]
        if not files:
            return 0
        try:
            return max([int(f.split("_")[1].split(".")[0]) for f in files]) + 1
        except Exception:
            return len(files)

    def setup_ui(self):
        # Configure layout
        self.grid_columnconfigure(0, weight=1)  # Video feed gets more space
        self.grid_columnconfigure(1, weight=0, minsize=300) # Sidebar
        self.grid_rowconfigure(0, weight=1)

        # --- Video Frame ---
        self.video_frame = ctk.CTkFrame(self, corner_radius=10)
        self.video_frame.grid(row=0, column=0, padx=20, pady=20, sticky="nsew")
        self.video_frame.grid_rowconfigure(0, weight=1)
        self.video_frame.grid_columnconfigure(0, weight=1)

        self.video_label = ctk.CTkLabel(self.video_frame, text="Camera starting...")
        self.video_label.grid(row=0, column=0)

        # --- Sidebar ---
        self.sidebar_frame = ctk.CTkFrame(self, corner_radius=10)
        self.sidebar_frame.grid(row=0, column=1, padx=(0, 20), pady=20, sticky="nsew")

        self.logo_label = ctk.CTkLabel(self.sidebar_frame, text="Dataset Collector", font=ctk.CTkFont(size=20, weight="bold"))
        self.logo_label.grid(row=0, column=0, padx=20, pady=(20, 10))

        # URL Input
        self.url_label = ctk.CTkLabel(self.sidebar_frame, text="IP Camera URL:")
        self.url_label.grid(row=1, column=0, padx=20, pady=(10, 0), sticky="w")
        
        self.url_entry = ctk.CTkEntry(self.sidebar_frame, textvariable=self.stream_url)
        self.url_entry.grid(row=2, column=0, padx=20, pady=(0, 10), sticky="ew")

        self.connect_btn = ctk.CTkButton(self.sidebar_frame, text="Connect Camera", command=self.start_camera)
        self.connect_btn.grid(row=3, column=0, padx=20, pady=10, sticky="ew")

        # Stats
        self.stats_frame = ctk.CTkFrame(self.sidebar_frame, fg_color="transparent")
        self.stats_frame.grid(row=4, column=0, padx=20, pady=20, sticky="ew")
        
        self.open_lbl = ctk.CTkLabel(self.stats_frame, text=f"Open Eyes: {self.open_count}", font=ctk.CTkFont(size=16))
        self.open_lbl.grid(row=0, column=0, pady=5, sticky="w")
        
        self.closed_lbl = ctk.CTkLabel(self.stats_frame, text=f"Closed Eyes: {self.closed_count}", font=ctk.CTkFont(size=16))
        self.closed_lbl.grid(row=1, column=0, pady=5, sticky="w")

        # Controls
        self.btn_open = ctk.CTkButton(self.sidebar_frame, text="Save Open (O)", fg_color="#28a745", hover_color="#218838", height=50, command=self.save_open)
        self.btn_open.grid(row=5, column=0, padx=20, pady=(20, 10), sticky="ew")

        self.btn_closed = ctk.CTkButton(self.sidebar_frame, text="Save Closed (C)", fg_color="#dc3545", hover_color="#c82333", height=50, command=self.save_closed)
        self.btn_closed.grid(row=6, column=0, padx=20, pady=10, sticky="ew")

        # Crop Preview
        self.preview_label_title = ctk.CTkLabel(self.sidebar_frame, text="Last Crop Preview:")
        self.preview_label_title.grid(row=7, column=0, padx=20, pady=(20, 0), sticky="w")
        
        self.preview_label = ctk.CTkLabel(self.sidebar_frame, text="No crop yet", width=100, height=100, fg_color="gray20", corner_radius=10)
        self.preview_label.grid(row=8, column=0, padx=20, pady=10)

        # Start camera initially
        self.after(500, self.start_camera)

    def start_camera(self):
        if self.cap is not None:
            self.cap.release()
            self.is_running = False

        url = self.stream_url.get().strip()
        
        # Fast reachability pre-check to prevent blocking OpenCV timeout
        if is_stream_reachable(url, timeout=0.5):
            print(f"Connecting to IP Webcam stream URL: {url}")
            self.cap = cv2.VideoCapture(url)
        else:
            print(f"IP Webcam stream unreachable or offline. Falling back instantly to default webcam (0)...")
            self.cap = cv2.VideoCapture(0)

        if not self.cap.isOpened():
            self.video_label.configure(text="Error: Could not access any camera.")
            return

        self.is_running = True
        self.update_frame()

    def update_frame(self):
        if not self.is_running or self.cap is None:
            return

        ret, frame = self.cap.read()
        if not ret:
            self.video_label.configure(text="Camera disconnected.")
            self.is_running = False
            return

        # Preprocess
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        gray = clahe.apply(gray)
        
        faces = face_cascade.detectMultiScale(gray, scaleFactor=1.3, minNeighbors=5, minSize=(80, 80))
        self.current_eye_crop = None

        for (fx, fy, fw, fh) in faces:
            cv2.rectangle(frame, (fx, fy), (fx+fw, fy+fh), (0, 255, 0), 2)
            roi_gray = gray[fy:fy+fh, fx:fx+fw]
            eyes = eye_cascade.detectMultiScale(roi_gray, scaleFactor=1.1, minNeighbors=10, minSize=(20, 20))
            
            for (ex, ey, ew, eh) in eyes[:1]:
                if ew > 0 and eh > 0:
                    self.current_eye_crop = cv2.resize(roi_gray[ey:ey+eh, ex:ex+ew], IMG_SIZE)
                    cv2.rectangle(frame, (fx+ex, fy+ey), (fx+ex+ew, fy+ey+eh), (255, 0, 0), 2)
            break

        # Convert frame to display in Tkinter
        # OpenCV uses BGR, we need RGB
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        
        # Resize frame to fit the UI nicely (e.g., width 500)
        h, w, _ = rgb_frame.shape
        new_w = 600
        new_h = int(h * (new_w / w))
        rgb_frame = cv2.resize(rgb_frame, (new_w, new_h))
        
        img = Image.fromarray(rgb_frame)
        ctk_img = ctk.CTkImage(light_image=img, dark_image=img, size=(new_w, new_h))
        
        self.video_label.configure(image=ctk_img, text="")
        self.video_label.image = ctk_img

        # Loop
        self.after(20, self.update_frame)

    def save_open(self):
        if self.current_eye_crop is not None:
            filename = f"open_{self.open_count:04d}.jpg"
            cv2.imwrite(os.path.join(open_dir, filename), self.current_eye_crop)
            self.open_count += 1
            self.open_lbl.configure(text=f"Open Eyes: {self.open_count}")
            self.update_preview()
            print(f"Saved {filename}")

    def save_closed(self):
        if self.current_eye_crop is not None:
            filename = f"closed_{self.closed_count:04d}.jpg"
            cv2.imwrite(os.path.join(closed_dir, filename), self.current_eye_crop)
            self.closed_count += 1
            self.closed_lbl.configure(text=f"Closed Eyes: {self.closed_count}")
            self.update_preview()
            print(f"Saved {filename}")

    def update_preview(self):
        if self.current_eye_crop is not None:
            preview = cv2.resize(self.current_eye_crop, (100, 100))
            preview_rgb = cv2.cvtColor(preview, cv2.COLOR_GRAY2RGB)
            img = Image.fromarray(preview_rgb)
            ctk_img = ctk.CTkImage(light_image=img, dark_image=img, size=(100, 100))
            self.preview_label.configure(image=ctk_img, text="")
            self.preview_label.image = ctk_img

    def handle_keypress(self, event):
        key = event.char.lower()
        if key == 'o':
            self.save_open()
        elif key == 'c':
            self.save_closed()
        elif key == 'q':
            self.on_closing()

    def on_closing(self):
        self.is_running = False
        if self.cap is not None:
            self.cap.release()
        self.destroy()

if __name__ == "__main__":
    ctk.set_appearance_mode("dark")
    ctk.set_default_color_theme("blue")
    app = DatasetCollectorApp()
    app.mainloop()
