import { connectDB } from "../config/db.js";
import sequelize from "../config/db.js";
import User from "../models/User.js";

function getArg(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match?.slice(prefix.length);
}

const name = getArg("name") || process.env.SUPER_ADMIN_NAME;
const email = getArg("email") || process.env.SUPER_ADMIN_EMAIL;
const password = getArg("password") || process.env.SUPER_ADMIN_PASSWORD;

if (!name || !email || !password) {
  console.error(
    "Usage: npm run create-super-admin -- --name=\"Admin Name\" --email=\"admin@example.com\" --password=\"StrongPassword\"",
  );
  console.error(
    "Or set SUPER_ADMIN_NAME, SUPER_ADMIN_EMAIL, and SUPER_ADMIN_PASSWORD.",
  );
  process.exit(1);
}

async function createSuperAdmin() {
  try {
    await connectDB();

    const normalizedEmail = email.toLowerCase().trim();
    const existingUser = await User.findOne({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      existingUser.name = name;
      existingUser.password = password;
      existingUser.role = "super-admin";
      existingUser.emailVerified = true;
      await existingUser.save();

      console.log(`Super admin updated: ${normalizedEmail}`);
      return;
    }

    await User.create({
      name,
      email: normalizedEmail,
      password,
      role: "super-admin",
      emailVerified: true,
    });

    console.log(`Super admin created: ${normalizedEmail}`);
  } catch (error) {
    console.error("Failed to create super admin:", error.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

createSuperAdmin();
