import path from "path";
import { fileURLToPath } from "url";
import {
  createSession,
  updateSession,
  getSessionById,
  getAllSessions,
  getSessionsByUser,
} from "../models/sessionModel.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const createMonitoringSession = async (req, res) => {
  try {
    const { userId, userName, startTime, status } = req.body;

    if (!userId || !userName) {
      return res.status(400).json({
        success: false,
        message: "User ID and name are required",
      });
    }

    const sessionData = {
      userId,
      userName,
      startTime: startTime || new Date().toISOString(),
      status: status || "active",
      behaviorData: {},
      alerts: [],
    };

    const session = await createSession(sessionData);

    res.status(201).json({
      success: true,
      session: {
        id: session.id,
        userId: session.userId,
        userName: session.userName,
        startTime: session.startTime,
        status: session.status,
      },
    });
  } catch (error) {
    console.error("Session Creation Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create monitoring session",
      error: error.message,
    });
  }
};

export const endMonitoringSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { behaviorData, alerts } = req.body || {};

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: "Session ID is required",
      });
    }

    const session = await getSessionById(sessionId);

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Session not found",
      });
    }

    const endTime = new Date().toISOString();
    const startTime = new Date(session.startTime);
    const duration = Math.round((new Date(endTime) - startTime) / 1000);

    const updateData = {
      endTime,
      status: "completed",
      duration: formatDuration(duration),
    };

    if (behaviorData) {
      updateData.behaviorData =
        typeof behaviorData === "string"
          ? behaviorData
          : JSON.stringify(behaviorData);
      console.log("Saving behavior data to session");
    }

    if (alerts) {
      updateData.alerts =
        typeof alerts === "string" ? alerts : JSON.stringify(alerts);
      console.log("Saving alerts to session");
    }

    const updatedSession = await updateSession(sessionId, updateData);

    console.log("Session successfully ended and data saved");

    res.json({
      success: true,
      session: updatedSession,
    });
  } catch (error) {
    console.error("Session End Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to end monitoring session",
      error: error.message,
    });
  }
};

export const getSession = async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await getSessionById(sessionId);

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Session not found",
      });
    }

    res.json({
      success: true,
      session,
    });
  } catch (error) {
    console.error("Get Session Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get session",
      error: error.message,
    });
  }
};

export const getAllMonitoringSessions = async (req, res) => {
  try {
    const sessions = await getAllSessions();

    res.json({
      success: true,
      sessions,
    });
  } catch (error) {
    console.error("Get All Sessions Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get sessions",
      error: error.message,
    });
  }
};

export const getUserSessions = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    const sessions = await getSessionsByUser(userId);

    res.json({
      success: true,
      sessions,
    });
  } catch (error) {
    console.error("Get User Sessions Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get user sessions",
      error: error.message,
    });
  }
};

export const updateSessionData = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { behaviorData, alerts } = req.body;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: "Session ID is required",
      });
    }

    const session = await getSessionById(sessionId);

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Session not found",
      });
    }

    const updateData = {};
    if (behaviorData) updateData.behaviorData = behaviorData;
    if (alerts) updateData.alerts = alerts;

    const updatedSession = await updateSession(sessionId, updateData);

    res.json({
      success: true,
      session: updatedSession,
    });
  } catch (error) {
    console.error("Update Session Data Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update session data",
      error: error.message,
    });
  }
};

export const getSessionAnalytics = async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await getSessionById(sessionId);

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Session not found",
      });
    }

    const analytics = calculateSessionAnalytics(session);

    res.json({
      success: true,
      analytics,
    });
  } catch (error) {
    console.error("Session Analytics Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get session analytics",
      error: error.message,
    });
  }
};

const formatDuration = (seconds) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
};

const calculateSessionAnalytics = (session) => {
  console.log("Calculating analytics for session:", session.id);
  console.log("Session data:", {
    behaviorData: session.behaviorData,
    alerts: session.alerts,
    alertsType: typeof session.alerts,
    behaviorDataType: typeof session.behaviorData,
    duration: session.duration,
  });

  let behaviorData = {};
  try {
    if (session.behaviorData) {
      let data = session.behaviorData;

      if (typeof data === "string") {
        data = JSON.parse(data);

        if (typeof data === "string") {
          data = JSON.parse(data);
        }
      }

      if (typeof data === "object" && data !== null) {
        behaviorData = data;
      } else {
        console.warn(
          "BehaviorData is not a valid object after parsing:",
          typeof data
        );
        behaviorData = {};
      }
    }
  } catch (error) {
    console.error("Error parsing behaviorData JSON:", error);
    behaviorData = {};
  }

  console.log("Processed behaviorData:", behaviorData);

  let alerts = [];
  try {
    if (session.alerts) {
      let data = session.alerts;

      if (typeof data === "string") {
        data = JSON.parse(data);

        if (typeof data === "string") {
          data = JSON.parse(data);
        }
      }

      if (Array.isArray(data)) {
        alerts = data;
      } else {
        console.warn("Alerts is not a valid array after parsing:", typeof data);
        alerts = [];
      }
    }
  } catch (error) {
    console.error("Error parsing alerts JSON:", error);
    alerts = [];
  }

  console.log("Processed alerts:", alerts);

  const analytics = {
    totalBehaviors: 0,
    behaviorBreakdown: {},
    alertCount: alerts.length,
    highSeverityAlerts: 0,
    sessionDuration: session.duration || "N/A",
    averageSeverity: 0,
    averageConfidence: 0,
    sessionSummary: {
      startTime: session.startTime,
      endTime: session.endTime,
      status: session.status,
    },
  };

  Object.entries(behaviorData).forEach(([behavior, data]) => {
    const count = data.count || 0;
    const totalConfidence = data.totalConfidence || 0;
    const avgConfidence = count > 0 ? totalConfidence / count : 0;

    analytics.totalBehaviors += count;
    analytics.behaviorBreakdown[behavior] = {
      count: count,
      totalConfidence: totalConfidence,
      averageConfidence: avgConfidence,
      severity: avgConfidence,
      lastDetection: data.lastDetection,
      behaviorType: behavior
        .replace("_", " ")
        .replace(/\b\w/g, (l) => l.toUpperCase()),
    };
  });

  if (Array.isArray(alerts)) {
    alerts.forEach((alert) => {
      if (alert && alert.confidence && alert.confidence > 0.7) {
        analytics.highSeverityAlerts++;
      }
    });
  }

  const confidenceValues = Object.values(analytics.behaviorBreakdown)
    .map((b) => b.averageConfidence)
    .filter((c) => c > 0);

  if (confidenceValues.length > 0) {
    analytics.averageConfidence =
      confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length;
    analytics.averageSeverity = analytics.averageConfidence;
  }

  console.log("Final analytics:", analytics);
  return analytics;
};

export const monitorAndSaveResult = async (req, res) => {
  try {
    const { sessionId, result } = req.body;
    if (!sessionId || !result) {
      return res.status(400).json({
        success: false,
        message: "sessionId and result are required",
      });
    }

    const session = await getSessionById(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Session not found",
      });
    }

    const updatedBehaviorData = {
      ...(session.behaviorData || {}),
      ...result,
    };

    await updateSession(sessionId, { behaviorData: updatedBehaviorData });

    res
      .status(200)
      .json({ success: true, message: "Monitoring result saved." });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to save monitoring result.",
      error: error.message,
    });
  }
};
