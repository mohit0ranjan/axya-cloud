const express = require('express');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(express.json());

const sharePasswordLimiter = rateLimit.rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { success: false, error: 'Too many password attempts. Please try again later.' },
    keyGenerator: (req) => `${rateLimit.ipKeyGenerator(req.ip)}_${req.params.token}`
});

app.post('/share/:token', sharePasswordLimiter, (req, res) => {
    res.json({ success: true });
});

app.use((err, req, res, next) => {
    console.error("APP ERROR:", err);
    res.status(500).json({ error: err.message });
});

const server = app.listen(3002, async () => {
    try {
        console.log("Fetching...");
        const res = await fetch('http://localhost:3002/share/123', { method: 'POST' });
        console.log("Status:", res.status);
        const text = await res.text();
        console.log("Body:", text);
    } catch (e) {
        console.error("Fetch Error:", e);
    }
    server.close();
});
