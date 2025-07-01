import React from "react";
import { Routes, Route } from "react-router-dom";
import Login from "./pages/Login";
import EmailVerify from "./pages/EmailVerify";
import ResetPassword from "./pages/ResetPassword";
import Settings from "./pages/Settings";
import Dashboard from "./pages/dashboards/Dashboard";
import ProtectedRoute from "./components/ProtectedRoute";
import { SocketStatus } from "./components/SocketStatus";

const App = () => {
  return (
    <div>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/login" element={<Login />} />
        <Route path="/email-verify" element={<EmailVerify />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/settings" element={<Settings />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
      </Routes>
      <SocketStatus />
    </div>
  );
};

export default App;
