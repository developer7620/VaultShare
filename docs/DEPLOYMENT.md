# VaultShare Production Deployment Checklist

## Pre-deploy

- [ ] NODE_ENV=production
- [ ] BCRYPT_ROUNDS=12 (not 10)
- [ ] SIGNED_URL_TTL_SECONDS=60 (or less)
- [ ] RATE_LIMIT_MAX=100 (tune per expected traffic)
- [ ] REDIS_URL set (mandatory for multi-process)
- [ ] FRONTEND_URL locked to actual domain (not \*)
- [ ] All env vars set — run `node src/server.js` locally with prod vars to verify

## MongoDB Atlas

- [ ] M10+ cluster (M0 free tier has connection limits)
- [ ] IP allowlist — add only your server's egress IP (not 0.0.0.0/0)
- [ ] DB user with least-privilege role (readWrite on vaultshare DB only)
- [ ] Backup enabled
- [ ] Connection string uses ?retryWrites=true&w=majority

## Storage

Cloudinary (dev):

- [ ] CLOUDINARY_UPLOAD_FOLDER=vaultshare (not root)
- [ ] Verify CLOUDINARY_API_SECRET is correct (test with /api/files/sign)

S3 (production):

- [ ] Bucket has Block Public Access: ALL enabled
- [ ] Bucket versioning: optional (adds cost, enables recovery)
- [ ] Server-side encryption: AES256 or KMS
- [ ] IAM user with minimal policy (PutObject, GetObject, DeleteObject on bucket/\* only)
- [ ] CORS policy on bucket allows PUT from your frontend domain only

## Security

- [ ] Helmet CSP reviewed for production domain
- [ ] CORS origin locked to production frontend URL
- [ ] Rate limits tuned to expected traffic patterns
- [ ] Upload token warning shown in UI ("save this — it won't be shown again")

## Post-deploy verification

- [ ] GET /health → 200
- [ ] GET /health/ready → 200 (DB connected)
- [ ] POST /api/files/sign → 200 with signature
- [ ] Full upload → register → download flow
- [ ] Wrong password → 401 with attempt counter
- [ ] Delete with token → 200
- [ ] Delete without token → 401
- [ ] npm test → 47 passed (run in CI before every deploy)
