import express from "express";
import userAuth from "../middleware/userAuth.js";
import {
  getContent,
  createContent,
  updateContent,
  deleteContent,
} from "../controllers/contentController.js";

const contentRouter = express.Router();

contentRouter.get("/", getContent);
contentRouter.post("/", userAuth, createContent);
contentRouter.put("/:id", userAuth, updateContent);
contentRouter.delete("/:id", userAuth, deleteContent);

export default contentRouter;
