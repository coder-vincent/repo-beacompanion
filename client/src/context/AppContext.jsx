/* eslint-disable react-refresh/only-export-components */
import axios from "axios";
import { createContext, useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
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
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userData, setUserData] = useState(false);
  const { socket, isConnected } = useSocket();

  const getUserData = useCallback(async () => {
    try {
      const { data } = await axios.get(backendUrl + "/api/user/data");

      data.success ? setUserData(data.userData) : toast.error(data.message);
    } catch (error) {
      toast.error(error.message);
    }
  }, [backendUrl, setUserData]);

  const getAuthState = useCallback(async () => {
    try {
      const { data } = await axios.get(backendUrl + "/api/auth/is-auth");

      if (data.success) {
        setIsLoggedIn(true);
        getUserData();
      }
    } catch (error) {
      toast.error(error.message);
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
