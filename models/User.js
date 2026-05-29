import { DataTypes } from "sequelize";
import bcrypt from "bcryptjs";
import sequelize from "../config/db.js";

const User = sequelize.define(
  "User",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING, allowNull: false, unique: true },
    password: { type: DataTypes.STRING, allowNull: false },
    role: {
      type: DataTypes.ENUM("user", "admin", "super-admin"),
      defaultValue: "user",
    },
    title: { type: DataTypes.STRING, defaultValue: "" },
    bio: { type: DataTypes.TEXT, defaultValue: "" },
    avatar: { type: DataTypes.STRING, defaultValue: "" },
    avatarCloudinaryId: { type: DataTypes.STRING, defaultValue: "" },
  },
  { tableName: "users", timestamps: true },
);

User.beforeSave(async (user) => {
  if (user.changed("password")) {
    user.password = await bcrypt.hash(user.password, 10);
  }
});

User.prototype.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

export default User;
