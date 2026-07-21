'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { assertSafeCopyTarget } = require('./data-sanitizer');

async function restoreDump(db, options = {}) {
  assertSafeCopyTarget(db, options.confirmDatabase);
  const dumpPath = path.resolve(String(options.dumpPath || ''));
  if (!dumpPath || !fs.existsSync(dumpPath) || !fs.statSync(dumpPath).isFile()) {
    throw new Error(`Dump file not found: ${dumpPath || '(missing)'}`);
  }

  const config = db.sequelize.config;
  const customFormat = isCustomFormatDump(dumpPath);
  const tool = findPgTool(customFormat ? 'pg_restore' : 'psql');
  preflightDump(tool, dumpPath, customFormat);

  await db.sequelize.authenticate();
  await db.sequelize.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const common = [
    '--host', String(config.host || '127.0.0.1'),
    '--port', String(config.port || 5432),
    '--username', String(config.username),
    '--dbname', String(config.database)
  ];
  const args = customFormat
    ? [
        ...common,
        '--clean',
        '--if-exists',
        '--no-owner',
        '--no-privileges',
        '--exit-on-error',
        dumpPath
      ]
    : [
        ...common,
        '--set', 'ON_ERROR_STOP=1',
        '--file', dumpPath
      ];

  console.log(`[DB] Restoring ${customFormat ? 'custom-format' : 'plain SQL'} dump into confirmed copy ${config.database}.`);
  const result = spawnSync(tool, args, {
    stdio: 'inherit',
    env: { ...process.env, PGPASSWORD: config.password || '' }
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(tool)} exited with code ${result.status}.`);
  return { dumpPath, format: customFormat ? 'custom' : 'plain', tool };
}

function preflightDump(tool, dumpPath, customFormat) {
  if (!customFormat) {
    if (fs.statSync(dumpPath).size === 0) throw new Error(`Dump file is empty: ${dumpPath}`);
    return;
  }

  const result = spawnSync(tool, ['--list', dumpPath], {
    stdio: 'ignore',
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${path.basename(tool)} could not read the custom-format dump; target was not changed.`);
  }
}

function isCustomFormatDump(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(5);
    fs.readSync(fd, header, 0, header.length, 0);
    return header.toString('ascii') === 'PGDMP';
  } finally {
    fs.closeSync(fd);
  }
}

function findPgTool(name) {
  const executable = process.platform === 'win32' ? `${name}.exe` : name;
  if (process.env.PGBIN) {
    const explicit = path.join(process.env.PGBIN, executable);
    if (fs.existsSync(explicit)) return explicit;
  }

  const lookup = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [executable], {
    encoding: 'utf8',
    windowsHide: true
  });
  const resolved = String(lookup.stdout || '').trim().split(/\r?\n/)[0];
  if (lookup.status === 0 && resolved) return resolved;
  throw new Error(`${executable} was not found. Install PostgreSQL client tools or set PGBIN.`);
}

module.exports = { restoreDump, isCustomFormatDump, findPgTool, preflightDump };
