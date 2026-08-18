import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const GalleryCategory = sequelize.define(
  "GalleryCategory",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
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
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    date: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  { tableName: "gallery_categories", timestamps: true },
);

export const setupGalleryCategoryAssociations = (EventImage) => {
  GalleryCategory.hasMany(EventImage, { foreignKey: "categoryId", as: "images" });
};

export default GalleryCategory;
