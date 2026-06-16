import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const Event = sequelize.define(
  "Event",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      defaultValue: "",
    },
    date: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  { tableName: "events", timestamps: true },
);

export const setupEventAssociations = (EventImage) => {
  Event.hasMany(EventImage, { foreignKey: "eventId", as: "images", onDelete: "CASCADE" });
};

export default Event;
