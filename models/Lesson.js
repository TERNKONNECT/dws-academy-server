import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";
import Module from "./Module.js";

const Lesson = sequelize.define(
  "Lesson",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    moduleId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "modules", key: "id" },
    },
    title: { type: DataTypes.STRING, allowNull: false },
    type: { type: DataTypes.ENUM("video", "text"), allowNull: false },
    content: { type: DataTypes.TEXT, defaultValue: "" }, // text body for text lessons
    videoUrl: { type: DataTypes.STRING, defaultValue: "" }, // cloudinary URL for video lessons
    cloudinaryId: { type: DataTypes.STRING, defaultValue: "" },
    duration: { type: DataTypes.STRING, defaultValue: "" },
    order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  },
  { tableName: "lessons", timestamps: true },
);

Module.hasMany(Lesson, { foreignKey: "moduleId", onDelete: "CASCADE" });
Lesson.belongsTo(Module, { foreignKey: "moduleId" });

export default Lesson;
