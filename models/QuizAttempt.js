import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";
import Enrollment from "./Enrollment.js";
import Quiz from "./Quiz.js";

const QuizAttempt = sequelize.define(
  "QuizAttempt",
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
    quizId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "quizzes", key: "id" },
    },
    answers: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    score: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    totalQuestions: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    percentage: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    passed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    completedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  { tableName: "quiz_attempts", timestamps: true },
);

Enrollment.hasMany(QuizAttempt, {
  foreignKey: "enrollmentId",
  onDelete: "CASCADE",
});
QuizAttempt.belongsTo(Enrollment, { foreignKey: "enrollmentId" });

Quiz.hasMany(QuizAttempt, { foreignKey: "quizId", onDelete: "CASCADE" });
QuizAttempt.belongsTo(Quiz, { foreignKey: "quizId" });

export default QuizAttempt;
