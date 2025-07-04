import express from "express";
import {
  analyzeBehavior,
  getModelStatus,
  batchAnalysis,
  evaluateDataset,
  resetAnalysisCounter,
} from "../controllers/mlController.js";

const mlRouter = express.Router();

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

mlRouter.post("/analyze", mlDataMiddleware, analyzeBehavior);
mlRouter.get("/status", getModelStatus);
mlRouter.post("/batch", mlDataMiddleware, batchAnalysis);
mlRouter.post("/evaluate", mlDataMiddleware, evaluateDataset);
mlRouter.post("/reset-counter", resetAnalysisCounter);

export default mlRouter;
