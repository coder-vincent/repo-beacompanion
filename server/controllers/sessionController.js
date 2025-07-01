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

// Create new monitoring session
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

// End monitoring session
export const endMonitoringSession = async (req, res) => {
  try {
    const { sessionId } = req.params;

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
    const duration = Math.round((new Date(endTime) - startTime) / 1000); // Duration in seconds

    const updatedSession = await updateSession(sessionId, {
      endTime,
      status: "completed",
      duration: formatDuration(duration),
    });

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

// Get session by ID
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

// Get all sessions
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

// Get sessions by user
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

// Update session with behavior data
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

// Get session analytics
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

    // Calculate analytics from behavior data
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

// Helper function to format duration
const formatDuration = (seconds) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
};

// Helper function to calculate session analytics
const calculateSessionAnalytics = (session) => {
  const behaviorData = session.behaviorData || {};
  const alerts = session.alerts || [];

  const analytics = {
    totalBehaviors: 0,
    behaviorBreakdown: {},
    alertCount: alerts.length,
    highSeverityAlerts: 0,
    sessionDuration: session.duration || "N/A",
    averageSeverity: 0,
  };

  // Calculate behavior statistics
  Object.entries(behaviorData).forEach(([behavior, data]) => {
    analytics.totalBehaviors += data.count || 0;
    analytics.behaviorBreakdown[behavior] = {
      count: data.count || 0,
      severity: data.severity || 0,
      lastDetection: data.lastDetection,
    };
  });

  // Calculate alert statistics
  alerts.forEach((alert) => {
    if (alert.type === "warning" && alert.confidence > 0.7) {
      analytics.highSeverityAlerts++;
    }
  });

  // Calculate average severity
  const severities = Object.values(analytics.behaviorBreakdown)
    .map((b) => b.severity)
    .filter((s) => s > 0);

  if (severities.length > 0) {
    analytics.averageSeverity =
      severities.reduce((a, b) => a + b, 0) / severities.length;
  }

  return analytics;
};

// Save monitoring result (dummy implementation)
export const monitorAndSaveResult = async (req, res) => {
  try {
    const { sessionId, result } = req.body;
    if (!sessionId || !result) {
      return res.status(400).json({
        success: false,
        message: "sessionId and result are required",
      });
    }

    // Get the session
    const session = await getSessionById(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Session not found",
      });
    }

    // Update the session's behaviorData (merge new result)
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
