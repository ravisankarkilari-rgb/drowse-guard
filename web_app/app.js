/* DrowseGuard Web — High-Performance real-time Edge AI Logic */

import { FilesetResolver, FaceLandmarker } from "./vision_bundle.js";

// Global state variables
let faceLandmarker = null;
let webcamStream = null;
let isMonitoring = false;
let lastVideoTime = -1;

// Calibrated defaults
let earThreshold = 0.25;
let alarmDelaySeconds = 0.8;

// Safety & Warning variables
let closedStartTime = null;
let alertCount = 0;
let earHistory = new Array(100).fill(0.35); // Seed history chart data
let earHistoryList = []; // Rolling array of raw EAR values for dynamic adaptive thresholding

// Web Audio API Synthetic Alarm state variables
let audioCtx = null;
let osc = null;
let gainNode = null;
let sirenInterval = null;

// DOM Elements
const video = document.getElementById("webcam");
const canvasElement = document.getElementById("canvas-overlay");
const canvasCtx = canvasElement.getContext("2d");
const chartCanvas = document.getElementById("chart-realtime");
const chartCtx = chartCanvas.getContext("2d");

const btnToggleMonitor = document.getElementById("btn-toggle-monitor");
const statusPill = document.getElementById("status-pill");
const pulseIndicator = document.querySelector(".pulse-indicator");
const cameraPlaceholder = document.getElementById("camera-placeholder");
const alarmOverlay = document.getElementById("alarm-overlay");
const alarmAudio = document.getElementById("audio-alarm");

// Metrics Outputs
const txtEyeStatus = document.getElementById("txt-eye-status");
const txtEarVal = document.getElementById("txt-ear-val");
const txtClosedDuration = document.getElementById("txt-closed-duration");
const txtAlertCount = document.getElementById("txt-alert-count");

// Calibration Slider Inputs
const rangeEarThreshold = document.getElementById("range-ear-threshold");
const valEarThreshold = document.getElementById("val-ear-threshold");
const rangeClosedTime = document.getElementById("range-closed-time");
const valClosedTime = document.getElementById("val-closed-time");

// ── 1. Initialize calibration controls ──────────────────
rangeEarThreshold.addEventListener("input", (e) => {
  earThreshold = parseFloat(e.target.value);
  valEarThreshold.innerText = earThreshold.toFixed(2);
});

rangeClosedTime.addEventListener("input", (e) => {
  alarmDelaySeconds = parseFloat(e.target.value);
  valClosedTime.innerText = alarmDelaySeconds.toFixed(1) + "s";
});

// ── 2. Load Google MediaPipe Model ──────────────────────
async function initMediaPipe() {
  statusPill.innerText = "LOADING MODEL...";
  try {
    // Robust WebAssembly fileset resolution: try relative first, fallback to origin-based absolute
    let vision;
    try {
      vision = await FilesetResolver.forVisionTasks("./wasm");
    } catch (e) {
      console.warn("Failed relative WASM load, falling back to absolute origin:", e);
      vision = await FilesetResolver.forVisionTasks(window.location.origin + "/wasm");
    }
    
    // Load optimized face landmarker task with automatic CPU and CDN fallbacks
    try {
      faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "./face_landmarker.task",
          delegate: "GPU"
        },
        runningMode: "VIDEO",
        numFaces: 1
      });
    } catch (gpuError) {
      console.warn("GPU delegation or local load failed. Retrying with CPU and CDN model fallback...", gpuError);
      try {
        faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
            delegate: "CPU"
          },
          runningMode: "VIDEO",
          numFaces: 1
        });
      } catch (cdnCpuError) {
        console.warn("CDN CPU fallback failed. Trying local task with CPU delegate...", cdnCpuError);
        faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "./face_landmarker.task",
            delegate: "CPU"
          },
          runningMode: "VIDEO",
          numFaces: 1
        });
      }
    }
    
    console.log("MediaPipe Model Loaded Successfully!");
    statusPill.innerText = "SYSTEM READY";
    statusPill.classList.remove("pill-offline");
    statusPill.classList.add("pill-online");
  } catch (error) {
    console.error("Failed to load MediaPipe Model:", error);
    statusPill.innerText = "MODEL ERROR";
    statusPill.classList.add("pill-offline");
    
    // Inject a prominent debug container directly onto the webpage to expose the exact stack trace
    const errorBanner = document.createElement("div");
    errorBanner.id = "model-debug-overlay";
    errorBanner.style.cssText = "position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: rgba(239, 68, 68, 0.95); color: white; padding: 20px; border-radius: 12px; z-index: 10000; font-family: 'Inter', sans-serif; font-size: 14px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); max-width: 90%; width: 600px; backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.2);";
    errorBanner.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 8px; font-size: 16px; display: flex; align-items: center; gap: 8px;">
        <span>🚨</span> MediaPipe Initialization Failed
      </div>
      <div style="background: rgba(0,0,0,0.25); padding: 12px; border-radius: 6px; font-family: monospace; font-size: 12px; overflow-x: auto; white-space: pre-wrap; line-height: 1.5; max-height: 200px; overflow-y: auto;">
        ${error.stack || error.message || error}
      </div>
      <div style="margin-top: 10px; font-size: 11px; opacity: 0.85; text-align: right;">
        Please copy this trace to help us fix the issue!
      </div>
    `;
    document.body.appendChild(errorBanner);
  }
}

// Initialize on load
initMediaPipe();

// Helper to unlock Web Audio API on mobile user interaction
function unlockAudioContext() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    
    // Play an ultra-short silence buffer to satisfy browser restrictions
    const buffer = audioCtx.createBuffer(1, 1, 22050);
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.start(0);
    console.log("AudioContext successfully unlocked/resumed.");
  } catch (e) {
    console.warn("Web Audio unlock failed:", e);
  }
}

// ── 3. Toggle webcam and tracking ───────────────────────
btnToggleMonitor.addEventListener("click", async () => {
  if (!faceLandmarker) {
    alert("Please wait, the MediaPipe AI model is still loading.");
    return;
  }

  // CRITICAL MOBILE CHROME UNLOCK: Unlock both Web Audio API & HTML5 audio synchronously here
  unlockAudioContext();
  try {
    alarmAudio.play().then(() => {
      alarmAudio.pause();
      alarmAudio.currentTime = 0;
    }).catch(e => console.log("HTML5 audio pre-unlock allowed:", e));
  } catch (e) {
    console.warn("HTML5 pre-unlock error:", e);
  }

  if (isMonitoring) {
    stopMonitoring();
  } else {
    await startMonitoring();
  }
});

async function startMonitoring() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Webcam access is not supported by your browser or requires a secure connection (HTTPS).");
    }

    // Capture user's webcam feed safely
    webcamStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: "user"
      }
    });
    
    video.srcObject = webcamStream;

    // Explicitly call play to bypass strict browser autoplay locks
    video.play().then(() => {
      console.log("Webcam feed playing successfully!");
    }).catch(err => {
      console.warn("Explicit play failed or was delayed:", err);
    });
    
    if (video.readyState >= 1) {
      onVideoLoaded();
    } else {
      video.addEventListener("loadedmetadata", onVideoLoaded);
    }
    
    btnToggleMonitor.innerText = "Stop Monitoring";
    btnToggleMonitor.classList.remove("btn-primary-start");
    btnToggleMonitor.classList.add("btn-danger-stop");
    
    pulseIndicator.classList.add("pulsing");
    cameraPlaceholder.style.display = "none";
    
    isMonitoring = true;
    closedStartTime = null;
    
    // Play a brief silent sound to unlock audio context on mobile/Safari
    alarmAudio.play().then(() => {
      alarmAudio.pause();
      alarmAudio.currentTime = 0;
    }).catch(e => console.log("Audio Context Locked initially:", e));

  } catch (error) {
    console.error("Webcam access failed:", error);
    alert(`Could not access your camera: ${error.message || error}\nPlease ensure camera permissions are granted and you are using a secure connection (HTTPS).`);
  }
}

function stopMonitoring() {
  if (webcamStream) {
    webcamStream.getTracks().forEach(track => track.stop());
  }
  
  video.srcObject = null;
  video.removeEventListener("loadedmetadata", onVideoLoaded);
  
  btnToggleMonitor.innerText = "Start Monitoring";
  btnToggleMonitor.classList.remove("btn-danger-stop");
  btnToggleMonitor.classList.add("btn-primary-start");
  
  pulseIndicator.classList.remove("pulsing");
  cameraPlaceholder.style.display = "flex";
  alarmOverlay.style.display = "none";
  alarmAudio.pause();
  alarmAudio.currentTime = 0;
  stopSyntheticAlarm();
  
  // Reset metrics
  txtEyeStatus.innerText = "UNKNOWN";
  txtEyeStatus.className = "card-val";
  txtEarVal.innerText = "0.00";
  txtClosedDuration.innerText = "0.0s";
  
  isMonitoring = false;
  closedStartTime = null;
  
  // Clear canvases
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
}

function onVideoLoaded() {
  video.removeEventListener("loadedmetadata", onVideoLoaded);
  canvasElement.width = video.videoWidth;
  canvasElement.height = video.videoHeight;
  
  // Start the frame loop
  requestAnimationFrame(renderLoop);
}

// ── 4. Main Frame-by-Frame Loop ────────────────────────
async function renderLoop() {
  if (!isMonitoring) return;

  // Render webcam stream overlay if frame is ready
  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    
    try {
      // Clear overlay
      canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
      
      // Run Face Landmark Detection
      const startTimeMs = Date.now();
      const results = faceLandmarker.detectForVideo(video, startTimeMs);
      
      if (results.faceLandmarks && results.faceLandmarks.length > 0) {
        const landmarks = results.faceLandmarks[0];
        
        // Calculate EAR for both eyes
        const ear = calculateAverageEAR(landmarks);
        
        // Update values
        txtEarVal.innerText = ear.toFixed(2);
        earHistory.push(ear);
        earHistory.shift(); // keep sliding queue of 100 samples
        
        // Draw facial overlay tracking indicators
        drawTrackingMesh(landmarks, ear);
        
        // Drowsiness Detection Logic
        evaluateDrowsiness(ear);
      } else {
        txtEyeStatus.innerText = "NO FACE DETECTED";
        txtEyeStatus.className = "card-val txt-red";
        closedStartTime = null;
        txtClosedDuration.innerText = "0.0s";
        
        // Hide alarm overlay and stop sounds immediately if face is lost
        if (alarmOverlay.style.display === "flex") {
          alarmOverlay.style.display = "none";
        }
        alarmAudio.pause();
        alarmAudio.currentTime = 0;
        stopSyntheticAlarm();
      }
    } catch (err) {
      console.error("Frame processing error:", err);
    }
  }

  // Draw real-time history line graph
  drawHistoryChart();

  // Recursively loop on next browser refresh
  requestAnimationFrame(renderLoop);
}

// ── 5. Mathematical EAR Formula ─────────────────────────
function distance2D(p1, p2) {
  return Math.sqrt(
    Math.pow(p1.x - p2.x, 2) +
    Math.pow(p1.y - p2.y, 2)
  );
}

function calculateAverageEAR(landmarks) {
  // Left Eye Landmarks:
  // Vertical center [159, 145], vertical left [160, 153], vertical right [158, 144]
  // Horizontal corner-to-corner [33, 133]
  const dLeftVertical1 = distance2D(landmarks[159], landmarks[145]);
  const dLeftVertical2 = distance2D(landmarks[160], landmarks[153]);
  const dLeftVertical3 = distance2D(landmarks[158], landmarks[144]);
  const dLeftHorizontal = distance2D(landmarks[33], landmarks[133]);
  const leftEAR = (dLeftVertical1 * 2.0 + dLeftVertical2 + dLeftVertical3) / (4.0 * dLeftHorizontal);

  // Right Eye Landmarks:
  // Vertical center [386, 374], vertical right [385, 373], vertical left [387, 380]
  // Horizontal corner-to-corner [263, 362]
  const dRightVertical1 = distance2D(landmarks[386], landmarks[374]);
  const dRightVertical2 = distance2D(landmarks[385], landmarks[373]);
  const dRightVertical3 = distance2D(landmarks[387], landmarks[380]);
  const dRightHorizontal = distance2D(landmarks[263], landmarks[362]);
  const rightEAR = (dRightVertical1 * 2.0 + dRightVertical2 + dRightVertical3) / (4.0 * dRightHorizontal);

  return (leftEAR + rightEAR) / 2.0;
}

// ── Web Audio API Synthetic Alarm Playback Helpers ──────
function playSyntheticAlarm() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    
    if (osc) return; // already running
    
    osc = audioCtx.createOscillator();
    gainNode = audioCtx.createGain();
    
    osc.type = "sawtooth"; // high-urgency saw wave
    osc.frequency.setValueAtTime(880, audioCtx.currentTime); // 880 Hz
    
    gainNode.gain.setValueAtTime(0.4, audioCtx.currentTime); // 40% volume
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    osc.start();
    
    // Pulse frequency for siren sound effect
    let high = true;
    sirenInterval = setInterval(() => {
      if (osc) {
        osc.frequency.setValueAtTime(high ? 988 : 660, audioCtx.currentTime);
        high = !high;
      }
    }, 150);
  } catch (e) {
    console.error("Web Audio playback failed:", e);
  }
}

function stopSyntheticAlarm() {
  if (sirenInterval) {
    clearInterval(sirenInterval);
    sirenInterval = null;
  }
  if (osc) {
    try {
      osc.stop();
      osc.disconnect();
    } catch (e) {}
    osc = null;
  }
}

// ── 6. Drowsiness Evaluation & Warning state (AI-Powered Adaptive Dynamic Calibration) ──
function evaluateDrowsiness(ear) {
  // 1. Maintain sliding history of the last 150 frames of EAR (about 5-7 seconds)
  earHistoryList.push(ear);
  if (earHistoryList.length > 150) {
    earHistoryList.shift();
  }
  
  // 2. Compute 90th percentile to dynamically calibrate the stable "open eyes" EAR reference
  const sorted = [...earHistoryList].sort((a, b) => a - b);
  const openRefEAR = sorted.length > 20 
    ? sorted[Math.floor(sorted.length * 0.90)] 
    : 0.32; // safe initialization fallback
    
  // 3. Compute adaptive threshold dynamically (76% of open reference EAR)
  // Clamp between 0.18 and 0.31 to prevent any anomalous extreme scaling
  const adaptiveThreshold = Math.max(0.18, Math.min(0.31, openRefEAR * 0.76));
  earThreshold = adaptiveThreshold;
  
  // 4. Update UI calibration sliders smoothly
  rangeEarThreshold.value = adaptiveThreshold;
  valEarThreshold.innerText = adaptiveThreshold.toFixed(2);
  
  if (ear < earThreshold) {
    // Eyes closed
    txtEyeStatus.innerText = "CLOSED";
    txtEyeStatus.className = "card-val txt-red";
    
    if (closedStartTime === null) {
      closedStartTime = Date.now();
    }
    
    const duration = (Date.now() - closedStartTime) / 1000.0;
    txtClosedDuration.innerText = duration.toFixed(1) + "s";
    
    // Play alarm if threshold exceeded
    if (duration >= alarmDelaySeconds) {
      if (alarmOverlay.style.display !== "flex") {
        alarmOverlay.style.display = "flex";
        
        // Dual alarm: Try playing both MP3 and Synthetic browser siren
        alarmAudio.play().catch(e => console.log("Audio file play failed:", e));
        playSyntheticAlarm();
        
        alertCount++;
        txtAlertCount.innerText = alertCount;
      }
    }
  } else {
    // Eyes open
    txtEyeStatus.innerText = "OPEN";
    txtEyeStatus.className = "card-val txt-green";
    closedStartTime = null;
    txtClosedDuration.innerText = "0.0s";
    
    if (alarmOverlay.style.display === "flex") {
      alarmOverlay.style.display = "none";
      alarmAudio.pause();
      alarmAudio.currentTime = 0;
      stopSyntheticAlarm();
    }
  }
}

// ── 7. Draw Visual FaceMesh Eye Overlay (Futuristic HUD Bounding Boxes) ──
function drawTrackingMesh(landmarks, ear) {
  // Left Eye Landmarks (indices from MediaPipe FaceMesh)
  const leftEyeIndices = [33, 160, 158, 133, 153, 144];
  // Right Eye Landmarks
  const rightEyeIndices = [263, 385, 387, 362, 373, 380];
  
  function drawEyeBoundingBox(indices, eyeEAR, label) {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    for (const idx of indices) {
      const p = landmarks[idx];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    
    const width = canvasElement.width;
    const height = canvasElement.height;
    
    // Calculate coordinates in pixels
    const pxMin = minX * width;
    const pxMax = maxX * width;
    const pxMinY = minY * height;
    const pxMaxY = maxY * height;
    
    const eyeW = pxMax - pxMin;
    const eyeH = pxMaxY - pxMinY;
    
    // Pad bounding box for stunning aesthetics
    const padX = eyeW * 0.35;
    const padY = eyeH * 0.45;
    
    const x = pxMin - padX;
    const y = pxMinY - padY;
    const w = eyeW + (padX * 2);
    const h = eyeH + (padY * 2);
    
    const isOpen = eyeEAR >= earThreshold;
    
    // Selection of colors
    const strokeColor = isOpen ? "rgb(34, 197, 94)" : "rgb(239, 68, 68)";
    const fillColor = isOpen ? "rgba(34, 197, 94, 0.08)" : "rgba(239, 68, 68, 0.18)";
    
    canvasCtx.strokeStyle = strokeColor;
    canvasCtx.fillStyle = fillColor;
    canvasCtx.lineWidth = 2.0;
    
    // Draw rounded rect box
    canvasCtx.beginPath();
    if (canvasCtx.roundRect) {
      canvasCtx.roundRect(x, y, w, h, 6);
    } else {
      canvasCtx.rect(x, y, w, h);
    }
    canvasCtx.fill();
    canvasCtx.stroke();
    
    // Draw modern industrial HUD corner brackets
    const len = Math.min(w, h) * 0.22;
    canvasCtx.lineWidth = 2.5;
    canvasCtx.strokeStyle = isOpen ? "rgba(34, 197, 94, 0.7)" : "rgba(239, 68, 68, 0.7)";
    
    // Top-Left corner
    canvasCtx.beginPath();
    canvasCtx.moveTo(x, y + len);
    canvasCtx.lineTo(x, y);
    canvasCtx.lineTo(x + len, y);
    canvasCtx.stroke();
    
    // Top-Right corner
    canvasCtx.beginPath();
    canvasCtx.moveTo(x + w, y + len);
    canvasCtx.lineTo(x + w, y);
    canvasCtx.lineTo(x + w - len, y);
    canvasCtx.stroke();
    
    // Bottom-Left corner
    canvasCtx.beginPath();
    canvasCtx.moveTo(x, y + h - len);
    canvasCtx.lineTo(x, y + h);
    canvasCtx.lineTo(x + len, y + h);
    canvasCtx.stroke();
    
    // Bottom-Right corner
    canvasCtx.beginPath();
    canvasCtx.moveTo(x + w, y + h - len);
    canvasCtx.lineTo(x + w, y + h);
    canvasCtx.lineTo(x + w - len, y + h);
    canvasCtx.stroke();
    
    // Reset line width
    canvasCtx.lineWidth = 2.0;

    // Draw solid label badge above box
    canvasCtx.fillStyle = strokeColor;
    const tagText = `${label}: ${(eyeEAR * 100).toFixed(0)}% [${isOpen ? "OPEN" : "CLOSED"}]`;
    canvasCtx.font = "bold 9px 'JetBrains Mono', 'Fira Code', monospace, sans-serif";
    const textWidth = canvasCtx.measureText(tagText).width;
    
    canvasCtx.beginPath();
    if (canvasCtx.roundRect) {
      canvasCtx.roundRect(x, y - 15, textWidth + 10, 13, [3, 3, 0, 0]);
    } else {
      canvasCtx.rect(x, y - 15, textWidth + 10, 13);
    }
    canvasCtx.fill();
    
    // Text rendering inside solid badge
    canvasCtx.fillStyle = "#ffffff";
    canvasCtx.fillText(tagText, x + 5, y - 5);
  }
  
  // Calculate distances for left and right eyes
  const dLeftVertical1 = distance2D(landmarks[160], landmarks[153]);
  const dLeftVertical2 = distance2D(landmarks[158], landmarks[144]);
  const dLeftHorizontal = distance2D(landmarks[33], landmarks[133]);
  const leftEAR = (dLeftVertical1 + dLeftVertical2) / (2.0 * dLeftHorizontal);

  const dRightVertical1 = distance2D(landmarks[385], landmarks[373]);
  const dRightVertical2 = distance2D(landmarks[387], landmarks[380]);
  const dRightHorizontal = distance2D(landmarks[263], landmarks[362]);
  const rightEAR = (dRightVertical1 + dRightVertical2) / (2.0 * dRightHorizontal);
  
  // Render Left and Right Bounding Boxes
  drawEyeBoundingBox(leftEyeIndices, leftEAR, "L_EYE");
  drawEyeBoundingBox(rightEyeIndices, rightEAR, "R_EYE");
}

// ── 8. Draw Custom Canvas Line Graph ─────────────────────
function drawHistoryChart() {
  // Resize chart canvas to fit element layout bounding box
  const rect = chartCanvas.parentElement.getBoundingClientRect();
  chartCanvas.width = rect.width;
  chartCanvas.height = rect.height;

  const w = chartCanvas.width;
  const h = chartCanvas.height;

  chartCtx.clearRect(0, 0, w, h);
  
  // Draw EAR threshold guide line
  const thresholdY = h - (earThreshold / 0.4) * h;
  chartCtx.beginPath();
  chartCtx.strokeStyle = "rgba(239, 68, 68, 0.4)";
  chartCtx.lineWidth = 1;
  chartCtx.setLineDash([4, 4]);
  chartCtx.moveTo(0, thresholdY);
  chartCtx.lineTo(w, thresholdY);
  chartCtx.stroke();
  chartCtx.setLineDash([]); // Reset line dash

  // Draw chart line
  chartCtx.beginPath();
  chartCtx.lineWidth = 2.5;
  
  // Create beautiful indigo gradient
  const grad = chartCtx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "hsl(239, 84%, 67%)");
  grad.addColorStop(1, "rgba(99, 102, 241, 0.1)");
  chartCtx.strokeStyle = grad;
  
  const step = w / 99;
  for (let i = 0; i < 100; i++) {
    const x = i * step;
    
    // Normalize EAR value (clamped between 0.0 and 0.4)
    const val = Math.min(Math.max(earHistory[i], 0.0), 0.4);
    const y = h - (val / 0.4) * h;
    
    if (i === 0) {
      chartCtx.moveTo(x, y);
    } else {
      chartCtx.lineTo(x, y);
    }
  }
  chartCtx.stroke();
  
  // Draw glow shadow beneath the line
  chartCtx.shadowColor = "rgba(99, 102, 241, 0.35)";
  chartCtx.shadowBlur = 8;
  chartCtx.shadowOffsetY = 2;
}
