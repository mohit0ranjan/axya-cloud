function backendOrigin(env = process.env) {
    const raw = (env.AXYA_API_URL || '').trim();
    if (!raw && env.NODE_ENV === 'production') throw new Error('AXYA_API_URL is required at production build time.');
    let url;
    try { url = new URL(raw || 'http://localhost:3000'); }
    catch { throw new Error('AXYA_API_URL must be an HTTP(S) origin.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
        throw new Error('AXYA_API_URL must be an HTTP(S) origin without credentials, paths or query parameters.');
    }
    if (env.RENDER === 'true' && (url.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(url.hostname))) {
        throw new Error('Render requires a public HTTPS AXYA_API_URL.');
    }
    const browserApi = env.NEXT_PUBLIC_API_URL || env.NEXT_PUBLIC_API_BASE;
    if (env.NODE_ENV === 'production' && browserApi && browserApi !== '/backend') {
        throw new Error('NEXT_PUBLIC_API_URL must be /backend for production cookie authentication.');
    }
    return url.origin;
}
module.exports = { backendOrigin };
