import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import dotenv from 'dotenv';

dotenv.config();

const apiId = parseInt(process.env.TELEGRAM_API_ID || '0', 10);
const apiHash = process.env.TELEGRAM_API_HASH || '';
// Use TELEGRAM_SESSION to load the saved session
const stringSession = new StringSession(process.env.TELEGRAM_SESSION || '');

export const telegramClient = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
});

export const connectTelegram = async () => {
    try {
        await telegramClient.connect();
        const isAuth = await telegramClient.checkAuthorization();
        if (isAuth) {
            console.log('✅ Telegram client authenticated using session.');
        } else {
            console.log('⚠️ Telegram client connected, but requires login (OTP).');
        }
    } catch (error) {
        console.error('❌ Failed to connect to Telegram:', error);
    }
};
