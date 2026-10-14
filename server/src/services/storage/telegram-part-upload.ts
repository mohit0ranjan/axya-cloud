import { Api } from 'telegram';
import fs from 'fs';
import crypto from 'crypto';
import bigInt from 'big-integer';

const PART_BYTES = 512 * 1024;
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Continuous bounded workers: a slow part does not hold up an entire batch.
 * Retries keep the same file ID and part index, so acknowledged parts stay saved.
 * State is deliberately local to this delivery; it does not survive host restarts.
 */
export async function uploadTelegramParts(client: any, options: {
    filePath: string; fileName: string; fileSize: number;
    onProgress?: (fraction: number) => void;
    workers?: number; wait?: (ms: number) => Promise<void>;
}) {
    const { filePath, fileName, fileSize, onProgress } = options;
    if (!Number.isSafeInteger(fileSize) || fileSize <= 0) throw new Error('FILE_SIZE_INVALID');
    const rawWorkers = options.workers ?? Number(process.env.TELEGRAM_UPLOAD_PART_WORKERS || 6);
    const workers = Math.min(8, Math.max(1, Number.isFinite(rawWorkers) ? Math.floor(rawWorkers) : 6));
    const parts = Math.ceil(fileSize / PART_BYTES);
    const large = fileSize > 10 * 1024 * 1024;
    const fileId = bigInt(crypto.randomBytes(8).readBigInt64LE().toString());
    const handle = await fs.promises.open(filePath, 'r');
    const wait = options.wait || sleep;
    let nextPart = 0, acknowledged = 0, failed: unknown;
    let floodUntil = 0;
    try {
        const stat = await handle.stat();
        if (stat.size !== fileSize) throw new Error('UPLOAD_SOURCE_SIZE_CHANGED');
        // Small documents require a checksum, independent of worker completion order.
        let md5Checksum = '';
        if (!large) {
            const hash = crypto.createHash('md5');
            for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
            md5Checksum = hash.digest('hex');
        }
        onProgress?.(0);
        const run = async () => {
            try {
                while (!failed) {
                    const index = nextPart++;
                    if (index >= parts) return;
                    const length = Math.min(PART_BYTES, fileSize - index * PART_BYTES);
                    const bytes = Buffer.allocUnsafe(length);
                    let read = 0;
                    while (read < length) {
                        const result = await handle.read(bytes, read, length - read, index * PART_BYTES + read);
                        if (!result.bytesRead) throw new Error('UPLOAD_SOURCE_ENDED');
                        read += result.bytesRead;
                    }
                    let saved = false;
                    for (let attempt = 0; attempt < 5 && !failed; attempt++) {
                        if (floodUntil > Date.now()) await wait(floodUntil - Date.now());
                        if (failed) return;
                        try {
                            const sender = await client.getSender(client.session.dcId);
                            const result = await sender.send(large
                                ? new Api.upload.SaveBigFilePart({ fileId, filePart: index, fileTotalParts: parts, bytes })
                                : new Api.upload.SaveFilePart({ fileId, filePart: index, bytes }));
                            if (result !== true) throw new Error('TELEGRAM_PART_NOT_ACKNOWLEDGED');
                            saved = true;
                            break;
                        } catch (error: any) {
                            const message = String(error?.errorMessage || error?.message || '');
                            const flood = /FLOOD(?:_PREMIUM)?_WAIT/i.test(message);
                            const transient = flood || /TIMEOUT|TIMED OUT|DISCONNECT|CONNECTION|ECONN|EPIPE|NETWORK|RPC_CALL_FAIL|INTERNAL|NOT_ACKNOWLEDGED/i.test(message)
                                || Number(error?.code) >= 500;
                            if (!transient || attempt === 4) throw error;
                            if (flood) {
                                const seconds = Number(error?.seconds) || Number(message.match(/WAIT_?(\d+)/)?.[1]) || 15;
                                // Share the cooldown with all workers; never hammer through FLOOD_WAIT.
                                floodUntil = Math.max(floodUntil, Date.now() + (seconds + 1) * 1000);
                            } else await wait(Math.min(8000, 500 * 2 ** attempt));
                        }
                    }
                    if (!saved || failed) return;
                    acknowledged += length;
                    onProgress?.(acknowledged / fileSize);
                }
            } catch (error) { failed = failed || error; }
        };
        // Drain active RPCs before closing the file or starting a whole-delivery retry.
        await Promise.all(Array.from({ length: Math.min(workers, parts) }, run));
        if (failed) throw failed;
        return large ? new Api.InputFileBig({ id: fileId, parts, name: fileName })
            : new Api.InputFile({ id: fileId, parts, name: fileName, md5Checksum });
    } finally { await handle.close(); }
}
