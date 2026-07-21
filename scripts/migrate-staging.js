'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { prepareStagingEnv, printSummary } = require('./lib/staging-env');

try {
    const config = prepareStagingEnv();
    printSummary(config);
    console.log('Applying pending Sequelize migrations to the verified staging database.');

    const cli = path.resolve(__dirname, '..', 'node_modules', 'sequelize-cli', 'lib', 'sequelize');
    const result = spawnSync(process.execPath, [cli, 'db:migrate', '--env', 'production'], {
        cwd: path.resolve(__dirname, '..'),
        env: process.env,
        encoding: 'utf8',
        windowsHide: true
    });

    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('sequelize-cli exited with code ' + result.status + '.');

    console.log('Staging migrations completed successfully.');
} catch (err) {
    console.error('[staging:migrate] ' + err.message);
    process.exit(1);
}
