import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";
import User from "./User.js";
import Course from "./Course.js";

const Certificate = sequelize.define(
  "Certificate",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    certificateId: {
      // Public, human-shareable code (e.g. "DWS-A1B2C3D4") used in the verification URL.
      // Deliberately not the internal UUID `id`, so it's short and doesn't leak row order.
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
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
    // Snapshots taken at issue time so the certificate stays historically accurate
    // even if the student later changes their name or the course is renamed.
    studentName: { type: DataTypes.STRING, allowNull: false },
    courseName: { type: DataTypes.STRING, allowNull: false },
    instructorName: { type: DataTypes.STRING, allowNull: true },
    issuedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    tableName: "certificates",
    timestamps: true,
    indexes: [
      { unique: true, fields: ["certificateId"] },
      { unique: true, fields: ["userId", "courseId"] },
    ],
  },
);

User.hasMany(Certificate, { foreignKey: "userId", onDelete: "CASCADE" });
Certificate.belongsTo(User, { foreignKey: "userId" });

Course.hasMany(Certificate, { foreignKey: "courseId", onDelete: "CASCADE" });
Certificate.belongsTo(Course, { foreignKey: "courseId" });

export default Certificate;
