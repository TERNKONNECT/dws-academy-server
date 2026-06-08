import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const Course = sequelize.define(
  "Course",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    createdBy: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "users", key: "id" },
    },
    title: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, defaultValue: "" },
    thumbnail: { type: DataTypes.STRING, defaultValue: "" },
    thumbnailCloudinaryId: { type: DataTypes.STRING, defaultValue: "" },
    introVideoUrl: { type: DataTypes.STRING, defaultValue: "" },
    introVideoCloudinaryId: { type: DataTypes.STRING, defaultValue: "" },
    difficulty: { type: DataTypes.STRING, defaultValue: "Beginner" },
    status: {
      type: DataTypes.ENUM("draft", "published"),
      defaultValue: "draft",
    },
    whatYouLearn: { type: DataTypes.JSONB, defaultValue: [] },
    pricingType: {
      type: DataTypes.ENUM("free", "paid"),
      allowNull: false,
      defaultValue: "free",
    },
    price: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    currency: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "NGN",
    },
  },
  { tableName: "courses", timestamps: true },
);

export const setupCourseAssociations = (User) => {
  Course.belongsTo(User, { foreignKey: "createdBy", as: "instructor" });
};

export default Course;
