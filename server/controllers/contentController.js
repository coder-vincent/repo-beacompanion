import Content from "../models/contentModel.js";

export const getContent = async (req, res) => {
  try {
    const { type } = req.query;
    const content = await Content.findAll({
      where: { type, isActive: true },
      order: [["order", "ASC"]],
    });

    res.json({ success: true, content });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
};

export const createContent = async (req, res) => {
  try {
    const { type, title, content, order } = req.body;

    if (!type || !title || !content) {
      return res.json({ success: false, message: "Missing required fields" });
    }

    const newContent = await Content.create({
      type,
      title,
      content,
      order: order || 0,
    });

    res.json({ success: true, content: newContent });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
};

export const updateContent = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, order, isActive } = req.body;

    const contentItem = await Content.findByPk(id);

    if (!contentItem) {
      return res.json({ success: false, message: "Content not found" });
    }

    if (title) contentItem.title = title;
    if (content) contentItem.content = content;
    if (order !== undefined) contentItem.order = order;
    if (isActive !== undefined) contentItem.isActive = isActive;

    await contentItem.save();

    res.json({ success: true, content: contentItem });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
};

export const deleteContent = async (req, res) => {
  try {
    const { id } = req.params;

    const contentItem = await Content.findByPk(id);

    if (!contentItem) {
      return res.json({ success: false, message: "Content not found" });
    }

    await contentItem.destroy();

    res.json({ success: true, message: "Content deleted successfully" });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
};
