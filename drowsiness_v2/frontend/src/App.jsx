// frontend/src/App.jsx
import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { supabase } from "./supabase/config";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";

function PrivateRoute({ user, children }) {
  if (user === undefined) return <div style={loadingStyle}>Loading...</div>;
  return user ? children : <Navigate to="/" replace />;
}

export default function App() {
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    // Get current session on load
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null);
    });

    // Listen for login/logout
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />
        <Route path="/dashboard" element={<PrivateRoute user={user}><Dashboard /></PrivateRoute>} />
      </Routes>
    </BrowserRouter>
  );
}

const loadingStyle = {
  display: "flex", alignItems: "center", justifyContent: "center",
  height: "100vh", background: "#0f0f1a", color: "#fff", fontSize: 18,
};
