'use strict';

require('dotenv').config();

const assert = require('assert');
const db = require('../models');
const manifest = require('../db/migration-manifest');
const { getStatus, migrate } = require('../db/migration-runner');
const { assertDatabaseReady } = require('../db/schema-verifier');

async function main() {
  const database = String(db.sequelize.config.database || '');
  if (!/(ledger.*test|test.*ledger)/i.test(database)) {
    throw new Error(`Refusing checksum regression on ${database}; use a dedicated ledger test database.`);
  }

  await migrate(db.sequelize);
  const initial = await getStatus(db.sequelize);
  assert.strictEqual(initial.ledgerReady, true);
  assert.strictEqual(initial.checksumMismatches.length, 0);

  const target = manifest[0];
  const invalidChecksum = '0'.repeat(64);
  assert.notStrictEqual(target.checksum, invalidChecksum);

  try {
    await db.sequelize.query(`
      UPDATE "SequelizeMeta"
         SET "checksum" = :checksum
       WHERE "name" = :name
    `, { replacements: { name: target.name, checksum: invalidChecksum } });

    const tampered = await getStatus(db.sequelize);
    assert.strictEqual(tampered.ledgerReady, false);
    assert.deepStrictEqual(tampered.checksumMismatches.map((item) => item.name), [target.name]);

    await assert.rejects(
      () => assertDatabaseReady(db),
      (error) => error && error.code === 'RX_DATABASE_NOT_READY' && /checksum mismatch/i.test(error.message)
    );
    await assert.rejects(
      () => migrate(db.sequelize),
      /checksum drift/i
    );
  } finally {
    await db.sequelize.query(`
      UPDATE "SequelizeMeta"
         SET "checksum" = :checksum
       WHERE "name" = :name
    `, { replacements: { name: target.name, checksum: target.checksum } });
  }

  const restored = await getStatus(db.sequelize);
  assert.strictEqual(restored.ledgerReady, true);
  assert.strictEqual(restored.checksumMismatches.length, 0);
  console.log('PASS migration checksum drift blocks startup and further migrations.');
}

main()
  .catch((error) => {
    console.error('FAIL migration checksum regression');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.sequelize.close().catch(() => {});
  });
