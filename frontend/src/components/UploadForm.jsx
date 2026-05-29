/**
 * UploadForm — the upload page.
 *
 * Renders a file picker + options form.
 * On submit, drives the useUpload state machine.
 * On success, shows the share link and upload token.
 */

import { useState, useRef } from "react";
import { useUpload } from "../hooks/useUpload";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/x-zip-compressed",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/wav",
];

export default function UploadForm() {
  const {
    upload,
    reset,
    stage,
    progress,
    result,
    error,
    isBusy,
    isDone,
    STAGES,
  } = useUpload();

  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState("");
  const [password, setPassword] = useState("");
  const [maxDownloads, setMaxDownloads] = useState("");
  const [expiresIn, setExpiresIn] = useState("");
  const [copied, setCopied] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);
  const fileInputRef = useRef(null);

  function handleFileChange(e) {
    const selected = e.target.files[0];
    setFileError("");

    if (!selected) return;

    if (selected.size > MAX_FILE_SIZE) {
      setFileError("File exceeds 100MB limit.");
      return;
    }

    if (!ALLOWED_MIME_TYPES.includes(selected.type)) {
      setFileError("File type not supported.");
      return;
    }

    setFile(selected);
  }

  function buildExpiresAt() {
    if (!expiresIn) return undefined;
    const hours = parseInt(expiresIn, 10);
    if (isNaN(hours) || hours <= 0) return undefined;
    return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!file) return;

    await upload(file, {
      password: password || undefined,
      maxDownloads: maxDownloads ? parseInt(maxDownloads, 10) : undefined,
      expiresAt: buildExpiresAt(),
    });
  }

  async function copyToClipboard(text, setter) {
    await navigator.clipboard.writeText(text);
    setter(true);
    setTimeout(() => setter(false), 2000);
  }

  function handleReset() {
    setFile(null);
    setPassword("");
    setMaxDownloads("");
    setExpiresIn("");
    setFileError("");
    setCopied(false);
    setTokenCopied(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    reset();
  }

  // ── Success state ──────────────────────────────────────────────────────
  if (isDone && result) {
    return (
      <div style={styles.card}>
        <div style={styles.successIcon}>✓</div>
        <h2 style={styles.successTitle}>File shared successfully</h2>

        <div style={styles.field}>
          <label style={styles.label}>Share link</label>
          <div style={styles.copyRow}>
            <input style={styles.input} value={result.shareUrl} readOnly />
            <button
              style={styles.copyBtn}
              onClick={() => copyToClipboard(result.shareUrl, setCopied)}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>

        <div style={styles.field}>
          <label style={styles.label}>
            Upload token{" "}
            <span style={styles.hint}>
              — save this to delete the file later
            </span>
          </label>
          <div style={styles.copyRow}>
            <input
              style={{ ...styles.input, fontFamily: "monospace", fontSize: 11 }}
              value={result.uploadToken}
              readOnly
            />
            <button
              style={styles.copyBtn}
              onClick={() =>
                copyToClipboard(result.uploadToken, setTokenCopied)
              }
            >
              {tokenCopied ? "Copied!" : "Copy"}
            </button>
          </div>
          <p style={styles.warning}>
            This token is shown once. Store it somewhere safe.
          </p>
        </div>

        <div style={styles.metaRow}>
          {result.isPasswordProtected && (
            <span style={styles.badge}>Password protected</span>
          )}
          {result.maxDownloads && (
            <span style={styles.badge}>
              {result.maxDownloads} downloads max
            </span>
          )}
          {result.expiresAt && (
            <span style={styles.badge}>
              Expires {new Date(result.expiresAt).toLocaleDateString()}
            </span>
          )}
        </div>

        <button style={styles.secondaryBtn} onClick={handleReset}>
          Upload another file
        </button>
      </div>
    );
  }

  // ── Upload form ────────────────────────────────────────────────────────
  return (
    <div style={styles.card}>
      <h2 style={styles.title}>Share a file</h2>

      <form onSubmit={handleSubmit}>
        {/* File picker */}
        <div style={styles.field}>
          <div
            style={{
              ...styles.dropZone,
              ...(file ? styles.dropZoneActive : {}),
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            {file ? (
              <>
                <span style={styles.fileName}>{file.name}</span>
                <span style={styles.fileSize}>
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </span>
              </>
            ) : (
              <>
                <span style={styles.dropIcon}>↑</span>
                <span>Click to select a file</span>
                <span style={styles.hint}>Max 100MB</span>
              </>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileChange}
            style={{ display: "none" }}
          />
          {fileError && <p style={styles.error}>{fileError}</p>}
        </div>

        {/* Options */}
        <div style={styles.optionsGrid}>
          <div style={styles.field}>
            <label style={styles.label}>Password (optional)</label>
            <input
              style={styles.input}
              type="password"
              placeholder="Leave blank for no password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isBusy}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Max downloads (optional)</label>
            <input
              style={styles.input}
              type="number"
              placeholder="Unlimited"
              min="1"
              max="10000"
              value={maxDownloads}
              onChange={(e) => setMaxDownloads(e.target.value)}
              disabled={isBusy}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Expires in (hours, optional)</label>
            <input
              style={styles.input}
              type="number"
              placeholder="Never"
              min="1"
              value={expiresIn}
              onChange={(e) => setExpiresIn(e.target.value)}
              disabled={isBusy}
            />
          </div>
        </div>

        {/* Progress */}
        {isBusy && (
          <div style={styles.progressWrap}>
            <div style={styles.progressLabel}>
              {stage === STAGES.SIGNING && "Preparing upload..."}
              {stage === STAGES.UPLOADING && `Uploading... ${progress}%`}
              {stage === STAGES.REGISTERING && "Registering file..."}
            </div>
            <div style={styles.progressTrack}>
              <div
                style={{
                  ...styles.progressBar,
                  width: stage === STAGES.UPLOADING ? `${progress}%` : "100%",
                  opacity: stage !== STAGES.UPLOADING ? 0.5 : 1,
                }}
              />
            </div>
          </div>
        )}

        {error && <p style={styles.error}>{error}</p>}

        <button
          style={{
            ...styles.primaryBtn,
            opacity: !file || isBusy ? 0.5 : 1,
            cursor: !file || isBusy ? "not-allowed" : "pointer",
          }}
          type="submit"
          disabled={!file || isBusy}
        >
          {isBusy ? "Uploading..." : "Upload & share"}
        </button>
      </form>
    </div>
  );
}

// ── Inline styles ──────────────────────────────────────────────────────────
const styles = {
  card: {
    maxWidth: 520,
    margin: "40px auto",
    padding: "32px",
    background: "#fff",
    borderRadius: 12,
    boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
    fontFamily: "system-ui, sans-serif",
  },
  title: { margin: "0 0 24px", fontSize: 22, fontWeight: 600, color: "#111" },
  successTitle: {
    margin: "8px 0 24px",
    fontSize: 20,
    fontWeight: 600,
    color: "#111",
  },
  successIcon: {
    width: 48,
    height: 48,
    borderRadius: "50%",
    background: "#ecfdf5",
    color: "#059669",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 22,
    fontWeight: 700,
    marginBottom: 4,
  },
  field: { marginBottom: 16 },
  label: {
    display: "block",
    fontSize: 13,
    fontWeight: 500,
    color: "#374151",
    marginBottom: 6,
  },
  hint: { fontSize: 12, color: "#9ca3af", fontWeight: 400 },
  input: {
    width: "100%",
    padding: "8px 12px",
    borderRadius: 6,
    border: "1px solid #d1d5db",
    fontSize: 14,
    color: "#111",
    boxSizing: "border-box",
    outline: "none",
    background: "#fff",
  },
  optionsGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "0 16px",
  },
  dropZone: {
    border: "2px dashed #d1d5db",
    borderRadius: 8,
    padding: "28px 16px",
    textAlign: "center",
    cursor: "pointer",
    color: "#6b7280",
    fontSize: 14,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
    transition: "border-color 0.15s",
  },
  dropZoneActive: {
    borderColor: "#6366f1",
    color: "#111",
    background: "#fafafa",
  },
  dropIcon: { fontSize: 28, color: "#6366f1", marginBottom: 4 },
  fileName: { fontWeight: 500, color: "#111", fontSize: 15 },
  fileSize: { color: "#9ca3af", fontSize: 13 },
  progressWrap: { marginBottom: 16 },
  progressLabel: { fontSize: 13, color: "#6b7280", marginBottom: 6 },
  progressTrack: {
    height: 6,
    background: "#e5e7eb",
    borderRadius: 4,
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    background: "#6366f1",
    borderRadius: 4,
    transition: "width 0.2s",
  },
  primaryBtn: {
    width: "100%",
    padding: "10px 0",
    background: "#6366f1",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 600,
    marginTop: 8,
  },
  secondaryBtn: {
    width: "100%",
    padding: "10px 0",
    background: "transparent",
    color: "#6366f1",
    border: "1px solid #6366f1",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 500,
    marginTop: 16,
    cursor: "pointer",
  },
  copyRow: { display: "flex", gap: 8 },
  copyBtn: {
    padding: "8px 14px",
    background: "#6366f1",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  metaRow: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 },
  badge: {
    padding: "3px 10px",
    background: "#f3f4f6",
    borderRadius: 20,
    fontSize: 12,
    color: "#374151",
  },
  warning: { fontSize: 12, color: "#dc2626", marginTop: 6 },
  error: { fontSize: 13, color: "#dc2626", marginTop: 4 },
};
