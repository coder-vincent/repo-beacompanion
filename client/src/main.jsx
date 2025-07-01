import "./lib/disable-console.js";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider } from "./components/theme/theme-provider";
import { AppContextProvider } from "./context/AppContext";
import { SocketProvider } from "./context/SocketContext";
import { Toaster } from "react-hot-toast";

createRoot(document.getElementById("root")).render(
  <BrowserRouter
    future={{
      v7_startTransition: true,
      v7_relativeSplatPath: true,
    }}
  >
    <SocketProvider>
      <AppContextProvider>
        <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
          <>
            <App />
            <Toaster
              position="top-center"
              reverseOrder={false}
              toastOptions={{
                duration: 1500,
                style: {
                  background: "var(--popover)",
                  color: "var(--popover-foreground)",
                  border: "2px solid var(--border)",
                },
              }}
            />
          </>
        </ThemeProvider>
      </AppContextProvider>
    </SocketProvider>
  </BrowserRouter>
);
