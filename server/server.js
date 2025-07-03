import express from "express";
import cors from "cors";
import "dotenv/config";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import { Server } from "socket.io";
import { connectDB, sequelize } from "./config/mysql.js";
import authRouter from "./routes/authRoutes.js";
import userRouter from "./routes/userRoutes.js";
import contentRouter from "./routes/contentRoutes.js";
import mlRouter from "./routes/mlRoutes.js";
import sessionRouter from "./routes/sessionRoutes.js";

// Only disable console.log in production, keep it for development debugging
if (process.env.NODE_ENV === "production") {
  console.log = () => {};
}

const app = express();
const httpServer = createServer(app);

// Define allowed origins before using them
const allowedOrigins =
  process.env.NODE_ENV === "production"
    ? [
        "https://repo-beacompanion.vercel.app", // Vercel frontend
        "https://repo-beacompanion-server.onrender.com", // Render backend
        "https://beacompanion.online", // root domain
        "https://www.beacompanion.online", // www subdomain
        process.env.CLIENT_URL, // Additional client URL if set
      ].filter(Boolean)
    : [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:3000",
        "https://repo-beacompanion.vercel.app", // Allow Vercel frontend in development too
        "https://repo-beacompanion-server.onrender.com", // Allow production backend in development
      ];

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins.filter(Boolean), // Remove any undefined values
    credentials: true,
    methods: ["GET", "POST"],
  },
});

const port = process.env.PORT || 4000;

// Initialize database connection and sync models
const initializeServer = async () => {
  try {
    let dbReady = false;
    try {
      await connectDB();

      // Sync all models
      await sequelize.sync({ alter: true });
      console.log("Database models synchronized successfully");
      dbReady = true;
    } catch (dbErr) {
      // Log but continue – allows the API (e.g., /health) to respond instead of Render 502
      console.error(
        "\u001b[31m[WARN] Database unavailable – continuing without DB. Most endpoints may fail.\u001b[0m"
      );
      console.error(dbErr);
    }

    // Always start the server so Render health-check succeeds
    httpServer.listen(port, () => {
      console.log(`Server started on port: ${port}`);
      console.log(`CORS allowed origins:`, allowedOrigins);
      console.log(`Socket.IO server ready`);
      if (!dbReady) {
        console.warn(
          "Running without a database connection – only non-DB routes will work."
        );
      }
    });
  } catch (error) {
    console.error("Failed to initialize server:", error);
    process.exit(1);
  }
};

// Enhanced CORS configuration – REGISTER **before** body parsers so even parsing errors carry CORS headers
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
  })
);

// Add explicit CORS headers for preflight requests
app.use((req, res, next) => {
  const origin = req.headers.origin;

  // Handle different origin scenarios
  if (!origin) {
    // No origin header (direct API calls, server-to-server, etc.)
    res.header("Access-Control-Allow-Origin", "*");
    console.log(`🔓 CORS: No origin header - allowing all (likely API call)`);
  } else if (allowedOrigins.includes(origin)) {
    // Origin is in our allowed list
    res.header("Access-Control-Allow-Origin", origin);
    console.log(`✅ CORS: Allowed origin ${origin}`);
  } else if (process.env.NODE_ENV !== "production") {
    // In development, be more permissive
    res.header("Access-Control-Allow-Origin", origin);
    console.log(`🔧 CORS: Dev mode - allowing origin ${origin}`);
  } else {
    // Production with unknown origin - still allow but log warning
    res.header("Access-Control-Allow-Origin", origin);
    console.warn(
      `⚠️ CORS: Unknown origin ${origin} allowed. Allowed origins:`,
      allowedOrigins
    );
  }

  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Cookie"
  );

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    console.log(
      `🔍 CORS: Handling OPTIONS preflight request from ${
        origin || "no-origin"
      }`
    );
    res.sendStatus(200);
  } else {
    next();
  }
});

// Increase JSON body parser limit for large ML data – declared **after** CORS
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(cookieParser());

// NOTE: Express 5 no longer accepts wildcard patterns like "*" or "/*" in route definitions.
// The built-in CORS middleware already handles all OPTIONS pre-flight requests, so the extra
// app.options handler is unnecessary and, in fact, breaks on Render (path-to-regexp error).

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("error", (error) => {
    console.error("Socket error:", error);
  });

  socket.on("disconnect", (reason) => {
    console.log("Client disconnected:", socket.id, "Reason:", reason);
  });
});

// Make io accessible to routes
app.set("io", io);

// API Endpoints
app.get("/", (req, res) => res.send("Server Connected"));
app.use("/api/auth", authRouter);
app.use("/api/user", userRouter);
app.use("/api/content", contentRouter);
app.use("/api/ml", mlRouter);
app.use("/api/session", sessionRouter);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Error details:", err);

  // Handle JSON parsing errors specifically
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({
      success: false,
      message: "Invalid JSON format in request body",
      error: err.message,
    });
  }

  console.error(err.stack);
  res.status(500).json({ success: false, message: "Something went wrong!" });
});

// Initialize the server
initializeServer();
