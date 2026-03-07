import dotenv from 'dotenv';
dotenv.config();
import { resolveTelegramMessageForShareItem } from './src/services/share-v2/telegram-read.service';
import { iterFileDownload } from './src/services/telegram.service';
import pool from './src/config/db';

async function test() {
    try {
        const res = await pool.query('SELECT owner_user_id FROM share_links_v2 WHERE id = $1', ['ff43ac12-492f-4729-8b4d-48be5586ddaf']);
        const ownerId = res.rows[0]?.owner_user_id;

        const resolved = await resolveTelegramMessageForShareItem(ownerId, 'me', 34775);
        if ('failure' in resolved) {
            console.error("FAILURE:", resolved.failure);
        } else {
            console.log("SUCCESS, testing iterFileDownload...");
            let bytes = 0;
            const iter = iterFileDownload(resolved.client, resolved.message, 0, Infinity);
            for await (const chunk of iter) {
                bytes += chunk.length;
                console.log(`Downloaded ${chunk.length} bytes (Total: ${bytes})`);
                break; // Just one chunk is enough to test if iterDownload works
            }
            console.log(`Finished, got ${bytes} bytes`);
        }
    } catch (e: any) {
        console.error("UNKNOWN ERROR:", e.message);
    } finally {
        await pool.end();
        process.exit(0);
    }
}
test();
