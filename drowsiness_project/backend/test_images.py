import cv2
import glob
import os
from main import process_frame, state

def test_images():
    image_paths = glob.glob("../dataset_collector/temp_dataset_images/*.png")
    os.makedirs("output_images", exist_ok=True)
    
    for path in image_paths:
        print(f"\nProcessing {path}...")
        frame = cv2.imread(path)
        if frame is None:
            print(f"Could not read {path}")
            continue
            
        # We need to process the frame a few times to trigger the 'drowsiness' threshold
        # Since the threshold is 3 frames, we'll process it 4 times.
        out_frame = None
        for i in range(4):
            out_frame = process_frame(frame.copy())
            
        out_path = f"output_images/out_{os.path.basename(path)}"
        cv2.imwrite(out_path, out_frame)
        
        print(f"Result for {os.path.basename(path)}:")
        print(f"  Eye Status: {state['eye_status']}")
        print(f"  Drowsy: {state['drowsy']}")
        print(f"  Alarm: {state['alarm']}")
        print(f"  Output saved to {out_path}")
        
        # Reset state for next image
        state["closed_frames"] = 0
        state["eye_status"] = "unknown"
        state["drowsy"] = False
        state["alarm"] = False
        state["prev_face_center"] = None

if __name__ == "__main__":
    test_images()
