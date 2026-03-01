import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
const input = require("input");
import dotenv from "dotenv";

dotenv.config();

const apiId = parseInt(process.env.TELEGRAM_API_ID || '0', 10);
const apiHash = process.env.TELEGRAM_API_HASH || '';

const stringSession = new StringSession("");

(async () => {
    if (!apiId || !apiHash) {
        console.error("❌ Please set TELEGRAM_API_ID and TELEGRAM_API_HASH in your .env file.");
        process.exit(1);
    }

    const client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
    });

    await client.start({
        phoneNumber: async () => await input.text("Enter phone: "),
        password: async () => await input.text("2FA Password (if any): "),
        phoneCode: async () => await input.text("Enter OTP: "),
        onError: (err) => console.log(err),
    });

    console.log("\n✅ SESSION STRING:\n");
    console.log(client.session.save()); // 🔥 COPY THIS

    console.log("\n👉 Add this string to your .env file as TELEGRAM_SESSION");
    process.exit(0);
})();
