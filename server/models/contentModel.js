import { DataTypes } from "sequelize";
import { sequelize } from "../config/mysql.js";

const Content = sequelize.define("Content", {
  type: {
    type: DataTypes.ENUM("about", "faq"),
    allowNull: false,
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  order: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
});

await Content.sync();

export default Content;
