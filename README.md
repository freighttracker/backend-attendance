# Attendance Management System Backend

Full-featured Attendance Management System built with Node.js, Express, and MongoDB.

## Features

### Admin Features
- Create / Update / Delete employees
- Manage attendance rules
- Set check-in/check-out timing
- Approve/Reject leaves
- Manage holidays
- Upload employee list (Excel)
- Generate salary slips
- Lock attendance
- Enable/disable system features
- Manage weekends
- Manage sandwich leave policy
- View reports

### Employee Features
- Login
- Check-in / Check-out
- View attendance history
- Apply for leave
- View salary slip
- View holidays
- View profile
- View working hours

## Tech Stack
- Node.js + Express.js
- MongoDB + Mongoose
- JWT Authentication
- PDFKit for salary slips
- xlsx for Excel processing
- Winston for logging
- Multer for file uploads

## Installation

```bash
npm install
```

Create `.env` file with your MongoDB URI and JWT secrets.

## Seed Database

```bash
npm run seed
```

Default credentials: info@freightrack.co / admin123

## GPS / Geofenced Attendance

Admins define office locations (coordinates + geofence radius), assign offices to
employees, and choose a policy per company for check-in and check-out:
`off` (default - unchanged behaviour), `flag` (record, flag outside/low-accuracy for
review) or `enforce` (must be inside an assigned office, or submit a reason for review).
Distances are computed server-side; the client never chooses the office.

```bash
npm run migrate:geo-attendance   # once per environment: indexes + default policy (non-destructive, re-runnable)
npm run geo:purge-locations      # schedule daily: strips coordinates older than the retention period
```

Endpoints: `/api/office-locations` (CRUD, `/:id/status`, `/admin-permissions`, `/my-permissions`),
`/api/users/:id/office-assignments`, `/api/attendance/check-in|check-out` (accept
`latitude`, `longitude`, `accuracy`, optional `exceptionReason`), `/api/attendance/locations`,
`/api/attendance/:id/location`, `/api/attendance/:id/location-review`,
`/api/attendance/geo-policy`, `/api/attendance/geo-audit-logs`.

GPS readings can be spoofed and are imprecise indoors - treat them as supporting
evidence, not proof of presence. Location is captured only at check-in/check-out.
Browsers only expose geolocation over HTTPS (or localhost).

## Start Server

```bash
npm run dev    # Development
npm start      # Production
```
