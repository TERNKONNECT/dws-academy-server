import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const BookPreorder = sequelize.define(
  "BookPreorder",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    bookSlug: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "money-on-the-table",
    },
    bookTitle: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "Money on the Table",
    },
    fullName: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING, allowNull: false },
    whatsapp: { type: DataTypes.STRING, allowNull: false },
    quantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    deliveryDetails: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
    reference: { type: DataTypes.STRING, allowNull: false, unique: true },
    amount: { type: DataTypes.INTEGER, allowNull: false },
    currency: { type: DataTypes.STRING, allowNull: false, defaultValue: "NGN" },
    status: {
      type: DataTypes.ENUM("pending", "success", "failed", "abandoned"),
      allowNull: false,
      defaultValue: "pending",
    },
    paidAt: { type: DataTypes.DATE, allowNull: true },
    channel: { type: DataTypes.STRING, allowNull: false, defaultValue: "" },
    gatewayResponse: { type: DataTypes.STRING, allowNull: false, defaultValue: "" },
    paystackTransactionId: { type: DataTypes.STRING, allowNull: false, defaultValue: "" },
    metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  },
  {
    tableName: "book_preorders",
    timestamps: true,
    indexes: [
      { unique: true, fields: ["reference"] },
      { fields: ["status"] },
    ],
  },
);

export default BookPreorder;
