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

if (process.env.NODE_ENV === "production") {
  console.log = () => {};
}

const app = express();
const httpServer = createServer(app);

const allowedOrigins =
  process.env.NODE_ENV === "production"
    ? [
        "https://repo-beacompanion.vercel.app", // Vercel frontend
        "https://repo-beacompanion-server.onrender.com", // Render backend
        "https://beacompanion.online", // root domain
        "https://www.beacompanion.online", // www subdomain
        process.env.CLIENT_URL,
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
    origin: allowedOrigins.filter(Boolean),
    credentials: true,
    methods: ["GET", "POST"],
  },
});

const port = process.env.PORT || 4000;

const initializeServer = async () => {
  try {
    let dbReady = false;
    try {
      await connectDB();

      await sequelize.sync({ alter: true });
      console.log("Database models synchronized successfully");
      dbReady = true;
    } catch (dbErr) {
      console.error(
        "\u001b[31m[WARN] Database unavailable – continuing without DB. Most endpoints may fail.\u001b[0m"
      );
      console.error(dbErr);
    }

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

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
  })
);

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (!origin) {
    res.header("Access-Control-Allow-Origin", "*");
    console.log(`CORS: No origin header - allowing all (likely API call)`);
  } else if (allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    console.log(`CORS: Allowed origin ${origin}`);
  } else if (process.env.NODE_ENV !== "production") {
    res.header("Access-Control-Allow-Origin", origin);
    console.log(`🔧 CORS: Dev mode - allowing origin ${origin}`);
  } else {
    res.header("Access-Control-Allow-Origin", origin);
    console.warn(
      `CORS: Unknown origin ${origin} allowed. Allowed origins:`,
      allowedOrigins
    );
  }

  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Cookie"
  );

  if (req.method === "OPTIONS") {
    console.log(
      `CORS: Handling OPTIONS preflight request from ${origin || "no-origin"}`
    );
    res.sendStatus(200);
  } else {
    next();
  }
});

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(cookieParser());

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("error", (error) => {
    console.error("Socket error:", error);
  });

  socket.on("disconnect", (reason) => {
    console.log("Client disconnected:", socket.id, "Reason:", reason);
  });
});

app.set("io", io);

app.get("/", (req, res) => res.send("Server Connected"));
app.use("/api/auth", authRouter);
app.use("/api/user", userRouter);
app.use("/api/content", contentRouter);
app.use("/api/ml", mlRouter);
app.use("/api/session", sessionRouter);

app.use((err, req, res, next) => {
  console.error("Error details:", err);

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

initializeServer();
