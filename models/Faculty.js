import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const Faculty = sequelize.define(
  "Faculty",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: { 
      type: DataTypes.STRING, 
      allowNull: false 
    },
    jobTitle: { 
      type: DataTypes.STRING, 
      allowNull: true,
      defaultValue: "",
    },
    company: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: "",
    },
    shortDescription: { 
      type: DataTypes.STRING(500), 
      allowNull: true,
      defaultValue: "",
    },
    avatar: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: "",
    },
    isActive: { 
      type: DataTypes.BOOLEAN, 
      defaultValue: true 
    },
  },
  { tableName: "faculties", timestamps: true },
);

export default Faculty;
