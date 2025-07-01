import { DataTypes } from "sequelize";
import { sequelize } from "../config/mysql.js";

const Session = sequelize.define(
  "Session",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "users",
        key: "id",
      },
    },
    userName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    startTime: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    endTime: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    duration: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM("active", "completed", "paused"),
      allowNull: false,
      defaultValue: "active",
    },
    behaviorData: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {},
    },
    alerts: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: [],
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "monitoring_sessions",
    timestamps: true,
    indexes: [
      {
        fields: ["userId"],
        name: "monitoring_sessions_user_idx",
      },
    ],
  }
);

// Create session
export const createSession = async (sessionData) => {
  try {
    const session = await Session.create(sessionData);
    return session.toJSON();
  } catch (error) {
    console.error("Create Session Error:", error);
    throw error;
  }
};

// Get session by ID
export const getSessionById = async (sessionId) => {
  try {
    const session = await Session.findByPk(sessionId);
    return session ? session.toJSON() : null;
  } catch (error) {
    console.error("Get Session By ID Error:", error);
    throw error;
  }
};

// Update session
export const updateSession = async (sessionId, updateData) => {
  try {
    const session = await Session.findByPk(sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    await session.update(updateData);
    return session.toJSON();
  } catch (error) {
    console.error("Update Session Error:", error);
    throw error;
  }
};

// Get all sessions
export const getAllSessions = async () => {
  try {
    const sessions = await Session.findAll({
      order: [["createdAt", "DESC"]],
    });
    return sessions.map((session) => session.toJSON());
  } catch (error) {
    console.error("Get All Sessions Error:", error);
    throw error;
  }
};

// Get sessions by user ID
export const getSessionsByUser = async (userId) => {
  try {
    const sessions = await Session.findAll({
      where: { userId },
      order: [["createdAt", "DESC"]],
    });
    return sessions.map((session) => session.toJSON());
  } catch (error) {
    console.error("Get Sessions By User Error:", error);
    throw error;
  }
};

// Get active sessions
export const getActiveSessions = async () => {
  try {
    const sessions = await Session.findAll({
      where: { status: "active" },
      order: [["createdAt", "DESC"]],
    });
    return sessions.map((session) => session.toJSON());
  } catch (error) {
    console.error("Get Active Sessions Error:", error);
    throw error;
  }
};

// Delete session
export const deleteSession = async (sessionId) => {
  try {
    const session = await Session.findByPk(sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    await session.destroy();
    return true;
  } catch (error) {
    console.error("Delete Session Error:", error);
    throw error;
  }
};

// Get session statistics
export const getSessionStatistics = async () => {
  try {
    const totalSessions = await Session.count();
    const activeSessions = await Session.count({ where: { status: "active" } });
    const completedSessions = await Session.count({
      where: { status: "completed" },
    });

    // Get average session duration
    const completedSessionsData = await Session.findAll({
      where: { status: "completed" },
      attributes: ["duration"],
    });

    let totalDuration = 0;
    let validSessions = 0;

    completedSessionsData.forEach((session) => {
      if (session.duration) {
        // Parse duration string (HH:MM:SS) to seconds
        const [hours, minutes, seconds] = session.duration
          .split(":")
          .map(Number);
        totalDuration += hours * 3600 + minutes * 60 + seconds;
        validSessions++;
      }
    });

    const averageDuration =
      validSessions > 0 ? totalDuration / validSessions : 0;

    return {
      totalSessions,
      activeSessions,
      completedSessions,
      averageDuration: formatDuration(averageDuration),
    };
  } catch (error) {
    console.error("Get Session Statistics Error:", error);
    throw error;
  }
};

// Helper function to format duration
const formatDuration = (seconds) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
};

export default Session;
