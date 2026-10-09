const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http');
const { drainRequestsThenCloseDatabase } = require('../../dist/utils/shutdown');

test('deployment shutdown lets an in-flight response finish before closing its database', async () => {
    let release, started;
    const requestStarted = new Promise(resolve => { started = resolve; });
    const events = [];
    const server = http.createServer((_req, res) => {
        release = () => res.end('acknowledged');
        res.on('finish', () => events.push('response-finished'));
        started();
    });
    server.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const response = fetch(`http://127.0.0.1:${server.address().port}/upload-test`);
    await requestStarted;
    const drained = drainRequestsThenCloseDatabase(server, async () => { events.push('database-closed'); });
    assert.deepEqual(events, []);
    release();
    assert.equal(await (await response).text(), 'acknowledged');
    await drained;
    assert.deepEqual(events, ['response-finished', 'database-closed']);
});
