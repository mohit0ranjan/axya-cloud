"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const telegram_1 = require("telegram");
const sessions_1 = require("telegram/sessions");
const input = require("input");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const apiId = parseInt(process.env.TELEGRAM_API_ID || '0', 10);
const apiHash = process.env.TELEGRAM_API_HASH || '';
const stringSession = new sessions_1.StringSession("");
(() => __awaiter(void 0, void 0, void 0, function* () {
    if (!apiId || !apiHash) {
        console.error("❌ Please set TELEGRAM_API_ID and TELEGRAM_API_HASH in your .env file.");
        process.exit(1);
    }
    const client = new telegram_1.TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
    });
    yield client.start({
        phoneNumber: () => __awaiter(void 0, void 0, void 0, function* () { return yield input.text("Enter phone: "); }),
        password: () => __awaiter(void 0, void 0, void 0, function* () { return yield input.text("2FA Password (if any): "); }),
        phoneCode: () => __awaiter(void 0, void 0, void 0, function* () { return yield input.text("Enter OTP: "); }),
        onError: (err) => console.log(err),
    });
    console.log("\n✅ SESSION STRING:\n");
    console.log(client.session.save()); // 🔥 COPY THIS
    console.log("\n👉 Add this string to your .env file as TELEGRAM_SESSION");
    process.exit(0);
}))();
