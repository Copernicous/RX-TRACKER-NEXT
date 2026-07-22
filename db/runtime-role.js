'use strict';

const { Sequelize } = require('sequelize');
const { inspectDatabase } = require('./schema-verifier');

const ROLE_PATTERN = /^[a-z][a-z0-9_]{2,62}$/;

async function configureRuntimeRole(db, options = {}) {
  const sequelize = db.sequelize;
  const database = sequelize.config.database;
  const role = String(options.role || '').trim();
  const password = String(options.password || '');
  const confirmDatabase = String(options.confirmDatabase || '').trim();

  if (confirmDatabase !== database) {
    throw new Error(`Runtime-role configuration requires --confirm-database ${database}.`);
  }
  if (!ROLE_PATTERN.test(role)) {
    throw new Error('Runtime role must start with a lowercase letter and contain only lowercase letters, numbers, or underscores.');
  }
  if (password.length < 20) {
    throw new Error('Runtime role password must contain at least 20 characters.');
  }
  if (role === sequelize.config.username) {
    throw new Error('Runtime role must be different from the database maintenance user.');
  }

  const quotedRole = quoteIdentifier(role);
  const quotedDatabase = quoteIdentifier(database);
  const transaction = await sequelize.transaction();

  try {
    const [existingRows] = await sequelize.query(`
      SELECT r.oid,
             r.rolsuper,
             r.rolcreatedb,
             r.rolcreaterole,
             (SELECT COUNT(*)::integer FROM pg_auth_members m
               WHERE m.member = r.oid OR m.roleid = r.oid) AS membership_count,
             (SELECT COUNT(*)::integer FROM pg_class c WHERE c.relowner = r.oid) AS owned_relation_count,
             (SELECT COUNT(*)::integer FROM pg_database d WHERE d.datdba = r.oid) AS owned_database_count
        FROM pg_roles r
       WHERE r.rolname = :role
    `, { replacements: { role }, transaction });

    if (existingRows.length) {
      const existing = existingRows[0];
      if (Number(existing.membership_count) > 0 ||
          Number(existing.owned_relation_count) > 0 ||
          Number(existing.owned_database_count) > 0) {
        throw new Error('Existing runtime role owns database objects or participates in role memberships; refusing to repurpose it.');
      }
      await sequelize.query(`
        ALTER ROLE ${quotedRole}
          WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
               NOREPLICATION NOBYPASSRLS PASSWORD :password
      `, { replacements: { password }, transaction });
    } else {
      await sequelize.query(`
        CREATE ROLE ${quotedRole}
          WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
               NOREPLICATION NOBYPASSRLS PASSWORD :password
      `, { replacements: { password }, transaction });
    }

    // PostgreSQL grants are additive. Remove PUBLIC schema creation so the
    // runtime role cannot regain DDL through the implicit PUBLIC role.
    await sequelize.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC', { transaction });
    await sequelize.query(`REVOKE ALL PRIVILEGES ON DATABASE ${quotedDatabase} FROM ${quotedRole}`, { transaction });
    await sequelize.query(`GRANT CONNECT ON DATABASE ${quotedDatabase} TO ${quotedRole}`, { transaction });
    await sequelize.query(`REVOKE ALL PRIVILEGES ON SCHEMA public FROM ${quotedRole}`, { transaction });
    await sequelize.query(`GRANT USAGE ON SCHEMA public TO ${quotedRole}`, { transaction });
    await sequelize.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${quotedRole}`, { transaction });
    await sequelize.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${quotedRole}`, { transaction });

    // Lifecycle metadata is readable during startup but writable only by the
    // maintenance identity used by rx-db and Project Control.
    const [ledgerRows] = await sequelize.query("SELECT to_regclass('public.\"SequelizeMeta\"') AS relation", { transaction });
    if (ledgerRows[0] && ledgerRows[0].relation) {
      await sequelize.query(`
        REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
          ON TABLE "SequelizeMeta" FROM ${quotedRole}
      `, { transaction });
      await sequelize.query(`GRANT SELECT ON TABLE "SequelizeMeta" TO ${quotedRole}`, { transaction });
    }

    // Migrations run as the maintenance identity. These default privileges
    // keep later application tables usable without making the runtime role an
    // owner or granting schema creation.
    await sequelize.query(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${quotedRole}
    `, { transaction });
    await sequelize.query(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO ${quotedRole}
    `, { transaction });

    await transaction.commit();
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    throw error;
  }

  return inspectRuntimeRole(db, role);
}

async function inspectRuntimeRole(db, roleValue) {
  const sequelize = db.sequelize;
  const database = sequelize.config.database;
  const role = String(roleValue || '').trim();
  if (!ROLE_PATTERN.test(role)) throw new Error('Invalid runtime role name.');

  const [roleRows] = await sequelize.query(`
    SELECT r.oid,
           r.rolcanlogin,
           r.rolsuper,
           r.rolcreatedb,
           r.rolcreaterole,
           r.rolinherit,
           r.rolreplication,
           r.rolbypassrls,
           has_database_privilege(r.rolname, :database, 'CONNECT') AS can_connect,
           has_database_privilege(r.rolname, :database, 'CREATE') AS can_create_database_objects,
           has_schema_privilege(r.rolname, 'public', 'USAGE') AS has_schema_usage,
           has_schema_privilege(r.rolname, 'public', 'CREATE') AS can_create_schema_objects,
           (SELECT COUNT(*)::integer FROM pg_auth_members m
             WHERE m.member = r.oid OR m.roleid = r.oid) AS membership_count,
           (SELECT COUNT(*)::integer FROM pg_class c WHERE c.relowner = r.oid) AS owned_relation_count,
           (SELECT COUNT(*)::integer FROM pg_database d WHERE d.datdba = r.oid) AS owned_database_count
      FROM pg_roles r
     WHERE r.rolname = :role
  `, { replacements: { role, database } });

  if (!roleRows.length) {
    return { ok: false, role, database, errors: ['runtime role does not exist'] };
  }

  const [tableRows] = await sequelize.query(`
    SELECT COUNT(*)::integer AS table_count,
           COUNT(*) FILTER (WHERE NOT has_table_privilege(:role, c.oid, 'SELECT'))::integer AS missing_select,
           COUNT(*) FILTER (
             WHERE c.relname <> 'SequelizeMeta'
               AND NOT (
                 has_table_privilege(:role, c.oid, 'INSERT')
                 AND has_table_privilege(:role, c.oid, 'UPDATE')
                 AND has_table_privilege(:role, c.oid, 'DELETE')
               )
           )::integer AS missing_business_write
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
  `, { replacements: { role } });

  const [sequenceRows] = await sequelize.query(`
    SELECT COUNT(*)::integer AS sequence_count,
           COUNT(*) FILTER (WHERE NOT has_sequence_privilege(:role, c.oid, 'USAGE'))::integer AS missing_usage
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'S'
  `, { replacements: { role } });

  const [ledgerRows] = await sequelize.query(`
    SELECT CASE WHEN to_regclass('public."SequelizeMeta"') IS NULL THEN false
                ELSE has_table_privilege(:role, 'public."SequelizeMeta"', 'SELECT') END AS can_read,
           CASE WHEN to_regclass('public."SequelizeMeta"') IS NULL THEN false
                ELSE (
                  has_table_privilege(:role, 'public."SequelizeMeta"', 'INSERT')
                  OR has_table_privilege(:role, 'public."SequelizeMeta"', 'UPDATE')
                  OR has_table_privilege(:role, 'public."SequelizeMeta"', 'DELETE')
                ) END AS can_write
  `, { replacements: { role } });

  const attributes = roleRows[0];
  const tables = tableRows[0];
  const sequences = sequenceRows[0];
  const ledger = ledgerRows[0];
  const errors = [];

  if (!attributes.rolcanlogin) errors.push('role cannot log in');
  if (attributes.rolsuper || attributes.rolcreatedb || attributes.rolcreaterole ||
      attributes.rolinherit || attributes.rolreplication || attributes.rolbypassrls) {
    errors.push('role has an administrative role attribute');
  }
  if (!attributes.can_connect) errors.push('role cannot connect to the target database');
  if (attributes.can_create_database_objects) errors.push('role can create database objects');
  if (!attributes.has_schema_usage) errors.push('role lacks public schema usage');
  if (attributes.can_create_schema_objects) errors.push('role can create public schema objects');
  if (Number(attributes.membership_count) !== 0) errors.push('role participates in role memberships');
  if (Number(attributes.owned_relation_count) !== 0 || Number(attributes.owned_database_count) !== 0) {
    errors.push('role owns database objects');
  }
  if (Number(tables.missing_select) !== 0) errors.push(`${tables.missing_select} table(s) lack SELECT`);
  if (Number(tables.missing_business_write) !== 0) errors.push(`${tables.missing_business_write} business table(s) lack write access`);
  if (Number(sequences.missing_usage) !== 0) errors.push(`${sequences.missing_usage} sequence(s) lack USAGE`);
  if (!ledger.can_read) errors.push('role cannot read migration history');
  if (ledger.can_write) errors.push('role can modify migration history');

  return {
    ok: errors.length === 0,
    role,
    database,
    tableCount: Number(tables.table_count),
    sequenceCount: Number(sequences.sequence_count),
    errors
  };
}

async function verifyRuntimeConnection(db, options = {}) {
  const role = String(options.role || '').trim();
  const password = String(options.password || '');
  if (!ROLE_PATTERN.test(role)) throw new Error('Invalid runtime role name.');
  if (!password) throw new Error('Runtime role password is required.');

  const adminConfig = db.sequelize.config;
  const runtimeSequelize = new Sequelize(
    adminConfig.database,
    role,
    password,
    {
      host: adminConfig.host,
      port: adminConfig.port,
      dialect: 'postgres',
      logging: false
    }
  );

  const runtimeDb = { ...db, sequelize: runtimeSequelize };
  try {
    await runtimeSequelize.authenticate();
    const schema = await inspectDatabase(runtimeDb);
    if (!schema.ok) throw new Error(`Runtime schema verification failed: ${schema.errors.join('; ')}`);

    await runtimeSequelize.query('BEGIN');
    try {
      await runtimeSequelize.query('SELECT COUNT(*) FROM "Patients"');
      await runtimeSequelize.query('UPDATE "SystemSettings" SET "updatedAt" = "updatedAt" WHERE false');

      let ledgerWriteRejected = false;
      try {
        await runtimeSequelize.query('SAVEPOINT runtime_ledger_write');
        await runtimeSequelize.query('UPDATE "SequelizeMeta" SET "name" = "name" WHERE false');
      } catch (error) {
        ledgerWriteRejected = permissionDenied(error);
        await runtimeSequelize.query('ROLLBACK TO SAVEPOINT runtime_ledger_write');
      }
      if (!ledgerWriteRejected) throw new Error('Runtime role unexpectedly modified migration history.');

      let ddlRejected = false;
      try {
        await runtimeSequelize.query('SAVEPOINT runtime_ddl');
        await runtimeSequelize.query('CREATE TABLE public.rx_runtime_forbidden_probe (id integer)');
      } catch (error) {
        ddlRejected = permissionDenied(error);
        await runtimeSequelize.query('ROLLBACK TO SAVEPOINT runtime_ddl');
      }
      if (!ddlRejected) throw new Error('Runtime role unexpectedly created a persistent table.');
    } finally {
      await runtimeSequelize.query('ROLLBACK').catch(() => {});
    }

    return { ok: true, role, database: adminConfig.database, schema };
  } finally {
    await runtimeSequelize.close().catch(() => {});
  }
}

function permissionDenied(error) {
  const code = error?.original?.code || error?.parent?.code || error?.code;
  return code === '42501';
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

module.exports = {
  ROLE_PATTERN,
  configureRuntimeRole,
  inspectRuntimeRole,
  verifyRuntimeConnection
};
