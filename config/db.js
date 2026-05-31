import pg from "pg";
import { DataTypes, Sequelize } from "sequelize";

const isProduction = process.env.DATABASE_URL?.includes("neon.tech") || process.env.DATABASE_URL?.includes("rds.amazonaws.com");

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: "postgres",
  dialectModule: pg,
  logging: false,
  pool: { max: 2, min: 0, acquire: 30000, idle: 10000 },
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false,
    },
  },
});

let isConnected = false;
let connectionPromise = null;

async function ensureUserInviteColumns() {
  const queryInterface = sequelize.getQueryInterface();
  const table = await queryInterface.describeTable("users");

  const columns = [
    ["adminInviteToken", { type: DataTypes.STRING, allowNull: true }],
    ["adminInviteExpires", { type: DataTypes.DATE, allowNull: true }],
    [
      "passwordSetupRequired",
      { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    ],
  ];

  for (const [columnName, definition] of columns) {
    if (!table[columnName]) {
      await queryInterface.addColumn("users", columnName, definition);
      console.log(`Added missing users.${columnName} column`);
    }
  }
}

export async function connectDB() {
  if (isConnected) return;
  if (connectionPromise) return connectionPromise;

  connectionPromise = (async () => {
    try {
      await sequelize.authenticate();
      await ensureUserInviteColumns();
      isConnected = true;
      console.log("PostgreSQL connected");
    } catch (err) {
      connectionPromise = null;
      console.error("PostgreSQL connection failed:", err.message);
      throw err;
    }
  })();

  return connectionPromise;
}

export default sequelize;
