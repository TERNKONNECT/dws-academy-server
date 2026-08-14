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
- **Resend**: Used exclusively for handling the `/api/contact` form submissions, routing emails to `schoolofeventsafrica@gmail.com`.
- **Payment Gateway**: Integrated to handle course enrollments and purchases (e.g., via `/api/payments/initialize`). Ensure webhook endpoints (`/api/payments/webhook`) are correctly registered in the gateway's dashboard for production deployments.

## 6. Deployment Considerations
- **Frontend Deployment**: Can be seamlessly hosted on Vercel, Netlify, or AWS S3+CloudFront. Ensure that the build command is `npm run build` and the output directory is `dist`.
- **Backend Deployment**: Designed for Node.js environments (e.g., Render, AWS EC2, DigitalOcean App Platform, or Serverless Lambda via `serverless-http`).
- **CORS Configuration**: The backend `server.js` maintains a strict `allowedOrigins` array. Before launching in production, ensure your exact production frontend URL is added to the CORS whitelist to prevent blocked requests.
