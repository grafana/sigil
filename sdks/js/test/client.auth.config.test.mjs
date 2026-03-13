import assert from 'node:assert/strict';
import test from 'node:test';
import { SigilClient } from '../.test-dist/index.js';

test('invalid generation auth config throws at client init', () => {
  assert.throws(
    () =>
      new SigilClient({
        generationExport: {
          auth: {
            mode: 'tenant',
          },
        },
      }),
    /requires tenantId/
  );
});

test('basic auth mode injects Authorization and X-Scope-OrgID headers', () => {
  const client = new SigilClient({
    generationExport: {
      auth: {
        mode: 'basic',
        tenantId: '42',
        basicPassword: 'secret',
      },
    },
  });

  const expected = 'Basic ' + btoa('42:secret');
  assert.equal(client.config.generationExport.headers?.['Authorization'], expected);
  assert.equal(client.config.generationExport.headers?.['X-Scope-OrgID'], '42');
  client.shutdown();
});

test('basic auth mode uses basicUser over tenantId for credential', () => {
  const client = new SigilClient({
    generationExport: {
      auth: {
        mode: 'basic',
        tenantId: '42',
        basicUser: 'probe-user',
        basicPassword: 'secret',
      },
    },
  });

  const expected = 'Basic ' + btoa('probe-user:secret');
  assert.equal(client.config.generationExport.headers?.['Authorization'], expected);
  assert.equal(client.config.generationExport.headers?.['X-Scope-OrgID'], '42');
  client.shutdown();
});

test('basic auth mode requires basicPassword', () => {
  assert.throws(
    () =>
      new SigilClient({
        generationExport: {
          auth: {
            mode: 'basic',
            tenantId: '42',
          },
        },
      }),
    /requires basicPassword/
  );
});

test('basic auth mode requires basicUser or tenantId', () => {
  assert.throws(
    () =>
      new SigilClient({
        generationExport: {
          auth: {
            mode: 'basic',
            basicPassword: 'secret',
          },
        },
      }),
    /requires basicUser or tenantId/
  );
});

test('basic auth explicit headers win over auth-derived headers', () => {
  const client = new SigilClient({
    generationExport: {
      headers: {
        Authorization: 'Basic override',
        'X-Scope-OrgID': 'override-tenant',
      },
      auth: {
        mode: 'basic',
        tenantId: '42',
        basicPassword: 'secret',
      },
    },
  });

  assert.equal(client.config.generationExport.headers?.['Authorization'], 'Basic override');
  assert.equal(client.config.generationExport.headers?.['X-Scope-OrgID'], 'override-tenant');
  client.shutdown();
});
