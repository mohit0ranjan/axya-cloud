import rateLimit from 'express-rate-limit';

// Strict limiter for share password protection
export const sharePasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5, // Only 5 attempts per 15 mins per IP
    message: { success: false, error: 'Too many password attempts. Please try again later.' },
    keyGenerator: (req: any) => `${req.ip}_${req.params.token}` // Limit per IP + Token
});

// Throttling for public views
export const shareViewLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 30, // 30 views per minute
    message: { success: false, error: 'Too many views. Please slow down.' }
});

// Throttling for downloads
export const shareDownloadLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 10, // 10 downloads per 5 minutes
    message: { success: false, error: 'Download limit reached. Please try again in 5 minutes.' }
});
