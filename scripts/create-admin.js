import { connectDB } from "../config/db.js";
import sequelize from "../config/db.js";
import User from "../models/User.js";

function getArg(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match?.slice(prefix.length);
}

const name = getArg("name") || process.env.ADMIN_NAME;
const email = getArg("email") || process.env.ADMIN_EMAIL;
const password = getArg("password") || process.env.ADMIN_PASSWORD;

if (!name || !email || !password) {
  console.error(
    "Usage: npm run create-admin -- --name=\"Admin Name\" --email=\"admin@example.com\" --password=\"StrongPassword\"",
  );
  console.error("Or set ADMIN_NAME, ADMIN_EMAIL, and ADMIN_PASSWORD.");
  process.exit(1);
}

async function createAdmin() {
  try {
    await connectDB();

    const normalizedEmail = email.toLowerCase().trim();
    const existingUser = await User.findOne({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      existingUser.name = name;
      existingUser.password = password;
      existingUser.role = "admin";
      existingUser.emailVerified = true;
      await existingUser.save();

      console.log(`Admin updated: ${normalizedEmail}`);
      return;
    }

    await User.create({
      name,
      email: normalizedEmail,
      password,
      role: "admin",
      emailVerified: true,
    });

    console.log(`Admin created: ${normalizedEmail}`);
  } catch (error) {
    console.error("Failed to create admin:", error.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

createAdmin();
