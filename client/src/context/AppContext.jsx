/* eslint-disable react-refresh/only-export-components */
import axios from "axios";
import { createContext, useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
import { io } from "socket.io-client";

export const AppContext = createContext();

export const AppContextProvider = (props) => {
  axios.defaults.withCredentials = true;

  const backendUrl = import.meta.env.VITE_BACKEND_URL;
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userData, setUserData] = useState(false);

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

  useEffect(() => {
    getAuthState();

    const socket = io(backendUrl, { withCredentials: true });

    socket.on("connect", () => {
      console.log("Connected to Socket.IO server from AppContext");
    });

    socket.on("userListUpdate", () => {
      console.log("Received userListUpdate event in AppContext");
      getUserData();
    });

    socket.on("disconnect", () => {
      console.log("Disconnected from Socket.IO server from AppContext");
    });

    return () => {
      socket.disconnect();
    };
  }, [backendUrl, getAuthState, getUserData]);

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
