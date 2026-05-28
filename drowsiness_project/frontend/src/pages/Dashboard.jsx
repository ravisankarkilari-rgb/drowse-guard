import React, { useState, useEffect, useRef } from "react";
import { supabase } from "../supabase/config";
import { useNavigate } from "react-router-dom";

export default function Dashboard() {
  const [user, setUser] = useState(null);
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState({ eye_status: "unknown", drowsy: false, alarm: false, closed_duration: 0, closed_frames: 0, frame_count: 0, live_ear: 0 });
  const [alerts, setAlerts] = useState([]);
  const [sensitivity, setSensitivity] = useState(20);
  const [earThreshold, setEarThreshold] = useState(0.25);
  const [alarmAudio] = useState(() => {
    const audio = new Audio("/alarm.mp3");
    audio.loop = true;
    return audio;
  });
  const navigate = useNavigate();

  const [mode, setMode] = useState("local"); // "backend" or "local"
  const API_URL = process.env.REACT_APP_API_URL || "http://localhost:8000";

  // Edge AI refs
  const faceLandmarkerRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const animationRef = useRef(null);
  const [isModelLoaded, setIsModelLoaded] = useState(false);

  // Synchronization refs to solve React stale closures inside requestAnimationFrame loop
  const earThresholdRef = useRef(earThreshold);
  const sensitivityRef = useRef(sensitivity);
  const activeRef = useRef(active);

  useEffect(() => {
    earThresholdRef.current = earThreshold;
  }, [earThreshold]);

  useEffect(() => {
    sensitivityRef.current = sensitivity;
  }, [sensitivity]);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  // Stable time-based tracking refs
  const closedStartTimeRef = useRef(null);
  const graceStartTimeRef = useRef(null);

  // Rolling eye calibration references for real-time adaptive dynamic thresholding
  const earHistoryListRef = useRef([]);
  const adaptiveThresholdRef = useRef(0.25);

  // Hardware-native Web Audio API Alarm refs
  const audioCtxRef = useRef(null);
  const oscRef = useRef(null);
  const gainNodeRef = useRef(null);
  const sirenIntervalRef = useRef(null);

  const startSyntheticAlarm = () => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtxRef.current.state === "suspended") {
        audioCtxRef.current.resume();
      }
      if (oscRef.current) return; // already playing

      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.type = "square"; // piercing square wave
      osc.frequency.setValueAtTime(2800, ctx.currentTime); // 2.8kHz is highly distressing and alertive
      gainNode.gain.setValueAtTime(0.4, ctx.currentTime);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      osc.start();

      oscRef.current = osc;
      gainNodeRef.current = gainNode;

      // Pulse the volume (beep-beep-beep) for an industrial warning alarm
      let activeState = true;
      sirenIntervalRef.current = setInterval(() => {
        if (gainNodeRef.current && audioCtxRef.current) {
          gainNodeRef.current.gain.setValueAtTime(
            activeState ? 0.4 : 0.0,
            audioCtxRef.current.currentTime
          );
          activeState = !activeState;
        }
      }, 120); // fast pulsing beep
    } catch (e) {
      console.error("Web Audio synthetic alarm failed:", e);
    }
  };

  const stopSyntheticAlarm = () => {
    if (sirenIntervalRef.current) {
      clearInterval(sirenIntervalRef.current);
      sirenIntervalRef.current = null;
    }
    if (oscRef.current) {
      try {
        oscRef.current.stop();
        oscRef.current.disconnect();
      } catch (e) {}
      oscRef.current = null;
    }
    if (gainNodeRef.current) {
      try {
        gainNodeRef.current.disconnect();
      } catch (e) {}
      gainNodeRef.current = null;
    }
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user));

    // Load MediaPipe Face Landmarker from high-speed secure CDN dynamically
    async function loadModel() {
      try {
        const mp = await import("@mediapipe/tasks-vision");
        const FilesetResolver = mp.FilesetResolver;
        const FaceLandmarker = mp.FaceLandmarker;

        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm"
        );
        try {
          faceLandmarkerRef.current = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
              delegate: "GPU"
            },
            runningMode: "VIDEO",
            numFaces: 1
          });
        } catch (gpuError) {
          console.warn("GPU delegation failed. Retrying with CPU delegate...", gpuError);
          faceLandmarkerRef.current = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
              delegate: "CPU"
            },
            runningMode: "VIDEO",
            numFaces: 1
          });
        }
        setIsModelLoaded(true);
        console.log("MediaPipe Face Landmarker loaded successfully!");
      } catch (error) {
        console.error("Failed to load MediaPipe Face Landmarker:", error);
      }
    }
    loadModel();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Backend status polling loop
  useEffect(() => {
    let interval;
    if (mode === "backend" && active) {
      interval = setInterval(() => {
        fetch(`${API_URL}/status`)
          .then(res => res.json())
          .then(data => {
            setStatus(prev => {
              const isAlarm = data.alarm;
              if (isAlarm && !prev.alarm) {
                setAlerts(prevAlerts => {
                  const newAlert = { time: new Date().toLocaleTimeString(), msg: "Drowsiness Detected!" };
                  return [newAlert, ...prevAlerts].slice(0, 10);
                });
              }
              return {
                eye_status: data.eye_status || "unknown",
                drowsy: data.drowsy || false,
                alarm: isAlarm || false,
                closed_duration: (data.closed_frames || 0) / 20.0,
                closed_frames: data.closed_frames || 0,
                frame_count: data.frame_count || 0,
                live_ear: data.live_ear || 0
              };
            });
          })
          .catch(err => console.error("Backend status polling error:", err));
      }, 500);
    } else if (mode === "backend" && !active) {
      setStatus({ eye_status: "unknown", drowsy: false, alarm: false, closed_duration: 0, closed_frames: 0, frame_count: 0, live_ear: 0 });
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [active, mode, API_URL]);

  // Handle playing/pausing the alarm sound
  useEffect(() => {
    if (status.alarm) {
      // Dual alarms: play HTML5 audio file & native Web Audio siren
      alarmAudio.play().catch(e => console.log("Audio play blocked by browser:", e));
      startSyntheticAlarm();
    } else {
      alarmAudio.pause();
      alarmAudio.currentTime = 0;
      stopSyntheticAlarm();
    }
    return () => {
      alarmAudio.pause();
      stopSyntheticAlarm();
    };
  }, [status.alarm, alarmAudio]);

  // Start / Stop camera based on active state (only when in local Edge-AI mode)
  useEffect(() => {
    if (mode === "local") {
      if (active) {
        startCamera();
      } else {
        stopCamera();
      }
    }
    return () => {
      if (mode === "local") {
        stopCamera();
      }
    };
  }, [active, mode]);

  const startCamera = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Webcam access is not supported by your browser or requires a secure connection (HTTPS).");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: "user"
        }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        
        // Play silent sound to unlock browser audio restrictions on first user click
        alarmAudio.play().then(() => {
          alarmAudio.pause();
          alarmAudio.currentTime = 0;
        }).catch(e => console.log("Audio pre-unlock allowed:", e));

        // Force explicit stream play to bypass browser autoplay blocks
        videoRef.current.play().then(() => {
          console.log("Webcam feed playing successfully!");
        }).catch(err => {
          console.warn("Explicit play failed, web context might require user permission first:", err);
        });

        if (videoRef.current.readyState >= 1) {
          onVideoLoaded();
        } else {
          videoRef.current.addEventListener("loadedmetadata", onVideoLoaded);
        }
      }
    } catch (err) {
      console.error("Camera access blocked:", err);
      alert(`Could not access your camera: ${err.message || err}\nPlease ensure camera permissions are granted and you are using a secure connection (HTTPS).`);
      setActive(false);
    }
  };

  const stopCamera = () => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.removeEventListener("loadedmetadata", onVideoLoaded);
    }
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext("2d");
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
    setStatus({ eye_status: "unknown", drowsy: false, alarm: false, closed_frames: 0, frame_count: 0 });
  };

  const onVideoLoaded = () => {
    if (videoRef.current) {
      videoRef.current.removeEventListener("loadedmetadata", onVideoLoaded);
    }
    if (canvasRef.current && videoRef.current) {
      canvasRef.current.width = videoRef.current.videoWidth;
      canvasRef.current.height = videoRef.current.videoHeight;
    }
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
    animationRef.current = requestAnimationFrame(detectFrame);
  };

  // Face Landmarking & EAR Tracking loop
  const detectFrame = () => {
    if (!videoRef.current || !activeRef.current) return;

    // Defer early termination if model is still loading to keep loop alive
    if (!faceLandmarkerRef.current) {
      animationRef.current = requestAnimationFrame(detectFrame);
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!canvas) {
      animationRef.current = requestAnimationFrame(detectFrame);
      return;
    }
    const ctx = canvas.getContext("2d");

    // Only detect if video has enough frame data and time has changed
    if (video.readyState >= 2 && video.currentTime !== video.lastVideoTime) {
      video.lastVideoTime = video.currentTime;
      
      try {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const results = faceLandmarkerRef.current.detectForVideo(video, Date.now());
        
        if (results.faceLandmarks && results.faceLandmarks.length > 0) {
          const landmarks = results.faceLandmarks[0];
          const ear = calculateAverageEAR(landmarks);
          
          // Draw overlays
          drawEyeMesh(ctx, landmarks, ear, canvas.width, canvas.height);
          
          // Drowsiness state machine
          evaluateDrowsiness(ear);
        } else {
          closedStartTimeRef.current = null;
          graceStartTimeRef.current = null;
          setStatus(prev => ({
            ...prev,
            eye_status: "no face detected",
            closed_frames: 0,
            closed_duration: 0,
            drowsy: false,
            alarm: false
          }));
        }
      } catch (err) {
        console.error("Frame detection error:", err);
      }
    }
    animationRef.current = requestAnimationFrame(detectFrame);
  };

  // Mathematical 2D EAR helper formulas
  function distance2D(p1, p2) {
    return Math.sqrt(
      Math.pow(p1.x - p2.x, 2) +
      Math.pow(p1.y - p2.y, 2)
    );
  }

  // Highly robust 3-point vertical eye aspect ratio calculation
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

  // Drowsiness local state machine with real-time AI-powered adaptive thresholding
  const evaluateDrowsiness = (ear) => {
    // 1. Maintain sliding history of the last 150 frames of EAR (about 5-7 seconds)
    earHistoryListRef.current.push(ear);
    if (earHistoryListRef.current.length > 150) {
      earHistoryListRef.current.shift();
    }
    
    // 2. Compute 90th percentile to dynamically calibrate the stable "open eyes" EAR reference
    const sorted = [...earHistoryListRef.current].sort((a, b) => a - b);
    const openRefEAR = sorted.length > 20 
      ? sorted[Math.floor(sorted.length * 0.90)] 
      : 0.32; // safe initialization fallback
      
    // 3. Compute adaptive threshold dynamically (76% of open reference EAR)
    // Clamp between 0.18 and 0.31 to prevent any anomalous extreme scaling
    const adaptiveThreshold = Math.max(0.18, Math.min(0.31, openRefEAR * 0.76));
    adaptiveThresholdRef.current = adaptiveThreshold;
    
    // 4. Safely sync to React state for UI slider readout smoothly once every 30 frames
    // (to prevent rapid 60fps re-renders which severely degrade video performance)
    setStatus(prev => {
      if (prev.frame_count % 30 === 0) {
        setTimeout(() => {
          setEarThreshold(adaptiveThreshold);
        }, 0);
      }
      
      const currentThreshold = adaptiveThreshold;
      const currentSensitivity = sensitivityRef.current;
      const isClosed = ear < currentThreshold;
      const alarmDelaySeconds = currentSensitivity / 20.0;
      
      let nextClosedStartTime = prev.closed_duration > 0 ? closedStartTimeRef.current : null;
      let nextClosedDuration = 0;

      if (isClosed) {
        if (closedStartTimeRef.current === null) {
          closedStartTimeRef.current = Date.now();
        }
        nextClosedStartTime = closedStartTimeRef.current;
        nextClosedDuration = (Date.now() - closedStartTimeRef.current) / 1000.0;
        graceStartTimeRef.current = null; // clear grace timer
      } else {
        // Implement 300ms flicker grace period
        if (closedStartTimeRef.current !== null) {
          if (graceStartTimeRef.current === null) {
            graceStartTimeRef.current = Date.now();
          }
          const graceElapsed = Date.now() - graceStartTimeRef.current;
          if (graceElapsed < 300) {
            nextClosedDuration = (Date.now() - closedStartTimeRef.current) / 1000.0;
          } else {
            closedStartTimeRef.current = null;
            graceStartTimeRef.current = null;
            nextClosedDuration = 0;
          }
        } else {
          nextClosedDuration = 0;
        }
      }

      let isAlarm = nextClosedDuration >= alarmDelaySeconds;
      let isDrowsy = nextClosedDuration >= (alarmDelaySeconds / 2.0);

      // Trigger recent alerts list dynamically in React state
      if (isAlarm && !prev.alarm) {
        setAlerts(prevAlerts => {
          const newAlert = { time: new Date().toLocaleTimeString(), msg: "Drowsiness Detected!" };
          return [newAlert, ...prevAlerts].slice(0, 10);
        });
      }

      return {
        eye_status: isClosed ? "closed" : (nextClosedDuration > 0 ? "closed" : "open"),
        drowsy: isDrowsy,
        alarm: isAlarm,
        closed_duration: nextClosedDuration,
        closed_frames: Math.round(nextClosedDuration * 20),
        frame_count: prev.frame_count + 1,
        live_ear: ear
      };
    });
  };

  // Draw high-tech visual HUD eye bounding boxes overlays
  function drawEyeMesh(ctx, landmarks, ear, width, height) {
    const currentThreshold = adaptiveThresholdRef.current;
    
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
      
      // Calculate coordinates in pixels
      const pxMin = minX * width;
      const pxMax = maxX * width;
      const pxMinY = minY * height;
      const pxMaxY = maxY * height;
      
      const eyeW = pxMax - pxMin;
      const eyeH = pxMaxY - pxMinY;
      
      // Add padding around eye area for aesthetics
      const padX = eyeW * 0.35;
      const padY = eyeH * 0.45;
      
      const x = pxMin - padX;
      const y = pxMinY - padY;
      const w = eyeW + (padX * 2);
      const h = eyeH + (padY * 2);
      
      const isOpen = eyeEAR >= currentThreshold;
      
      // Futuristic HUD styling colors
      const strokeColor = isOpen ? "rgb(34, 197, 94)" : "rgb(239, 68, 68)"; // Cyber green vs Warning red
      const fillColor = isOpen ? "rgba(34, 197, 94, 0.08)" : "rgba(239, 68, 68, 0.18)";
      
      ctx.strokeStyle = strokeColor;
      ctx.fillStyle = fillColor;
      ctx.lineWidth = 2.0;
      
      // Draw rectangular box
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(x, y, w, h, 6);
      } else {
        ctx.rect(x, y, w, h);
      }
      ctx.fill();
      ctx.stroke();
      
      // Draw premium HUD corner brackets for extra visual excellence
      const len = Math.min(w, h) * 0.22;
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = isOpen ? "rgba(34, 197, 94, 0.7)" : "rgba(239, 68, 68, 0.7)";
      
      // Top-Left corner
      ctx.beginPath();
      ctx.moveTo(x, y + len);
      ctx.lineTo(x, y);
      ctx.lineTo(x + len, y);
      ctx.stroke();
      
      // Top-Right corner
      ctx.beginPath();
      ctx.moveTo(x + w, y + len);
      ctx.lineTo(x + w, y);
      ctx.lineTo(x + w - len, y);
      ctx.stroke();
      
      // Bottom-Left corner
      ctx.beginPath();
      ctx.moveTo(x, y + h - len);
      ctx.lineTo(x, y + h);
      ctx.lineTo(x + len, y + h);
      ctx.stroke();
      
      // Bottom-Right corner
      ctx.beginPath();
      ctx.moveTo(x + w, y + h - len);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x + w - len, y + h);
      ctx.stroke();
      
      // Draw modern HUD solid status label tag above bounding box
      ctx.fillStyle = strokeColor;
      const tagText = `${label}: ${(eyeEAR * 100).toFixed(0)}% [${isOpen ? "OPEN" : "CLOSED"}]`;
      ctx.font = "bold 9px 'JetBrains Mono', 'Fira Code', monospace, sans-serif";
      const textWidth = ctx.measureText(tagText).width;
      
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(x, y - 15, textWidth + 10, 13, [3, 3, 0, 0]);
      } else {
        ctx.rect(x, y - 15, textWidth + 10, 13);
      }
      ctx.fill();
      
      // Draw tag white text
      ctx.fillStyle = "#ffffff";
      ctx.fillText(tagText, x + 5, y - 5);
    }
    
    // Left eye EAR
    const dLeftVertical1 = distance2D(landmarks[160], landmarks[153]);
    const dLeftVertical2 = distance2D(landmarks[158], landmarks[144]);
    const dLeftHorizontal = distance2D(landmarks[33], landmarks[133]);
    const leftEAR = (dLeftVertical1 + dLeftVertical2) / (2.0 * dLeftHorizontal);

    // Right eye EAR
    const dRightVertical1 = distance2D(landmarks[385], landmarks[373]);
    const dRightVertical2 = distance2D(landmarks[387], landmarks[380]);
    const dRightHorizontal = distance2D(landmarks[263], landmarks[362]);
    const rightEAR = (dRightVertical1 + dRightVertical2) / (2.0 * dRightHorizontal);
    
    // Draw left and right HUD boxes
    drawEyeBoundingBox(leftEyeIndices, leftEAR, "L_EYE");
    drawEyeBoundingBox(rightEyeIndices, rightEAR, "R_EYE");
  }

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  const applySensitivity = () => {
    if (mode === "backend") {
      fetch(`${API_URL}/config?ear_frames=${sensitivity}`, { method: "PUT" })
        .then(res => res.json())
        .then(data => {
          alert(`Backend sensitivity successfully set to ${sensitivity} frames.`);
        })
        .catch(err => {
          console.error("Failed to update backend config:", err);
          alert(`Failed to update backend: ${err.message || err}`);
        });
    } else {
      alert(`Sensitivity threshold calibrated to: ${sensitivity} consecutive closed frames.`);
    }
  };

  const getAvatar = () => {
    if (!user) return "U";
    if (user.user_metadata?.full_name) return user.user_metadata.full_name.charAt(0).toUpperCase();
    if (user.email) return user.email.charAt(0).toUpperCase();
    return "U";
  };

  return (
    <div className="dashboard-layout">
      {/* Sidebar */}
      <div className="sidebar glass-panel">
        <div>
          <div className="logo-container">
            <span className="logo-icon">👁️</span>
            <h2 className="logo-text">DrowseGuard</h2>
          </div>
          <div className="nav-item active-nav">
            <span className="nav-icon">📊</span> Dashboard
          </div>
          <div className="nav-item">
            <span className="nav-icon">⚙️</span> Settings
          </div>
        </div>
        <div className="user-section">
          <div className="user-info">
            <div className="avatar">{getAvatar()}</div>
            <div className="user-details">
              <div className="user-email">{user?.email || "User"}</div>
              <div className="user-role">Administrator</div>
            </div>
          </div>
          <button onClick={handleLogout} className="logout-btn">Log out</button>
        </div>
      </div>

      {/* Main Content */}
      <div className="main-content">
        <header className="top-header">
          <h1 className="page-title">Monitoring Dashboard</h1>
          <div className="status-badge">
            <span className={`status-dot ${active ? 'active-dot' : 'inactive-dot'}`}></span>
            {active ? "System Active" : "System Idle"}
          </div>
        </header>

        {/* Status Cards */}
        <div className="cards-grid">
          <div className="metric-card eye-card">
            <div className="card-header">
              <div className="card-label">Eye Status</div>
              <div className="card-icon">👁️</div>
            </div>
            <div className={`card-value ${status.eye_status === "closed" ? "danger-text" : "success-text"}`}>
              {status.eye_status.toUpperCase()}
            </div>
          </div>
          
          <div className="metric-card frames-card">
            <div className="card-header">
              <div className="card-label">Closed Duration</div>
              <div className="card-icon">⏱️</div>
            </div>
            <div className="card-value warning-text">{status.closed_duration ? status.closed_duration.toFixed(1) + "s" : "0.0s"}</div>
            <div className="card-subtext">Live EAR: {status.live_ear ? status.live_ear.toFixed(2) : "0.00"}</div>
          </div>
          
          <div className={`metric-card alert-card ${status.alarm ? 'alarm-active' : status.drowsy ? 'warning-active' : ''}`} style={{ borderBottom: status.alarm ? '3px solid var(--accent-danger)' : status.drowsy ? '3px solid var(--accent-warning)' : '3px solid var(--accent-success)' }}>
            <div className="card-header">
              <div className="card-label">Alert Status</div>
              <div className="card-icon">⚠️</div>
            </div>
            <div className={`card-value ${status.alarm ? "danger-text" : status.drowsy ? "warning-text" : "success-text"}`}>
              {status.alarm ? "ALARM" : status.drowsy ? "DROWSY" : "SAFE"}
            </div>
            <div className="card-subtext">
              {status.alarm 
                ? "Wake up driver immediately" 
                : status.drowsy 
                  ? "Warning: Driver showing signs of drowsiness" 
                  : "Driver is alert and safe"}
            </div>
          </div>
          
          <div className="metric-card total-card">
            <div className="card-header">
              <div className="card-label">Total Frames</div>
              <div className="card-icon">🎞️</div>
            </div>
            <div className="card-value info-text">{status.frame_count}</div>
            <div className="card-subtext">Processed this session</div>
          </div>
        </div>

        <div className="content-row">
          {/* Camera Feed */}
          <div className="camera-section glass-panel">
            <div className="camera-header">
              <div className="camera-title-box">
                <h3 className="camera-title">Live Camera Feed</h3>
                {active && <span className="recording-indicator">REC</span>}
              </div>
              <button 
                onClick={() => {
                  // Direct user gesture audio unlock for perfect mobile browser support (iOS Safari & Android Chrome)
                  try {
                    if (!audioCtxRef.current) {
                      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
                    }
                    if (audioCtxRef.current.state === "suspended") {
                      audioCtxRef.current.resume();
                    }
                    alarmAudio.play().then(() => {
                      alarmAudio.pause();
                      alarmAudio.currentTime = 0;
                    }).catch(e => console.log("Silent audio gesture unlock successful:", e));
                  } catch (e) {
                    console.warn("Mobile browser gesture audio unlock failed:", e);
                  }
                  setActive(!active);
                }} 
                className={`feed-btn ${active ? "feed-btn-stop" : "feed-btn-start"}`}
              >
                {active ? "Stop Feed" : "Start Feed"}
              </button>
            </div>
            
            {status.alarm ? (
              <div className="alarm-banner">
                <span className="alarm-icon">🚨</span> 
                DROWSINESS DETECTED — WAKE UP! 
                <span className="alarm-icon">🚨</span>
              </div>
            ) : status.drowsy ? (
              <div className="alarm-banner warning-banner" style={{ background: "linear-gradient(90deg, #b45309, #d97706, #b45309)" }}>
                <span className="alarm-icon">⚠️</span> 
                WARNING: DROWSINESS DETECTED
                <span className="alarm-icon">⚠️</span>
              </div>
            ) : null}
            
            <div className="video-container">
              {active ? (
                mode === "backend" ? (
                  <img 
                    src={`${API_URL}/stream`} 
                    alt="Live Stream Feed" 
                    className="video-stream" 
                    style={{ width: "100%", height: "100%", objectFit: "contain" }}
                    onError={(e) => {
                      e.target.onerror = null;
                      console.warn("Failed to stream from local Python backend. Ensure Python app.py is running on localhost:8000.");
                    }}
                  />
                ) : (
                  <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", justifyContent: "center", alignItems: "center" }}>
                    <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />
                    <canvas ref={canvasRef} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)", zIndex: 10 }} />
                  </div>
                )
              ) : (
                <div className="placeholder">
                  <div className="placeholder-icon">📷</div>
                  Camera offline. Click Start Feed to begin monitoring.
                </div>
              )}
            </div>
          </div>

          {/* Right Panel */}
          <div className="right-panel">
            <div className="panel-card glass-panel">
              <h4 className="panel-title">Detection Engine</h4>
              <p className="panel-desc">Choose between the Python CNN Backend or Local offline Edge-AI.</p>
              
              <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
                <button 
                  onClick={() => {
                    setMode("backend");
                    if (active) {
                      stopCamera();
                    }
                  }}
                  className="feed-btn"
                  style={{
                    flex: 1,
                    background: mode === "backend" ? "var(--primary)" : "rgba(255,255,255,0.05)",
                    border: mode === "backend" ? "1px solid var(--primary)" : "1px solid rgba(255,255,255,0.1)",
                    color: "white",
                    padding: "8px",
                    borderRadius: "10px",
                    fontWeight: "600",
                    cursor: "pointer"
                  }}
                >
                  Python CNN
                </button>
                <button 
                  onClick={() => {
                    setMode("local");
                  }}
                  className="feed-btn"
                  style={{
                    flex: 1,
                    background: mode === "local" ? "var(--primary)" : "rgba(255,255,255,0.05)",
                    border: mode === "local" ? "1px solid var(--primary)" : "1px solid rgba(255,255,255,0.1)",
                    color: "white",
                    padding: "8px",
                    borderRadius: "10px",
                    fontWeight: "600",
                    cursor: "pointer"
                  }}
                >
                  Local Edge-AI
                </button>
              </div>

              <h4 className="panel-title" style={{ marginTop: "20px" }}>Sensitivity Control</h4>
              <p className="panel-desc">Adjust the consecutive frame delay and calibration thresholds.</p>
              
              <div className="sensitivity-display">
                <span className="sensitivity-label">Time Threshold:</span>
                <span className="sensitivity-value">{(sensitivity / 20.0).toFixed(1)}s</span>
              </div>
              
              <input 
                type="range" min="5" max="60" 
                value={sensitivity} onChange={e => setSensitivity(Number(e.target.value))}
                className="slider"
                style={{marginBottom: '20px'}}
              />

              <div className="sensitivity-display">
                <span className="sensitivity-label">EAR Calibration:</span>
                <span className="sensitivity-value">{earThreshold.toFixed(2)}</span>
              </div>
              
              <input 
                type="range" min="0.15" max="0.35" step="0.01"
                value={earThreshold} onChange={e => setEarThreshold(Number(e.target.value))}
                className="slider"
              />
              
              <button onClick={applySensitivity} className="btn-primary" style={{marginTop: '20px'}}>
                Apply Settings
              </button>
            </div>

            <div className="panel-card glass-panel alerts-panel">
              <div className="panel-header-row">
                <h4 className="panel-title" style={{margin: 0}}>Recent Alerts</h4>
                <span className="alert-count">{alerts.length}</span>
              </div>
              
              <div className="alerts-list">
                {alerts.length === 0 ? (
                  <div className="empty-alerts">No alerts recorded in this session.</div>
                ) : (
                  alerts.map((a, i) => (
                    <div key={i} className="alert-item">
                      <div className="alert-indicator"></div>
                      <div className="alert-content">
                        <div className="alert-msg">{a.msg}</div>
                        <div className="alert-time">{a.time}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .dashboard-layout {
          display: flex;
          min-height: 100vh;
          background: transparent;
        }
        
        .sidebar {
          width: 260px;
          margin: 20px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 24px 20px;
          position: sticky;
          top: 20px;
          height: calc(100vh - 40px);
        }
        
        .logo-container {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 40px;
        }
        
        .logo-icon {
          font-size: 24px;
          background: rgba(99, 102, 241, 0.2);
          width: 40px;
          height: 40px;
          display: flex;
          justify-content: center;
          align-items: center;
          border-radius: 10px;
          border: 1px solid rgba(99, 102, 241, 0.3);
        }
        
        .logo-text {
          color: white;
          margin: 0;
          font-size: 20px;
          font-weight: 800;
          background: linear-gradient(to right, #fff, #a5b4fc);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        
        .nav-item {
          color: var(--text-muted);
          padding: 14px 16px;
          border-radius: 12px;
          font-weight: 600;
          font-size: 15px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 12px;
          transition: all 0.3s ease;
          margin-bottom: 8px;
        }
        
        .nav-item:hover {
          background: rgba(255, 255, 255, 0.05);
          color: white;
        }
        
        .active-nav {
          background: linear-gradient(90deg, rgba(99,102,241,0.2) 0%, rgba(99,102,241,0.05) 100%);
          color: white;
          border-left: 3px solid var(--primary);
        }
        
        .user-section {
          background: rgba(0, 0, 0, 0.2);
          border-radius: 14px;
          padding: 16px;
          border: 1px solid var(--glass-border);
        }
        
        .user-info {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 16px;
        }
        
        .avatar {
          width: 40px;
          height: 40px;
          border-radius: 10px;
          background: linear-gradient(135deg, var(--primary), var(--primary-hover));
          display: flex;
          justify-content: center;
          align-items: center;
          color: white;
          font-weight: bold;
          font-size: 16px;
          box-shadow: 0 4px 10px rgba(99, 102, 241, 0.3);
        }
        
        .user-details {
          flex: 1;
          overflow: hidden;
        }
        
        .user-email {
          color: white;
          font-size: 14px;
          font-weight: 600;
          text-overflow: ellipsis;
          overflow: hidden;
          white-space: nowrap;
        }
        
        .user-role {
          color: var(--text-muted);
          font-size: 12px;
        }
        
        .logout-btn {
          width: 100%;
          background: rgba(239, 68, 68, 0.1);
          color: #fca5a5;
          border: 1px solid rgba(239, 68, 68, 0.2);
          padding: 10px;
          border-radius: 10px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 600;
          transition: all 0.3s ease;
        }
        
        .logout-btn:hover {
          background: rgba(239, 68, 68, 0.2);
          color: white;
        }
        
        .main-content {
          flex: 1;
          padding: 20px 20px 20px 0;
          display: flex;
          flex-direction: column;
          gap: 24px;
          height: 100vh;
          overflow-y: auto;
        }
        
        .top-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: var(--glass-bg);
          backdrop-filter: blur(12px);
          padding: 20px 30px;
          border-radius: 16px;
          border: 1px solid var(--glass-border);
        }
        
        .page-title {
          font-size: 24px;
          font-weight: 800;
          margin: 0;
        }
        
        .status-badge {
          display: flex;
          align-items: center;
          gap: 8px;
          background: rgba(0, 0, 0, 0.3);
          padding: 8px 16px;
          border-radius: 50px;
          font-size: 13px;
          font-weight: 600;
          border: 1px solid var(--glass-border);
        }
        
        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }
        
        .active-dot {
          background: var(--accent-success);
          box-shadow: 0 0 10px var(--accent-success);
        }
        
        .inactive-dot {
          background: var(--text-muted);
        }
        
        .cards-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 20px;
        }
        
        .metric-card {
          background: var(--glass-bg);
          backdrop-filter: blur(12px);
          border-radius: 16px;
          padding: 24px;
          border: 1px solid var(--glass-border);
          position: relative;
          overflow: hidden;
          transition: transform 0.3s ease;
        }
        
        .metric-card:hover {
          transform: translateY(-4px);
        }
        
        .eye-card { border-bottom: 3px solid var(--primary); }
        .frames-card { border-bottom: 3px solid var(--accent-warning); }
        .alert-card { border-bottom: 3px solid var(--accent-danger); }
        .total-card { border-bottom: 3px solid var(--accent-info); }
        
        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
        }
        
        .card-label {
          color: var(--text-muted);
          font-size: 13px;
          text-transform: uppercase;
          letter-spacing: 1px;
          font-weight: 600;
        }
        
        .card-icon {
          font-size: 20px;
          background: rgba(255, 255, 255, 0.05);
          width: 36px;
          height: 36px;
          display: flex;
          justify-content: center;
          align-items: center;
          border-radius: 10px;
        }
        
        .card-value {
          font-size: 32px;
          font-weight: 800;
          line-height: 1;
          margin-bottom: 8px;
        }
        
        .card-subtext {
          color: var(--text-muted);
          font-size: 12px;
        }
        
        .success-text { color: var(--accent-success); }
        .danger-text { color: var(--accent-danger); }
        .warning-text { color: var(--accent-warning); }
        .info-text { color: var(--accent-info); }
        
        .content-row {
          display: flex;
          gap: 24px;
          min-height: 400px;
        }
        
        .camera-section {
          flex: 2;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          padding: 0;
        }
        
        .camera-header {
          padding: 20px 24px;
          border-bottom: 1px solid var(--glass-border);
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: rgba(0, 0, 0, 0.2);
        }
        
        .camera-title-box {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        
        .camera-title {
          margin: 0;
          font-size: 18px;
          font-weight: 700;
        }
        
        .recording-indicator {
          background: rgba(239, 68, 68, 0.2);
          color: #fca5a5;
          border: 1px solid rgba(239, 68, 68, 0.4);
          padding: 4px 8px;
          border-radius: 6px;
          font-size: 10px;
          font-weight: bold;
          letter-spacing: 1px;
          animation: blink 2s infinite;
        }
        
        .feed-btn {
          border: none;
          padding: 10px 20px;
          border-radius: 10px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.3s ease;
          font-size: 14px;
        }
        
        .feed-btn-start {
          background: var(--accent-success);
          color: white;
          box-shadow: 0 4px 15px rgba(16, 185, 129, 0.3);
        }
        
        .feed-btn-stop {
          background: var(--accent-danger);
          color: white;
          box-shadow: 0 4px 15px rgba(239, 68, 68, 0.3);
        }
        
        .alarm-banner {
          background: linear-gradient(90deg, #991b1b, #ef4444, #991b1b);
          color: white;
          font-weight: 800;
          text-align: center;
          padding: 12px;
          letter-spacing: 2px;
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 10px;
          text-transform: uppercase;
        }
        
        .video-container {
          flex: 1;
          display: flex;
          justify-content: center;
          align-items: center;
          background: #000;
          position: relative;
          background-image: 
            linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
          background-size: 30px 30px;
        }
        
        .video-stream {
          width: 100%;
          height: 100%;
          object-fit: contain;
          display: block;
        }
        
        .placeholder {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
          color: var(--text-muted);
          font-size: 15px;
        }
        
        .placeholder-icon {
          font-size: 48px;
          opacity: 0.5;
        }
        
        .right-panel {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 24px;
        }
        
        .panel-card {
          padding: 24px;
        }
        
        .panel-title {
          margin: 0 0 8px 0;
          font-size: 18px;
          font-weight: 700;
        }
        
        .panel-desc {
          color: var(--text-muted);
          font-size: 13px;
          margin-bottom: 20px;
          line-height: 1.5;
        }
        
        .sensitivity-display {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: rgba(0,0,0,0.2);
          padding: 12px 16px;
          border-radius: 12px;
          margin-bottom: 16px;
          border: 1px solid var(--glass-border);
        }
        
        .sensitivity-label {
          color: var(--text-muted);
          font-size: 14px;
          font-weight: 600;
        }
        
        .sensitivity-value {
          color: var(--primary);
          font-weight: 800;
          font-size: 16px;
        }
        
        .slider {
          -webkit-appearance: none;
          width: 100%;
          height: 6px;
          border-radius: 5px;
          background: rgba(255,255,255,0.1);
          outline: none;
        }
        
        .slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: var(--primary);
          cursor: pointer;
          box-shadow: 0 0 10px var(--glass-glow);
        }
        
        .alerts-panel {
          flex: 1;
          display: flex;
          flex-direction: column;
        }
        
        .panel-header-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }
        
        .alert-count {
          background: rgba(239, 68, 68, 0.2);
          color: #fca5a5;
          padding: 4px 10px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: bold;
        }
        
        .alerts-list {
          flex: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        
        .empty-alerts {
          color: var(--text-muted);
          font-size: 14px;
          text-align: center;
          padding: 40px 0;
          background: rgba(0,0,0,0.1);
          border-radius: 12px;
          border: 1px dashed rgba(255,255,255,0.1);
        }
        
        .alert-item {
          display: flex;
          gap: 16px;
          background: rgba(239, 68, 68, 0.05);
          border: 1px solid rgba(239, 68, 68, 0.1);
          padding: 16px;
          border-radius: 12px;
          transition: transform 0.2s ease;
        }
        
        .alert-item:hover {
          transform: translateX(4px);
          background: rgba(239, 68, 68, 0.1);
        }
        
        .alert-indicator {
          width: 8px;
          border-radius: 4px;
          background: var(--accent-danger);
        }
        
        .alert-content {
          flex: 1;
        }
        
        .alert-msg {
          color: white;
          font-weight: 600;
          font-size: 14px;
          margin-bottom: 4px;
        }
        
        .alert-time {
          color: var(--text-muted);
          font-size: 12px;
        }

        /* ── 10. React Dashboard Mobile Responsiveness ────── */
        @media (max-width: 900px) {
          .dashboard-layout {
            flex-direction: column;
          }
          
          .sidebar {
            width: calc(100% - 40px);
            height: auto;
            position: relative;
            margin: 20px;
            top: 0;
            padding: 16px;
          }
          
          .logo-container {
            margin-bottom: 16px;
          }
          
          .user-section {
            margin-top: 16px;
          }

          .main-content {
            padding: 20px;
            height: auto;
            overflow-y: visible;
          }
          
          .cards-grid {
            grid-template-columns: repeat(2, 1fr);
            gap: 12px;
          }
          
          .content-row {
            flex-direction: column;
            gap: 20px;
          }
          
          .camera-section {
            flex: none;
            width: 100%;
          }
          
          .right-panel {
            flex: none;
            width: 100%;
          }
        }
        
        @media (max-width: 600px) {
          .cards-grid {
            grid-template-columns: 1fr;
          }
          
          .top-header {
            flex-direction: column;
            align-items: flex-start;
            gap: 12px;
            padding: 16px 20px;
          }
          
          .page-title {
            font-size: 20px;
          }
          
          .metric-card {
            padding: 16px;
          }
          
          .card-value {
            font-size: 24px;
          }
        }
      `}</style>
    </div>
  );
}
