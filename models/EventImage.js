import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const EventImage = sequelize.define(
  "EventImage",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    eventId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "events", key: "id" },
      onDelete: "CASCADE",
    },
    url: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    key: {
      type: DataTypes.STRING,
      allowNull: false,
    },
  },
  { tableName: "event_images", timestamps: true },
);

export const setupEventImageAssociations = (Event) => {
  EventImage.belongsTo(Event, { foreignKey: "eventId", as: "event" });
};

export default EventImage;
