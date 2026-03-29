import winston from 'winston';

type LogLevel = 'info' | 'warn' | 'error';

const baseLogger = winston.createLogger({
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: {
        service: 'axya-api',
        env: process.env.NODE_ENV || 'development',
    },
    transports: [new winston.transports.Console()],
});

const write = (level: LogLevel, scope: string, message: string, meta?: unknown) => {
    baseLogger.log(level, message, {
        scope,
        meta,
    });
};

export const logger = {
    info: (scope: string, message: string, meta?: unknown) => write('info', scope, message, meta),
    warn: (scope: string, message: string, meta?: unknown) => write('warn', scope, message, meta),
    error: (scope: string, message: string, meta?: unknown) => write('error', scope, message, meta),
};

