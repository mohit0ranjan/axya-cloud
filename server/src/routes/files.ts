import express from 'express';
import multer from 'multer';
import { TelegramClient } from 'telegram';
import { Api } from 'telegram';
import pool from '../db';
import { CustomFile } from 'telegram/client/uploads';

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

// Pass the client from the main app, or manage globally
// For now, assume it's attached to the app request somehow, or we export it
let telegramClient: TelegramClient | null = null;
export const setTelegramClient = (client: TelegramClient) => {
    telegramClient = client;
};

// --- MOCK MIGRATION & STORAGE LOGIC ---
// In a real flow, you'll associate the uploaded file with a user record.
router.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) throw new Error("No file uploaded");
        if (!telegramClient) throw new Error("Telegram client not initialised");

        const { originalname, path: filePath, mimetype, size } = req.file;
        const mockUserId = 1; // Assuming a mock user

        console.log(`Uploading file ${originalname} to Telegram Saved Messages...`);

        // This connects to the GramJS client to send to 'me' (Saved Messages)
        // using the local file path wrapped as a CustomFile.
        const sentMessage = await telegramClient.sendFile('me', {
            file: new CustomFile(originalname, size, filePath),
            caption: originalname,
        });

        const telegramMsgId = sentMessage.id;
        console.log(`✅ Uploaded to Telegram with Message ID: ${telegramMsgId}`);

        // Mock DB Insert for file metadata
        const insertQuery = `
            INSERT INTO files (user_id, telegram_message_id, name, mime_type, size, url)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *;
        `;
        const result = await pool.query(insertQuery, [
            mockUserId,
            telegramMsgId,
            originalname,
            mimetype,
            size,
            `/api/files/download/${telegramMsgId}` // Mock local url to fetch via proxy later
        ]);

        res.json({ success: true, file: result.rows[0] });

    } catch (err: any) {
        console.error("Upload error:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM files ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
