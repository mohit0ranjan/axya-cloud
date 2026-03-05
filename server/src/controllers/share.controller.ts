import { Request, Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import pool from '../config/db';
import { getDynamicClient } from '../services/telegram.service';
import bcrypt from 'bcryptjs';
import archiver from 'archiver';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const SHARE_TMP_DIR = path.join(os.tmpdir(), 'axya_share_tmp');
const MAX_SHARE_FOLDER_DEPTH = 32;
const DEFAULT_VIEW_LIMIT = 200;
const MAX_VIEW_LIMIT = 500;

try {
    fs.mkdirSync(SHARE_TMP_DIR, { recursive: true });
} catch {
    // Non-fatal.
}

const parseIntSafe = (v: any, fallback: number): number => {
    const n = Number.parseInt(String(v ?? ''), 10);
    return Number.isFinite(n) ? n : fallback;
};

const safeUnlink = (p: string) => {
    try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
        // best effort
    }
};

const isShareCookieValid = (req: Request, token: string): boolean => {
    return req.cookies?.[`share_auth_${token}`] === 'true';
};

// ─────────────────────────────────────────────────────────────────────────────
// CREATE A PUBLIC SHARE LINK (File or Folder)
// ─────────────────────────────────────────────────────────────────────────────
export const createShareLink = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });

    let { file_id, folder_id, expires_in_hours, password, allow_download = true, view_only = false } = req.body;

    // Legacy fallback: allow file_id from route param
    if (!file_id && !folder_id && req.params.id) {
        file_id = req.params.id;
    }

    if (file_id && folder_id) {
        return res.status(400).json({ success: false, error: 'Must provide exactly one of file_id or folder_id, but not both' });
    }
    if (!file_id && !folder_id) {
        return res.status(400).json({ success: false, error: 'Must provide either file_id or folder_id' });
    }

    const db = await pool.connect();
    try {
        const expiresAt = expires_in_hours ? new Date(Date.now() + parseInt(expires_in_hours, 10) * 3600000) : null;
        const passwordHash = password ? await bcrypt.hash(password, 10) : null;

        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                await db.query('BEGIN');

                if (file_id) {
                    const fileCheck = await db.query('SELECT id FROM files WHERE id = $1 AND user_id = $2', [file_id, req.user.id]);
                    if (fileCheck.rows.length === 0) {
                        await db.query('ROLLBACK');
                        return res.status(404).json({ success: false, error: 'File not found' });
                    }
                } else if (folder_id) {
                    const folderCheck = await db.query('SELECT id FROM folders WHERE id = $1 AND user_id = $2', [folder_id, req.user.id]);
                    if (folderCheck.rows.length === 0) {
                        await db.query('ROLLBACK');
                        return res.status(404).json({ success: false, error: 'Folder not found' });
                    }
                }

                const tokenPrefix = file_id ? 'f_' : 'd_';
                const token = `${tokenPrefix}${crypto.randomBytes(16).toString('hex')}`;

                const result = file_id
                    ? await db.query(
                        `INSERT INTO shared_links (token, file_id, folder_id, created_by, expires_at, password_hash, allow_download, view_only)
                         VALUES ($1, $2, NULL, $3, $4, $5, $6, $7)
                         ON CONFLICT (created_by, file_id) WHERE file_id IS NOT NULL
                         DO UPDATE SET token = EXCLUDED.token,
                                       expires_at = EXCLUDED.expires_at,
                                       password_hash = EXCLUDED.password_hash,
                                       allow_download = EXCLUDED.allow_download,
                                       view_only = EXCLUDED.view_only,
                                       created_at = NOW()
                         RETURNING token, expires_at`,
                        [token, file_id, req.user.id, expiresAt, passwordHash, allow_download, view_only]
                    )
                    : await db.query(
                        `INSERT INTO shared_links (token, file_id, folder_id, created_by, expires_at, password_hash, allow_download, view_only)
                         VALUES ($1, NULL, $2, $3, $4, $5, $6, $7)
                         ON CONFLICT (created_by, folder_id) WHERE folder_id IS NOT NULL
                         DO UPDATE SET token = EXCLUDED.token,
                                       expires_at = EXCLUDED.expires_at,
                                       password_hash = EXCLUDED.password_hash,
                                       allow_download = EXCLUDED.allow_download,
                                       view_only = EXCLUDED.view_only,
                                       created_at = NOW()
                         RETURNING token, expires_at`,
                        [token, folder_id, req.user.id, expiresAt, passwordHash, allow_download, view_only]
                    );

                await db.query('COMMIT');
                return res.json({ success: true, token: result.rows[0].token, expires_at: result.rows[0].expires_at });
            } catch (e: any) {
                await db.query('ROLLBACK');
                const isTokenCollision = e?.code === '23505' && String(e?.constraint || '').includes('token');
                if (isTokenCollision && attempt < 2) continue;
                throw e;
            }
        }
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    } finally {
        db.release();
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// REVOKE SHARE LINK
// ─────────────────────────────────────────────────────────────────────────────
export const revokeShareLink = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { id } = req.params;
    try {
        await pool.query(
            `DELETE FROM shared_links
             WHERE (file_id = $1 OR folder_id = $1 OR token = $1) AND created_by = $2`,
            [id, req.user.id]
        );
        res.json({ success: true, message: 'Share link revoked.' });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// LIST USER'S SHARED LINKS
// ─────────────────────────────────────────────────────────────────────────────
export const getUserSharedLinks = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });

    try {
        const result = await pool.query(`
            SELECT sl.id, sl.token, sl.file_id, sl.folder_id, sl.created_at, sl.expires_at, sl.views, sl.download_count,
                   f.file_name, fo.name as folder_name
            FROM shared_links sl
            LEFT JOIN files f ON f.id = sl.file_id
            LEFT JOIN folders fo ON fo.id = sl.folder_id
            WHERE sl.created_by = $1
            ORDER BY sl.created_at DESC
        `, [req.user.id]);

        res.json({ success: true, links: result.rows });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATE PASSWORD
// ─────────────────────────────────────────────────────────────────────────────
export const validatePassword = async (req: Request, res: Response) => {
    const token = String(req.params.token);
    const { password } = req.body;

    try {
        const linkResult = await pool.query('SELECT id, password_hash FROM shared_links WHERE token = $1', [token]);
        if (linkResult.rows.length === 0) return res.status(404).json({ success: false, error: 'Share link not found.' });

        const link = linkResult.rows[0];
        if (!link.password_hash) return res.json({ success: true }); // No password requested

        const isValid = await bcrypt.compare(password, link.password_hash);
        if (!isValid) return res.status(401).json({ success: false, error: 'Incorrect password.' });

        // Set a cookie to remember auth for this token
        res.cookie(`share_auth_${token}`, 'true', {
            maxAge: 24 * 60 * 60 * 1000,
            httpOnly: true,
            path: `/share/${token}`,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
        });
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC SHARE WEB PAGE  (HTML preview — no auth required, cookie for password)
// ─────────────────────────────────────────────────────────────────────────────
export const shareWebPage = async (req: Request, res: Response) => {
    const token = String(req.params.token);
    const page = Math.max(1, parseIntSafe(req.query.page, 1));
    const limit = Math.min(MAX_VIEW_LIMIT, Math.max(1, parseIntSafe(req.query.limit, DEFAULT_VIEW_LIMIT)));
    const offset = (page - 1) * limit;

    try {
        // Increment view count (fire-and-forget)
        pool.query('UPDATE shared_links SET views = views + 1 WHERE token = $1', [token]).catch(() => { });

        const linkResult = await pool.query(
            `SELECT sl.*,
                    f.file_name, f.file_size, f.mime_type,
                    fo.name as folder_name
             FROM shared_links sl
             LEFT JOIN files f ON f.id = sl.file_id
             LEFT JOIN folders fo ON fo.id = sl.folder_id
             WHERE sl.token = $1`,
            [token]
        );

        if (linkResult.rows.length === 0) {
            return res.status(404).send(errorPage('Link Not Found', 'This share link does not exist or has been revoked.'));
        }

        const link = linkResult.rows[0];
        if (link.expires_at && new Date(link.expires_at) < new Date()) {
            return res.status(410).send(errorPage('Link Expired', 'This share link has expired.'));
        }

        // Check password protection via cookie
        if (link.password_hash && !isShareCookieValid(req, token)) {
            return res.send(`
            <!DOCTYPE html><html lang="en"><head><title>Password Required — Axya</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
            <style>
              *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
              body{font-family:'Inter',sans-serif;background:#0D0F1A;color:#E8EAF0;display:flex;flex-direction:column;align-items:center;padding-top:100px;}
              .card{background:#1A1E2E;border-radius:24px;padding:40px;width:90%;max-width:400px;text-align:center;}
              h1{font-size:20px;margin-bottom:12px;}
              p{color:#6B7A99;font-size:14px;margin-bottom:24px;}
              input{width:100%;background:#0D0F1A;border:1px solid #252A3E;border-radius:12px;padding:16px;color:#fff;font-size:16px;margin-bottom:16px;outline:none;}
              input:focus{border-color:#5B7FFF;}
              button{width:100%;background:linear-gradient(135deg, #5B7FFF, #4B6EF5);color:#fff;border:none;border-radius:12px;padding:16px;font-size:16px;font-weight:600;cursor:pointer;}
              .err{color:#FF5252;font-size:13px;margin-bottom:16px;display:none;}
            </style>
            </head><body>
              <div class="card">
                <h1>Password Protected</h1>
                <p>Please enter the password to view this shared link.</p>
                <div class="err" id="err">Incorrect password</div>
                <input type="password" id="pw" placeholder="Enter password" />
                <button onclick="submitPw()">Access Link</button>
              </div>
              <script>
                async function submitPw() {
                  const pw = document.getElementById('pw').value;
                  const res = await fetch('/share/${token}/password', {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    credentials: 'same-origin',
                    body: JSON.stringify({password: pw})
                  });
                  if (res.ok) window.location.reload();
                  else document.getElementById('err').style.display = 'block';
                }
              </script>
            </body></html>
            `);
        }

        const formatSize = (b: number) => {
            if (!b) return '0 B';
            const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(b) / Math.log(k));
            return (b / Math.pow(k, i)).toFixed(1) + ' ' + s[i];
        };

        let content = '';

        if (link.folder_id) {
            // RENDERING FOLDER VIEW — paginated, recursive CTE, no internal IDs exposed
            const filesRes = await pool.query(
                `WITH RECURSIVE folder_tree AS (
                    SELECT id, 0 AS depth
                    FROM folders
                    WHERE id = $1 AND user_id = $2 AND is_trashed = false
                    UNION ALL
                    SELECT f.id, ft.depth + 1
                    FROM folders f
                    INNER JOIN folder_tree ft ON f.parent_id = ft.id
                    WHERE f.user_id = $2 AND f.is_trashed = false AND ft.depth < $3
                ),
                all_files AS (
                    SELECT fi.file_name, fi.file_size, fi.mime_type, fi.created_at
                    FROM files fi
                    INNER JOIN folder_tree ft ON fi.folder_id = ft.id
                    WHERE fi.user_id = $2 AND fi.is_trashed = false
                )
                SELECT
                    (SELECT COUNT(*)::int FROM all_files) AS total_count,
                    file_name, file_size, mime_type
                FROM all_files
                ORDER BY created_at DESC
                LIMIT $4 OFFSET $5`,
                [link.folder_id, link.created_by, MAX_SHARE_FOLDER_DEPTH, limit, offset]
            );

            const rows = filesRes.rows;
            const totalCount = Number(rows[0]?.total_count || 0);

            const sizeRes = await pool.query(
                `WITH RECURSIVE folder_tree AS (
                    SELECT id, 0 AS depth
                    FROM folders
                    WHERE id = $1 AND user_id = $2 AND is_trashed = false
                    UNION ALL
                    SELECT f.id, ft.depth + 1
                    FROM folders f
                    INNER JOIN folder_tree ft ON f.parent_id = ft.id
                    WHERE f.user_id = $2 AND f.is_trashed = false AND ft.depth < $3
                )
                SELECT COALESCE(SUM(fi.file_size),0)::bigint AS total_size
                FROM files fi
                INNER JOIN folder_tree ft ON fi.folder_id = ft.id
                WHERE fi.user_id = $2 AND fi.is_trashed = false`,
                [link.folder_id, link.created_by, MAX_SHARE_FOLDER_DEPTH]
            );
            const totalSize = Number(sizeRes.rows[0]?.total_size || 0);

            let filesHtml = rows.map((f: any) => `
                <div class="file-item">
                    <div class="f-icon">${getTypeEmoji(f.mime_type)}</div>
                    <div class="f-meta">
                        <div class="f-name">${escHtml(f.file_name)}</div>
                        <div class="f-size">${formatSize(f.file_size)}</div>
                    </div>
                </div>
            `).join('');

            if (rows.length === 0) filesHtml = `<div class="no-preview" style="grid-column: 1 / -1;"><p>This folder is empty.</p></div>`;

            const totalPages = Math.max(1, Math.ceil(totalCount / limit));
            const pager = totalCount > limit
                ? `<div style="display:flex;gap:10px;justify-content:center;margin-top:20px;">
                    ${page > 1 ? `<a class="f-dl" href="/share/${token}?page=${page - 1}&limit=${limit}">Prev</a>` : ''}
                    <span style="font-size:12px;color:#6B7A99;align-self:center;">Page ${page}/${totalPages}</span>
                    ${page < totalPages ? `<a class="f-dl" href="/share/${token}?page=${page + 1}&limit=${limit}">Next</a>` : ''}
                  </div>`
                : '';

            content = `
                <div class="file-info">
                  <div class="file-icon" style="background:#5B7FFF20;color:#5B7FFF">📁</div>
                  <div class="file-meta">
                    <h1>${escHtml(link.folder_name)}</h1>
                    <div class="details">${totalCount} files &nbsp;·&nbsp; ${formatSize(totalSize)}</div>
                  </div>
                </div>
                <div class="folder-grid">${filesHtml}</div>
                ${link.allow_download && !link.view_only ? `<a href="/share/${token}/download-all" class="btn-download" download>⬇ Download All (ZIP)</a>` : ''}
                ${pager}
            `;
        } else {
            // RENDERING SINGLE FILE VIEW — preview uses /content, download uses /download
            const { file_name, file_size, mime_type } = link;
            const isImage = mime_type?.startsWith('image/');
            const isVideo = mime_type?.startsWith('video/');
            const isPdf = mime_type === 'application/pdf';

            const downloadUrl = `/share/${token}/download`;
            const contentUrl = `/share/${token}/content`; // Inline preview — bypasses view_only

            const preview = isImage
                ? `<img src="${contentUrl}" alt="${escHtml(file_name)}" class="preview-img" />`
                : isVideo
                    ? `<video controls class="preview-video"><source src="${contentUrl}" type="${mime_type}" />Your browser does not support video playback.</video>`
                    : isPdf
                        ? `<iframe src="${contentUrl}" class="preview-pdf" title="${escHtml(file_name)}"></iframe>`
                        : `<div class="no-preview"><span class="file-emoji">${getTypeEmoji(mime_type)}</span><p>No preview available</p></div>`;

            content = `
                <div class="file-info">
                  <div class="file-icon">${getTypeEmoji(mime_type)}</div>
                  <div class="file-meta">
                    <h1>${escHtml(file_name)}</h1>
                    <div class="details">${formatSize(file_size)} &nbsp;·&nbsp; ${mime_type || 'Unknown type'}</div>
                  </div>
                </div>
                ${preview}
                ${link.allow_download && !link.view_only ? `<a href="${downloadUrl}" class="btn-download" download="${escHtml(file_name)}">⬇ Download File</a>` : ''}
            `;
        }

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(link.folder_name || link.file_name)} — Axya Shared</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', sans-serif; background: #0D0F1A; color: #E8EAF0; min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 24px 16px 60px; }
    .logo { font-size: 20px; font-weight: 800; color: #5B7FFF; letter-spacing: -0.5px; margin-bottom: 32px; margin-top: 8px; }
    .logo span { color: #E8EAF0; }
    .card { background: #1A1E2E; border-radius: 24px; padding: 32px; max-width: 680px; width: 100%; box-shadow: 0 20px 60px rgba(0,0,0,0.4); }
    .file-info { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; }
    .file-icon { width: 56px; height: 56px; border-radius: 16px; background: #252A3E; display: flex; align-items: center; justify-content: center; font-size: 26px; flex-shrink: 0; }
    .file-meta h1 { font-size: 18px; font-weight: 700; word-break: break-all; margin-bottom: 4px; }
    .file-meta .details { font-size: 13px; color: #6B7A99; }
    .preview-img { width: 100%; border-radius: 16px; max-height: 480px; object-fit: contain; background: #0D0F1A; }
    .preview-video { width: 100%; border-radius: 16px; max-height: 420px; }
    .preview-pdf { width: 100%; height: 520px; border-radius: 12px; border: none; background: #fff; }
    .no-preview { text-align: center; padding: 60px 0; color: #6B7A99; }
    .file-emoji { font-size: 64px; display: block; margin-bottom: 12px; }
    .btn-download { display: block; background: linear-gradient(135deg, #5B7FFF, #4B6EF5); color: #fff; border-radius: 16px; padding: 18px 24px; text-align: center; text-decoration: none; font-size: 17px; font-weight: 700; margin-top: 24px; transition: opacity 0.2s; }
    .btn-download:hover { opacity: 0.85; }
    .footer { margin-top: 32px; font-size: 12px; color: #4F5B76; text-align: center; }
    .footer a { color: #5B7FFF; text-decoration: none; }
    .folder-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; margin-top: 20px;}
    .file-item { background: #0D0F1A; border: 1px solid #252A3E; border-radius: 16px; padding: 16px; display: flex; align-items: center; gap: 12px;}
    .f-icon { font-size: 24px; }
    .f-meta { overflow: hidden; }
    .f-name { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .f-size { font-size: 12px; color: #6B7A99; margin-top: 4px; }
    .f-dl { margin-left: auto; background: #252A3E; color: #E8EAF0; padding: 8px 12px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 700; transition: background 0.2s; }
    .f-dl:hover { background: #5B7FFF; }
  </style>
</head>
<body>
  <div class="logo">Axya <span>Cloud</span></div>
  <div class="card">
    ${content}
  </div>

  <div class="footer">
    Powered by <a href="https://axya.cloud">Axya</a> — Telegram-based secure cloud drive.<br/>
    ${link.expires_at ? `Link expires ${new Date(link.expires_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}` : 'Link has no expiry'}
  </div>
</body>
</html>`);
    } catch (err: any) {
        res.status(500).send(errorPage('Server Error', err.message));
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC FILE DOWNLOAD / INLINE CONTENT (no auth required via share token)
// Both /:token/download and /:token/content hit this handler.
// /content serves inline (bypasses view_only) for previews.
// /download enforces allow_download + view_only restrictions.
// ─────────────────────────────────────────────────────────────────────────────
export const downloadSharedFile = async (req: Request, res: Response) => {
    const token = String(req.params.token);
    const { file_id } = req.query;

    // /content route serves inline previews — allowed even in view_only mode
    const isContentRoute = req.path.endsWith('/content');

    try {
        const linkResult = await pool.query(
            `SELECT sl.*, u.session_string
             FROM shared_links sl
             JOIN users u ON u.id = sl.created_by
             WHERE sl.token = $1`,
            [token]
        );

        if (linkResult.rows.length === 0) return res.status(404).json({ success: false, error: 'Share link not found.' });

        const link = linkResult.rows[0];
        if (link.expires_at && new Date(link.expires_at) < new Date()) {
            return res.status(410).json({ success: false, error: 'This share link has expired.' });
        }

        // For actual /download requests, enforce download restrictions
        if (!isContentRoute) {
            if (!link.allow_download) {
                return res.status(403).json({ success: false, error: 'Downloads are disabled for this link.' });
            }
            if (link.view_only) {
                return res.status(403).json({ success: false, error: 'View only mode is enabled.' });
            }
        }

        if (link.password_hash && !isShareCookieValid(req, token)) {
            return res.status(401).json({ success: false, error: 'Password authentication required.' });
        }

        // Determine which file to serve
        let targetFileId = link.file_id;
        if (link.folder_id && file_id) {
            const fileCheck = await pool.query(
                `WITH RECURSIVE folder_tree AS (
                    SELECT id, 0 AS depth
                    FROM folders
                    WHERE id = $1 AND user_id = $3 AND is_trashed = false
                    UNION ALL
                    SELECT f.id, ft.depth + 1
                    FROM folders f
                    INNER JOIN folder_tree ft ON f.parent_id = ft.id
                    WHERE f.user_id = $3 AND f.is_trashed = false AND ft.depth < $4
                )
                SELECT id
                FROM files
                WHERE folder_id IN (SELECT id FROM folder_tree) AND id = $2 AND user_id = $3 AND is_trashed = false`,
                [link.folder_id, file_id, link.created_by, MAX_SHARE_FOLDER_DEPTH]
            );
            if (fileCheck.rows.length === 0) {
                return res.status(403).json({ success: false, error: 'File is not within this shared folder.' });
            }
            targetFileId = file_id;
        } else if (link.folder_id && !file_id) {
            return res.status(400).json({ success: false, error: 'File ID is required when downloading from a shared folder.' });
        }

        const fileData = await pool.query(
            'SELECT file_name, mime_type, telegram_message_id, telegram_chat_id FROM files WHERE id = $1 AND is_trashed = false',
            [targetFileId]
        );
        if (fileData.rows.length === 0) return res.status(404).json({ success: false, error: 'File no longer available.' });
        const file = fileData.rows[0];

        // Only increment download stats for actual download requests, not inline previews
        if (!isContentRoute) {
            await pool.query(`UPDATE shared_links SET download_count = download_count + 1 WHERE token = $1`, [token]);
        }

        const client = await getDynamicClient(link.session_string);
        const messages = await client.getMessages(file.telegram_chat_id, { ids: parseInt(file.telegram_message_id, 10) });
        if (!messages || messages.length === 0) return res.status(404).json({ success: false, error: 'File no longer available on Telegram.' });

        const tmpPath = path.join(SHARE_TMP_DIR, `${token}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}.bin`);
        const downloadResult = await client.downloadMedia(messages[0] as any, { outputFile: tmpPath } as any);
        const diskPath = typeof downloadResult === 'string' ? downloadResult : tmpPath;
        if (!fs.existsSync(diskPath)) return res.status(500).json({ success: false, error: 'Failed to stream file.' });

        const stat = fs.statSync(diskPath);
        res.set('Content-Type', file.mime_type || 'application/octet-stream');
        const disposition = isContentRoute ? 'inline' : 'attachment';
        res.set('Content-Disposition', `${disposition}; filename="${encodeURIComponent(file.file_name)}"`);
        res.set('Content-Length', stat.size.toString());

        const stream = fs.createReadStream(diskPath);
        stream.on('close', () => safeUnlink(diskPath));
        stream.on('error', () => safeUnlink(diskPath));
        res.on('close', () => safeUnlink(diskPath));
        stream.pipe(res);
    } catch (err: any) {
        if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC FOLDER DOWNLOAD (ZIP) — recursive with depth limit
// ─────────────────────────────────────────────────────────────────────────────
export const downloadAllShared = async (req: Request, res: Response) => {
    const token = String(req.params.token);
    try {
        const linkResult = await pool.query(
            `SELECT sl.*, fo.name as folder_name, u.session_string
             FROM shared_links sl
             JOIN folders fo ON fo.id = sl.folder_id
             JOIN users u ON u.id = sl.created_by
             WHERE sl.token = $1`,
            [token]
        );

        if (linkResult.rows.length === 0) return res.status(404).json({ success: false, error: 'Folder share link not found.' });

        const link = linkResult.rows[0];
        if (link.expires_at && new Date(link.expires_at) < new Date()) {
            return res.status(410).json({ success: false, error: 'This share link has expired.' });
        }
        if (!link.allow_download) {
            return res.status(403).json({ success: false, error: 'Downloads are disabled for this link.' });
        }
        if (link.view_only) {
            return res.status(403).json({ success: false, error: 'View only mode is enabled.' });
        }
        if (link.password_hash && !isShareCookieValid(req, token)) {
            return res.status(401).json({ success: false, error: 'Password authentication required.' });
        }

        const filesRes = await pool.query(
            `WITH RECURSIVE folder_tree AS (
                SELECT id, 0 AS depth, ''::text as path
                FROM folders
                WHERE id = $1 AND user_id = $2 AND is_trashed = false
                UNION ALL
                SELECT f.id, ft.depth + 1, CASE WHEN ft.path = '' THEN f.name ELSE ft.path || '/' || f.name END as path
                FROM folders f
                INNER JOIN folder_tree ft ON f.parent_id = ft.id
                WHERE f.user_id = $2 AND f.is_trashed = false AND ft.depth < $3
            )
            SELECT fi.file_name, fi.telegram_message_id, fi.telegram_chat_id, ft.path
            FROM files fi
            INNER JOIN folder_tree ft ON fi.folder_id = ft.id
            WHERE fi.user_id = $2 AND fi.is_trashed = false`,
            [link.folder_id, link.created_by, MAX_SHARE_FOLDER_DEPTH]
        );

        const files = filesRes.rows;
        if (files.length === 0) return res.status(404).json({ success: false, error: 'Folder is empty.' });

        await pool.query(`UPDATE shared_links SET download_count = download_count + 1 WHERE token = $1`, [token]);

        const client = await getDynamicClient(link.session_string);

        res.set('Content-Type', 'application/zip');
        res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(link.folder_name)}.zip"`);

        const archive = archiver('zip', { zlib: { level: 5 } });
        archive.on('error', (err) => {
            if (!res.headersSent) res.status(500).send({ error: err.message });
        });
        archive.pipe(res);

        // Download files dynamically and stream into archiver
        for (const file of files) {
            let tmpPath = '';
            try {
                const msgs = await client.getMessages(file.telegram_chat_id, { ids: parseInt(file.telegram_message_id, 10) });
                if (msgs && msgs.length > 0) {
                    tmpPath = path.join(SHARE_TMP_DIR, `zip_${Date.now()}_${crypto.randomBytes(6).toString('hex')}.bin`);
                    const result = await client.downloadMedia(msgs[0] as any, { outputFile: tmpPath } as any);
                    const diskPath = typeof result === 'string' ? result : tmpPath;
                    if (fs.existsSync(diskPath)) {
                        const zipPath = file.path ? `${file.path}/${file.file_name}` : file.file_name;
                        archive.append(fs.createReadStream(diskPath), { name: zipPath });
                        archive.on('entry', () => safeUnlink(diskPath));
                        tmpPath = ''; // ownership transferred
                    }
                }
            } catch (err: any) {
                console.warn(`Failed to include file ${file.file_name} in ZIP:`, err.message);
            } finally {
                if (tmpPath) safeUnlink(tmpPath);
            }
        }

        await archive.finalize();

    } catch (err: any) {
        if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function getTypeEmoji(mime: string) {
    if (!mime) return '📄';
    if (mime.startsWith('image/')) return '🖼️';
    if (mime.startsWith('video/')) return '🎬';
    if (mime.startsWith('audio/')) return '🎵';
    if (mime === 'application/pdf') return '📑';
    if (mime.includes('zip') || mime.includes('compress')) return '📦';
    if (mime.includes('word') || mime.includes('document')) return '📝';
    if (mime.includes('sheet') || mime.includes('excel')) return '📊';
    return '📄';
}

function escHtml(str: string) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function errorPage(title: string, message: string) {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title} — Axya</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@600;800&display=swap" rel="stylesheet">
    <style>body{font-family:Inter,sans-serif;background:#0D0F1A;color:#E8EAF0;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:24px;text-align:center;}
    h1{font-size:24px;font-weight:800;color:#FF5252;margin-bottom:12px;}p{color:#6B7A99;font-size:15px;}</style>
    </head><body><h1>${title}</h1><p>${message}</p></body></html>`;
}
