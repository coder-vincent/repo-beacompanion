/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState } from "react";
import { io } from "socket.io-client";

const SocketContext = createContext();

export const useSocket = () => {
  return useContext(SocketContext);
};

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState(null);

  useEffect(() => {
    // Determine server URL based on environment
    const isLocalhost = window.location.hostname === "localhost";
    const isVercelDeployment = window.location.hostname.includes("vercel.app");

    const serverUrl =
      import.meta.env.VITE_BACKEND_URL ||
      (isLocalhost
        ? "http://localhost:4000"
        : "https://repo-beacompanion-server.onrender.com");

    console.log(
      "Environment:",
      isLocalhost
        ? "Development (localhost)"
        : isVercelDeployment
        ? "Production (Vercel)"
        : "Production"
    );
    console.log("Attempting to connect to Socket.IO server:", serverUrl);

    const socketInstance = io(serverUrl, {
      withCredentials: true,
      transports: ["websocket", "polling"], // Try websocket first, fallback to polling
      timeout: 10000,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socketInstance.on("connect", () => {
      console.log("✅ Connected to socket server:", socketInstance.id);
      setIsConnected(true);
      setConnectionError(null);
    });

    socketInstance.on("disconnect", (reason) => {
      console.log("❌ Disconnected from socket server. Reason:", reason);
      setIsConnected(false);
      if (reason === "io server disconnect") {
        // Server disconnected, try to reconnect
        socketInstance.connect();
      }
    });

    socketInstance.on("connect_error", (error) => {
      console.error("🔥 Socket connection error:", error.message);
      setConnectionError(error.message);
      setIsConnected(false);
    });

    socketInstance.on("reconnect", (attemptNumber) => {
      console.log("🔄 Socket reconnected after", attemptNumber, "attempts");
      setIsConnected(true);
      setConnectionError(null);
    });

    socketInstance.on("reconnect_error", (error) => {
      console.error("🔥 Socket reconnection error:", error.message);
      setConnectionError(error.message);
    });

    socketInstance.on("reconnect_failed", () => {
      console.error("💀 Socket reconnection failed after maximum attempts");
      setConnectionError("Failed to reconnect to server");
    });

    setSocket(socketInstance);

    return () => {
      console.log("🧹 Cleaning up socket connection");
      socketInstance.disconnect();
    };
  }, []);

  const contextValue = {
    socket,
    isConnected,
    connectionError,
  };

  return (
    <SocketContext.Provider value={contextValue}>
      {children}
    </SocketContext.Provider>
  );
};
