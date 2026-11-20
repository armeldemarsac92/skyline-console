// SPDX-License-Identifier: Apache-2.0
import { templateFlavor } from 'resources/magnum/lifecycle';
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
  expect(templateFlavor(selection, 'k8s_capi_helm_v1')).toBe('m1.compute');
  expect(templateFlavor(selection, '', 'flavor-id')).toBe('flavor-id');
  expect(templateFlavor(selection, 'other_driver')).toBe('flavor-id');
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
