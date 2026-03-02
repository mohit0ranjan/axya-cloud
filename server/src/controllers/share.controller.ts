import { Request, Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import pool from '../config/db';
import { getDynamicClient } from '../services/telegram.service';

// ─────────────────────────────────────────────────────────────────────────────
// CREATE A PUBLIC SHARE LINK
// ─────────────────────────────────────────────────────────────────────────────
export const createShareLink = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { id } = req.params;
    const { expires_in_hours } = req.body;

    try {
        const fileCheck = await pool.query('SELECT id FROM files WHERE id = $1 AND user_id = $2', [id, req.user.id]);
        if (fileCheck.rows.length === 0) return res.status(404).json({ success: false, error: 'File not found' });

        const expiresAt = expires_in_hours ? new Date(Date.now() + parseInt(expires_in_hours) * 3600000) : null;

        // Delete old link and create fresh one
        await pool.query(`DELETE FROM shared_links WHERE file_id = $1 AND created_by = $2`, [id, req.user.id]);
        const result = await pool.query(
            `INSERT INTO shared_links (file_id, created_by, expires_at) VALUES ($1, $2, $3) RETURNING token, expires_at`,
            [id, req.user.id, expiresAt]
        );

        res.json({ success: true, token: result.rows[0].token, expires_at: result.rows[0].expires_at });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// REVOKE SHARE LINK
// ─────────────────────────────────────────────────────────────────────────────
export const revokeShareLink = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { id } = req.params;
    try {
        await pool.query(`DELETE FROM shared_links WHERE file_id = $1 AND created_by = $2`, [id, req.user.id]);
        res.json({ success: true, message: 'Share link revoked.' });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC SHARE WEB PAGE  (HTML preview — no auth required)
// ─────────────────────────────────────────────────────────────────────────────
export const shareWebPage = async (req: Request, res: Response) => {
    const { token } = req.params;
    try {
        const linkResult = await pool.query(
            `SELECT sl.*, f.file_name, f.file_size, f.mime_type, f.sha256_hash
             FROM shared_links sl JOIN files f ON f.id = sl.file_id
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

        const { file_name, file_size, mime_type, sha256_hash } = link;
        const formatSize = (b: number) => {
            if (!b) return '0 B';
            const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(b) / Math.log(k));
            return (b / Math.pow(k, i)).toFixed(1) + ' ' + s[i];
        };

        const isImage = mime_type?.startsWith('image/');
        const isVideo = mime_type?.startsWith('video/');
        const isPdf = mime_type === 'application/pdf';

        const downloadUrl = `/share/${token}/download`;
        const preview = isImage
            ? `<img src="${downloadUrl}" alt="${file_name}" class="preview-img" />`
            : isVideo
                ? `<video controls class="preview-video"><source src="${downloadUrl}" type="${mime_type}" />Your browser does not support video playback.</video>`
                : isPdf
                    ? `<iframe src="${downloadUrl}" class="preview-pdf" title="${file_name}"></iframe>`
                    : `<div class="no-preview"><span class="file-emoji">${getTypeEmoji(mime_type)}</span><p>No preview available</p></div>`;

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${file_name} — Axya</title>
  <meta name="description" content="Shared file: ${file_name} (${formatSize(file_size)})">
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
    .hash { font-size: 11px; color: #4F5B76; background: #0D0F1A; border-radius: 8px; padding: 10px 14px; margin-top: 16px; word-break: break-all; }
    .hash span { color: #1FD45A; font-weight: 700; }
    .footer { margin-top: 32px; font-size: 12px; color: #4F5B76; text-align: center; }
    .footer a { color: #5B7FFF; text-decoration: none; }
  </style>
</head>
<body>
  <div class="logo">Tele<span>Drive</span></div>
  <div class="card">
    <div class="file-info">
      <div class="file-icon">${getTypeEmoji(mime_type)}</div>
      <div class="file-meta">
        <h1>${escHtml(file_name)}</h1>
        <div class="details">${formatSize(file_size)} &nbsp;·&nbsp; ${mime_type || 'Unknown type'}</div>
      </div>
    </div>

    ${preview}

    <a href="${downloadUrl}" class="btn-download" download="${escHtml(file_name)}">⬇ Download File</a>

    ${sha256_hash ? `<div class="hash"><span>SHA-256 Verified:</span> ${sha256_hash}</div>` : ''}
  </div>

  <div class="footer">
    Powered by <a href="https://Axya.app">Axya</a> — Telegram-secured cloud storage.<br/>
    ${link.expires_at ? `Link expires ${new Date(link.expires_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}` : 'Link has no expiry'}
  </div>
</body>
</html>`);
    } catch (err: any) {
        res.status(500).send(errorPage('Server Error', err.message));
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC FILE DOWNLOAD (no auth required via share token)
// ─────────────────────────────────────────────────────────────────────────────
export const downloadSharedFile = async (req: Request, res: Response) => {
    const { token } = req.params;
    try {
        const linkResult = await pool.query(
            `SELECT sl.*, f.telegram_message_id, f.telegram_chat_id, f.mime_type, f.file_name, f.file_size,
                    u.session_string
             FROM shared_links sl
             JOIN files f ON f.id = sl.file_id
             JOIN users u ON u.id = sl.created_by
             WHERE sl.token = $1`,
            [token]
        );

        if (linkResult.rows.length === 0) return res.status(404).json({ success: false, error: 'Share link not found.' });

        const link = linkResult.rows[0];
        if (link.expires_at && new Date(link.expires_at) < new Date()) {
            return res.status(410).json({ success: false, error: 'This share link has expired.' });
        }

        await pool.query(`UPDATE shared_links SET download_count = download_count + 1 WHERE token = $1`, [token]);

        const { telegram_message_id, telegram_chat_id, mime_type, file_name, session_string } = link;
        const client = await getDynamicClient(session_string);
        const messages = await client.getMessages(telegram_chat_id, { ids: parseInt(telegram_message_id, 10) });

        if (!messages || messages.length === 0) return res.status(404).json({ success: false, error: 'File no longer available.' });

        const buffer = await client.downloadMedia(messages[0] as any);
        if (!buffer) return res.status(500).json({ success: false, error: 'Failed to stream file.' });

        res.set('Content-Type', mime_type || 'application/octet-stream');
        res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(file_name)}"`);
        res.set('Content-Length', buffer.length.toString());
        res.send(buffer);
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
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function errorPage(title: string, message: string) {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title} — Axya</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@600;800&display=swap" rel="stylesheet">
    <style>body{font-family:Inter,sans-serif;background:#0D0F1A;color:#E8EAF0;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:24px;text-align:center;}
    h1{font-size:24px;font-weight:800;color:#FF5252;margin-bottom:12px;}p{color:#6B7A99;font-size:15px;}</style>
    </head><body><h1>${title}</h1><p>${message}</p></body></html>`;
}
