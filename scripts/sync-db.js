import { connectDB } from "../config/db.js";
import sequelize from "../config/db.js";
import User from "../models/User.js";
import { setupCourseAssociations } from "../models/Course.js";

// Make sure associations are set up before syncing
setupCourseAssociations(User);

async function runSync() {
  try {
    console.log("Starting database sync...");
    await connectDB();
    await sequelize.sync({ alter: true });
    console.log("Database schema synced successfully via CI/CD!");
    process.exit(0);
  } catch (error) {
    console.error("Failed to sync database schema:", error);
    process.exit(1);
  }
}

runSync();
