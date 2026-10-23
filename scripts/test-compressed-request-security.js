'use strict';
// Exercise the compressed-body crash path in a disposable child process.
const assert = require('node:assert/strict');
const http = require('node:http');
const { fork } = require('node:child_process');
const zlib = require('node:zlib');
if (process.argv.includes('--fixture')) {
    const express = require('express');
    const app = express();
    app.use(require('body-parser').json());
    app.post('/', (req, res) => res.json(req.body));
    app.get('/health', (req, res) => res.end('ok'));
    app.use((err, req, res, next) => res.status(400).end('invalid body'));
    const server = app.listen(0, '127.0.0.1', () => process.send(server.address().port));
} else {
    const child = fork(__filename, ['--fixture'], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true });
    let errors = '';
    child.stderr.on('data', data => { errors += data; });
    const request = (port, body, encoding) => new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port, path: body ? '/' : '/health', method: body ? 'POST' : 'GET',
            headers: body ? { 'Content-Type': 'application/json', 'Content-Encoding': encoding, 'Content-Length': body.length } : {} }, res => {
            let text = ''; res.on('data', data => { text += data; });
            res.on('end', () => resolve({ status: res.statusCode, text }));
        });
        req.setTimeout(5000, () => req.destroy(new Error('Fixture request timed out')));
        req.on('error', reject); req.end(body);
    });
    (async () => {
        try {
            const port = await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Fixture startup timed out')), 5000);
                child.once('message', value => { clearTimeout(timer); resolve(value); });
                child.once('exit', () => { clearTimeout(timer); reject(new Error('Fixture exited before startup')); });
            });
            for (const [encoding, compress] of [['gzip', zlib.gzipSync], ['deflate', zlib.deflateSync]]) {
                const valid = compress(Buffer.from('{"synthetic":true}'));
                assert.equal((await request(port, valid, encoding)).status, 200);
                const malformed = Buffer.concat([valid, Buffer.from('invalid trailing compressed bytes')]);
                const response = await request(port, malformed, encoding);
                assert.ok([200, 400].includes(response.status));
                await new Promise(resolve => setTimeout(resolve, 150));
                assert.equal(child.exitCode, null, 'Compressed input crashed the server: ' + errors);
                assert.equal((await request(port)).text, 'ok');
            }
            console.log('PASS gzip/deflate valid and trailing-byte requests; server remains healthy.');
        } finally {
            if (child.exitCode === null) { child.kill(); await new Promise(resolve => child.once('exit', resolve)); }
        }
    })().catch(error => { console.error(error); process.exitCode = 1; });
}
