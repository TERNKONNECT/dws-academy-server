import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";
import Course from "./Course.js";

const Video = sequelize.define(
  "Video",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    courseId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "courses", key: "id" },
    },
    title: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, defaultValue: "" },
    filename: { type: DataTypes.STRING, defaultValue: "" },
    url: { type: DataTypes.STRING, allowNull: false },
    cloudinaryId: { type: DataTypes.STRING, defaultValue: "" },
    duration: { type: DataTypes.STRING, defaultValue: "" },
    difficulty: { type: DataTypes.STRING, defaultValue: "Beginner" },
    youtubeUrl: { type: DataTypes.STRING, defaultValue: "" },
  },
  { tableName: "videos", timestamps: true },
);

Course.hasMany(Video, { foreignKey: "courseId", onDelete: "CASCADE" });
Video.belongsTo(Course, { foreignKey: "courseId" });

export default Video;
