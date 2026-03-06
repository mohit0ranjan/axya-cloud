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
const DEFAULT_SHARE_EXPIRY_HOURS = 5 * 24; // Auto-expire after 5 days unless user sets another value.
const LEGACY_SHARE_PASSWORD_SCHEME = 'sha256';

const getSharePasswordPepper = (): string => {
    return process.env.SHARE_PASSWORD_PEPPER || process.env.COOKIE_SECRET || 'axya_share_password_pepper';
};

const hashLegacySharePassword = (password: string): string => {
    const digest = crypto
        .createHash('sha256')
        .update(`${getSharePasswordPepper()}|${password}`, 'utf8')
        .digest('hex');
    return `${LEGACY_SHARE_PASSWORD_SCHEME}:${digest}`;
};

const hashSharePassword = async (password: string): Promise<string> => {
    return bcrypt.hash(password, 12);
};

const verifySharePasswordHash = async (password: string, storedHash: string): Promise<boolean> => {
    if (!storedHash) return false;

    // Current scheme: bcrypt
    if (/^\$2[aby]\$\d{2}\$/.test(storedHash)) {
        try {
            return await bcrypt.compare(password, storedHash);
        } catch {
            return false;
        }
    }

    // Legacy fallback: sha256:<hex>
    if (storedHash.startsWith(`${LEGACY_SHARE_PASSWORD_SCHEME}:`)) {
        const expected = hashLegacySharePassword(password);
        const a = Buffer.from(storedHash, 'utf8');
        const b = Buffer.from(expected, 'utf8');
        if (a.length !== b.length) return false;
        return crypto.timingSafeEqual(a, b);
    }

    return false;
};

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

const isShareExpired = (expiresAt: string | Date | null): boolean => {
    if (!expiresAt) return false;
    return new Date(expiresAt).getTime() < Date.now();
};

const getShareByToken = async (token: string) => {
    const linkResult = await pool.query(
        `SELECT sl.id, sl.token, sl.file_id, sl.folder_id, sl.created_by, sl.expires_at, sl.password_hash, sl.allow_download, sl.view_only,
                f.file_name, f.file_size, f.mime_type,
                fo.name AS folder_name
         FROM shared_links sl
         LEFT JOIN files f ON f.id = sl.file_id
         LEFT JOIN folders fo ON fo.id = sl.folder_id
         WHERE sl.token = $1`,
        [token]
    );
    return linkResult.rows[0] || null;
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// CREATE A PUBLIC SHARE LINK (File or Folder)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const createShareLink = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });

    let { file_id, folder_id, expires_in_hours, allow_download = true, view_only = false } = req.body;
    const rawPassword = req.body?.password ?? req.body?.pin ?? '';
    const normalizedPassword = String(rawPassword);

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
        const parsedExpiryHours = parseIntSafe(expires_in_hours, DEFAULT_SHARE_EXPIRY_HOURS);
        if (parsedExpiryHours <= 0) {
            return res.status(400).json({ success: false, error: 'Expiry hours must be greater than 0.' });
        }
        const expiresAt = new Date(Date.now() + parsedExpiryHours * 3600000);
        const passwordHash = normalizedPassword.length > 0 ? await hashSharePassword(normalizedPassword) : null;

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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// REVOKE SHARE LINK
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// LIST USER'S SHARED LINKS
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// VALIDATE PASSWORD
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const validatePassword = async (req: Request, res: Response) => {
    const token = String(req.params.token);
    const rawPassword = req.body?.password ?? req.body?.pin ?? '';
    const password = String(rawPassword);

    try {
        const link = await getShareByToken(token);
        if (!link) return res.status(404).json({ success: false, error: 'Share link not found.' });
        if (isShareExpired(link.expires_at)) {
            return res.status(410).json({ success: false, error: 'This share link has expired.' });
        }
        if (!link.password_hash) return res.json({ success: true }); // No password requested
        if (!password) return res.status(400).json({ success: false, error: 'Password is required.' });

        const passwordHash = String(link.password_hash || '');
        const isValid = await verifySharePasswordHash(password, passwordHash);
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

export const verifyShareAccess = async (req: Request, res: Response) => {
    const token = String(req.body?.share_id || req.body?.shareId || req.params?.token || '');
    const rawPassword = req.body?.password ?? req.body?.pin ?? '';
    const password = String(rawPassword);

    if (!token) return res.status(400).json({ success: false, error: 'share_id is required.' });

    try {
        const link = await getShareByToken(token);
        if (!link) return res.status(404).json({ success: false, error: 'Share not found.' });
        if (isShareExpired(link.expires_at)) {
            return res.status(410).json({ success: false, error: 'Link expired.' });
        }

        if (!link.password_hash) {
            return res.json({ success: true, requires_password: false });
        }
        if (!password) return res.status(400).json({ success: false, error: 'Password is required.' });

        const isValid = await verifySharePasswordHash(password, String(link.password_hash || ''));
        if (!isValid) return res.status(401).json({ success: false, error: 'Incorrect password.' });

        res.cookie(`share_auth_${token}`, 'true', {
            maxAge: 24 * 60 * 60 * 1000,
            httpOnly: true,
            path: `/share/${token}`,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
        });

        return res.json({ success: true, share_id: token, requires_password: true });
    } catch {
        return res.status(500).json({ success: false, error: 'Server error.' });
    }
};

export const getSharePublicMeta = async (req: Request, res: Response) => {
    const token = String(req.params.shareId || req.params.token || '');
    try {
        const link = await getShareByToken(token);
        if (!link) return res.status(404).json({ success: false, error: 'Share not found.' });
        if (isShareExpired(link.expires_at)) return res.status(410).json({ success: false, error: 'Link expired.' });

        const requiresPassword = Boolean(link.password_hash);
        const hasAccess = !requiresPassword || isShareCookieValid(req, token);
        return res.json({
            success: true,
            share: {
                id: token,
                folder_id: link.folder_id,
                file_id: link.file_id,
                folder_name: link.folder_name || null,
                file_name: link.file_name || null,
                allow_download: Boolean(link.allow_download),
                view_only: Boolean(link.view_only),
                expires_at: link.expires_at,
                requires_password: requiresPassword,
                has_access: hasAccess,
            },
        });
    } catch {
        return res.status(500).json({ success: false, error: 'Server error.' });
    }
};

export const getSharePublicFiles = async (req: Request, res: Response) => {
    const token = String(req.params.shareId || req.params.token || '');
    const page = Math.max(1, parseIntSafe(req.query.page, 1));
    const limit = Math.min(MAX_VIEW_LIMIT, Math.max(1, parseIntSafe(req.query.limit, DEFAULT_VIEW_LIMIT)));
    const offset = (page - 1) * limit;

    try {
        const link = await getShareByToken(token);
        if (!link) return res.status(404).json({ success: false, error: 'Share not found.' });
        if (isShareExpired(link.expires_at)) return res.status(410).json({ success: false, error: 'Link expired.' });
        if (link.password_hash && !isShareCookieValid(req, token)) {
            return res.status(401).json({ success: false, error: 'Password validation required.' });
        }

        if (link.file_id) {
            return res.json({
                success: true,
                share: { id: token, file_id: link.file_id, folder_id: null, name: link.file_name || null },
                files: [{
                    id: link.file_id,
                    file_name: link.file_name,
                    file_size: Number(link.file_size || 0),
                    mime_type: link.mime_type || null,
                    download_url: `/share/${token}/download`,
                    content_url: `/share/${token}/content`,
                }],
                page,
                limit,
                total_count: 1,
            });
        }

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
                SELECT fi.id, fi.file_name, fi.file_size, fi.mime_type, fi.created_at
                FROM files fi
                INNER JOIN folder_tree ft ON fi.folder_id = ft.id
                WHERE fi.user_id = $2 AND fi.is_trashed = false
            )
            SELECT
                (SELECT COUNT(*)::int FROM all_files) AS total_count,
                id, file_name, file_size, mime_type
            FROM all_files
            ORDER BY created_at DESC
            LIMIT $4 OFFSET $5`,
            [link.folder_id, link.created_by, MAX_SHARE_FOLDER_DEPTH, limit, offset]
        );

        const rows = filesRes.rows || [];
        const totalCount = Number(rows[0]?.total_count || 0);
        return res.json({
            success: true,
            share: { id: token, file_id: null, folder_id: link.folder_id, name: link.folder_name || null },
            files: rows.map((row: any) => ({
                id: row.id,
                file_name: row.file_name,
                file_size: Number(row.file_size || 0),
                mime_type: row.mime_type || null,
                download_url: `/share/${token}/download?file_id=${encodeURIComponent(String(row.id))}`,
                content_url: `/share/${token}/content?file_id=${encodeURIComponent(String(row.id))}`,
            })),
            page,
            limit,
            total_count: totalCount,
        });
    } catch {
        return res.status(500).json({ success: false, error: 'Server error.' });
    }
};

export const sharePasswordGateScript = async (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.send(`(() => {
  const body = document.body;
  const token = body?.dataset?.shareToken || '';
  const passwordInput = document.getElementById('pw');
  const submitBtn = document.getElementById('submitBtn');
  const errEl = document.getElementById('err');
  const helperEl = document.getElementById('helper');

  if (!token || !passwordInput || !submitBtn || !errEl) return;

  const showMessage = (message) => {
    errEl.textContent = message;
    errEl.style.display = 'block';
    if (helperEl) helperEl.style.display = 'none';
  };

  const submitPw = async () => {
    const pw = passwordInput.value || '';
    if (!pw.trim()) {
      showMessage('Please enter the password.');
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Unlocking...';
    try {
      const response = await fetch('/share/' + encodeURIComponent(token) + '/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ password: pw }),
      });

      if (response.ok) {
        window.location.reload();
        return;
      }

      let payload = {};
      try { payload = await response.json(); } catch {}
      const apiError = typeof payload?.error === 'string' ? payload.error : '';

      if (response.status === 400) {
        showMessage(apiError || 'Password is required.');
      } else if (response.status === 401) {
        showMessage(apiError || 'Incorrect password. Please try again.');
      } else if (response.status === 404) {
        showMessage(apiError || 'Share link not found.');
      } else if (response.status === 410) {
        showMessage(apiError || 'This share link has expired.');
      } else if (response.status === 429) {
        showMessage(apiError || 'Too many attempts. Try again later.');
      } else {
        showMessage(apiError || 'Server error. Please try again.');
      }
    } catch {
      showMessage('Network error. Please try again.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Unlock Folder';
    }
  };

  submitBtn.addEventListener('click', submitPw);
  passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitPw();
  });
})();`);
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// PUBLIC SHARE WEB PAGE  (HTML preview â€” no auth required, cookie for password)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
            <!DOCTYPE html><html lang="en"><head><title>Unlock Shared Folder - AYXA</title>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link rel="preconnect" href="https://fonts.googleapis.com">
            <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
            <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
            <style>
              :root{--bg-a:#02050d;--bg-b:#071325;--bg-c:#0e2445;--card:rgba(255,255,255,0.08);--line:rgba(255,255,255,0.16);--text:#ffffff;--muted:rgba(219,232,255,0.78);}
              *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
              body{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;color:var(--text);font-family:'Plus Jakarta Sans',sans-serif;background:radial-gradient(1200px 500px at 90% -10%, rgba(109,167,255,0.20), transparent 60%),radial-gradient(900px 500px at -10% 110%, rgba(59,130,246,0.18), transparent 60%),linear-gradient(140deg, var(--bg-a), var(--bg-b) 45%, var(--bg-c));}
              .card{width:min(480px,100%);border:1px solid var(--line);background:var(--card);backdrop-filter:blur(20px);border-radius:24px;padding:34px 28px 28px;box-shadow:0 30px 70px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.1);}
              .brand{font-size:30px;font-weight:800;letter-spacing:0.18em;text-align:center;margin-bottom:8px;}
              .folder{font-size:16px;text-align:center;color:var(--muted);margin-bottom:18px;word-break:break-word;}
              .headline{text-align:center;font-size:15px;color:var(--muted);margin-bottom:20px;}
              .field{width:100%;height:50px;border-radius:14px;border:1px solid var(--line);background:rgba(0,0,0,0.28);color:var(--text);padding:0 14px;font-size:15px;outline:none;}
              .field:focus{border-color:rgba(131,179,255,0.9);box-shadow:0 0 0 3px rgba(109,167,255,0.2);}
              .btn{margin-top:12px;width:100%;height:48px;border:none;border-radius:14px;font-size:15px;font-weight:700;color:#03122a;background:linear-gradient(135deg,#86b8ff,#5a95ff);box-shadow:0 14px 30px rgba(87,146,255,0.35);cursor:pointer;}
              .btn:disabled{opacity:0.75;cursor:not-allowed}
              .helper{margin-top:12px;font-size:13px;color:var(--muted);text-align:center;}
              .err{margin-top:12px;font-size:13px;color:#ffb0b0;text-align:center;display:none;}
            </style>
            </head><body data-share-token="${escHtml(token)}">
              <div class="card">
                <div class="brand">AYXA</div>
                <div class="folder">Shared Folder: ${escHtml(link.folder_name || link.file_name || 'Shared Space')}</div>
                <p class="headline">Enter password to access this shared space</p>
                <input class="field" type="password" id="pw" placeholder="Enter password" autocomplete="current-password" />
                <button class="btn" id="submitBtn">Unlock Folder</button>
                <p class="helper" id="helper">Your access is protected with end-to-end share controls.</p>
                <p class="err" id="err"></p>
              </div>
              <script src="/share/client/password-gate.js"></script>
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
            // RENDERING FOLDER VIEW â€” paginated, recursive CTE, no internal IDs exposed
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
                  <div class="file-icon" style="background:#5B7FFF20;color:#5B7FFF">ðŸ“</div>
                  <div class="file-meta">
                    <h1>${escHtml(link.folder_name)}</h1>
                    <div class="details">${totalCount} files &nbsp;Â·&nbsp; ${formatSize(totalSize)}</div>
                  </div>
                </div>
                <div class="folder-grid">${filesHtml}</div>
                ${link.allow_download && !link.view_only ? `<a href="/share/${token}/download-all" class="btn-download" download>â¬‡ Download All (ZIP)</a>` : ''}
                ${pager}
            `;
        } else {
            // RENDERING SINGLE FILE VIEW â€” preview uses /content, download uses /download
            const { file_name, file_size, mime_type } = link;
            const isImage = mime_type?.startsWith('image/');
            const isVideo = mime_type?.startsWith('video/');
            const isPdf = mime_type === 'application/pdf';

            const downloadUrl = `/share/${token}/download`;
            const contentUrl = `/share/${token}/content`; // Inline preview â€” bypasses view_only

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
                    <div class="details">${formatSize(file_size)} &nbsp;Â·&nbsp; ${mime_type || 'Unknown type'}</div>
                  </div>
                </div>
                ${preview}
                ${link.allow_download && !link.view_only ? `<a href="${downloadUrl}" class="btn-download" download="${escHtml(file_name)}">â¬‡ Download File</a>` : ''}
            `;
        }

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(link.folder_name || link.file_name)} â€” Axya Shared</title>
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
    Powered by <a href="https://axya.cloud">Axya</a> â€” Telegram-based secure cloud drive.<br/>
    ${link.expires_at ? `Link expires ${new Date(link.expires_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}` : 'Link has no expiry'}
  </div>
</body>
</html>`);
    } catch (err: any) {
        res.status(500).send(errorPage('Server Error', err.message));
    }
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// PUBLIC FILE DOWNLOAD / INLINE CONTENT (no auth required via share token)
// Both /:token/download and /:token/content hit this handler.
// /content serves inline (bypasses view_only) for previews.
// /download enforces allow_download + view_only restrictions.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const downloadSharedFile = async (req: Request, res: Response) => {
    const token = String(req.params.token);
    const { file_id } = req.query;

    // /content route serves inline previews â€” allowed even in view_only mode
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// PUBLIC FOLDER DOWNLOAD (ZIP) â€” recursive with depth limit
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Helpers
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getTypeEmoji(mime: string) {
    if (!mime) return 'ðŸ“„';
    if (mime.startsWith('image/')) return 'ðŸ–¼ï¸';
    if (mime.startsWith('video/')) return 'ðŸŽ¬';
    if (mime.startsWith('audio/')) return 'ðŸŽµ';
    if (mime === 'application/pdf') return 'ðŸ“‘';
    if (mime.includes('zip') || mime.includes('compress')) return 'ðŸ“¦';
    if (mime.includes('word') || mime.includes('document')) return 'ðŸ“';
    if (mime.includes('sheet') || mime.includes('excel')) return 'ðŸ“Š';
    return 'ðŸ“„';
}

function escHtml(str: string) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function errorPage(title: string, message: string) {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title} â€” Axya</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@600;800&display=swap" rel="stylesheet">
    <style>body{font-family:Inter,sans-serif;background:#0D0F1A;color:#E8EAF0;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:24px;text-align:center;}
    h1{font-size:24px;font-weight:800;color:#FF5252;margin-bottom:12px;}p{color:#6B7A99;font-size:15px;}</style>
    </head><body><h1>${title}</h1><p>${message}</p></body></html>`;
}

