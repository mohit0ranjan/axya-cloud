import express from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import multer from "multer";
import fs from "fs";
import path from "path";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import pool from "../config/db";
import { requireAuth, AuthRequest } from "../middlewares/auth.middleware";
import { decryptSession } from "../utils/sessionEncryption";
import { sendApiError } from "../utils/apiError";
import { FRONTEND_BASE_URL } from "../config/urls";
import {
  initUpload,
  uploadChunk,
  completeUpload,
  checkUploadStatus,
  cancelUpload,
  pauseUpload,
  resumePausedUpload,
} from "../controllers/upload";
import { UPLOAD_TMP_ROOT } from "../controllers/upload/upload.types";
import { isAllowedUploadMime } from "../utils/uploadMime";

const router = express.Router();
const asyncRoute =
  (fn: any): express.RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
const hash = (text: string) =>
  crypto.createHash("sha256").update(text).digest("hex");
const limits = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 12000,
  standardHeaders: true,
  legacyHeaders: false,
});
const initLimits = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
router.get(
  "/",
  requireAuth,
  asyncRoute(async (req: AuthRequest, res: express.Response) => {
    const rows = await pool.query(
      "SELECT id,slug,title,folder_id,expires_at,revoked_at,max_bytes,max_files,created_at,(SELECT count(*)::int FROM file_request_uploads u WHERE u.request_id=r.id) AS files_received FROM file_requests r WHERE owner_user_id=$1 ORDER BY created_at DESC LIMIT 100",
      [req.user!.id],
    );
    res.json({ success: true, requests: rows.rows });
  }),
);
router.post(
  "/",
  requireAuth,
  initLimits,
  asyncRoute(async (req: AuthRequest, res: express.Response) => {
    const p = z
      .object({
        title: z.string().trim().min(1).max(100),
        folderId: z.string().uuid(),
        expiresInDays: z.number().int().min(1).max(30).default(7),
        maxMB: z.number().int().min(1).max(500).default(100),
        maxFiles: z.number().int().min(1).max(100).default(20),
        password: z.string().min(8).max(128).optional(),
      })
      .safeParse(req.body);
    if (!p.success)
      return sendApiError(
        res,
        400,
        "invalid_request",
        "Choose a folder, title and valid limits. Optional passwords need at least 8 characters.",
      );
    const folder = await pool.query(
      "SELECT id FROM folders WHERE id=$1 AND user_id=$2 AND is_trashed=false",
      [p.data.folderId, req.user!.id],
    );
    if (!folder.rowCount)
      return sendApiError(
        res,
        404,
        "not_found",
        "Destination folder not found.",
      );
    const key = crypto.randomBytes(32).toString("base64url"),
      slug = crypto.randomBytes(18).toString("base64url");
    const row = await pool.query(
      "INSERT INTO file_requests(owner_user_id,folder_id,title,slug,key_hash,password_hash,expires_at,max_bytes,max_files) VALUES($1,$2,$3,$4,$5,$6,NOW()+$7::int*INTERVAL '1 day',$8,$9) RETURNING id,slug,title,expires_at",
      [
        req.user!.id,
        p.data.folderId,
        p.data.title,
        slug,
        hash(key),
        p.data.password ? await bcrypt.hash(p.data.password, 12) : null,
        p.data.expiresInDays,
        p.data.maxMB * 1024 ** 2,
        p.data.maxFiles,
      ],
    );
    res
      .status(201)
      .json({
        success: true,
        request: row.rows[0],
        url: `${FRONTEND_BASE_URL}/r/${slug}#k=${key}`,
      });
  }),
);
router.delete(
  "/:slug",
  requireAuth,
  asyncRoute(async (req: AuthRequest, res: express.Response) => {
    const r = await pool.query(
      "UPDATE file_requests SET revoked_at=NOW() WHERE slug=$1 AND owner_user_id=$2 RETURNING id",
      [req.params.slug, req.user!.id],
    );
    if (!r.rowCount)
      return sendApiError(res, 404, "not_found", "Request not found.");
    res.json({ success: true });
  }),
);

// The capability never authorises drive listing, download or arbitrary uploads.
const grant = asyncRoute(
  async (
    req: AuthRequest,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    const key = String(req.headers["x-axya-request-key"] || "");
    if (key.length < 32 || key.length > 128)
      return sendApiError(
        res,
        403,
        "forbidden",
        "This request link is invalid.",
      );
    const found = await pool.query(
      "SELECT r.*,u.phone,u.session_string FROM file_requests r JOIN users u ON u.id=r.owner_user_id JOIN folders f ON f.id=r.folder_id AND f.user_id=r.owner_user_id WHERE r.slug=$1 AND r.revoked_at IS NULL AND r.expires_at>NOW() AND f.is_trashed=false",
      [req.params.slug],
    );
    const r = found.rows[0];
    if (
      !r ||
      !crypto.timingSafeEqual(Buffer.from(hash(key)), Buffer.from(r.key_hash))
    )
      return sendApiError(
        res,
        404,
        "not_found",
        "This file request has expired or is unavailable.",
      );
    let unlocked = false;
    try {
      const token = String(req.headers["x-axya-request-session"] || "");
      if (token) {
        const claims = jwt.verify(token, process.env.JWT_SECRET!) as any;
        unlocked =
          claims.purpose === "file-request" &&
          claims.requestId === r.id &&
          claims.keyHash === r.key_hash;
      }
    } catch {}
    if (r.password_hash && !unlocked) {
      const password = String(req.headers["x-axya-request-password"] || "");
      if (
        password.length > 128 ||
        !(await bcrypt.compare(password, r.password_hash))
      )
        return sendApiError(
          res,
          401,
          "password_required",
          "Enter the file-request password.",
        );
    }
    (req as any).fileRequest = r;
    if (req.path.endsWith("/info"))
      (req as any).requestAccessSession = jwt.sign(
        { purpose: "file-request", requestId: r.id, keyHash: r.key_hash },
        process.env.JWT_SECRET!,
        { expiresIn: "1h" },
      );
    req.user = {
      id: r.owner_user_id,
      phone: r.phone,
      sessionString: decryptSession(r.session_string),
    };
    res.setHeader("Cache-Control", "no-store");
    next();
  },
);
router.get(
  "/:slug/info",
  initLimits,
  grant,
  asyncRoute(async (req: any, res: express.Response) => {
    const r = req.fileRequest;
    const totals = await pool.query(
      "SELECT COUNT(*)::int AS count,COALESCE(SUM(bytes),0)::text AS bytes FROM file_request_uploads WHERE request_id=$1",
      [r.id],
    );
    res.json({
      success: true,
      accessSession: (req as any).requestAccessSession,
      title: r.title,
      expiresAt: r.expires_at,
      maxFileBytes: Math.min(Number(r.max_bytes), 100 * 1024 ** 2),
      remainingBytes: Math.max(
        0,
        Number(r.max_bytes) - Number(totals.rows[0].bytes),
      ),
      remainingFiles: Math.max(0, r.max_files - totals.rows[0].count),
    });
  }),
);

router.post(
  "/:slug/init",
  initLimits,
  grant,
  asyncRoute(async (req: any, res: express.Response) => {
    const r = req.fileRequest;
    const p = z
      .object({
        originalname: z.string().min(1).max(255),
        size: z
          .number()
          .int()
          .positive()
          .max(100 * 1024 ** 2),
        mimetype: z.string().max(150),
        client_upload_key: z.string().min(8).max(120),
      })
      .safeParse(req.body);
    if (!p.success || !isAllowedUploadMime(p.success ? p.data.mimetype : ""))
      return sendApiError(
        res,
        400,
        "invalid_request",
        "Choose a supported file up to 100 MB.",
      );
    const clientKey = hash(`${r.id}:${p.data.client_upload_key}`);
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const active = await db.query(
        "SELECT * FROM file_requests WHERE id=$1 AND revoked_at IS NULL AND expires_at>NOW() FOR UPDATE",
        [r.id],
      );
      if (!active.rowCount) {
        await db.query("ROLLBACK");
        return sendApiError(res, 404, "not_found", "File request unavailable.");
      }
      const existing = await db.query(
        "SELECT * FROM file_request_uploads WHERE request_id=$1 AND client_key=$2",
        [r.id, clientKey],
      );
      if (existing.rowCount) {
        if (
          Number(existing.rows[0].bytes) !== p.data.size ||
          existing.rows[0].name !== p.data.originalname
        ) {
          await db.query("ROLLBACK");
          return sendApiError(
            res,
            409,
            "conflict",
            "Upload identity does not match the selected file.",
          );
        }
      } else {
        const totals = await db.query(
          "SELECT count(*)::int AS n,COALESCE(sum(bytes),0)::text AS bytes FROM file_request_uploads WHERE request_id=$1",
          [r.id],
        );
        if (
          totals.rows[0].n >= active.rows[0].max_files ||
          Number(totals.rows[0].bytes) + p.data.size >
            Number(active.rows[0].max_bytes)
        ) {
          await db.query("ROLLBACK");
          return sendApiError(
            res,
            413,
            "request_full",
            "This request has reached its upload limit.",
          );
        }
        await db.query(
          "INSERT INTO file_request_uploads(request_id,client_key,name,bytes) VALUES($1,$2,$3,$4)",
          [r.id, clientKey, p.data.originalname, p.data.size],
        );
      }
      await db.query("COMMIT");
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
    req.body = {
      ...p.data,
      client_upload_key: clientKey,
      folder_id: r.folder_id,
      telegram_chat_id: "me",
      chunk_size_bytes: 1024 ** 2,
    };
    const original = res.json.bind(res);
    res.json = ((payload: any) => {
      res.json = original;
      void (async () => {
        if (payload.success && payload.uploadId)
          await pool.query(
            "UPDATE file_request_uploads SET upload_id=$1 WHERE request_id=$2 AND client_key=$3",
            [payload.uploadId, r.id, clientKey],
          );
        else
          await pool.query(
            "DELETE FROM file_request_uploads WHERE request_id=$1 AND client_key=$2 AND upload_id IS NULL",
            [r.id, clientKey],
          );
        original(publicPayload(payload));
      })().catch(() =>
        sendApiError(
          res,
          503,
          "request_storage_unavailable",
          "Could not persist this upload. Retry with the same selected file.",
        ),
      );
      return res;
    }) as any;
    try {
      await initUpload(req, res);
    } catch (e) {
      res.json = original;
      await pool.query(
        "DELETE FROM file_request_uploads WHERE request_id=$1 AND client_key=$2 AND upload_id IS NULL",
        [r.id, clientKey],
      );
      throw e;
    }
  }),
);
function publicPayload(p: any) {
  const allowed = [
    "success",
    "uploadId",
    "status",
    "progress",
    "error",
    "message",
    "code",
    "retryable",
    "retry_after_seconds",
    "receivedBytes",
    "totalBytes",
    "uploadedChunks",
    "totalChunks",
    "chunkSizeBytes",
    "backpressure",
    "retryAfterMs",
    "recommendedParallelChunks",
  ];
  return Object.fromEntries(
    allowed.filter((k) => p[k] !== undefined).map((k) => [k, p[k]]),
  );
}
const scoped = asyncRoute(
  async (req: any, res: express.Response, next: express.NextFunction) => {
    const id = req.params.uploadId || req.body.uploadId;
    if (!z.string().uuid().safeParse(id).success) {
      if (req.file?.path) await fs.promises.rm(req.file.path, { force: true });
      return sendApiError(res, 404, "not_found", "Upload not found.");
    }
    const owned = await pool.query(
      "SELECT u.upload_id FROM file_request_uploads u JOIN upload_sessions s ON s.upload_id=u.upload_id WHERE u.request_id=$1 AND u.upload_id=$2 AND s.user_id=$3",
      [req.fileRequest.id, id, req.user.id],
    );
    if (!owned.rowCount) {
      if (req.file?.path) await fs.promises.rm(req.file.path, { force: true });
      return sendApiError(
        res,
        404,
        "not_found",
        "Upload not found in this file request.",
      );
    }
    const original = res.json.bind(res);
    res.json = ((p: any) => original(publicPayload(p))) as any;
    next();
  },
);
const directory = path.join(UPLOAD_TMP_ROOT, "request_chunks");
fs.mkdirSync(directory, { recursive: true });
const chunks = multer({
  dest: directory,
  limits: { fileSize: 5 * 1024 ** 2, files: 1, fields: 3 },
});
router.post(
  "/:slug/heartbeat",
  limits,
  grant,
  scoped,
  asyncRoute(async (req: any, res: express.Response) => {
    await pool.query(
      "UPDATE upload_sessions SET client_seen_at=NOW() WHERE upload_id=$1 AND user_id=$2",
      [req.body.uploadId, req.user.id],
    );
    res.json({ success: true });
  }),
);
router.post(
  "/:slug/chunk",
  limits,
  grant,
  chunks.single("chunk"),
  scoped,
  asyncRoute(uploadChunk),
);
router.get(
  "/:slug/status/:uploadId",
  limits,
  grant,
  scoped,
  asyncRoute(checkUploadStatus),
);
router.post(
  "/:slug/complete",
  limits,
  grant,
  scoped,
  asyncRoute(completeUpload),
);
router.post("/:slug/pause", limits, grant, scoped, asyncRoute(pauseUpload));
router.post(
  "/:slug/resume",
  limits,
  grant,
  scoped,
  asyncRoute(resumePausedUpload),
);
router.post("/:slug/cancel", limits, grant, scoped, asyncRoute(cancelUpload));
export default router;
