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
    ["isBlocked", { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }],
  ];

  for (const [columnName, definition] of userColumns) {
    if (!userTable[columnName]) {
      await queryInterface.addColumn("users", columnName, definition);
      console.log(`Added missing users.${columnName} column`);
    }
  }

  const courseTable = await queryInterface.describeTable("courses");
  const courseColumns = [
    [
      "pricingType",
      { type: DataTypes.ENUM("free", "paid"), allowNull: false, defaultValue: "free" },
    ],
    ["price", { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }],
    ["currency", { type: DataTypes.STRING, allowNull: false, defaultValue: "NGN" }],
  ];

  for (const [columnName, definition] of courseColumns) {
    if (!courseTable[columnName]) {
      await queryInterface.addColumn("courses", columnName, definition);
      console.log(`Added missing courses.${columnName} column`);
    }
  }
}

async function ensurePaymentTable() {
  const queryInterface = sequelize.getQueryInterface();
  const tables = await queryInterface.showAllTables();
  if (tables.includes("payments")) return;

  await queryInterface.createTable("payments", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "users", key: "id" },
      onDelete: "CASCADE",
    },
    courseId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "courses", key: "id" },
      onDelete: "CASCADE",
    },
    reference: { type: DataTypes.STRING, allowNull: false, unique: true },
    accessCode: { type: DataTypes.STRING, allowNull: false, defaultValue: "" },
    authorizationUrl: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
    amount: { type: DataTypes.INTEGER, allowNull: false },
    currency: { type: DataTypes.STRING, allowNull: false, defaultValue: "NGN" },
    status: {
      type: DataTypes.ENUM("pending", "success", "failed", "abandoned"),
      allowNull: false,
      defaultValue: "pending",
    },
    paidAt: { type: DataTypes.DATE, allowNull: true },
    channel: { type: DataTypes.STRING, allowNull: false, defaultValue: "" },
    gatewayResponse: { type: DataTypes.STRING, allowNull: false, defaultValue: "" },
    paystackTransactionId: { type: DataTypes.STRING, allowNull: false, defaultValue: "" },
    metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  console.log("Created missing payments table");
}

export async function connectDB() {
  if (isConnected) return;
  if (connectionPromise) return connectionPromise;

  connectionPromise = (async () => {
    try {
      await sequelize.authenticate();
      await ensureUserInviteColumns();
      await ensurePaymentTable();
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
