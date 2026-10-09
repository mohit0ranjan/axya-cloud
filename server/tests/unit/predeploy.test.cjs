const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../../scripts/predeploy.cjs'), 'utf8');
async function run(keyValid) {
    let migrations = 0, ended = false, logs = [], page = 0;
    const process = { exitCode: 0 };
    const pool = { query: async sql => sql.includes('to_regclass') ? { rows: [{ present: true }] } :
        { rows: page++ ? [] : [{ id: '00000000-0000-0000-0000-000000000001', session_string: 'private-test-ciphertext' }] },
        end: async () => { ended = true; } };
    const dependencies = {
        dotenv: { config() {} }, '../dist/utils/productionConfig': { assertProductionConfig() {} },
        '../dist/utils/sessionEncryption': { encryptSession() {}, isEncryptedSession: () => true,
            decryptSession() { if (!keyValid) throw new Error('private-test-key-failure'); } },
        '../dist/config/db': { default: pool }, '../dist/services/db.service': { initSchema: async () => { migrations++; } },
    };
    await vm.runInNewContext(source, { require: name => dependencies[name], process,
        console: { log: message => logs.push(message), error: message => logs.push(message) } });
    return { migrations, ended, logs, exitCode: process.exitCode };
}
test('wrong existing session key prevents migration without printing secrets', async () => {
    const result = await run(false);
    assert.equal(result.migrations, 0); assert.equal(result.exitCode, 1); assert.equal(result.ended, true);
    assert.ok(!result.logs.join('\n').includes('private-test'));
});
test('valid existing key permits migration and closes the database', async () => {
    const result = await run(true);
    assert.equal(result.migrations, 1); assert.equal(result.exitCode, 0); assert.equal(result.ended, true);
    assert.ok(result.logs.some(line => line.includes('1 encrypted')));
});
