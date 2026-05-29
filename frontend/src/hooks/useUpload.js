/**
 * useUpload — manages the full two-phase upload flow as a state machine.
 *
 * States:
 *   idle → signing → uploading (with progress) → registering → done → error
 *
 * Why a custom hook instead of inline state in the component?
 * The upload flow has 5 distinct async steps. Putting all state
 * management in the component creates a 200-line component that's
 * impossible to test or reason about. The hook isolates the state
 * machine; the component just renders it.
 */

import { useState, useCallback } from "react";
import {
  getUploadSignature,
  uploadToCloudinary,
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
  const [result, setResult] = useState(null); // { fileId, uploadToken, shareUrl }
  const [error, setError] = useState(null);

  const upload = useCallback(async (file, options = {}) => {
    const { password, maxDownloads, expiresAt } = options;

    setStage(STAGES.SIGNING);
    setError(null);
    setProgress(0);

    try {
      // ── Phase 1: Get upload credentials ────────────────────────────────
      const { uploadCredentials } = await getUploadSignature({
        originalName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });

      // ── Phase 2a: Upload to Cloudinary ─────────────────────────────────
      setStage(STAGES.UPLOADING);

      const cloudinaryResult = await uploadToCloudinary(
        file,
        uploadCredentials,
        (percent) => setProgress(percent),
      );

      // ── Phase 2b: Register with backend ────────────────────────────────
      setStage(STAGES.REGISTERING);

      const registration = await registerFile({
        storageKey: cloudinaryResult.public_id,
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
