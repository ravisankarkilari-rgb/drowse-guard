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
      video: { width: 640, height: 480, facingMode: "user" }
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
function distance3D(p1, p2) {
  return Math.sqrt(
    Math.pow(p1.x - p2.x, 2) +
    Math.pow(p1.y - p2.y, 2) +
    Math.pow(p1.z - p2.z, 2)
  );
}

function calculateAverageEAR(landmarks) {
  // MediaPipe FaceMesh indices:
  // Left eye: Inner corner [133], Outer corner [33]
  //           Top lids [160, 158], Bottom lids [153, 144]
  const dLeftVertical1 = distance3D(landmarks[160], landmarks[153]);
  const dLeftVertical2 = distance3D(landmarks[158], landmarks[144]);
  const dLeftHorizontal = distance3D(landmarks[33], landmarks[133]);
  const leftEAR = (dLeftVertical1 + dLeftVertical2) / (2.0 * dLeftHorizontal);

  // Right eye: Inner corner [362], Outer corner [263]
  //            Top lids [385, 387], Bottom lids [373, 380]
  const dRightVertical1 = distance3D(landmarks[385], landmarks[373]);
  const dRightVertical2 = distance3D(landmarks[387], landmarks[380]);
  const dRightHorizontal = distance3D(landmarks[263], landmarks[362]);
  const rightEAR = (dRightVertical1 + dRightVertical2) / (2.0 * dRightHorizontal);

  // Return the average of both eyes
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

// ── 6. Drowsiness Evaluation & Warning state ────────────
function evaluateDrowsiness(ear) {
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

// ── 7. Draw Visual FaceMesh Eye Overlay ──────────────────
function drawTrackingMesh(landmarks, ear) {
  canvasCtx.lineWidth = 1.5;
  canvasCtx.strokeStyle = ear < earThreshold ? "rgb(239, 68, 68)" : "rgb(6, 182, 212)";
  canvasCtx.fillStyle = ear < earThreshold ? "rgba(239, 68, 68, 0.25)" : "rgba(6, 182, 212, 0.15)";

  // helper to draw a closed eye contour
  function drawEyeContour(indices) {
    canvasCtx.beginPath();
    const firstPoint = landmarks[indices[0]];
    canvasCtx.moveTo(firstPoint.x * canvasElement.width, firstPoint.y * canvasElement.height);
    
    for (let i = 1; i < indices.length; i++) {
      const p = landmarks[indices[i]];
      canvasCtx.lineTo(p.x * canvasElement.width, p.y * canvasElement.height);
    }
    canvasCtx.closePath();
    canvasCtx.fill();
    canvasCtx.stroke();
  }

  // Left Eye Contour (indices ordered around outer loop)
  const leftEyeIndices = [33, 160, 158, 133, 153, 144];
  drawEyeContour(leftEyeIndices);

  // Right Eye Contour
  const rightEyeIndices = [263, 385, 387, 362, 373, 380];
  drawEyeContour(rightEyeIndices);
  
  // Draw eye landmarker nodes
  canvasCtx.fillStyle = "#ffffff";
  const allIndices = [...leftEyeIndices, ...rightEyeIndices];
  allIndices.forEach(idx => {
    const p = landmarks[idx];
    canvasCtx.beginPath();
    canvasCtx.arc(p.x * canvasElement.width, p.y * canvasElement.height, 1.8, 0, 2 * Math.PI);
    canvasCtx.fill();
  });
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
