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
    const audio = new Audio("https://actions.google.com/sounds/v1/alarms/alarm_clock.ogg");
    audio.loop = true;
    return audio;
  });
  const navigate = useNavigate();

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

      osc.type = "sawtooth"; // high-urgency saw wave
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gainNode.gain.setValueAtTime(0.4, ctx.currentTime);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      osc.start();

      oscRef.current = osc;
      gainNodeRef.current = gainNode;

      let high = true;
      sirenIntervalRef.current = setInterval(() => {
        if (oscRef.current && audioCtxRef.current) {
          oscRef.current.frequency.setValueAtTime(
            high ? 988 : 660,
            audioCtxRef.current.currentTime
          );
          high = !high;
        }
      }, 150);
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

  // Start / Stop camera based on active state
  useEffect(() => {
    if (active) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [active]);

  const startCamera = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Webcam access is not supported by your browser or requires a secure connection (HTTPS).");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" }
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
          setStatus(prev => ({
            ...prev,
            eye_status: "no face detected",
            closed_frames: 0
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

  function calculateAverageEAR(landmarks) {
    const dLeftVertical1 = distance2D(landmarks[160], landmarks[153]);
    const dLeftVertical2 = distance2D(landmarks[158], landmarks[144]);
    const dLeftHorizontal = distance2D(landmarks[33], landmarks[133]);
    const leftEAR = (dLeftVertical1 + dLeftVertical2) / (2.0 * dLeftHorizontal);

    const dRightVertical1 = distance2D(landmarks[385], landmarks[373]);
    const dRightVertical2 = distance2D(landmarks[387], landmarks[380]);
    const dRightHorizontal = distance2D(landmarks[263], landmarks[362]);
    const rightEAR = (dRightVertical1 + dRightVertical2) / (2.0 * dRightHorizontal);

    return (leftEAR + rightEAR) / 2.0;
  }

  // Drowsiness local state machine
  const evaluateDrowsiness = (ear) => {
    const currentThreshold = earThresholdRef.current;
    const currentSensitivity = sensitivityRef.current;
    const isClosed = ear < currentThreshold;
    const alarmDelaySeconds = currentSensitivity / 20.0; // translate frames to stable duration seconds (e.g. 20 frames = 1.0s)
    
    setStatus(prev => {
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
        // Implement a 300ms flicker grace period before resetting timer
        if (closedStartTimeRef.current !== null) {
          if (graceStartTimeRef.current === null) {
            graceStartTimeRef.current = Date.now();
          }
          const graceElapsed = Date.now() - graceStartTimeRef.current;
          if (graceElapsed < 300) {
            // retain closed state during grace period
            nextClosedDuration = (Date.now() - closedStartTimeRef.current) / 1000.0;
          } else {
            // grace period expired, reset closed state
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

  // Draw eye meshes overlays
  function drawEyeMesh(ctx, landmarks, ear, width, height) {
    const currentThreshold = earThresholdRef.current;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = ear < currentThreshold ? "rgb(239, 68, 68)" : "rgb(6, 182, 212)";
    ctx.fillStyle = ear < currentThreshold ? "rgba(239, 68, 68, 0.25)" : "rgba(6, 182, 212, 0.15)";

    function drawContour(indices) {
      ctx.beginPath();
      const first = landmarks[indices[0]];
      ctx.moveTo(first.x * width, first.y * height);
      for (let i = 1; i < indices.length; i++) {
        const p = landmarks[indices[i]];
        ctx.lineTo(p.x * width, p.y * height);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    const leftEye = [33, 160, 158, 133, 153, 144];
    const rightEye = [263, 385, 387, 362, 373, 380];

    drawContour(leftEye);
    drawContour(rightEye);
    
    ctx.fillStyle = "#ffffff";
    [...leftEye, ...rightEye].forEach(idx => {
      const p = landmarks[idx];
      ctx.beginPath();
      ctx.arc(p.x * width, p.y * height, 1.5, 0, 2 * Math.PI);
      ctx.fill();
    });
  }

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  const applySensitivity = () => {
    alert(`Sensitivity threshold calibrated to: ${sensitivity} consecutive closed frames.`);
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
          
          <div className={`metric-card alert-card ${status.alarm ? 'alarm-active' : ''}`}>
            <div className="card-header">
              <div className="card-label">Alert Status</div>
              <div className="card-icon">⚠️</div>
            </div>
            <div className={`card-value ${status.alarm ? "danger-text" : "success-text"}`}>
              {status.alarm ? "ALARM" : "SAFE"}
            </div>
            <div className="card-subtext">{status.alarm ? "Wake up driver immediately" : "Driver is alert"}</div>
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
                onClick={() => setActive(!active)} 
                className={`feed-btn ${active ? "feed-btn-stop" : "feed-btn-start"}`}
              >
                {active ? "Stop Feed" : "Start Feed"}
              </button>
            </div>
            
            {status.alarm && (
              <div className="alarm-banner">
                <span className="alarm-icon">🚨</span> 
                DROWSINESS DETECTED — WAKE UP! 
                <span className="alarm-icon">🚨</span>
              </div>
            )}
            
            <div className="video-container">
              {active ? (
                <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", justifyContent: "center", alignItems: "center" }}>
                  <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />
                  <canvas ref={canvasRef} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)", zIndex: 10 }} />
                </div>
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
              <h4 className="panel-title">Sensitivity Control</h4>
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
                type="range" min="0.15" max="0.30" step="0.01"
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
