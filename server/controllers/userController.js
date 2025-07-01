import userModel from "../models/userModel.js";
import {
  deleteUserSessionByToken,
  getUserSessionsByUserId,
} from "../models/userSessionModel.js";
import bcrypt from "bcryptjs";

// Removed emitUserDataUpdate as we are using a generic event now
// const emitUserDataUpdate = (req, userData) => {
//   const io = req.app.get("io");
//   if (io) {
//     io.emit("userDataUpdate", userData);
//   }
// };

export const getUserData = async (req, res) => {
  try {
    const { id } = req.user;

    const user = await userModel.findByPk(id);

    if (!user) {
      return res.json({ success: false, message: "User not found" });
    }

    const userData = {
      id: user.id,
      name: user.name,
      email: user.email,
      isAccountVerified: user.isAccountVerified,
    };

    // Removed emitUserDataUpdate
    // emitUserDataUpdate(req, userData);

    res.json({
      success: true,
      userData,
    });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
};

export const updateAccount = async (req, res) => {
  try {
    const { userId, name, email, password } = req.body;

    const user = await userModel.findByPk(userId);

    if (!user) {
      return res.json({ success: false, message: "User not found" });
    }

    if (name) user.name = name;
    if (email) user.email = email;
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      user.password = hashedPassword;
    }

    await user.save();

    const userData = {
      name: user.name,
      email: user.email,
      isAccountVerified: user.isAccountVerified,
    };

    // Emit a general userListUpdate event
    const io = req.app.get("io");
    if (io) {
      io.emit("userListUpdate");
    }

    res.json({
      success: true,
      userData,
    });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
};

export const deleteAccount = async (req, res) => {
  try {
    const { userId } = req.body;

    const user = await userModel.findByPk(userId);

    if (!user) {
      return res.json({ success: false, message: "User not found" });
    }

    // Delete all user sessions
    const userSessions = await getUserSessionsByUserId(userId);
    for (const session of userSessions) {
      await deleteUserSessionByToken(session.token);
    }

    await user.destroy();

    if (req.user.id === userId) {
      res.clearCookie("token", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
      });
    }

    // Emit a general userListUpdate event
    const io = req.app.get("io");
    if (io) {
      io.emit("userListUpdate");
    }

    res.json({ success: true, message: "Account deleted successfully" });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
};

export const createUser = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Basic validation
    if (!name || !email || !password) {
      return res.json({ success: false, message: "All fields are required" });
    }

    // Check if user already exists
    const existingUser = await userModel.findOne({ where: { email } });
    if (existingUser) {
      return res.json({
        success: false,
        message: "User with this email already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await userModel.create({
      name,
      email,
      password: hashedPassword,
      isAccountVerified: false,
    });

    // Emit a general userListUpdate event
    const io = req.app.get("io");
    if (io) {
      io.emit("userListUpdate");
    }

    res.json({
      success: true,
      message: "Account created successfully",
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        isAccountVerified: newUser.isAccountVerified,
      },
    });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
};

export const getAllUsers = async (req, res) => {
  try {
    const users = await userModel.findAll({
      attributes: [
        "id",
        "name",
        "email",
        "isAccountVerified",
        "createdAt",
        "updatedAt",
      ],
    });

    res.json({
      success: true,
      users,
    });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
};
