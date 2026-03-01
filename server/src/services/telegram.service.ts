import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { CustomFile } from 'telegram/client/uploads';
import NodeCache from 'node-cache';
import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

const getApiConfig = () => {
    const apiId = parseInt(process.env.TELEGRAM_API_ID || '0', 10);
    const apiHash = process.env.TELEGRAM_API_HASH || '';
    if (!apiId || !apiHash) throw new Error("Missing TELEGRAM_API_ID or TELEGRAM_API_HASH");
    return { apiId, apiHash };
};
const clientPool = new NodeCache({ stdTTL: 600, checkperiod: 120, useClones: false });

const sessionKey = (s: string) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

export const getDynamicClient = async (sessionString: string) => {
    const key = sessionKey(sessionString);
    if (clientPool.has(key)) {
        const cachedClient = clientPool.get(key) as TelegramClient;
        if (!cachedClient.connected) {
            await cachedClient.connect();
        }
        return cachedClient;
    }
    const { apiId, apiHash } = getApiConfig();
    const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
        connectionRetries: 1,
    });
    await client.connect();

    clientPool.set(key, client);

    clientPool.on('expired', async (_key, val: TelegramClient) => {
        try { await val.disconnect(); } catch { }
    });

    return client;
};

export const generateOTP = async (phoneNumber: string) => {
    const { apiId, apiHash } = getApiConfig();
    const client = new TelegramClient(new StringSession(""), apiId, apiHash, { connectionRetries: 5 });
    await client.connect();

    const { phoneCodeHash } = await client.sendCode({ apiId, apiHash }, phoneNumber);

    const tempSession = client.session.save() as unknown as string;
    await client.disconnect();
    return { phoneCodeHash, tempSession };
};

export const verifyOTPAndSignIn = async (phoneNumber: string, phoneCodeHash: string, phoneCode: string, tempSession: string) => {
    const { apiId, apiHash } = getApiConfig();
    const client = new TelegramClient(new StringSession(tempSession), apiId, apiHash, { connectionRetries: 5 });
    await client.connect();

    await client.invoke(
        new Api.auth.SignIn({
            phoneNumber,
            phoneCodeHash,
            phoneCode,
        })
    );

    const me = await client.getMe() as Api.User;
    const profileData = {
        name: [me.firstName, me.lastName].filter(Boolean).join(' '),
        username: me.username || null,
    };

    const userSessionString = client.session.save() as unknown as string;
    await client.disconnect();
    return { userSessionString, profileData };
};
