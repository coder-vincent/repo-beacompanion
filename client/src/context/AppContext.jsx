/* eslint-disable react-refresh/only-export-components */
import axios from "axios";
import { createContext, useEffect, useState, useCallback } from "react";
import { useSocket } from "./SocketContext";

export const AppContext = createContext();

export const AppContextProvider = (props) => {
  axios.defaults.withCredentials = true;

  const isLocalhost = window.location.hostname === "localhost";

  const backendUrl =
    import.meta.env.VITE_BACKEND_URL ||
    (isLocalhost
      ? "http://localhost:4000"
      : "https://repo-beacompanion-server.onrender.com");

  const [isLoggedIn, setIsLoggedIn] = useState(null); // null = loading, true = logged in, false = not logged in
  const [userData, setUserData] = useState(null);
  const { socket, isConnected } = useSocket();

  // On initial load, ensure axios has Authorization header if token is stored
  useEffect(() => {
    const storedToken = localStorage.getItem("authToken");
    if (storedToken) {
      axios.defaults.headers.common["Authorization"] = `Bearer ${storedToken}`;
    }
  }, []);

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
      // Fallback: get token stored in localStorage (helps on mobile where cookies may be blocked)
      const tokenFromStorage = localStorage.getItem("authToken");

      const config = {
        withCredentials: true,
      };

      // Prioritize token from cookie, otherwise use token from localStorage
      const authTokenHeader = tokenFromCookie || tokenFromStorage;
      if (authTokenHeader) {
        config.headers = {
          Authorization: `Bearer ${authTokenHeader}`,
        };
        console.log(
          "🔍 AppContext: Added Authorization header",
          authTokenHeader === tokenFromCookie
            ? "from cookie"
            : "from localStorage"
        );
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
      const tokenFromStorage = localStorage.getItem("authToken");
      const config = {
        withCredentials: true,
      };

      if (tokenFromStorage) {
        config.headers = {
          Authorization: `Bearer ${tokenFromStorage}`,
        };
      }

      const { data } = await axios.get(
        backendUrl + "/api/auth/is-auth",
        config
      );

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
