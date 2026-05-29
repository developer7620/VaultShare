/**
 * VaultShare API client.
 *
 * All backend calls go through this module — never fetch() inline in components.
 * This gives you one place to:
 *   - Change the base URL (dev → prod)
 *   - Add auth headers
 *   - Handle global error patterns
 *
 * Functions return { data } on success, throw an Error with a .code property
 * on failure so components can handle specific error codes if needed.
 */

const BASE_URL = "/api";

/**
 * Shared fetch wrapper — parses JSON, throws structured errors.
 */
async function apiFetch(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });

  const json = await response.json();

  if (!json.success) {
    const err = new Error(json.error?.message || "Request failed");
    err.code = json.error?.code;
    err.statusCode = json.error?.statusCode;
    err.details = json.error?.details;
    throw err;
  }

  return json.data;
}

/**
 * Phase 1 — Get Cloudinary upload credentials from the backend.
 *
 * @param {{ originalName: string, mimeType: string, sizeBytes: number }} meta
 */
export async function getUploadSignature(meta) {
  return apiFetch("/files/sign", {
    method: "POST",
    body: JSON.stringify(meta),
  });
}

/**
 * Phase 2a — Upload file directly to Cloudinary using XMLHttpRequest.
 * Returns a Promise that resolves with Cloudinary's response JSON.
 *
 * Uses XHR (not fetch) because:
 *   - fetch() does not expose upload progress events
 *   - XHR's upload.onprogress fires for each chunk
 *
 * @param {File}     file        - Browser File object
 * @param {Object}   credentials - From getUploadSignature()
 * @param {Function} onProgress  - (percent: number) => void
 * @returns {Promise<{ public_id: string, bytes: number, ... }>}
 */
export function uploadToCloudinary(file, credentials, onProgress) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("api_key", credentials.apiKey);
    formData.append("timestamp", credentials.timestamp);
    formData.append("signature", credentials.signature);
    formData.append("folder", credentials.folder);
    formData.append("resource_type", credentials.resourceType);
    // Only append type if explicitly set — omitting = Cloudinary default (upload)
    if (credentials.uploadType) {
      formData.append("type", credentials.uploadType);
    }

    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      try {
        const response = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(response);
        } else {
          const err = new Error(
            response.error?.message || "Cloudinary upload failed",
          );
          err.code = "CLOUDINARY_UPLOAD_FAILED";
          reject(err);
        }
      } catch {
        reject(new Error("Failed to parse Cloudinary response"));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.open("POST", credentials.uploadUrl);
    xhr.send(formData);
  });
}

/**
 * Phase 2b — Register the uploaded file with the VaultShare backend.
 *
 * @param {Object} payload
 * @param {string} payload.storageKey   - public_id from Cloudinary
 * @param {string} payload.originalName
 * @param {string} payload.mimeType
 * @param {number} payload.sizeBytes
 * @param {string} [payload.password]
 * @param {number} [payload.maxDownloads]
 * @param {string} [payload.expiresAt]  - ISO 8601 string
 */
export async function registerFile(payload) {
  return apiFetch("/files/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * Get public metadata for a file (no download, no auth required).
 *
 * @param {string} fileId
 */
export async function getFileMeta(fileId) {
  return apiFetch(`/files/${fileId}`);
}

/**
 * Request a signed download URL.
 *
 * @param {string}      fileId
 * @param {string|null} password
 */
export async function requestDownload(fileId, password) {
  return apiFetch(`/files/${fileId}/download`, {
    method: "POST",
    body: JSON.stringify({ password: password || undefined }),
  });
}

/**
 * Delete a file (requires upload token).
 *
 * @param {string} fileId
 * @param {string} uploadToken
 */
export async function deleteFile(fileId, uploadToken) {
  return apiFetch(`/files/${fileId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${uploadToken}` },
  });
}
