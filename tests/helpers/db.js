import sequelize, { connectDB } from "../../config/db.js";
import app from "../../server.js";

// Creates a fresh schema in the test database from the current model definitions.
// Each test file runs in its own process under `node --test`, so calling this once
// per file (in a top-level `before`) gives every file an isolated, clean database.
export async function setupTestDb() {
  await connectDB();
  await sequelize.sync({ force: true });
}

export async function closeTestDb() {
  await sequelize.close();
}

export { app, sequelize };
