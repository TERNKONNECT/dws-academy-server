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
    reference: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    accessCode: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "",
    },
    authorizationUrl: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "",
    },
    amount: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    currency: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "NGN",
    },
    status: {
      type: DataTypes.ENUM("pending", "success", "failed", "abandoned"),
      allowNull: false,
      defaultValue: "pending",
    },
    paidAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    channel: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "",
    },
    gatewayResponse: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "",
    },
    paystackTransactionId: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "",
    },
    metadata: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
  },
  {
    tableName: "payments",
    timestamps: true,
    indexes: [
      { unique: true, fields: ["reference"] },
      { fields: ["userId", "courseId"] },
      { fields: ["status"] },
    ],
  },
);

User.hasMany(Payment, { foreignKey: "userId", onDelete: "CASCADE" });
Payment.belongsTo(User, { foreignKey: "userId" });

Course.hasMany(Payment, { foreignKey: "courseId", onDelete: "CASCADE" });
Payment.belongsTo(Course, { foreignKey: "courseId" });

export default Payment;
