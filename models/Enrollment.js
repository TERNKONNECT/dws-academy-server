import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";
import User from "./User.js";
import Course from "./Course.js";

const Enrollment = sequelize.define(
  "Enrollment",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "users", key: "id" },
    },
    courseId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "courses", key: "id" },
    },
    isCompleted: { type: DataTypes.BOOLEAN, defaultValue: false },
    completedAt: { type: DataTypes.DATE, allowNull: true },
    // Set to the admin's user id when an admin/instructor enrolled this student
    // via the "Enroll Student" feature; null means the student enrolled themself
    // (free course or completed Paystack payment).
    enrolledBy: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "users", key: "id" },
    },
  },
  {
    tableName: "enrollments",
    timestamps: true,
    indexes: [{ unique: true, fields: ["userId", "courseId"] }],
  },
);

User.hasMany(Enrollment, { foreignKey: "userId", onDelete: "CASCADE" });
Enrollment.belongsTo(User, { foreignKey: "userId" });

Course.hasMany(Enrollment, { foreignKey: "courseId", onDelete: "CASCADE" });
Enrollment.belongsTo(Course, { foreignKey: "courseId" });

Enrollment.belongsTo(User, { foreignKey: "enrolledBy", as: "EnrolledByAdmin" });

export default Enrollment;
