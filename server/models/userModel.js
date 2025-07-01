import { DataTypes } from "sequelize";
import { sequelize } from "../config/mysql.js";

const User = sequelize.define(
  "User",
  {
    name: { type: DataTypes.STRING, allowNull: false },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    password: { type: DataTypes.STRING, allowNull: false },
    verifyOtp: { type: DataTypes.STRING, defaultValue: "" },
    verifyOtpExpireAt: { type: DataTypes.BIGINT, defaultValue: 0 },
    isAccountVerified: { type: DataTypes.BOOLEAN, defaultValue: false },
    resetOtp: { type: DataTypes.STRING, defaultValue: "" },
    resetOtpExpireAt: { type: DataTypes.BIGINT, defaultValue: 0 },
  },
  {
    tableName: "users",
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ["email"],
        name: "users_email_unique",
      },
    ],
  }
);

export default User;
