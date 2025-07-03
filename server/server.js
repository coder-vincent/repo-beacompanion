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
    await connectDB();

    // Sync all models
    await sequelize.sync({ alter: true });
    console.log("Database models synchronized successfully");

    // Start the server
    httpServer.listen(port, () => {
      console.log(`Server started on port: ${port}`);
      console.log(`CORS allowed origins:`, allowedOrigins);
      console.log(`Socket.IO server ready`);
    });
  } catch (error) {
    console.error("Failed to initialize server:", error);
    process.exit(1);
  }
};

// Increase JSON body parser limit for large ML data
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(cookieParser());

// Enhanced CORS configuration
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
  })
);

// NEW: Explicitly handle all CORS pre-flight requests early
app.options(
  "*",
  cors({
    origin: allowedOrigins,
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
  })
);

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
