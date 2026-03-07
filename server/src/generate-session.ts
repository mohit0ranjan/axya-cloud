import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
const input = require('input'); // Required for CLI prompts
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

/**
 * Generate a brand new Telegram String Session.
 * This runs interactively in the terminal and outputs the session string.
 */
const generateSession = async () => {
    console.log("==========================================");
    console.log("   Telegram Session Generator (GramJS)    ");
    console.log("==========================================");

    const apiId = parseInt(process.env.TELEGRAM_API_ID || '0', 10);
    const apiHash = process.env.TELEGRAM_API_HASH || '';

    if (!apiId || !apiHash) {
        console.error("❌ Error: TELEGRAM_API_ID or TELEGRAM_API_HASH missing from .env");
        process.exit(1);
    }

    // Initialize an empty string session to start a fresh login
    const stringSession = new StringSession('');

    const client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
    });

    console.log("Connecting to Telegram...");

    // GramJS handles the complete interactive auth flow (OTP, Password)
    await client.start({
        phoneNumber: async () => await input.text("Enter your phone number (e.g., +1234567890): "),
        password: async () => await input.text("Enter your 2FA password (if any): "),
        phoneCode: async () => await input.text("Enter the Telegram OTP code you received: "),
        onError: (err) => console.log("Auth Error: ", err),
    });

    console.log("\n✅ Successfully Logged In!\n");
    console.log("Here is your new Session String. Save it securely:");
    console.log("==========================================");
    console.log("\nTELEGRAM_SESSION=" + client.session.save());
    console.log("\n==========================================");
    console.log("1. Copy the string above (it is very long).");
    console.log("2. Paste it into your server/.env file, replacing the old TELEGRAM_SESSION.");
    console.log("3. Restart your backend server.");

    // Clean exit
    await client.disconnect();
    process.exit(0);
};

generateSession();
