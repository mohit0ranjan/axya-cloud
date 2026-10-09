import { Writable } from 'stream';

/** Bounded-memory streaming. Abort/seek wakes backpressure waits and stops upstream reads. */
export async function pipeMediaChunks(chunks: AsyncIterable<Buffer>, output: Writable, expectedBytes: number, signal: AbortSignal) {
    let sent = 0;
    for await (const chunk of chunks) {
        if (signal.aborted || output.destroyed) return sent;
        const remaining = expectedBytes - sent;
        if (remaining <= 0) break;
        const bytes = chunk.subarray(0, remaining);
        sent += bytes.length;
        if (!output.write(bytes)) {
            await new Promise<void>((resolve, reject) => {
                const cleanup = () => {
                    output.off('drain', done); output.off('error', fail); output.off('close', done);
                    signal.removeEventListener('abort', done);
                };
                const done = () => { cleanup(); resolve(); };
                const fail = (error: Error) => { cleanup(); reject(error); };
                output.once('drain', done); output.once('error', fail); output.once('close', done);
                signal.addEventListener('abort', done, { once: true });
                if (signal.aborted || output.destroyed) done();
            });
        }
        if (signal.aborted || output.destroyed) return sent;
        if (sent === expectedBytes) break;
    }
    if (!signal.aborted && !output.destroyed) {
        if (sent !== expectedBytes) throw new Error('Video source ended before the requested bytes arrived');
        output.end();
    }
    return sent;
}
