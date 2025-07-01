import express from "express";
import userAuth from "../middleware/userAuth.js";
import {
  analyzeBehavior,
  getModelStatus,
  batchAnalysis,
  evaluateDataset,
} from "../controllers/mlController.js";

const mlRouter = express.Router();

// Middleware for handling large ML data payloads
const mlDataMiddleware = express.json({
  limit: "50mb",
  verify: (req, res, buf) => {
    try {
      JSON.parse(buf);
    } catch (e) {
      res.status(400).json({
        success: false,
        message: "Invalid JSON payload",
      });
      throw new Error("Invalid JSON");
    }
  },
});

// Test endpoint without auth for debugging
mlRouter.post("/test-analyze", mlDataMiddleware, analyzeBehavior);

// ML Analysis Routes (with authentication and large payload support)
mlRouter.post("/analyze", userAuth, mlDataMiddleware, analyzeBehavior);
mlRouter.get("/status", userAuth, getModelStatus);
mlRouter.post("/batch", userAuth, mlDataMiddleware, batchAnalysis);
mlRouter.post("/evaluate", userAuth, mlDataMiddleware, evaluateDataset);

export default mlRouter;
