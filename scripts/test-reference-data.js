'use strict';

const assert = require('assert');
const { WORKFLOW_ACTIONS, seedWorkflowActions } = require('../db/reference-data');

async function main() {
  let findCalls = 0;
  const configuredDb = {
    WorkflowAction: {
      count: async () => 10,
      findOrCreate: async () => {
        findCalls += 1;
        throw new Error('Existing workflow configuration must not be seeded.');
      }
    }
  };
  const preserved = await seedWorkflowActions(configuredDb, {});
  assert.deepStrictEqual(preserved, { created: 0, preserved: 10 });
  assert.strictEqual(findCalls, 0);

  const createdNames = [];
  const emptyDb = {
    WorkflowAction: {
      count: async () => 0,
      findOrCreate: async ({ where }) => {
        createdNames.push(where.name);
        return [{ name: where.name }, true];
      }
    }
  };
  const seeded = await seedWorkflowActions(emptyDb, {});
  assert.deepStrictEqual(seeded, { created: WORKFLOW_ACTIONS.length, preserved: 0 });
  assert.deepStrictEqual(createdNames, WORKFLOW_ACTIONS.map(([name]) => name));

  console.log('PASS reference seeding preserves configured workflows and initializes only empty databases.');
}

main().catch((error) => {
  console.error('FAIL reference-data regression');
  console.error(error);
  process.exitCode = 1;
});
