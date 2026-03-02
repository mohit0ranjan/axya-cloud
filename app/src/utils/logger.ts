type LogLevel = 'info' | 'warn' | 'error';

const formatPayload = (scope: string, message: string, meta?: unknown) => ({
    ts: new Date().toISOString(),
    scope,
    message,
    meta,
});

const write = (level: LogLevel, scope: string, message: string, meta?: unknown) => {
    const payload = formatPayload(scope, message, meta);
    if (level === 'error') {
        console.error(payload);
    } else if (level === 'warn') {
        console.warn(payload);
    } else {
        console.log(payload);
    }
};

export const logger = {
    info: (scope: string, message: string, meta?: unknown) => write('info', scope, message, meta),
    warn: (scope: string, message: string, meta?: unknown) => write('warn', scope, message, meta),
    error: (scope: string, message: string, meta?: unknown) => write('error', scope, message, meta),
};

