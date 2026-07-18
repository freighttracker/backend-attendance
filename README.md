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

Default credentials: admin@company.com / admin123

## Start Server

```bash
npm run dev    # Development
npm start      # Production
```
