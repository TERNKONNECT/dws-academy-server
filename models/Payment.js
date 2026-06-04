import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";
import User from "./User.js";
import Course from "./Course.js";

const Payment = sequelize.define(
  "Payment",
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
    reference: { type: DataTypes.STRING, allowNull: false, unique: true },
    accessCode: { type: DataTypes.STRING, defaultValue: "" },
    authorizationUrl: { type: DataTypes.TEXT, defaultValue: "" },
    amount: { type: DataTypes.INTEGER, allowNull: false },
    currency: { type: DataTypes.STRING, defaultValue: "NGN" },
    status: {
      type: DataTypes.ENUM("pending", "success", "failed", "abandoned"),
      defaultValue: "pending",
    },
    paidAt: { type: DataTypes.DATE, allowNull: true },
    channel: { type: DataTypes.STRING, defaultValue: "" },
    gatewayResponse: { type: DataTypes.STRING, defaultValue: "" },
    paystackTransactionId: { type: DataTypes.STRING, defaultValue: "" },
    metadata: { type: DataTypes.JSONB, defaultValue: {} },
  },
  {
    tableName: "payments",
    timestamps: true,
    indexes: [
      { fields: ["userId"] },
      { fields: ["courseId"] },
      { fields: ["status"] },
    ],
  },
);

User.hasMany(Payment, { foreignKey: "userId", onDelete: "CASCADE" });
Payment.belongsTo(User, { foreignKey: "userId" });

Course.hasMany(Payment, { foreignKey: "courseId", onDelete: "CASCADE" });
Payment.belongsTo(Course, { foreignKey: "courseId" });

export default Payment;
