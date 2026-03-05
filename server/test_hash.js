const crypto = require('crypto');

const SHARE_PASSWORD_SCHEME = 'sha256';

const getSharePasswordPepper = () => 'axya_share_password_pepper';

const hashSharePassword = (password) => {
    const digest = crypto
        .createHash('sha256')
        .update(`${getSharePasswordPepper()}|${password}`, 'utf8')
        .digest('hex');
    return `${SHARE_PASSWORD_SCHEME}:${digest}`;
};

const verifySharePasswordHash = async (password, storedHash) => {
    if (!storedHash) return false;

    // New scheme: sha256:<hex>
    if (storedHash.startsWith(`${SHARE_PASSWORD_SCHEME}:`)) {
        const expected = hashSharePassword(password);
        const a = Buffer.from(storedHash, 'utf8');
        const b = Buffer.from(expected, 'utf8');
        if (a.length !== b.length) return false;
        return crypto.timingSafeEqual(a, b);
    }

    return false;
};

(async () => {
    try {
        const hash = hashSharePassword('my_password');
        console.log("Hash:", hash);
        const isValid = await verifySharePasswordHash('my_password', hash);
        console.log("IsValid:", isValid);
        const isInvalid = await verifySharePasswordHash('wrong', hash);
        console.log("IsInvalid:", isInvalid);
    } catch (e) {
        console.error("Error:", e);
    }
})();
