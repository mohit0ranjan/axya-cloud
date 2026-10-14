import path from 'path';

// Return variable names only: validation must never print connection strings or keys.
export const productionConfigErrors = (env: NodeJS.ProcessEnv): string[] => {
    if (env.NODE_ENV !== 'production') return [];
    const errors: string[] = [];
    const requireValue = (name: string) => {
        if (!env[name]?.trim()) errors.push(name);
    };
    for (const name of ['DATABASE_URL', 'SESSION_ENCRYPTION_KEY', 'TELEGRAM_API_ID', 'TELEGRAM_API_HASH',
        'JWT_SECRET', 'COOKIE_SECRET', 'SHARE_V2_SESSION_SECRET', 'SHARE_V2_TICKET_SECRET', 'SHARE_V2_LINK_PEPPER',
        'SERVER_BASE_URL', 'FRONTEND_BASE_URL', 'ALLOWED_ORIGINS', 'UPLOAD_STORAGE_DIR']) requireValue(name);
    const validUrl = (raw: string, protocols: string[], originOnly = false): boolean => {
        try {
            const url = new URL(raw);
            return protocols.includes(url.protocol) && (!originOnly ||
                (!url.username && !url.password && !url.search && !url.hash && url.pathname === '/' &&
                    !['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(url.hostname)));
        } catch { return false; }
    };
    if (env.DATABASE_URL && !validUrl(env.DATABASE_URL, ['postgres:', 'postgresql:'])) errors.push('DATABASE_URL');
    for (const name of ['SERVER_BASE_URL', 'FRONTEND_BASE_URL']) {
        if (env[name] && !validUrl(env[name]!, ['https:'], true)) errors.push(name);
    }
    if (env.ALLOWED_ORIGINS) {
        const origins = env.ALLOWED_ORIGINS.split(',').map(value => value.trim());
        if (origins.some(origin => !validUrl(origin, ['https:'], true))) errors.push('ALLOWED_ORIGINS');
        if (env.FRONTEND_BASE_URL && !origins.includes(env.FRONTEND_BASE_URL.replace(/\/$/, ''))) errors.push('ALLOWED_ORIGINS');
    }
    for (const name of ['JWT_SECRET', 'COOKIE_SECRET']) {
        if (env[name] && (env[name]!.length < 32 || /replace|change[-_ ]?me|example/i.test(env[name]!))) errors.push(name);
    }
    const encryptionKey = env.SESSION_ENCRYPTION_KEY || '';
    if (encryptionKey && (/^[a-f0-9]{64}$/i.test(encryptionKey) ? Buffer.from(encryptionKey, 'hex') : Buffer.from(encryptionKey, 'base64')).length !== 32) errors.push('SESSION_ENCRYPTION_KEY');
    if (env.TELEGRAM_API_ID && !/^[1-9]\d*$/.test(env.TELEGRAM_API_ID)) errors.push('TELEGRAM_API_ID');
    if (env.TELEGRAM_API_HASH && !/^[a-f0-9]{32}$/i.test(env.TELEGRAM_API_HASH)) errors.push('TELEGRAM_API_HASH');
    if (env.UPLOAD_STORAGE_DIR && !path.isAbsolute(env.UPLOAD_STORAGE_DIR)) errors.push('UPLOAD_STORAGE_DIR');
    if (env.PORT && (!Number.isInteger(Number(env.PORT)) || Number(env.PORT) < 1 || Number(env.PORT) > 65535)) errors.push('PORT');
    if (env.STORAGE_PROVIDER && env.STORAGE_PROVIDER !== 'telegram') errors.push('STORAGE_PROVIDER');
    return [...new Set(errors)];
};

export const assertProductionConfig = (env: NodeJS.ProcessEnv = process.env): void => {
    const errors = productionConfigErrors(env);
    if (errors.length) throw new Error(`Invalid production configuration: ${errors.join(', ')}. Check the deployment playbook.`);
};
