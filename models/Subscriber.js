import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const Subscriber = sequelize.define(
  "Subscriber",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
  },
  { tableName: "newsletter_subscribers", timestamps: true },
);

export default Subscriber;
