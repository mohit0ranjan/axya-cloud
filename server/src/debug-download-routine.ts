import { getDynamicClient } from './services/telegram.service';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const getShareReadSessionCandidates = (ownerSessionString?: string): string[] => {
    const candidates = [
        String(process.env.TELEGRAM_STORAGE_SESSION || '').trim(),
        String(process.env.TELEGRAM_SESSION || '').trim(),
        String(ownerSessionString || '').trim(),
    ].filter(Boolean);
    return Array.from(new Set(candidates));
};

const getShareReadClients = async (ownerSessionString?: string) => {
    const sessions = getShareReadSessionCandidates(ownerSessionString);
    if (!sessions.length) {
        throw new Error('No Telegram storage session configured.');
    }

    const clients: any[] = [];
    let lastErr: any = null;
    for (const session of sessions) {
        try {
            clients.push(await getDynamicClient(session));
        } catch (err: any) {
            lastErr = err;
        }
    }

    if (!clients.length) {
        throw lastErr || new Error('Failed to connect Telegram storage session.');
    }

    return clients;
};

const resolveShareMessageFromClients = async (
    clients: any[],
    chatId: string,
    messageId: number
): Promise<{ message: any; client: any } | null> => {
    let lastErr: unknown = null;
    for (const client of clients) {
        try {
            console.log(`Trying client with id ${client.session.serverAddress}`);
            const messages = await client.getMessages(chatId, { ids: messageId });
            if (messages && messages.length > 0 && messages[0]) {
                return { message: messages[0], client };
            }
        } catch (err: any) {
            console.error(`Client getMessages Failed: ${err.message}`);
            lastErr = err;
        }
    }
    if (lastErr) throw lastErr;
    return null;
};

async function testDownloadRoutine() {
    try {
        console.log('1. Fetching a file...');
        const res = await pool.query('SELECT user_id, telegram_chat_id, telegram_message_id, file_name FROM files WHERE is_trashed = false AND telegram_message_id IS NOT NULL ORDER BY created_at DESC LIMIT 1');
        const file = res.rows[0];
        console.log(`File: ${file.file_name} (chatId: ${file.telegram_chat_id}, messageId: ${file.telegram_message_id})`);

        const ownerRes = await pool.query('SELECT session_string FROM users WHERE id = $1', [file.user_id]);
        const ownerSessionString = String(ownerRes.rows[0]?.session_string || '');
        console.log(`Owner has a local session?: ${!!ownerSessionString}`);

        console.log('\n2. Booting Clients...');
        const clients = await getShareReadClients(ownerSessionString);
        console.log(`Found ${clients.length} valid client connections.`);

        console.log('\n3. Resolving Message...');
        const resolved = await resolveShareMessageFromClients(clients, String(file.telegram_chat_id), Number(file.telegram_message_id));
        if (resolved) {
            console.log(`✅ Message resolved successfully! Size: ${resolved.message.media?.document?.size || 'unknown'}`);
        } else {
            console.log(`❌ Message returned NULL.`);
        }
    } catch (err: any) {
        console.error('Fatal Test Error:', err.message);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

testDownloadRoutine();
