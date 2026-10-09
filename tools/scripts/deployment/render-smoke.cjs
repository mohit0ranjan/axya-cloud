// Read-only smoke check. This never logs in, uploads files or changes production data.
async function smoke(api, web, request = fetch) {
    const checks = [
        ['API liveness', `${api}/health`, response => response.ok, body => body.readyForUploads === true],
        ['API readiness', `${api}/readyz`, response => response.status === 200, body => body.readyForUploads === true && body.checks?.db === 'ok'],
        ['Web home', `${web}/`, response => response.ok && /text\/html/.test(response.headers.get('content-type') || ''), null],
        ['Web API proxy readiness', `${web}/backend/readyz`, response => response.status === 200, body => body.readyForUploads === true && body.checks?.db === 'ok'],
        ['Production diagnostics hidden', `${web}/test/upload`, response => response.status === 404, null],
    ];
    return Promise.all(checks.map(async ([name, url, status, bodyCheck]) => {
        try {
            const response = await request(url, { signal: AbortSignal.timeout(10000), redirect: 'manual' });
            let ok = status(response);
            if (ok && bodyCheck) ok = bodyCheck(await response.json());
            else await response.arrayBuffer();
            return { name, ok, status: response.status };
        } catch { return { name, ok: false, status: 'connection/timeout/invalid-response' }; }
    }));
}
function origin(raw) {
    const url = new URL(raw);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
        throw new Error('Use public HTTPS origins, or localhost HTTP for local checks. Never pass secrets.');
    }
    return url.origin;
}
async function main() {
    const args = process.argv.slice(2);
    if (args.length !== 4 || args[0] !== '--api' || args[2] !== '--web') {
        console.error('Usage: npm run deploy:smoke -- --api https://YOUR-API --web https://YOUR-WEB');
        process.exitCode = 1; return;
    }
    try {
        const checks = await smoke(origin(args[1]), origin(args[3]));
        for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name} (${check.status})`);
        process.exitCode = checks.every(check => check.ok) ? 0 : 1;
    } catch { console.error('Invalid origins. Supply origins only, without credentials or query parameters.'); process.exitCode = 1; }
}
module.exports = { smoke, origin };
if (require.main === module) void main();
