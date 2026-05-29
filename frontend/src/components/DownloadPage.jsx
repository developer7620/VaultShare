/**
 * DownloadPage — shown when a user visits /files/:id
 *
 * States:
 *   loading → loaded (show metadata + optional password form)
 *           → downloading (signed URL requested)
 *           → error (file not found, expired, wrong password)
 */

import { useState, useEffect } from "react";
import { getFileMeta, requestDownload } from "../api/vaultshare";

export default function DownloadPage({ fileId }) {
  const [meta, setMeta] = useState(null);
  const [metaError, setMetaError] = useState("");
  const [loading, setLoading] = useState(true);

  const [password, setPassword] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [downloaded, setDownloaded] = useState(false);

  // Fetch file metadata on mount
  useEffect(() => {
    if (!fileId) return;

    getFileMeta(fileId)
      .then(setMeta)
      .catch((err) => {
        setMetaError(
          err.code === "NOT_FOUND"
            ? "This file does not exist, has expired, or has been deleted."
            : "Failed to load file information.",
        );
      })
      .finally(() => setLoading(false));
  }, [fileId]);

  async function handleDownload(e) {
    e.preventDefault();
    setDownloading(true);
    setDownloadError("");

    try {
      const result = await requestDownload(
        fileId,
        meta?.isPasswordProtected ? password : null,
      );

      // Open the signed URL in a new tab — browser handles the download
      // The signed URL is valid for urlExpiresInSeconds (default 60s)
      // Replace the window.open line in handleDownload:
      const link = document.createElement("a");
      link.href = result.signedUrl;
      link.download = meta.originalName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setDownloaded(true);
      setDownloaded(true);

      // Update remaining count in UI
      if (result.downloadsRemaining !== null) {
        setMeta((prev) => ({
          ...prev,
          downloadsRemaining: result.downloadsRemaining,
        }));
      }
    } catch (err) {
      if (err.code === "UNAUTHORIZED") {
        setDownloadError(err.message || "Incorrect password.");
      } else if (err.code === "NOT_FOUND") {
        setDownloadError(
          "This file has expired or reached its download limit.",
        );
      } else if (err.code === "RATE_LIMITED") {
        setDownloadError(err.message || "Too many attempts. Please wait.");
      } else {
        setDownloadError("Download failed. Please try again.");
      }
    } finally {
      setDownloading(false);
    }
  }

  // ── Loading ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={styles.card}>
        <div style={styles.spinner} />
        <p style={styles.loadingText}>Loading file info...</p>
      </div>
    );
  }

  // ── File not found / expired ───────────────────────────────────────────
  if (metaError) {
    return (
      <div style={styles.card}>
        <div style={styles.errorIcon}>✕</div>
        <h2 style={styles.title}>File unavailable</h2>
        <p style={styles.bodyText}>{metaError}</p>
      </div>
    );
  }

  // ── Download complete ──────────────────────────────────────────────────
  if (downloaded) {
    return (
      <div style={styles.card}>
        <div style={styles.successIcon}>↓</div>
        <h2 style={styles.title}>Download started</h2>
        <p style={styles.bodyText}>
          Your file should be downloading. If it didn't start,{" "}
          <button style={styles.linkBtn} onClick={() => setDownloaded(false)}>
            try again
          </button>
          .
        </p>
        {meta.downloadsRemaining !== null && (
          <p style={styles.hint}>
            {meta.downloadsRemaining} download(s) remaining
          </p>
        )}
      </div>
    );
  }

  // ── Main download UI ───────────────────────────────────────────────────
  return (
    <div style={styles.card}>
      {/* File icon */}
      <div style={styles.fileIcon}>{getFileEmoji(meta.mimeType)}</div>

      <h2 style={styles.title}>{meta.originalName}</h2>

      {/* File metadata */}
      <div style={styles.metaRow}>
        <span style={styles.badge}>{meta.humanReadableSize}</span>
        {meta.isPasswordProtected && (
          <span style={{ ...styles.badge, ...styles.badgeSecure }}>
            Password protected
          </span>
        )}
        {meta.downloadsRemaining !== null && (
          <span style={styles.badge}>
            {meta.downloadsRemaining} download(s) left
          </span>
        )}
        {meta.expiresAt && (
          <span style={styles.badge}>
            Expires {new Date(meta.expiresAt).toLocaleDateString()}
          </span>
        )}
      </div>

      {/* Download form */}
      <form onSubmit={handleDownload}>
        {meta.isPasswordProtected && (
          <div style={styles.field}>
            <label style={styles.label}>Password required</label>
            <input
              style={styles.input}
              type="password"
              placeholder="Enter password to download"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={downloading}
              autoFocus
            />
          </div>
        )}

        {downloadError && <p style={styles.error}>{downloadError}</p>}

        <button
          style={{
            ...styles.primaryBtn,
            opacity: downloading ? 0.6 : 1,
            cursor: downloading ? "not-allowed" : "pointer",
          }}
          type="submit"
          disabled={downloading}
        >
          {downloading ? "Preparing download..." : "↓  Download file"}
        </button>
      </form>
    </div>
  );
}

function getFileEmoji(mimeType) {
  if (!mimeType) return "📄";
  if (mimeType.startsWith("image/")) return "🖼";
  if (mimeType.startsWith("video/")) return "🎬";
  if (mimeType.startsWith("audio/")) return "🎵";
  if (mimeType === "application/pdf") return "📕";
  if (mimeType.includes("zip") || mimeType.includes("tar")) return "📦";
  if (mimeType.includes("word") || mimeType.includes("document")) return "📝";
  if (mimeType.includes("sheet") || mimeType.includes("excel")) return "📊";
  return "📄";
}

const styles = {
  card: {
    maxWidth: 440,
    margin: "40px auto",
    padding: "32px",
    background: "#fff",
    borderRadius: 12,
    boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
    fontFamily: "system-ui, sans-serif",
    textAlign: "center",
  },
  title: {
    margin: "12px 0 16px",
    fontSize: 20,
    fontWeight: 600,
    color: "#111",
  },
  bodyText: { color: "#6b7280", fontSize: 14, lineHeight: 1.6 },
  hint: { color: "#9ca3af", fontSize: 13, marginTop: 8 },
  fileIcon: { fontSize: 48, marginBottom: 4 },
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
    margin: "0 auto 8px",
  },
  errorIcon: {
    width: 48,
    height: 48,
    borderRadius: "50%",
    background: "#fef2f2",
    color: "#dc2626",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 20,
    fontWeight: 700,
    margin: "0 auto 8px",
  },
  metaRow: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    justifyContent: "center",
    marginBottom: 24,
  },
  badge: {
    padding: "3px 10px",
    background: "#f3f4f6",
    borderRadius: 20,
    fontSize: 12,
    color: "#374151",
  },
  badgeSecure: { background: "#fef3c7", color: "#92400e" },
  field: { marginBottom: 16, textAlign: "left" },
  label: {
    display: "block",
    fontSize: 13,
    fontWeight: 500,
    color: "#374151",
    marginBottom: 6,
  },
  input: {
    width: "100%",
    padding: "8px 12px",
    borderRadius: 6,
    border: "1px solid #d1d5db",
    fontSize: 14,
    color: "#111",
    boxSizing: "border-box",
    outline: "none",
  },
  primaryBtn: {
    width: "100%",
    padding: "11px 0",
    background: "#6366f1",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 600,
  },
  linkBtn: {
    background: "none",
    border: "none",
    color: "#6366f1",
    cursor: "pointer",
    fontSize: 14,
    padding: 0,
  },
  error: {
    fontSize: 13,
    color: "#dc2626",
    marginBottom: 12,
    textAlign: "left",
  },
  spinner: {
    width: 32,
    height: 32,
    border: "3px solid #e5e7eb",
    borderTop: "3px solid #6366f1",
    borderRadius: "50%",
    margin: "0 auto 16px",
    animation: "spin 0.8s linear infinite",
  },
  loadingText: { color: "#6b7280", fontSize: 14 },
};
