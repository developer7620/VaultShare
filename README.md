# VaultShare

A production-grade secure file sharing platform built with the MERN stack.

## Overview

VaultShare allows users to share files securely with:

- Password protection using bcrypt
- Download limits
- Automatic expiration
- Short-lived signed download URLs
- Direct-to-cloud uploads (backend never handles file bytes)
- Storage abstraction layer (Cloudinary today, AWS S3 later)

## Core Design Principles

### Direct Upload Architecture

The backend never processes raw file buffers.

```text
Client
  │
  ├── Request upload signature
  ▼
Backend
  │
  └── Returns signed upload parameters
       ▼
Cloudinary
       ▲
       │
Client uploads file directly
       │
       ▼
Backend registers file metadata
```

Benefits:

- Lower backend memory usage
- Better scalability
- Faster uploads
- Easier migration to S3 using presigned uploads

---

## Features

### Security

- bcrypt password hashing
- Signed download URLs
- Rate limiting
- Secure HTTP headers via Helmet
- Request correlation IDs
- Structured error handling

### File Controls

- Password-protected downloads
- Configurable download limits
- Automatic file expiration
- Download audit tracking

### Reliability

- MongoDB-backed metadata
- Atomic download count updates
- Cron-based expiry cleanup
- Graceful shutdown handling
- Health and readiness checks

---

## Tech Stack

### Backend

- Node.js
- Express.js
- MongoDB + Mongoose
- Cloudinary
- bcrypt
- node-cron

### Frontend

- React
- Vite

---

## Planned Architecture

```text
Route
  │
  ▼
Controller
  │
  ▼
Service
  ├── MongoDB Model
  └── Storage Provider
          ├── CloudinaryProvider
          └── S3Provider
```

Controllers remain thin.

Business logic lives inside services.

Storage operations are abstracted behind a provider interface.

---

## Project Structure

```text
backend/
├── src/
│   ├── config/
│   ├── controllers/
│   ├── services/
│   ├── storage/
│   ├── models/
│   ├── routes/
│   ├── middleware/
│   ├── jobs/
│   ├── utils/
│   ├── app.js
│   └── server.js
├── tests/
└── .env.example

frontend/
└── src/
```

---

## File Metadata Model

Each uploaded file stores:

- Storage key
- Original filename
- MIME type
- File size
- Password hash
- Download limits
- Download count
- Expiration timestamp
- Status
- Download audit history

---

## Security Model

### Password Protection

Passwords are hashed using bcrypt before storage.

The original password is never stored.

### Download Authorization

Downloads require:

1. File exists
2. File is active
3. File is not expired
4. Download limit not reached
5. Password verification (if enabled)

Only then is a signed download URL generated.

### Signed URLs

Signed URLs:

- Are generated on demand
- Expire after a short duration (default 60 seconds)
- Are never stored in MongoDB

---

## Environment Variables

```env
NODE_ENV=development
PORT=3000

MONGODB_URI=your_mongodb_uri

CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

FRONTEND_URL=http://localhost:5173

SIGNED_URL_TTL_SECONDS=60
BCRYPT_ROUNDS=12

RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100

STORAGE_PROVIDER=cloudinary
```

---

## Local Setup

### Install Dependencies

```bash
npm install
```

### Configure Environment

```bash
cp .env.example .env
```

Fill in:

- MongoDB URI
- Cloudinary credentials

### Run Development Server

```bash
npm run dev
```

### Health Check

```bash
GET /health
GET /health/ready
```

---

## Future Enhancements

- AWS S3 provider
- User authentication
- File ownership
- Admin dashboard
- Cloudinary upload webhooks
- Redis-backed rate limiting
- Background job queue
- Monitoring and observability

---

## Engineering Highlights

### Atomic Download Limits

Download counts are updated using MongoDB atomic operations to prevent race conditions.

### Storage Abstraction

Storage logic is isolated behind a provider interface, enabling Cloudinary-to-S3 migration with minimal application changes.

### Fail-Fast Configuration

The application validates required environment variables during startup and exits immediately if configuration is incomplete.

---

## License

MIT
