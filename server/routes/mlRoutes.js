import express from "express";
import userAuth from "../middleware/userAuth.js";
import {
  analyzeBehavior,
  getModelStatus,
  batchAnalysis,
  evaluateDataset,
  resetAnalysisCounter,
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

// ML Analysis Routes (temporarily without authentication for demo)
mlRouter.post("/analyze", mlDataMiddleware, analyzeBehavior);
mlRouter.get("/status", getModelStatus);
mlRouter.post("/batch", mlDataMiddleware, batchAnalysis);
mlRouter.post("/evaluate", mlDataMiddleware, evaluateDataset);
mlRouter.post("/reset-counter", resetAnalysisCounter);

export default mlRouter;
