import { DataTypes, Op } from "sequelize";
import { sequelize } from "../config/mysql.js";

const UserSession = sequelize.define(
  "UserSession",
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
    token: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    deviceInfo: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
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
    tableName: "user_sessions",
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ["token"],
        name: "user_sessions_token_unique",
      },
    ],
  }
);

// Create user session
export const createUserSession = async (sessionData) => {
  try {
    const session = await UserSession.create(sessionData);
    return session.toJSON();
  } catch (error) {
    console.error("Create User Session Error:", error);
    throw error;
  }
};

// Get user session by token
export const getUserSessionByToken = async (token) => {
  try {
    const session = await UserSession.findOne({ where: { token } });
    return session ? session.toJSON() : null;
  } catch (error) {
    console.error("Get User Session By Token Error:", error);
    throw error;
  }
};

// Get user sessions by user ID
export const getUserSessionsByUserId = async (userId) => {
  try {
    const sessions = await UserSession.findAll({
      where: { userId },
      order: [["createdAt", "DESC"]],
    });
    return sessions.map((session) => session.toJSON());
  } catch (error) {
    console.error("Get User Sessions By User ID Error:", error);
    throw error;
  }
};

// Delete user session by token
export const deleteUserSessionByToken = async (token) => {
  try {
    const result = await UserSession.destroy({ where: { token } });
    return result > 0;
  } catch (error) {
    console.error("Delete User Session Error:", error);
    throw error;
  }
};

// Delete expired user sessions
export const deleteExpiredUserSessions = async () => {
  try {
    const result = await UserSession.destroy({
      where: {
        expiresAt: {
          [Op.lt]: new Date(),
        },
      },
    });
    return result;
  } catch (error) {
    console.error("Delete Expired User Sessions Error:", error);
    throw error;
  }
};

export default UserSession;
