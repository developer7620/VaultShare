/**
 * useUpload — manages the full two-phase upload flow as a state machine.
 *
 * States:
 *   idle → signing → uploading (with progress) → registering → done → error
 *
 * Provider-agnostic: routes to S3 or Cloudinary based on the
 * credentials.method field returned by /api/files/sign.
 *   - method: 'PUT'  → S3 (raw bytes via XHR PUT)
 *   - method: absent → Cloudinary (multipart form POST)
 */

import { useState, useCallback } from "react";
import {
  getUploadSignature,
  uploadToCloudinary,
  uploadToS3,
  registerFile,
} from "../api/vaultshare";

const STAGES = {
  IDLE: "idle",
  SIGNING: "signing",
  UPLOADING: "uploading",
  REGISTERING: "registering",
  DONE: "done",
  ERROR: "error",
};

export function useUpload() {
  const [stage, setStage] = useState(STAGES.IDLE);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const upload = useCallback(async (file, options = {}) => {
    const { password, maxDownloads, expiresAt } = options;

    setStage(STAGES.SIGNING);
    setError(null);
    setProgress(0);

    try {
      // ── Phase 1: Get upload credentials from backend ──────────────────
      const { uploadCredentials } = await getUploadSignature({
        originalName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });

      // ── Phase 2a: Upload directly to storage provider ─────────────────
      // credentials.method === 'PUT'  → S3 presigned PUT
      // credentials.method absent     → Cloudinary signed POST
      setStage(STAGES.UPLOADING);

      let storageKey;

      if (uploadCredentials.method === "PUT") {
        // S3 path — PUT raw bytes, no FormData
        const s3Result = await uploadToS3(file, uploadCredentials, (percent) =>
          setProgress(percent),
        );
        storageKey = s3Result.storageKey;
      } else {
        // Cloudinary path — multipart POST with form fields
        const cloudinaryResult = await uploadToCloudinary(
          file,
          uploadCredentials,
          (percent) => setProgress(percent),
        );
        storageKey = cloudinaryResult.public_id;
      }

      // ── Phase 2b: Register file with backend ──────────────────────────
      setStage(STAGES.REGISTERING);

      const registration = await registerFile({
        storageKey,
        originalName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        password: password || undefined,
        maxDownloads: maxDownloads || undefined,
        expiresAt: expiresAt || undefined,
      });

      // Store upload token in sessionStorage for this tab session
      if (registration.uploadToken) {
        sessionStorage.setItem(
          `vaultshare_token_${registration.fileId}`,
          registration.uploadToken,
        );
      }

      setResult(registration);
      setStage(STAGES.DONE);
    } catch (err) {
      setError(err.message || "Upload failed. Please try again.");
      setStage(STAGES.ERROR);
    }
  }, []);

  const reset = useCallback(() => {
    setStage(STAGES.IDLE);
    setProgress(0);
    setResult(null);
    setError(null);
  }, []);

  return {
    upload,
    reset,
    stage,
    progress,
    result,
    error,
    isIdle: stage === STAGES.IDLE,
    isBusy: [STAGES.SIGNING, STAGES.UPLOADING, STAGES.REGISTERING].includes(
      stage,
    ),
    isDone: stage === STAGES.DONE,
    isError: stage === STAGES.ERROR,
    STAGES,
  };
}
