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
    categoryId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      references: { model: "gallery_categories", key: "id" },
    },
  },
  { tableName: "event_images", timestamps: true },
);

export const setupEventImageAssociations = (Event, GalleryCategory) => {
  EventImage.belongsTo(Event, { foreignKey: "eventId", as: "event" });
  EventImage.belongsTo(GalleryCategory, { foreignKey: "categoryId", as: "category" });
};

export default EventImage;
