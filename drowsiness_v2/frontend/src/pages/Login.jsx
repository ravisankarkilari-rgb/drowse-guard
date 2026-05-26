// frontend/src/pages/Login.jsx
import { useState } from "react";
import { supabase } from "../supabase/config";
import { useNavigate } from "react-router-dom";

export default function Login() {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [isSignup, setIsSignup] = useState(false);
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const navigate = useNavigate();

  const handleEmailAuth = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (isSignup) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setError("Check your email to confirm your account, then login.");
        setLoading(false);
        return;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      navigate("/dashboard");
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handleGoogle = async () => {
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options:  { redirectTo: window.location.origin + "/dashboard" },
    });
    if (error) setError(error.message);
    setLoading(false);
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.header}>
          <div style={styles.iconCircle}>👁️</div>
          <h1 style={styles.title}>DrowseGuard</h1>
          <p style={styles.subtitle}>Driver Safety Dashboard</p>
        </div>
        <div style={styles.toggle}>
          <button style={!isSignup ? styles.toggleBtnActive : styles.toggleBtn} onClick={() => { setIsSignup(false); setError(""); }}>Login</button>
          <button style={isSignup ? styles.toggleBtnActive : styles.toggleBtn} onClick={() => { setIsSignup(true); setError(""); }}>Sign Up</button>
        </div>
        {error && <div style={error.includes("Check your email") ? styles.info : styles.error}>{error}</div>}
        <form onSubmit={handleEmailAuth} style={styles.form}>
          <input type="email" placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} style={styles.input} required />
          <input type="password" placeholder="Password (min 6 chars)" value={password} onChange={e => setPassword(e.target.value)} style={styles.input} required />
          <button type="submit" style={styles.btnPrimary} disabled={loading}>{loading ? "Please wait..." : isSignup ? "Create Account" : "Login"}</button>
        </form>
        <div style={styles.divider}><span style={styles.dividerLine}/><span style={styles.dividerText}>or</span><span style={styles.dividerLine}/></div>
        <button onClick={handleGoogle} style={styles.btnGoogle} disabled={loading}>
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" style={{ width: 20, marginRight: 10 }} />
          Continue with Google
        </button>
      </div>
    </div>
  );
}

const styles = {
  container: { minHeight: "100vh", background: "linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 50%, #16213e 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" },
  card: { background: "rgba(255,255,255,0.05)", backdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 20, padding: "40px 36px", width: "100%", maxWidth: 400 },
  header: { textAlign: "center", marginBottom: 28 },
  iconCircle: { fontSize: 40, background: "rgba(99,102,241,0.2)", borderRadius: "50%", width: 72, height: 72, display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 12 },
  title: { color: "#fff", fontSize: 26, fontWeight: 700, margin: 0 },
  subtitle: { color: "rgba(255,255,255,0.5)", fontSize: 14, margin: "4px 0 0" },
  toggle: { display: "flex", background: "rgba(255,255,255,0.07)", borderRadius: 10, padding: 4, marginBottom: 24 },
  toggleBtn: { flex: 1, padding: "9px 0", border: "none", background: "transparent", color: "rgba(255,255,255,0.4)", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 500 },
  toggleBtnActive: { flex: 1, padding: "9px 0", border: "none", background: "#6366f1", color: "#fff", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 500 },
  error: { background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 16 },
  info: { background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.3)", color: "#86efac", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 16 },
  form: { display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 },
  input: { padding: "13px 16px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.07)", color: "#fff", fontSize: 15, outline: "none" },
  btnPrimary: { padding: "13px 0", borderRadius: 10, border: "none", background: "#6366f1", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer", marginTop: 4 },
  divider: { display: "flex", alignItems: "center", gap: 12, marginBottom: 20 },
  dividerLine: { flex: 1, height: 1, background: "rgba(255,255,255,0.1)" },
  dividerText: { color: "rgba(255,255,255,0.3)", fontSize: 13 },
  btnGoogle: { width: "100%", padding: "13px 0", borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.05)", color: "#fff", fontSize: 15, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" },
};
