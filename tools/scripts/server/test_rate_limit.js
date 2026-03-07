const { ipKeyGenerator } = require('express-rate-limit');
try {
    console.log("Calling ipKeyGenerator with req.ip");
    ipKeyGenerator("127.0.0.1");
} catch (e) {
    console.error("Crash:", e);
}
