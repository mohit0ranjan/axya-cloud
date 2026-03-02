type LogLevel = 'info' | 'warn' | 'error';

const write = (level: LogLevel, scope: string, message: string, meta?: unknown) => {
    const payload = {
        ts: new Date().toISOString(),
        level,
        scope,
        message,
        meta,
    };
    const line = JSON.stringify(payload);
    if (level === 'error') {
        console.error(line);
    } else if (level === 'warn') {
        console.warn(line);
    } else {
        console.log(line);
    }
};

export const logger = {
    info: (scope: string, message: string, meta?: unknown) => write('info', scope, message, meta),
    warn: (scope: string, message: string, meta?: unknown) => write('warn', scope, message, meta),
    error: (scope: string, message: string, meta?: unknown) => write('error', scope, message, meta),
};

