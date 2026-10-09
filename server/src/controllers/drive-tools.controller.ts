import { Response } from "express";
import { AuthRequest } from "../middlewares/auth.middleware";
import pool from "../config/db";
import { formatFileRow } from "../utils/formatters";
import { sendApiError } from "../utils/apiError";
import { cacheDelByPrefix } from "../services/cache.service";
import { z } from "zod";

const uuid = z.string().uuid();
const pointerColumns = [
  "file_size",
  "mime_type",
  "telegram_file_id",
  "telegram_message_id",
  "telegram_chat_id",
  "sha256_hash",
  "md5_hash",
  "partial_sha256",
  "tg_media_meta",
  "tg_duration_sec",
  "tg_width",
  "tg_height",
  "tg_caption",
  "tg_source_tag",
  "blurhash",
];
const invalidate = (user: string) => {
  cacheDelByPrefix(`user:${user}:`);
};

export async function advancedSearch(req: AuthRequest, res: Response) {
  const params = z
    .object({
      q: z.string().max(200).default(""),
      type: z
        .enum(["all", "image", "video", "audio", "document"])
        .default("all"),
      tag: z.string().max(64).optional(),
      mime: z.string().max(150).optional(),
      minBytes: z.coerce.number().int().min(0).optional(),
      maxBytes: z.coerce.number().int().min(0).optional(),
      after: z.string().datetime().optional(),
      before: z.string().datetime().optional(),
      page: z.coerce.number().int().min(0).max(10000).default(0),
    })
    .safeParse(req.query);
  if (!params.success)
    return sendApiError(
      res,
      400,
      "invalid_request",
      "Check the search filters.",
    );
  const p = params.data;
  const values: unknown[] = [req.user!.id];
  const clauses = ["f.user_id = $1", "f.is_trashed = false"];
  const add = (sql: string, value: unknown) => {
    values.push(value);
    clauses.push(sql.replace("?", `$${values.length}`));
  };
  if (p.q) add("f.file_name ILIKE ?", `%${p.q.replace(/[\\%_]/g, "\\$&")}%`);
  if (p.type !== "all") {
    if (p.type === "document")
      clauses.push("f.mime_type !~ '^(image|video|audio)/'");
    else add("f.mime_type LIKE ?", `${p.type}/%`);
  }
  if (p.tag)
    add(
      "EXISTS (SELECT 1 FROM file_tags t WHERE t.file_id = f.id AND t.user_id = f.user_id AND t.tag = ?)",
      p.tag.trim().toLowerCase(),
    );
  if (p.mime) add("f.mime_type = ?", p.mime);
  if (p.minBytes !== undefined) add("f.file_size >= ?", p.minBytes);
  if (p.maxBytes !== undefined) add("f.file_size <= ?", p.maxBytes);
  if (p.after) add("f.created_at >= ?", p.after);
  if (p.before) add("f.created_at <= ?", p.before);
  values.push(p.page * 50);
  const rows = await pool.query(
    `SELECT f.* FROM files f WHERE ${clauses.join(" AND ")} ORDER BY f.created_at DESC, f.id LIMIT 51 OFFSET $${values.length}`,
    values,
  );
  res.json({
    success: true,
    files: rows.rows.slice(0, 50).map(formatFileRow),
    hasMore: rows.rows.length > 50,
  });
}

export async function exportManifest(req: AuthRequest, res: Response) {
  const page = z.coerce
    .number()
    .int()
    .min(0)
    .max(100000)
    .safeParse(req.query.page || 0);
  if (!page.success)
    return sendApiError(res, 400, "invalid_request", "Invalid export page.");
  const [files, folders] = await Promise.all([
    pool.query(
      "SELECT id,folder_id,file_name,file_size,mime_type,sha256_hash,is_starred,is_trashed,created_at,updated_at FROM files WHERE user_id = $1 ORDER BY id LIMIT 1001 OFFSET $2",
      [req.user!.id, page.data * 1000],
    ),
    pool.query(
      "SELECT id,name,parent_id,is_trashed,created_at FROM folders WHERE user_id = $1 ORDER BY id LIMIT 1001 OFFSET $2",
      [req.user!.id, page.data * 1000],
    ),
  ]);
  res.setHeader("Cache-Control", "no-store");
  res.json({
    success: true,
    format: "axya-manifest-v1",
    page: page.data,
    exportedAt: new Date().toISOString(),
    files: files.rows.slice(0, 1000),
    folders: folders.rows.slice(0, 1000),
    hasMore: files.rows.length > 1000 || folders.rows.length > 1000,
  });
}

export async function bulkRename(req: AuthRequest, res: Response) {
  const parsed = z
    .object({
      changes: z
        .array(
          z.object({
            id: uuid,
            name: z
              .string()
              .trim()
              .min(1)
              .max(255)
              .refine((n) => !/[\x00-\x1f/\\]/.test(n)),
            expectedName: z.string().max(255).optional(),
          }),
        )
        .min(1)
        .max(100),
    })
    .safeParse(req.body);
  if (
    !parsed.success ||
    new Set(parsed.success ? parsed.data.changes.map((c) => c.id) : []).size !==
      (parsed.success ? parsed.data.changes.length : 0)
  )
    return sendApiError(
      res,
      400,
      "invalid_request",
      "Provide up to 100 different files and valid names.",
    );
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const changes = parsed.data.changes;
    const owned = await db.query(
      "SELECT id,file_name FROM files WHERE user_id=$1 AND is_trashed=false AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE",
      [req.user!.id, changes.map((c) => c.id)],
    );
    if (owned.rows.length !== changes.length) {
      await db.query("ROLLBACK");
      return sendApiError(
        res,
        404,
        "not_found",
        "One or more files are unavailable. No files were renamed.",
      );
    }
    const undo = owned.rows.map((row) => ({
      id: row.id,
      name: row.file_name,
      expectedName: changes.find((c) => c.id === row.id)!.name,
    }));
    for (const c of changes) {
      if (
        c.expectedName !== undefined &&
        owned.rows.find((r) => r.id === c.id).file_name !== c.expectedName
      ) {
        await db.query("ROLLBACK");
        return sendApiError(
          res,
          409,
          "conflict",
          "A file was renamed elsewhere. Refresh before applying changes.",
        );
      }
      await db.query(
        "UPDATE files SET file_name=$1,updated_at=NOW() WHERE id=$2 AND user_id=$3",
        [c.name, c.id, req.user!.id],
      );
    }
    await db.query("COMMIT");
    invalidate(req.user!.id);
    res.json({ success: true, undo });
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}

export async function listVersions(req: AuthRequest, res: Response) {
  if (!uuid.safeParse(req.params.id).success)
    return sendApiError(res, 400, "invalid_request", "Invalid file.");
  const owned = await pool.query(
    "SELECT id FROM files WHERE id=$1 AND user_id=$2",
    [req.params.id, req.user!.id],
  );
  if (!owned.rowCount)
    return sendApiError(res, 404, "not_found", "File not found.");
  const rows = await pool.query(
    "SELECT id,created_at,snapshot->>'file_name' AS name,snapshot->>'file_size' AS size,snapshot->>'mime_type' AS mime_type FROM file_versions WHERE file_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 100",
    [req.params.id, req.user!.id],
  );
  res.json({ success: true, versions: rows.rows });
}

// Stable file identity and folder; snapshots keep old Telegram bytes referenced.
export async function changeVersion(req: AuthRequest, res: Response) {
  const p = z
    .object({ sourceFileId: uuid.optional(), versionId: uuid.optional() })
    .refine((v) => Boolean(v.sourceFileId) !== Boolean(v.versionId))
    .safeParse(req.body);
  if (
    !p.success ||
    !uuid.safeParse(req.params.id).success ||
    p.data.sourceFileId === req.params.id
  )
    return sendApiError(
      res,
      400,
      "invalid_request",
      "Choose another file or an earlier version.",
    );
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const locked = await db.query(
      "SELECT * FROM files WHERE user_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE",
      [req.user!.id, [req.params.id, p.data.sourceFileId].filter(Boolean)],
    );
    const current = locked.rows.find((r) => r.id === req.params.id);
    let source: any, manifest: any;
    if (!current || current.is_trashed) {
      await db.query("ROLLBACK");
      return sendApiError(res, 404, "not_found", "File not found.");
    }
    if (p.data.sourceFileId) {
      source = locked.rows.find((r) => r.id === p.data.sourceFileId);
      if (source)
        manifest = (
          await db.query(
            "SELECT * FROM file_segment_manifests WHERE file_id=$1 AND user_id=$2",
            [source.id, req.user!.id],
          )
        ).rows[0];
    } else {
      const v = await db.query(
        "SELECT snapshot,manifest FROM file_versions WHERE id=$1 AND file_id=$2 AND user_id=$3",
        [p.data.versionId, current.id, req.user!.id],
      );
      source = v.rows[0]?.snapshot;
      manifest = v.rows[0]?.manifest;
    }
    if (!source || source.is_trashed) {
      await db.query("ROLLBACK");
      return sendApiError(
        res,
        404,
        "not_found",
        "Version source is unavailable.",
      );
    }
    if (source.mime_type !== current.mime_type) {
      await db.query("ROLLBACK");
      return sendApiError(res, 400, "invalid_request", "Choose a file of the same type to preserve its name and preview.");
    }
    const previousManifest =
      (
        await db.query(
          "SELECT * FROM file_segment_manifests WHERE file_id=$1 AND user_id=$2",
          [current.id, req.user!.id],
        )
      ).rows[0] || null;
    await db.query(
      "INSERT INTO file_versions(file_id,user_id,snapshot,manifest) VALUES($1,$2,$3,$4)",
      [current.id, req.user!.id, current, previousManifest],
    );
    await db.query(
      `UPDATE files SET ${pointerColumns.map((c, i) => `${c}=$${i + 1}`).join(",")},updated_at=NOW() WHERE id=$${pointerColumns.length + 1} AND user_id=$${pointerColumns.length + 2}`,
      [
        ...pointerColumns.map((c) => source[c] ?? null),
        current.id,
        req.user!.id,
      ],
    );
    await db.query(
      "DELETE FROM file_segment_manifests WHERE file_id=$1 AND user_id=$2",
      [current.id, req.user!.id],
    );
    if (manifest)
      await db.query(
        "INSERT INTO file_segment_manifests(user_id,file_id,mode,chunk_size_bytes,segment_count,status,telegram_chat_id,segments,last_error) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          req.user!.id,
          current.id,
          manifest.mode,
          manifest.chunk_size_bytes,
          manifest.segment_count,
          manifest.status,
          manifest.telegram_chat_id,
          JSON.stringify(manifest.segments),
          manifest.last_error,
        ],
      );
    await db.query(
      "DELETE FROM telegram_pointer_health WHERE file_id=$1 AND user_id=$2",
      [current.id, req.user!.id],
    );
    await db.query("COMMIT");
    invalidate(req.user!.id);
    res.json({ success: true });
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
