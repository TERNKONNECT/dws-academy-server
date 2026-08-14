# Technical Documentation

This document provides a technical overview of the School of Events Africa platform, outlining the architecture, tech stack, and instructions for operating and maintaining the system.

## 1. System Architecture

The platform consists of two main components:
1. **Frontend (`dws-academy`)**: A modern, responsive React application built with Vite. It serves both the public-facing student portal and the protected admin dashboard.
2. **Backend (`dws-academy-server`)**: A Node.js/Express REST API that handles business logic, database interactions, authentication, and external integrations (e.g. Payments, Emails).

## 2. Technology Stack

### Frontend
- **Framework**: React 18 with TypeScript, bundled via Vite.
- **Styling**: Tailwind CSS, Shadcn UI components, and Radix UI primitives.
- **State Management**: Zustand (Global state, Auth) and TanStack React Query (Server state, caching, data fetching).
- **Routing**: React Router DOM (v6).
- **Forms**: React Hook Form with Zod validation.
- **Charts**: Chart.js and Recharts for admin analytics.

### Backend
- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: PostgreSQL (Neon/Supabase or standard AWS RDS).
- **ORM**: Sequelize for database models and schema sync.
- **Authentication**: JWT (JSON Web Tokens) & bcryptjs for password hashing.
- **File Uploads**: Multer (handling local buffers) & AWS S3/Cloudinary for persistent media storage.
- **Email Service**: Resend API (`resend` package).

## 3. Environment Configuration

### Backend `.env` Required Variables:
- `PORT`: Server port (default `9000`)
- `DATABASE_URL`: Connection string for PostgreSQL database
- `JWT_SECRET`: Secret key for signing authentication tokens
- `RESEND_API_KEY`: API Key from Resend for transactional emails
- *Storage Keys*: AWS S3 or Cloudinary credentials depending on configuration for handling image uploads.
- *Payment Keys*: API keys for Paystack or chosen payment gateway.

### Frontend `.env` Required Variables:
- `VITE_API_URL`: The URL pointing to the deployed backend server (e.g., `https://api.schoolofeventsafrica.com`). If running locally, this defaults to `http://localhost:9000` via proxy.

## 4. Operational Maintenance

### Starting the Applications Locally
**Backend:**
```bash
cd dws-academy-server
npm install
npm run dev
```

**Frontend:**
```bash
cd dws-academy
npm install
npm run dev
```

### Database Management
- The backend relies on Sequelize to synchronize models.
- Running `npm run db:sync` on the backend will force synchronize the schema based on the defined `models/`.
- Ensure you have a running PostgreSQL instance locally or a cloud database URL configured in `.env`.
- To create initial admin users, you can use the built-in scripts:
  - `npm run create-admin`
  - `npm run create-super-admin`

## 5. Third-Party Integrations
- **Resend**: Used exclusively for handling the `/api/contact` all the OTPs and automated emails as well!,form submissions, routing emails to `schoolofeventsafrica@gmail.com`.
- **Payment Gateway**: Integrated to handle course enrollments and purchases (e.g., via `/api/payments/initialize`). Ensure webhook endpoints (`/api/payments/webhook`) are correctly registered in the gateway's dashboard for production deployments.

## 6. Continuous Integration & Deployment (CI/CD)

The project leverages **GitHub Actions** to automate testing and deployments across both the frontend and backend.

### Unit Testing & Code Quality
- **Backend**: Tests are written using the native Node.js test runner and run against a live PostgreSQL 16 database (spun up via Docker service in GitHub Actions). 
  - *Pipeline Steps*: Code Checkout $\rightarrow$ Setup Node 22 $\rightarrow$ Install Dependencies (`npm ci`) $\rightarrow$ Syntax Check (`node --check`) $\rightarrow$ Unit Tests (`npm test`).
- **Frontend**: Tests are executed via Vitest. The pipeline utilizes `bun` for ultra-fast dependency resolution.
  - *Pipeline Steps*: Code Checkout $\rightarrow$ Setup Bun $\rightarrow$ Install Dependencies (`bun install`) $\rightarrow$ Typecheck $\rightarrow$ Lint $\rightarrow$ Tests (`bun run test`) $\rightarrow$ Build Validation.

### Deployment Environments & Resources
Deployments automatically trigger when code is pushed or merged into the `main` branch, given that all CI tests pass. 

**Frontend (Production/Dev)**
- **Pipeline**: Handled by `.github/workflows/deploy-frontend.yml`
- **Resources**: AWS S3 & AWS CloudFront.
- **Process**: The workflow builds the static assets via Vite (`bun run build`), syncs the `dist/` directory directly to an AWS S3 bucket, and then creates a CloudFront invalidation to instantly propagate the new frontend cache globally.

**Backend (Production/Dev)**
- **Pipeline**: Handled by `.github/workflows/deploy-backend.yml`
- **Resources**: AWS Lambda & API Gateway (orchestrated via the Serverless Framework) and AWS RDS/Neon for PostgreSQL.
- **Process**: The workflow generates the production `.env` file using GitHub Secrets, synchronizes the database schema via `node scripts/sync-db.js`, and finally runs `serverless deploy --stage prod` to update the Lambda functions and API gateway.

### Handling Secrets in CI/CD
To ensure successful deployment, the following GitHub Secrets must be configured in your repository:
- **AWS Credentials**: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`
- **Backend App Secrets**: `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, `PAYSTACK_SECRET_KEY`, `CLOUDINARY_*` keys.
- **Frontend App Secrets**: `VITE_API_BASE_URL`, `S3_BUCKET_NAME`, `CLOUDFRONT_DISTRIBUTION_ID`
