import type { Server } from 'http';

export const drainRequestsThenCloseDatabase = async (server: Server | undefined, closeDatabase: () => Promise<void>): Promise<void> => {
    if (server) await new Promise<void>(resolve => {
        server.close(() => resolve());
        server.closeIdleConnections();
    });
    await closeDatabase();
};
