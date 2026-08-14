# API Documentation

This document outlines the REST API endpoints available in the School of Events Africa backend application (`dws-academy-server`).

## Base URL
- **Local:** `http://localhost:9000/api`
- **Production:** (Refer to your deployment URL)

## Authentication (`/api/auth`)
Handles user registration, authentication, and token management.
- `POST /api/auth/register` - Create a new user account.
- `POST /api/auth/login` - Authenticate a user and return a JWT token.
- `GET /api/auth/me` - Get the currently authenticated user's profile.

## Profile Management (`/api/profile`)
- `GET /api/profile` - Retrieve the user's profile details.
- `PUT /api/profile` - Update profile information.

## Courses (`/api/courses`)
Handles the creation, retrieval, and management of courses.
- `GET /api/courses` - Retrieve all available courses.
- `GET /api/courses/:id` - Retrieve details of a specific course.
- `POST /api/courses` - Create a new course (Admin only).
- `PUT /api/courses/:id` - Update an existing course (Admin only).
- `DELETE /api/courses/:id` - Delete a course (Admin only).

## Course Modules & Lessons (`/api/courses/:courseId/modules`)
- `GET /api/courses/:courseId/modules` - Get modules for a course.
- `POST /api/courses/:courseId/modules` - Add a module to a course (Admin only).
- `GET /api/courses/:courseId/modules/:moduleId/lessons` - Get lessons for a specific module.

## Quizzes (`/api/quizzes` & `/api/courses/:courseId/modules/:moduleId/quiz`)
- `GET /api/quizzes/:id` - Get a quiz by ID.
- `POST /api/quizzes/:id/submit` - Submit answers for a quiz.

## Enrollments (`/api/enrollments`)
- `GET /api/enrollments` - Get the authenticated user's course enrollments.
- `POST /api/enrollments` - Enroll a user in a course.
- `GET /api/enrollments/:courseId/progress` - Get user progress for a specific course.

## Payments (`/api/payments`)
- `POST /api/payments/initialize` - Initialize a payment (e.g. via Paystack).
- `POST /api/payments/verify` - Verify a successful payment transaction.
- `POST /api/payments/webhook` - Webhook endpoint for payment gateway events.

## Events & Gallery (`/api/events`)
- `GET /api/events` - Retrieve all gallery events and associated images.
- `POST /api/events` - Create a new event (Admin only).
- `POST /api/events/:id/images` - Upload images to an event (Admin only).

## Testimonials (`/api/testimonials`)
- `GET /api/testimonials` - Retrieve all testimonials for display on the frontend.
- `POST /api/testimonials` - Add a new testimonial (Admin only).

## Team / Faculty (`/api/faculty`)
- `GET /api/faculty` - Retrieve all active team members. Accepts an optional `limit` query parameter.
- `POST /api/faculty` - Add a new team member (Admin only).
- `PUT /api/faculty/:id` - Update team member details (Admin only).
- `DELETE /api/faculty/:id` - Delete a team member (Admin only).
- `POST /api/faculty/:id/avatar` - Upload a profile image for a team member (Admin only).

## Certificates (`/api/certificates`)
- `GET /api/certificates/:id` - Retrieve a generated certificate.
- `POST /api/certificates/generate` - Generate a certificate upon course completion.
- `GET /api/certificates/verify/:certId` - Public endpoint to verify a certificate's authenticity.

## Contact (`/api/contact`)
- `POST /api/contact` - Submit the contact form. Dispatches an email to the support address via Resend.

## SuperAdmin (`/api/superadmin`)
- Various administrative and reporting endpoints restricted to users with the `super-admin` role. Includes user management, global analytics, and revenue reporting.

## Error Handling
The API standardizes error responses using a consistent JSON structure:
```json
{
  "error": "Error message description"
}
```
HTTP status codes are used appropriately (e.g., `400` Bad Request, `401` Unauthorized, `403` Forbidden, `404` Not Found, `500` Internal Server Error).
