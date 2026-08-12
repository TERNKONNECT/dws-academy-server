import pg from "pg";
import { DataTypes, Sequelize } from "sequelize";

const requiresSsl =
  process.env.DATABASE_URL?.includes("neon.tech") ||
  process.env.DATABASE_URL?.includes("rds.amazonaws.com") ||
  process.env.DATABASE_URL?.includes("supabase.co");

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: "postgres",
  dialectModule: pg,
  logging: false,
  pool: { max: 2, min: 0, acquire: 30000, idle: 10000 },
  ...(requiresSsl
    ? { dialectOptions: { ssl: { require: true, rejectUnauthorized: false } } }
    : {}),
});

let isConnected = false;
let connectionPromise = null;

async function ensureUserInviteColumns() {
  const queryInterface = sequelize.getQueryInterface();
  let table;
  try {
    table = await queryInterface.describeTable("users");
  } catch (err) {
    console.log("users table not found, skipping user invite columns");
  }

  if (table) {
    const columns = [
      ["adminInviteToken", { type: DataTypes.STRING, allowNull: true }],
      ["adminInviteExpires", { type: DataTypes.DATE, allowNull: true }],
      [
        "passwordSetupRequired",
        { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      ],
      ["isBlocked", { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }],
      ["otpAttempts", { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }],
    ];

    for (const [columnName, definition] of columns) {
      if (!table[columnName]) {
        await queryInterface.addColumn("users", columnName, definition);
        console.log(`Added missing users.${columnName} column`);
      }
    }
  }

  let courseTable;
  try {
    courseTable = await queryInterface.describeTable("courses");
  } catch (err) {
    console.log("courses table not found, skipping course columns");
  }

  if (courseTable) {
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
}

async function ensurePaymentTable() {
  const queryInterface = sequelize.getQueryInterface();
  const tables = await queryInterface.showAllTables();
  if (tables.includes("payments")) return;
  if (!tables.includes("users") || !tables.includes("courses")) {
    console.log("users or courses table not found, skipping payments table creation");
    return;
  }

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

async function ensureQuizAttemptTable() {
  const queryInterface = sequelize.getQueryInterface();
  const tables = await queryInterface.showAllTables();
  if (tables.includes("quiz_attempts")) return;
  if (
    !tables.includes("enrollments") ||
    !tables.includes("quizzes")
  ) {
    console.log("enrollments or quizzes table not found, skipping quiz_attempts table creation");
    return;
  }

  await queryInterface.createTable("quiz_attempts", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    enrollmentId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "enrollments", key: "id" },
      onDelete: "CASCADE",
    },
    quizId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "quizzes", key: "id" },
      onDelete: "CASCADE",
    },
    answers: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    score: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    totalQuestions: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    percentage: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    passed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    completedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  console.log("Created missing quiz_attempts table");
}

async function ensureEventTables() {
  const queryInterface = sequelize.getQueryInterface();
  const tables = await queryInterface.showAllTables();
  if (!tables.includes("events")) {
    await queryInterface.createTable("events", {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      name: { type: DataTypes.STRING, allowNull: false },
      description: { type: DataTypes.TEXT, defaultValue: "" },
      date: { type: DataTypes.DATE, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    });
    console.log("Created events table");
  }

  if (!tables.includes("event_images")) {
    const currentTables = await queryInterface.showAllTables();
    if (!currentTables.includes("events")) {
      console.log("events table not found, skipping event_images table creation");
      return;
    }
    await queryInterface.createTable("event_images", {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      eventId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "events", key: "id" },
        onDelete: "CASCADE",
      },
      url: { type: DataTypes.STRING, allowNull: false },
      key: { type: DataTypes.STRING, allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    });
    console.log("Created event_images table");
  }
}

async function ensureEnrollmentColumns() {
  const queryInterface = sequelize.getQueryInterface();
  let table;
  try {
    table = await queryInterface.describeTable("enrollments");
  } catch (err) {
    console.log("enrollments table not found, skipping enrollment columns");
  }

  if (table && !table.enrolledBy) {
    await queryInterface.addColumn("enrollments", "enrolledBy", {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "users", key: "id" },
    });
    console.log("Added missing enrollments.enrolledBy column");
  }
}

async function ensureCertificateTable() {
  const queryInterface = sequelize.getQueryInterface();
  const tables = await queryInterface.showAllTables();
  if (tables.includes("certificates")) return;
  if (!tables.includes("users") || !tables.includes("courses")) {
    console.log("users or courses table not found, skipping certificates table creation");
    return;
  }

  await queryInterface.createTable("certificates", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    certificateId: { type: DataTypes.STRING, allowNull: false, unique: true },
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
    studentName: { type: DataTypes.STRING, allowNull: false },
    courseName: { type: DataTypes.STRING, allowNull: false },
    instructorName: { type: DataTypes.STRING, allowNull: true },
    issuedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  console.log("Created missing certificates table");
}

export async function connectDB() {
  if (isConnected) return;
  if (connectionPromise) return connectionPromise;

  connectionPromise = (async () => {
    try {
      await sequelize.authenticate();
      await ensureUserInviteColumns();
      await ensurePaymentTable();
      await ensureQuizAttemptTable();
      await ensureEventTables();
      await ensureEnrollmentColumns();
      await ensureCertificateTable();
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
