import { Request, Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import pool from '../config/db';
import { getDynamicClient } from '../services/telegram.service';
import bcrypt from 'bcryptjs';
import archiver from 'archiver';

// ─────────────────────────────────────────────────────────────────────────────
// CREATE A PUBLIC SHARE LINK (File or Folder)
// ─────────────────────────────────────────────────────────────────────────────
export const createShareLink = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });

    // We expect either file_id or folder_id, plus sharing options
    const { file_id, folder_id, expires_in_hours, password, allow_download = true, view_only = false } = req.body;

    if (!file_id && !folder_id) {
        return res.status(400).json({ success: false, error: 'Must provide either file_id or folder_id' });
    }

    try {
        // Verify ownership
        if (file_id) {
            const fileCheck = await pool.query('SELECT id FROM files WHERE id = $1 AND user_id = $2', [file_id, req.user.id]);
            if (fileCheck.rows.length === 0) return res.status(404).json({ success: false, error: 'File not found' });
        } else if (folder_id) {
            const folderCheck = await pool.query('SELECT id FROM folders WHERE id = $1 AND user_id = $2', [folder_id, req.user.id]);
            if (folderCheck.rows.length === 0) return res.status(404).json({ success: false, error: 'Folder not found' });
        }

        const expiresAt = expires_in_hours ? new Date(Date.now() + parseInt(expires_in_hours) * 3600000) : null;
        const passwordHash = password ? await bcrypt.hash(password, 10) : null;

        // Delete old link (if any for this exact file/folder) and create fresh one
        if (file_id) await pool.query(`DELETE FROM shared_links WHERE file_id = $1 AND created_by = $2`, [file_id, req.user.id]);
        if (folder_id) await pool.query(`DELETE FROM shared_links WHERE folder_id = $1 AND created_by = $2`, [folder_id, req.user.id]);

        const result = await pool.query(
            `INSERT INTO shared_links (file_id, folder_id, created_by, expires_at, password_hash, allow_download, view_only) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING token, expires_at`,
            [file_id || null, folder_id || null, req.user.id, expiresAt, passwordHash, allow_download, view_only]
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
    const { id } = req.params; // This can be token or file/folder id depending on router setup
    try {
        await pool.query(`DELETE FROM shared_links WHERE (file_id = $1 OR folder_id = $1 OR token = $1) AND created_by = $2`, [id, req.user.id]);
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
    const { token } = req.params;
    const { password } = req.body;

    try {
        const linkResult = await pool.query('SELECT id, password_hash FROM shared_links WHERE token = $1', [token]);
        if (linkResult.rows.length === 0) return res.status(404).json({ success: false, error: 'Share link not found.' });

        const link = linkResult.rows[0];
        if (!link.password_hash) return res.json({ success: true }); // No password requested

        const isValid = await bcrypt.compare(password, link.password_hash);
        if (!isValid) return res.status(401).json({ success: false, error: 'Incorrect password.' });

        // Set a cookie to remember auth for this token
        res.cookie(`share_auth_${token}`, 'true', { maxAge: 24 * 60 * 60 * 1000, httpOnly: true });
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC SHARE WEB PAGE  (HTML preview — no auth required, cookie for password)
// ─────────────────────────────────────────────────────────────────────────────
export const shareWebPage = async (req: Request, res: Response) => {
    const { token } = req.params;
    try {
        // Increment view count immediately
        pool.query('UPDATE shared_links SET views = views + 1 WHERE token = $1', [token]).catch(() => { });

        const linkResult = await pool.query(
            `SELECT sl.*, 
                    f.file_name, f.file_size, f.mime_type, f.sha256_hash,
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
        if (link.password_hash && !req.headers.cookie?.includes(`share_auth_${token}=true`)) {
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
            // RENDERING FOLDER VIEW
            const filesRes = await pool.query(
                `SELECT id, file_name, file_size, mime_type FROM files WHERE folder_id = $1 AND is_trashed = false ORDER BY created_at DESC`,
                [link.folder_id]
            );
            const files = filesRes.rows;
            const totalSize = files.reduce((acc, f) => acc + (Number(f.file_size) || 0), 0);

            let filesHtml = files.map(f => `
                <div class="file-item">
                    <div class="f-icon">${getTypeEmoji(f.mime_type)}</div>
                    <div class="f-meta">
                        <div class="f-name">${escHtml(f.file_name)}</div>
                        <div class="f-size">${formatSize(f.file_size)}</div>
                    </div>
                </div>
            `).join('');

            if (files.length === 0) filesHtml = `<div class="no-preview" style="grid-column: 1 / -1;"><p>This folder is empty.</p></div>`;

            content = `
                <div class="file-info">
                  <div class="file-icon" style="background:#5B7FFF20;color:#5B7FFF">📁</div>
                  <div class="file-meta">
                    <h1>${escHtml(link.folder_name)}</h1>
                    <div class="details">${files.length} files &nbsp;·&nbsp; ${formatSize(totalSize)}</div>
                  </div>
                </div>
                <div class="folder-grid">
                    ${filesHtml}
                </div>
                ${link.allow_download ? `<a href="/share/${token}/download-all" class="btn-download" download>⬇ Download All (ZIP)</a>` : ''}
            `;
        } else {
            // RENDERING SINGLE FILE VIEW
            const { file_name, file_size, mime_type, sha256_hash } = link;
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

            content = `
                <div class="file-info">
                  <div class="file-icon">${getTypeEmoji(mime_type)}</div>
                  <div class="file-meta">
                    <h1>${escHtml(file_name)}</h1>
                    <div class="details">${formatSize(file_size)} &nbsp;·&nbsp; ${mime_type || 'Unknown type'}</div>
                  </div>
                </div>
                ${preview}
                ${link.allow_download ? `<a href="${downloadUrl}" class="btn-download" download="${escHtml(file_name)}">⬇ Download File</a>` : ''}
                ${sha256_hash ? `<div class="hash"><span>SHA-256 Verified:</span> ${sha256_hash}</div>` : ''}
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
    .hash { font-size: 11px; color: #4F5B76; background: #0D0F1A; border-radius: 8px; padding: 10px 14px; margin-top: 16px; word-break: break-all; }
    .hash span { color: #1FD45A; font-weight: 700; }
    .footer { margin-top: 32px; font-size: 12px; color: #4F5B76; text-align: center; }
    .footer a { color: #5B7FFF; text-decoration: none; }
    .folder-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; margin-top: 20px;}
    .file-item { background: #0D0F1A; border: 1px solid #252A3E; border-radius: 16px; padding: 16px; display: flex; align-items: center; gap: 12px;}
    .f-icon { font-size: 24px; }
    .f-meta { overflow: hidden; }
    .f-name { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .f-size { font-size: 12px; color: #6B7A99; margin-top: 4px; }
  </style>
</head>
<body>
  <div class="logo">Tele<span>Drive</span></div>
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
        if (!link.allow_download) {
            return res.status(403).json({ success: false, error: 'Downloads are disabled for this link.' });
        }
        if (link.password_hash && !req.headers.cookie?.includes(`share_auth_${token}=true`)) {
            return res.status(401).json({ success: false, error: 'Password authentication required.' });
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
// PUBLIC FOLDER DOWNLOAD (ZIP)
// ─────────────────────────────────────────────────────────────────────────────
export const downloadAllShared = async (req: Request, res: Response) => {
    const { token } = req.params;
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
        if (link.password_hash && !req.headers.cookie?.includes(`share_auth_${token}=true`)) {
            return res.status(401).json({ success: false, error: 'Password authentication required.' });
        }

        const filesRes = await pool.query(
            `SELECT file_name, telegram_message_id, telegram_chat_id 
             FROM files 
             WHERE folder_id = $1 AND is_trashed = false`,
            [link.folder_id]
        );

        const files = filesRes.rows;
        if (files.length === 0) return res.status(404).json({ success: false, error: 'Folder is empty.' });

        await pool.query(`UPDATE shared_links SET download_count = download_count + 1 WHERE token = $1`, [token]);

        const client = await getDynamicClient(link.session_string);

        res.set('Content-Type', 'application/zip');
        res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(link.folder_name)}.zip"`);

        const archive = archiver('zip', { zlib: { level: 5 } });
        archive.on('error', (err) => res.status(500).send({ error: err.message }));
        archive.pipe(res);

        // Download files dynamically and stream into archiver
        for (const file of files) {
            try {
                const msgs = await client.getMessages(file.telegram_chat_id, { ids: parseInt(file.telegram_message_id, 10) });
                if (msgs && msgs.length > 0) {
                    const buffer = await client.downloadMedia(msgs[0] as any);
                    if (buffer) {
                        archive.append(buffer, { name: file.file_name });
                    }
                }
            } catch (err: any) {
                console.warn(`Failed to include file ${file.file_name} in ZIP:`, err.message);
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
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function errorPage(title: string, message: string) {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title} — Axya</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@600;800&display=swap" rel="stylesheet">
    <style>body{font-family:Inter,sans-serif;background:#0D0F1A;color:#E8EAF0;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:24px;text-align:center;}
    h1{font-size:24px;font-weight:800;color:#FF5252;margin-bottom:12px;}p{color:#6B7A99;font-size:15px;}</style>
    </head><body><h1>${title}</h1><p>${message}</p></body></html>`;
}
