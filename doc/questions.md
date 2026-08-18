# Platform Architecture & Configuration Answers

**1. AWS Services in Use**
*   **AWS S3 (Simple Storage Service)**: Used for two distinct purposes:
    1.  **Frontend Hosting**: A dedicated bucket stores the compiled React frontend assets (`index.html`, JS, CSS).
    2.  **Media Storage**: A separate bucket stores all user uploads, large media files, and course videos.
*   **AWS CloudFront**: A Content Delivery Network (CDN) that serves the React frontend globally from the S3 hosting bucket, ensuring fast load times and providing SSL/HTTPS.
*   **AWS Lambda**: Runs the backend server (Node.js/Express) in a serverless environment, meaning it automatically scales based on traffic.
*   **AWS API Gateway (HTTP API)**: Acts as the front door, routing all HTTP requests from the frontend to the Lambda backend.
*   **AWS RDS (Relational Database Service)**: Provides scalable, managed hosting for the PostgreSQL database.

**2. Technologies and Frameworks**
*   **Frontend**: React (via Vite) with TypeScript/JavaScript. Styling is handled by Tailwind CSS and Shadcn UI components. State management is powered by Zustand and React Query (for API caching).
*   **Backend**: Node.js with the Express framework, wrapped in the Serverless Framework for AWS deployment.
*   **Database ORM**: Sequelize (used to map JavaScript objects to database tables).

**3. Database & Hosting**
*   **Database**: PostgreSQL.
*   **Hosting**: Hosted on AWS RDS

**4. Storage for Uploaded Files & Media**
*   In production, all uploaded files (videos, images, certificates, gallery photos, etc.) are stored in **AWS S3**.
*   (Note: For development or alternative setups, the codebase also has a fallback integration with Cloudinary).

**5. Planned Storage Architecture for Large Media**
*   To prevent large files (like videos) from bottlenecking the backend server, the platform uses **S3 Pre-signed URLs**. When a user requests a video, the Node.js server generates a temporary, secure URL that allows the user's browser to stream the video directly from AWS S3, completely bypassing the backend server.

**6. Website & LMS Performance Optimization**
*   **Media Delivery**: As mentioned, media streams directly from S3, drastically reducing backend load.
*   **Caching Headers**: Uploaded files to S3 are given long-term caching headers (`CacheControl: "public, max-age=31536000, immutable"`), meaning browsers will cache images and assets locally for repeat visits.
*   **Frontend Caching**: `React Query` is used on the frontend to cache API responses, reducing unnecessary network requests when navigating between pages.

**7. Authentication Technology**
*   The platform uses **JSON Web Tokens (JWT)** for stateless authentication.

**8. Security Measures**
*   **Role-Based Access Control (RBAC)**: Strict middleware (`adminOnly`, `superAdminOnly`) verifies the user's role on every sensitive request directly from the database (not just trusting the token).
*   **Rate Limiting**: Implementation of request rate limiting to prevent brute-force attacks and abuse.
*   **Deactivation Checks**: The system checks if a user is blocked or deactivated on every authenticated request, allowing immediate access revocation.

**9. SSL/HTTPS Encryption**
*   **Yes**. By deploying the backend via AWS API Gateway and serving media from AWS S3, all endpoints are automatically encrypted with HTTPS/SSL by default.

**10. Password Storage**
*   Passwords are never stored in plain text. They are securely hashed and salted using the industry-standard **bcryptjs** library before being saved to the database.

**11. Password Requirements**
*   Currently, the only enforced requirement is a **minimum length of 8 characters** (and a maximum of 200 characters to prevent denial-of-service attacks). Specific complexity rules (uppercase/lowercase/numbers) are not currently enforced in the code but can easily be added if required.

**12. Multi-Factor Authentication (MFA/2FA)**
*   The platform utilizes One-Time Passwords (OTPs) for email verification and password resets, but strict **MFA/2FA for routine logins (including Admin accounts) is not implemented**. 

**13. User Session Handling**
*   Sessions are completely stateless and handled via JWT expiration. When a user's token expires, they are automatically logged out (`TokenExpiredError` prompts a session expiration message). 

**14. Admin Account Security**
*   Admins cannot simply register; they must be invited by a Super Admin. The invitation generates a secure, expiring token (valid for 7 days) sent via email. Only upon clicking this secure link can the admin set up their password and activate their account.

**15. Sensitive Credentials Storage**
*   Locally, they are stored in `.env` files. In the AWS production environment, it is designed to securely inject these variables using **AWS Systems Manager Parameter Store** or standard Lambda environment variables, ensuring API keys and database credentials are not hardcoded.

**16. Resend Usage**
Resend is currently integrated to send transactional emails, specifically:
*   Account verification OTPs
*   Password reset OTPs
*   Secure Admin invitations
*   Payment confirmation receipts

**17. Admin Uploaded Files Storage**
*   Files uploaded through the admin platform follow the exact same architecture as user uploads: they are securely stored in the **AWS S3 bucket**.

**18. File Compression & Optimization**
*    However, natively via AWS S3, files are currently stored exactly as they are uploaded. If aggressive video/image compression is needed on the fly, we would recommend attaching an AWS CloudFront distribution to the S3 bucket or implementing an AWS Lambda trigger to compress videos upon upload.

**19. AI Technology/Provider**
*   No AI technology has been integrated into the platform 

**20. Project Handover & Asset Ownership**
*   **Yes**, upon completion of the project, you will receive full access, ownership, and control over all technical assets. This standard handover includes:
    *   Full GitHub source code/repository access
    *   All Super Admin accounts
    *   Any deployment/CI/CD configurations
    *   Necessary technical documentation for future maintenance.

  **But:** 
    *  We are not transferring AWS account/infrastructure ownership : you will need to migrate to your owner infrastructure or use ours
    *   Domain/DNS configuration access : You already own and manage this
    *   Resend and Paystack account credentials :  You already own and manage this
