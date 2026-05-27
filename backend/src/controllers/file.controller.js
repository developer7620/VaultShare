"use strict";

const fileService = require("../services/file.service");
const asyncHandler = require("../utils/asyncHandler");

const sign = asyncHandler(async (req, res) => {
  const { originalName, mimeType, sizeBytes } = req.body;
  const result = await fileService.generateUploadCredentials({
    originalName,
    mimeType,
    sizeBytes,
  });
  res.status(200).json({ success: true, data: result });
});

const register = asyncHandler(async (req, res) => {
  const {
    storageKey,
    originalName,
    mimeType,
    sizeBytes,
    password,
    maxDownloads,
    expiresAt,
  } = req.body;
  const result = await fileService.registerFile({
    storageKey,
    originalName,
    mimeType,
    sizeBytes,
    password,
    maxDownloads,
    expiresAt,
  });
  res.status(201).json({ success: true, data: result });
});

const getMeta = asyncHandler(async (req, res) => {
  const result = await fileService.getFileMeta(req.params.id);
  res.status(200).json({ success: true, data: result });
});

const download = asyncHandler(async (req, res) => {
  const { password } = req.body;
  const ipAddress = req.ip || req.socket?.remoteAddress || "unknown";
  const userAgent = req.headers["user-agent"] || "";
  const result = await fileService.downloadFile({
    fileId: req.params.id,
    password: password || null,
    ipAddress,
    userAgent,
  });
  res.status(200).json({ success: true, data: result });
});

const deleteFile = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // uploadToken is set by extractToken middleware (null if not provided)
  await fileService.softDeleteFile(id, req.uploadToken);

  res.status(200).json({
    success: true,
    data: {
      message: "File deleted successfully.",
      fileId: id,
    },
  });
});

const getStatus = asyncHandler(async (req, res) => {
  const result = await fileService.getFileStatus(req.params.id);
  res.status(200).json({ success: true, data: result });
});

module.exports = { sign, register, getMeta, download, deleteFile, getStatus };
