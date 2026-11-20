// SPDX-License-Identifier: Apache-2.0
import { templateFlavor } from 'resources/magnum/template';
import { ClusterTemplatesStore } from './clusterTemplates';
import { mockMagnum } from '../../../test/unit/magnum';

jest.mock('client', () => ({ magnum: require('client/magnum').default }));
jest.mock('stores/root', () => ({
  __esModule: true,
  default: { endpoints: { magnum: '/api/magnum' } },
}));

it('sends a Nova flavor name to CAPI and preserves the stored flavor on an unrelated edit', () => {
  const selection = {
    selectedRowKeys: ['flavor-id'],
    selectedRows: [{ id: 'flavor-id', name: 'm1.compute' }],
  };
  expect(templateFlavor(selection, true)).toBe('m1.compute');
  expect(templateFlavor(selection, true, 'flavor-id')).toBe('flavor-id');
  expect(templateFlavor(selection, false)).toBe('flavor-id');
});

it('creates a Kubernetes template and updates a referenced template with a single tags patch', async () => {
  const store = new ClusterTemplatesStore();
  const http = mockMagnum(
    ({ path }) =>
      path.startsWith('/v1/clustertemplates') && { data: { uuid: 'model' } }
  );
  try {
    const old = {
      name: 'base',
      tags: 'old',
      labels: { team: 'science' },
      public: false,
    };
    await store.create({ name: 'base', image_id: 'image' });
    await store.update({ id: 'model', original: old }, { ...old, tags: 'new' });
    expect(http.requests.map(({ method, body }) => [method, body])).toEqual([
      ['POST', { name: 'base', image_id: 'image', coe: 'kubernetes' }],
      ['PATCH', [{ op: 'replace', path: '/tags', value: 'new' }]],
    ]);
  } finally {
    http.restore();
  }
});

it('encodes native booleans separately from text in Magnum label patches', async () => {
  const http = mockMagnum(() => ({ data: {} }));
  try {
    const store = new ClusterTemplatesStore();
    await store.update(
      { id: 'model', original: { labels: { enabled: true } } },
      { labels: { enabled: true, label: 'true', retries: 2 } }
    );
    expect(http.requests[0].body).toEqual([
      {
        path: '/labels',
        op: 'replace',
        value: '{"enabled":True,"label":"true","retries":2}',
      },
    ]);
  } finally {
    http.restore();
  }
});
