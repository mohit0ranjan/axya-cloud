import type { Request, Response } from 'express';

type Dependencies = {
    schema: () => string;
    shuttingDown: () => boolean;
    telegramConfigured: () => boolean;
    staging: () => { ready: boolean; reason: string };
    database: () => Promise<unknown>;
    databaseTimeoutMs: number;
};

export const createReadinessHandler = (deps: Dependencies) => {
    // Share a pending probe so concurrent health checks cannot grow the DB queue.
    let pendingDatabase: Promise<boolean> | undefined;
    const databaseReady = async () => {
        if (!pendingDatabase) {
            pendingDatabase = Promise.resolve().then(deps.database).then(() => true, () => false)
                .finally(() => { pendingDatabase = undefined; });
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([pendingDatabase, new Promise<boolean>(resolve => {
                timer = setTimeout(() => resolve(false), deps.databaseTimeoutMs);
            })]);
        } finally { if (timer) clearTimeout(timer); }
    };
    return async (_req: Request, res: Response) => {
        res.setHeader('Cache-Control', 'no-store');
        try {
            const schema = deps.schema();
            let terminating = deps.shuttingDown();
            const telegram = deps.telegramConfigured();
            const staging = deps.staging();
            const db = schema === 'ready' && !terminating ? await databaseReady() : false;
            terminating = deps.shuttingDown();
            const ready = schema === 'ready' && !terminating && telegram && staging.ready && db;
            if (!ready) res.setHeader('Retry-After', '5');
            return res.status(ready ? 200 : 503).json({
                status: ready ? 'ready' : 'unavailable', readyForUploads: ready,
                checks: { schema, db: db ? 'ok' : 'unavailable', telegramApi: telegram ? 'configured' : 'missing',
                    uploadStaging: staging.reason, terminating },
            });
        } catch {
            return res.status(503).json({ status: 'unavailable', readyForUploads: false });
        }
    };
};
