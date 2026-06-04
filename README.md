# VaultShare

A secure file-sharing platform built with **Node.js, Express, MongoDB, and React**.

VaultShare allows users to upload files, generate secure share links, protect downloads with passwords, limit download counts, and automatically expire files. Files are delivered through short-lived signed URLs, while the backend never handles raw file bytes.

---

## Why VaultShare?

Most file-sharing applications either expose files publicly or route uploads through the backend, increasing bandwidth costs and memory usage.

VaultShare was designed to:

* Keep the backend stateless during uploads
* Support secure sharing with expiration and download controls
* Protect downloads with password verification
* Deliver files through short-lived signed URLs
* Abstract storage providers for future migration
* Demonstrate production-oriented backend engineering practices

---

## Architecture Decisions

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

* Lower backend memory usage
* Better scalability
* Faster uploads
* Easier migration to AWS S3

---

### Atomic Download Counter

Download limits are enforced using MongoDB atomic operations.

The eligibility check and counter decrement occur in a single database operation, preventing race conditions under concurrent access.

---

### Timing-Safe Password Verification

Passwords are hashed using bcrypt before storage.

Verification follows a timing-safe approach to reduce information leakage through response timing differences.

---

### Storage Abstraction

All storage operations are routed through a common `StorageProvider` interface.

```text
StorageProvider
├── CloudinaryProvider
└── S3Provider
```

This allows migration from Cloudinary to AWS S3 with minimal application changes.

---

### Dead-Letter Queue

Failed storage deletion operations are recorded and retried instead of being silently discarded.

This improves operational reliability and helps identify cleanup failures.

---

## System Architecture

```text
┌─────────────┐
│   React UI  │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Express API │
└──────┬──────┘
       │
 ┌─────┴─────┐
 ▼           ▼
MongoDB   Storage Provider
              │
       ┌──────┴──────┐
       ▼             ▼
   Cloudinary      AWS S3
```

---

## Features

### Security

* Password-protected downloads
* bcrypt password hashing
* Signed download URLs
* Rate limiting
* Secure HTTP headers via Helmet
* Request correlation IDs
* Structured error handling

### File Controls

* Password protection
* Download limits
* Automatic expiration
* Download audit tracking
* Secure deletion tokens

### Reliability

* MongoDB-backed metadata
* Atomic download count updates
* Cron-based expiry cleanup
* Graceful shutdown handling
* Health and readiness checks

### Administration

* File listing and filtering
* Usage statistics
* Download audit logs
* Orphan file detection
* Force delete functionality

---

## Tech Stack

| Layer                 | Technology                             |
| --------------------- | -------------------------------------- |
| Frontend              | React, Vite                            |
| Backend               | Node.js, Express                       |
| Database              | MongoDB, Mongoose                      |
| Storage (Development) | Cloudinary                             |
| Storage (Production)  | AWS S3                                 |
| Security              | bcrypt, Helmet                         |
| Background Jobs       | node-cron                              |
| Testing               | Jest, Supertest, mongodb-memory-server |

---

## Project Metrics

* 47+ backend tests
* Direct-to-cloud upload architecture
* Signed URL delivery
* Password-protected file sharing
* Download audit tracking
* Cloudinary → S3 migration ready
* Storage provider abstraction

---

## Running Locally

### Prerequisites

* Node.js 20+
* MongoDB Atlas account
* Cloudinary account

### Backend

```bash
cd backend

cp .env.example .env

npm install

npm run dev
```

Backend runs on:

```text
http://localhost:3000
```

### Frontend

```bash
cd frontend

npm install

npm run dev
```

Frontend runs on:

```text
http://localhost:5173
```

### Tests

```bash
cd backend

npm test
```

---

## Environment Variables

```env
# Required

MONGODB_URI=

CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

PORT=3000

ADMIN_API_KEY=

# Optional

STORAGE_PROVIDER=cloudinary

SIGNED_URL_TTL_SECONDS=60

BCRYPT_ROUNDS=12

RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100
```

---

## API Reference

### Public Endpoints

| Method | Endpoint                  | Description                           |
| ------ | ------------------------- | ------------------------------------- |
| POST   | `/api/files/sign`         | Generate upload credentials           |
| POST   | `/api/files/register`     | Register uploaded file                |
| GET    | `/api/files/:id`          | Fetch file metadata                   |
| POST   | `/api/files/:id/download` | Verify access and generate signed URL |
| GET    | `/api/files/:id/status`   | File lifecycle status                 |
| DELETE | `/api/files/:id`          | Delete file using upload token        |

### Admin Endpoints

| Method | Endpoint                         |
| ------ | -------------------------------- |
| GET    | `/api/admin/stats`               |
| GET    | `/api/admin/files`               |
| GET    | `/api/admin/files/:id/downloads` |
| GET    | `/api/admin/orphans`             |
| DELETE | `/api/admin/files/:id`           |

### Health Checks

| Method | Endpoint        |
| ------ | --------------- |
| GET    | `/health`       |
| GET    | `/health/ready` |

---

## Security Model

### Uploads

* Clients never receive Cloudinary secrets
* Upload credentials are generated server-side
* Files are uploaded directly to storage

### Downloads

Downloads require:

1. File exists
2. File is active
3. File is not expired
4. Download limit not reached
5. Password verification (if enabled)

Only after successful validation is a signed download URL generated.

### Signed URLs

* Generated on demand
* Short-lived
* Never stored in MongoDB

### Deletion

Files can be deleted using a one-time upload token generated during registration.

---

## Storage Migration Path

```env
STORAGE_PROVIDER=s3

AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=
AWS_S3_BUCKET=
```

New uploads automatically use S3 while existing Cloudinary files continue to work until naturally removed.

No controller or route changes are required.

---

## Project Structure

```text
vaultshare/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   ├── controllers/
│   │   ├── jobs/
│   │   ├── middleware/
│   │   ├── models/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── storage/
│   │   └── utils/
│   └── tests/
│
└── frontend/
    └── src/
        ├── api/
        ├── components/
        └── hooks/
```

---

## Future Enhancements

* User authentication
* File ownership and accounts
* Redis-backed rate limiting
* Background job queues
* Cloudinary upload webhooks
* Monitoring and observability
* CloudFront signed URLs

---

## License

MIT

---

## Author

**Aditya Bhimanwar**

B.Tech, IIIT Kottayam

Backend Engineering • Distributed Systems • MERN Stack
