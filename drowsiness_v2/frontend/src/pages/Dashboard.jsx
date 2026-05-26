// frontend/src/pages/Dashboard.jsx
import { useState, useEffect, useRef } from "react";
import { supabase } from "../supabase/config";
import { useNavigate } from "react-router-dom";

const API = "http://localhost:8000";

export default function Dashboard() {
  const [status,  setStatus]  = useState(null);
  const [active,  setActive]  = useState(false);
  const [alerts,  setAlerts]  = useState([]);
  const [thresh,  setThresh]  = useState(20);
  const [user,    setUser]    = useState(null);
  const pollRef  = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user));
  }, []);

  const fetchStatus = async () => {
    try {
      const res  = await fetch(`${API}/status`);
      const data = await res.json();
      setStatus(data);
      if (data.alarm) {
        setAlerts(prev => [
          { time: new Date().toLocaleTimeString(), msg: "Drowsiness detected!" },
          ...prev.slice(0, 9),
        ]);
      }
    } catch {}
  };

  useEffect(() => {
    if (active) {
      fetchStatus();
      pollRef.current = setInterval(fetchStatus, 1000);
    } else {
      clearInterval(pollRef.current);
    }
    return () => clearInterval(pollRef.current);
  }, [active]);

  const updateThreshold = async () => {
    await fetch(`${API}/config?ear_frames=${thresh}`, { method: "PUT" });
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  const eyeColor = status?.alarm ? "#ef4444" : status?.drowsy ? "#f59e0b" : "#22c55e";

  return (
    <div style={styles.page}>
      {/* Sidebar */}
      <aside style={styles.sidebar}>
        <div style={styles.logo}>👁️ DrowseGuard</div>
        <nav style={styles.nav}>
          <div style={styles.navItem}>Dashboard</div>
          <div style={styles.navItem}>History</div>
          <div style={styles.navItem}>Settings</div>
        </nav>
        <div style={styles.userInfo}>
          <div style={styles.avatar}>
            {user?.user_metadata?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || "U"}
          </div>
          <div>
            <div style={styles.userName}>{user?.user_metadata?.name || "Driver"}</div>
            <div style={styles.userEmail}>{user?.email}</div>
          </div>
        </div>
        <button onClick={handleLogout} style={styles.logoutBtn}>Logout</button>
      </aside>

      {/* Main */}
      <main style={styles.main}>
        <h1 style={styles.heading}>Live Monitoring</h1>

        {/* Status cards */}
        <div style={styles.cards}>
          <StatCard label="Eye Status"     value={status?.eye_status?.toUpperCase() || "—"} color={eyeColor} />
          <StatCard label="Closed Frames"  value={`${status?.closed_frames || 0} / ${status?.threshold || thresh}`} color="#6366f1" />
          <StatCard label="Alert Status"   value={status?.alarm ? "ALARM" : status?.drowsy ? "WARNING" : "SAFE"} color={eyeColor} />
          <StatCard label="Total Frames"   value={status?.frame_count || 0} color="#06b6d4" />
        </div>

        <div style={styles.row}>
          {/* Camera feed */}
          <div style={styles.feedBox}>
            <div style={styles.feedHeader}>
              <span>Camera Feed</span>
              <button
                onClick={() => setActive(v => !v)}
                style={{ ...styles.startBtn, background: active ? "#ef4444" : "#22c55e" }}
              >
                {active ? "Stop" : "Start"}
              </button>
            </div>
            {active ? (
              <img src={`${API}/stream`} alt="Live feed" style={styles.feedImg} />
            ) : (
              <div style={styles.feedPlaceholder}>Press Start to begin monitoring</div>
            )}
            {status?.alarm && <div style={styles.alarmBanner}>⚠ DROWSINESS DETECTED — WAKE UP!</div>}
          </div>

          {/* Right panel */}
          <div style={styles.rightPanel}>
            <div style={styles.panel}>
              <h3 style={styles.panelTitle}>Sensitivity</h3>
              <p style={styles.panelSub}>Alarm after <strong style={{color:"#6366f1"}}>{thresh}</strong> closed frames</p>
              <input type="range" min={5} max={60} value={thresh} onChange={e => setThresh(Number(e.target.value))} style={{ width: "100%", margin: "12px 0" }} />
              <div style={styles.rangeLegend}><span>More sensitive</span><span>Less sensitive</span></div>
              <button onClick={updateThreshold} style={styles.applyBtn}>Apply</button>
            </div>
            <div style={styles.panel}>
              <h3 style={styles.panelTitle}>Recent Alerts</h3>
              {alerts.length === 0
                ? <p style={styles.panelSub}>No alerts yet</p>
                : alerts.map((a, i) => (
                  <div key={i} style={styles.alertItem}>
                    <span style={styles.alertTime}>{a.time}</span>
                    <span style={styles.alertMsg}>{a.msg}</span>
                  </div>
                ))
              }
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div style={styles.card}>
      <div style={{ ...styles.cardValue, color }}>{value}</div>
      <div style={styles.cardLabel}>{label}</div>
    </div>
  );
}

const styles = {
  page:     { display: "flex", minHeight: "100vh", background: "#0f0f1a", color: "#fff" },
  sidebar:  { width: 220, background: "rgba(255,255,255,0.04)", borderRight: "1px solid rgba(255,255,255,0.07)", display: "flex", flexDirection: "column", padding: "24px 16px" },
  logo:     { fontSize: 18, fontWeight: 700, color: "#6366f1", marginBottom: 32 },
  nav:      { flex: 1 },
  navItem:  { padding: "10px 12px", borderRadius: 8, cursor: "pointer", color: "rgba(255,255,255,0.6)", fontSize: 14, marginBottom: 4 },
  userInfo: { display: "flex", alignItems: "center", gap: 10, marginBottom: 16 },
  avatar:   { width: 34, height: 34, borderRadius: "50%", background: "#6366f1", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, flexShrink: 0 },
  userName:  { fontSize: 13, fontWeight: 600, color: "#fff" },
  userEmail: { fontSize: 11, color: "rgba(255,255,255,0.4)" },
  logoutBtn: { background: "transparent", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.5)", borderRadius: 8, padding: "8px 0", cursor: "pointer", fontSize: 13, width: "100%" },
  main:    { flex: 1, padding: "32px 28px", overflowY: "auto" },
  heading: { fontSize: 24, fontWeight: 700, marginBottom: 24 },
  cards:   { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 24 },
  card:    { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "18px 16px" },
  cardValue: { fontSize: 22, fontWeight: 700, marginBottom: 4 },
  cardLabel: { fontSize: 12, color: "rgba(255,255,255,0.45)" },
  row:     { display: "flex", gap: 20 },
  feedBox: { flex: 2, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, overflow: "hidden" },
  feedHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.07)", fontSize: 14, fontWeight: 500 },
  startBtn: { padding: "7px 20px", border: "none", borderRadius: 8, color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 13 },
  feedImg: { width: "100%", display: "block" },
  feedPlaceholder: { height: 300, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.25)", fontSize: 14 },
  alarmBanner: { background: "#ef4444", color: "#fff", textAlign: "center", padding: "12px 0", fontWeight: 700, fontSize: 15 },
  rightPanel: { flex: 1, display: "flex", flexDirection: "column", gap: 16 },
  panel: { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "18px 16px" },
  panelTitle: { fontSize: 14, fontWeight: 600, marginBottom: 8 },
  panelSub:   { fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 4 },
  rangeLegend: { display: "flex", justifyContent: "space-between", fontSize: 11, color: "rgba(255,255,255,0.35)" },
  applyBtn: { marginTop: 12, width: "100%", padding: "9px 0", background: "#6366f1", border: "none", borderRadius: 8, color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 13 },
  alertItem: { display: "flex", gap: 8, padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 12 },
  alertTime: { color: "rgba(255,255,255,0.35)", flexShrink: 0 },
  alertMsg:  { color: "#fca5a5" },
};
