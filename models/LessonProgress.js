import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";
import Enrollment from "./Enrollment.js";
import Lesson from "./Lesson.js";

const LessonProgress = sequelize.define(
  "LessonProgress",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    enrollmentId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "enrollments", key: "id" },
    },
    lessonId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "lessons", key: "id" },
    },
    completedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    tableName: "lesson_progress",
    timestamps: false,
    indexes: [{ unique: true, fields: ["enrollmentId", "lessonId"] }],
  },
);

Enrollment.hasMany(LessonProgress, {
  foreignKey: "enrollmentId",
  onDelete: "CASCADE",
});
LessonProgress.belongsTo(Enrollment, { foreignKey: "enrollmentId" });

Lesson.hasMany(LessonProgress, { foreignKey: "lessonId", onDelete: "CASCADE" });
LessonProgress.belongsTo(Lesson, { foreignKey: "lessonId" });

export default LessonProgress;
