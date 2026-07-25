'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { prepareStagingEnv, printSummary } = require('./lib/staging-env');

try {
    const config = prepareStagingEnv();
    printSummary(config);
    console.log('Applying pending audited NEXT migrations to the verified staging database.');

    const lifecycle = path.resolve(__dirname, 'db-lifecycle.js');
    const result = spawnSync(process.execPath, [lifecycle, 'migrate'], {
        cwd: path.resolve(__dirname, '..'),
        env: process.env,
        encoding: 'utf8',
        windowsHide: true
    });

    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('NEXT database lifecycle exited with code ' + result.status + '.');

    console.log('Staging migrations completed successfully.');
} catch (err) {
    console.error('[staging:migrate] ' + err.message);
    process.exit(1);
}
