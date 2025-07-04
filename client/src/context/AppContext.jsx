/* eslint-disable react-refresh/only-export-components */
import axios from "axios";
import { createContext, useEffect, useState, useCallback } from "react";
import { useSocket } from "./SocketContext";

export const AppContext = createContext();

export const AppContextProvider = (props) => {
  axios.defaults.withCredentials = true;

  // Determine backend URL based on current host **without** assuming the front-end is always opened via "localhost".
  // 1. If VITE_BACKEND_URL is provided at build time, always prefer it – this is the normal production path.
  // 2. When developing locally we might open the site with:
  //      • http://localhost:5173               – classic desktop dev
  //      • http://127.0.0.1:5173               – some setups / Docker
  //      • http://192.168.x.x:5173 (LAN IP)    – accessing from a phone/tablet on same Wi-Fi
  //    In all those cases the backend is still expected to be available on port 4000 of *the same host*.
  //    Therefore we dynamically build the backend URL from the current hostname instead of hard-coding "localhost".
  // 3. Fallback to the Render production API when none of the above apply (e.g. when the site is opened from
  //    Vercel preview URL and no env var is provided).

  const backendUrl = (() => {
    // Highest priority: explicit env var
    if (import.meta.env.VITE_BACKEND_URL) {
      return import.meta.env.VITE_BACKEND_URL;
    }

    const host = window.location.hostname;

    // Development / LAN: treat localhost, 127.0.0.1, or any private-range IPv4 address as local backend
    const isDevHost =
      host === "localhost" ||
      host === "127.0.0.1" ||
      // Private IPv4 ranges: 10.x.x.x, 172.16-31.x.x, 192.168.x.x
      /^(10|127)\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);

    if (isDevHost) {
      return `http://${host}:4000`;
    }

    // Default production backend (Render)
    return "https://repo-beacompanion-server.onrender.com";
  })();

  const [isLoggedIn, setIsLoggedIn] = useState(null); // null = loading, true = logged in, false = not logged in
  const [userData, setUserData] = useState(null);
  const { socket, isConnected } = useSocket();

  const getUserData = useCallback(async () => {
    try {
      console.log(
        "🔍 AppContext: Attempting to fetch user data from:",
        backendUrl + "/api/user/data"
      );
      console.log(
        "🔍 AppContext: axios.defaults.withCredentials:",
        axios.defaults.withCredentials
      );
      console.log("🔍 AppContext: document.cookie:", document.cookie);

      // Extract token from cookie if available (for production fallback)
      const tokenMatch = document.cookie.match(/token=([^;]+)/);
      const tokenFromCookie = tokenMatch ? tokenMatch[1] : null;

      const config = {
        withCredentials: true,
      };

      // If we have a token from cookie but it's production, also send as header
      if (tokenFromCookie && !backendUrl.includes("localhost")) {
        config.headers = {
          Authorization: `Bearer ${tokenFromCookie}`,
        };
        console.log("🔍 AppContext: Added Authorization header for production");
      }

      const { data } = await axios.get(backendUrl + "/api/user/data", config);

      console.log("📊 AppContext: User data response:", data);

      if (data.success) {
        console.log(
          "✅ AppContext: Successfully got user data:",
          data.userData
        );
        setUserData(data.userData);
      } else {
        console.error("❌ AppContext: Failed to get user data:", data.message);
        setUserData(null);
        // If getting user data failed, the user might not be properly authenticated
        setIsLoggedIn(false);
      }
    } catch (error) {
      console.error("🚨 AppContext: Error getting user data:", error);
      console.error("🚨 AppContext: Error details:", {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
      });
      setUserData(null);
      // If there's a network error or auth error, treat as not logged in
      if (error.response?.status === 401 || error.response?.status === 403) {
        setIsLoggedIn(false);
      }
    }
  }, [backendUrl]);

  const getAuthState = useCallback(async () => {
    try {
      const { data } = await axios.get(backendUrl + "/api/auth/is-auth");

      if (data.success) {
        setIsLoggedIn(true);
        getUserData();
      } else {
        console.log("Not authenticated:", data.message);
        setIsLoggedIn(false);
        setUserData(null);
      }
    } catch (error) {
      console.log("Auth check error:", error.message);
      setIsLoggedIn(false);
      setUserData(null);
    }
  }, [backendUrl, getUserData]);

  // Set up socket event listeners when socket is available
  useEffect(() => {
    if (socket && isConnected) {
      console.log("Setting up AppContext socket listeners");

      const handleUserListUpdate = () => {
        console.log("Received userListUpdate event in AppContext");
        getUserData();
      };

      socket.on("userListUpdate", handleUserListUpdate);

      // Cleanup function
      return () => {
        socket.off("userListUpdate", handleUserListUpdate);
      };
    }
  }, [socket, isConnected, getUserData]);

  useEffect(() => {
    getAuthState();
  }, [getAuthState]);

  const value = {
    backendUrl,
    isLoggedIn,
    setIsLoggedIn,
    userData,
    setUserData,
    getUserData,
  };

  return (
    <AppContext.Provider value={value}>{props.children}</AppContext.Provider>
  );
};
