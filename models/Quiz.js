import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";
import Module from "./Module.js";

const Quiz = sequelize.define(
  "Quiz",
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
    description: { type: DataTypes.TEXT, defaultValue: "" },
    questions: { type: DataTypes.JSONB, defaultValue: [] },
  },
  { tableName: "quizzes", timestamps: true },
);

Module.hasOne(Quiz, { foreignKey: "moduleId", onDelete: "CASCADE" });
Quiz.belongsTo(Module, { foreignKey: "moduleId" });

export default Quiz;
