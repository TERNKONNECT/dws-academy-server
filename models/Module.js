import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";
import Course from "./Course.js";

const Module = sequelize.define(
  "Module",
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
    order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  },
  { tableName: "modules", timestamps: true },
);

Course.hasMany(Module, { foreignKey: "courseId", onDelete: "CASCADE" });
Module.belongsTo(Course, { foreignKey: "courseId" });

export default Module;
