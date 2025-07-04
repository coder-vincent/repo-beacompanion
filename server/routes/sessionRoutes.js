import express from "express";
import userAuth from "../middleware/userAuth.js";
import {
  createMonitoringSession,
  endMonitoringSession,
  getSession,
  getAllMonitoringSessions,
  getUserSessions,
  updateSessionData,
  getSessionAnalytics,
  monitorAndSaveResult,
} from "../controllers/sessionController.js";

const sessionRouter = express.Router();

sessionRouter.post("/monitor", monitorAndSaveResult);

sessionRouter.post("/", userAuth, createMonitoringSession);
sessionRouter.put("/:sessionId/end", userAuth, endMonitoringSession);
sessionRouter.get("/:sessionId", userAuth, getSession);
sessionRouter.get("/", userAuth, getAllMonitoringSessions);
sessionRouter.get("/user/:userId", userAuth, getUserSessions);
sessionRouter.put("/:sessionId/data", userAuth, updateSessionData);
sessionRouter.get("/:sessionId/analytics", userAuth, getSessionAnalytics);

export default sessionRouter;
