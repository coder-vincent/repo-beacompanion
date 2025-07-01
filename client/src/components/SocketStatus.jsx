import { useSocket } from "../context/SocketContext";

export const SocketStatus = () => {
  const { isConnected, connectionError } = useSocket();

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div
        className={`px-3 py-2 rounded-md text-sm font-medium ${
          isConnected
            ? "bg-green-500 text-white"
            : connectionError
            ? "bg-red-500 text-white"
            : "bg-yellow-500 text-black"
        }`}
      >
        {isConnected ? (
          <span className="flex items-center gap-2">
            <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
            Socket Connected
          </span>
        ) : connectionError ? (
          <span className="flex items-center gap-2">
            <div className="w-2 h-2 bg-white rounded-full"></div>
            Socket Error: {connectionError}
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
            Connecting...
          </span>
        )}
      </div>
    </div>
  );
};
