import serverless from "serverless-http";
import app from "./server.js";

// Wrap the Express app so AWS API Gateway requests are correctly passed into Express
export const handler = serverless(app);
