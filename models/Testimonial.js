import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const Testimonial = sequelize.define(
  "Testimonial",
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
      allowNull: false 
    },
    content: { 
      type: DataTypes.STRING(500), 
      allowNull: false 
    },
    date: { 
      type: DataTypes.DATE, 
      defaultValue: DataTypes.NOW 
    },
    isActive: { 
      type: DataTypes.BOOLEAN, 
      defaultValue: true 
    },
  },
  { tableName: "testimonials", timestamps: true },
);

export default Testimonial;
