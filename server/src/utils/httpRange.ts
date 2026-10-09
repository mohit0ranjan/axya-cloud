export type ByteRange = { start: number; end: number };

/** One RFC 9110 byte range. Invalid, multipart and unsatisfiable ranges are rejected. */
export const parseByteRange = (header: string | undefined, size: number): ByteRange | null => {
    if (!header) return null;
    if (!Number.isSafeInteger(size) || size <= 0) throw new RangeError('Invalid representation size');
    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!match || (!match[1] && !match[2])) throw new RangeError('Invalid byte range');
    if (!match[1]) {
        const suffix = Number(match[2]);
        if (!Number.isSafeInteger(suffix) || suffix <= 0) throw new RangeError('Invalid suffix range');
        return { start: Math.max(0, size - suffix), end: size - 1 };
    }
    const start = Number(match[1]);
    const requestedEnd = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd)
        || start >= size || requestedEnd < start) throw new RangeError('Unsatisfiable byte range');
    return { start, end: Math.min(requestedEnd, size - 1) };
};
