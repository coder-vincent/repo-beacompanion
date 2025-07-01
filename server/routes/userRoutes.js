import express from "express";
import userAuth from "../middleware/userAuth.js";
import {
  getUserData,
  updateAccount,
  deleteAccount,
  getAllUsers,
  createUser,
} from "../controllers/userController.js";

const userRouter = express.Router();

userRouter.get("/data", userAuth, getUserData);
userRouter.get("/all", userAuth, getAllUsers);
userRouter.post("/update-account", userAuth, updateAccount);
userRouter.delete("/delete-account", userAuth, deleteAccount);
userRouter.post("/create", userAuth, createUser);

export default userRouter;
