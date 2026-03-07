import { Pool } from 'pg';
import dotenv from 'dotenv';
import { getDynamicClient } from './services/telegram.service';

dotenv.config({ path: '../.env' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function debugShare() {
    try {
        console.log('Querying recent files...');
        const res = await pool.query('SELECT user_id, telegram_chat_id, telegram_message_id, file_name FROM files ORDER BY created_at DESC LIMIT 3');

        const files = res.rows;
        if (files.length === 0) {
            console.log("No files found.");
            process.exit(0);
        }

        console.log('Recent files:', files);

        // Use the global storage session
        console.log('Initializing Telegram client...');
        const storageSession = process.env.TELEGRAM_STORAGE_SESSION || process.env.TELEGRAM_SESSION || '';
        const client = await getDynamicClient(storageSession);
        console.log('Client connected.');

        for (const file of files) {
            if (!file.telegram_chat_id || !file.telegram_message_id) {
                console.log(`Skipping ${file.file_name} (No IDs)`);
                continue;
            }

            console.log(`Testing resolution for ${file.file_name} in chat ${file.telegram_chat_id} msg ${file.telegram_message_id}`);
            try {
                const messages = await client.getMessages(String(file.telegram_chat_id), { ids: Number(file.telegram_message_id) });
                if (messages && messages.length > 0 && messages[0]) {
                    console.log(`✅ Success for ${file.file_name}`);
                } else {
                    console.log(`❌ Message array empty or undefined for ${file.file_name}`);
                }
            } catch (err: any) {
                console.error(`❌ Error fetching ${file.file_name}:`, err.message);
            }
        }

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

debugShare();
