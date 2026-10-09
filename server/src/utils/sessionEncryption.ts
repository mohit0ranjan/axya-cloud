import crypto from 'crypto';

const PREFIX = 'axya-session:v1:';
const encryptionKey = (): Buffer => {
    const raw = process.env.SESSION_ENCRYPTION_KEY || '';
    const key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (key.length !== 32) throw new Error('SESSION_ENCRYPTION_KEY must contain a random 32-byte key (hex or base64)');
    return key;
};

export const encryptSession = (session: string): string => {
    if (!session) throw new Error('Cannot store an empty Telegram session');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
    cipher.setAAD(Buffer.from(PREFIX));
    const ciphertext = Buffer.concat([cipher.update(session, 'utf8'), cipher.final()]);
    return PREFIX + [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString('base64url')).join('.');
};

export const decryptSession = (stored: string): string => {
    // Read compatibility for old databases; new writes always encrypt.
    if (!stored.startsWith(PREFIX)) return stored;
    const parts = stored.slice(PREFIX.length).split('.');
    if (parts.length !== 3) throw new Error('Invalid encrypted Telegram session');
    const [iv, tag, ciphertext] = parts.map(part => Buffer.from(part, 'base64url'));
    if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid encrypted Telegram session');
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
    decipher.setAAD(Buffer.from(PREFIX));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
};

export const isEncryptedSession = (stored: string): boolean => stored.startsWith(PREFIX);
