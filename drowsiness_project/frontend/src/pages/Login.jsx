import React, { useState } from "react";
import { supabase } from "../supabase/config";
import { useNavigate } from "react-router-dom";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLogin, setIsLogin] = useState(true);
  const [message, setMessage] = useState({ text: "", type: "" });
  const navigate = useNavigate();

  const handleAuth = async (e) => {
    e.preventDefault();
    setMessage({ text: "", type: "" });
    if (!email || !password) return setMessage({ text: "Please enter email and password.", type: "error" });

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate("/dashboard");
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMessage({ text: "Check your email to confirm signup.", type: "success" });
      }
    } catch (err) {
      setMessage({ text: err.message, type: "error" });
    }
  };

  const handleGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({ 
      provider: "google", 
      options: { redirectTo: window.location.origin + "/dashboard" } 
    });
    if (error) setMessage({ text: error.message, type: "error" });
  };

  return (
    <div className="login-container">
      <div className="glass-panel login-card">
        <div className="icon-wrapper">
          <span className="icon">👁️</span>
        </div>
        <h1 className="title">DrowseGuard</h1>
        <p className="subtitle">Driver Safety Dashboard</p>

        <div className="toggle-container">
          <div 
            className={`toggle-tab ${isLogin ? 'active-tab' : ''}`} 
            onClick={() => setIsLogin(true)}
          >
            Login
          </div>
          <div 
            className={`toggle-tab ${!isLogin ? 'active-tab' : ''}`} 
            onClick={() => setIsLogin(false)}
          >
            Sign Up
          </div>
        </div>

        <form onSubmit={handleAuth} style={{width: "100%"}}>
          <input 
            type="email" 
            placeholder="Email" 
            value={email} 
            onChange={e => setEmail(e.target.value)} 
            className="glass-input" 
            style={{marginBottom: '12px'}}
          />
          <input 
            type="password" 
            placeholder="Password" 
            value={password} 
            onChange={e => setPassword(e.target.value)} 
            className="glass-input" 
            style={{marginBottom: '16px'}}
          />
          <button type="submit" className="btn-primary">
            {isLogin ? "Login" : "Sign Up"}
          </button>
        </form>

        <div className="divider">
          <span className="line"></span>
          <span className="or-text">or</span>
          <span className="line"></span>
        </div>

        <button onClick={handleGoogle} className="google-button">
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="google-icon" />
          Continue with Google
        </button>

        {message.text && (
          <div className={`message-box ${message.type === "error" ? "error-box" : "success-box"}`}>
            {message.text}
          </div>
        )}
      </div>

      <style>{`
        .login-container {
          min-height: 100vh;
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 20px;
        }
        .login-card {
          padding: 40px;
          max-width: 400px;
          width: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          animation: slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .icon-wrapper {
          width: 72px;
          height: 72px;
          border-radius: 50%;
          background: rgba(99, 102, 241, 0.15);
          display: flex;
          justify-content: center;
          align-items: center;
          margin-bottom: 16px;
          box-shadow: 0 0 20px rgba(99, 102, 241, 0.2);
        }
        .icon {
          font-size: 36px;
          animation: blink 4s infinite;
        }
        @keyframes blink {
          0%, 96%, 98%, 100% { opacity: 1; transform: scaleY(1); }
          97% { opacity: 0.5; transform: scaleY(0.1); }
        }
        .title {
          font-size: 28px;
          font-weight: 800;
          margin-bottom: 4px;
          background: linear-gradient(to right, #fff, #a5b4fc);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .subtitle {
          color: var(--text-muted);
          font-size: 14px;
          margin-bottom: 24px;
          font-weight: 500;
        }
        .toggle-container {
          display: flex;
          background: rgba(0, 0, 0, 0.3);
          border-radius: 50px;
          padding: 4px;
          width: 100%;
          margin-bottom: 24px;
          border: 1px solid var(--glass-border);
        }
        .toggle-tab {
          flex: 1;
          text-align: center;
          padding: 10px;
          cursor: pointer;
          border-radius: 50px;
          color: var(--text-muted);
          font-size: 14px;
          font-weight: 600;
          transition: all 0.3s ease;
        }
        .active-tab {
          background: var(--primary);
          color: white;
          box-shadow: 0 4px 12px var(--glass-glow);
        }
        .divider {
          display: flex;
          align-items: center;
          width: 100%;
          margin: 24px 0;
        }
        .line {
          flex: 1;
          height: 1px;
          background: var(--glass-border);
        }
        .or-text {
          color: var(--text-muted);
          margin: 0 14px;
          font-size: 13px;
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        .google-button {
          width: 100%;
          background: rgba(255, 255, 255, 0.05);
          color: var(--text-main);
          border: 1px solid var(--glass-border);
          padding: 14px;
          border-radius: 12px;
          display: flex;
          justify-content: center;
          align-items: center;
          cursor: pointer;
          font-size: 14px;
          font-weight: 600;
          transition: all 0.3s ease;
        }
        .google-button:hover {
          background: rgba(255, 255, 255, 0.1);
          transform: translateY(-2px);
        }
        .google-icon {
          width: 18px;
          height: 18px;
          margin-right: 10px;
        }
        .message-box {
          width: 100%;
          padding: 12px;
          border-radius: 10px;
          margin-top: 20px;
          font-size: 14px;
          text-align: center;
          font-weight: 500;
        }
        .error-box {
          background: rgba(239, 68, 68, 0.15);
          border: 1px solid rgba(239, 68, 68, 0.3);
          color: #fca5a5;
        }
        .success-box {
          background: rgba(16, 185, 129, 0.15);
          border: 1px solid rgba(16, 185, 129, 0.3);
          color: #6ee7b7;
        }
      `}</style>
    </div>
  );
}
