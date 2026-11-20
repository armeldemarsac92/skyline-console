// SPDX-License-Identifier: Apache-2.0
import { buildClusterBody } from './lifecycle';
import { ClustersStore } from 'stores/magnum/clusters';
import { mockMagnum } from '../../../test/unit/magnum';

jest.mock('client', () => ({ magnum: require('client/magnum').default }));
jest.mock('stores/root', () => ({
  __esModule: true,
  default: { endpoints: { magnum: '/proxy/magnum' } },
}));

it('inherits template management settings and sends explicit overrides alongside the selected flavor name', () => {
  const form = {
    name: 'science',
    clusterTemplate: { selectedRowKeys: ['tmpl'] },
    flavor: { selectedRows: [{ name: 'compute' }] },
    newNetwork: true,
  };
  const inherited = buildClusterBody(form);
  expect(inherited.labels).toBeUndefined();
  expect(inherited.flavor_id).toBe('compute');
  expect(
    buildClusterBody({
      ...form,
      labelMode: 'merge',
      auto_scaling_enabled: 'false',
      additionalLabels: [{ value: { key: 'team', value: 'science' } }],
    })
  ).toMatchObject({
    merge_labels: true,
    labels: { team: 'science', auto_scaling_enabled: 'false' },
  });
});

it('submits a global Kubernetes upgrade with only the model UUID and the supported microversion', async () => {
  const http = mockMagnum(
    ({ method, path }) =>
      method === 'POST' &&
      path === '/v1/clusters/cluster-id/actions/upgrade' && {
        status: 202,
        data: { uuid: 'cluster-id' },
      }
  );
  try {
    await new ClustersStore().upgrade(
      { id: 'cluster-id' },
      { cluster_template: 'target-id' }
    );
    expect(http.requests[0]).toMatchObject({
      headers: { 'OpenStack-API-Version': 'container-infra 1.8' },
      body: { cluster_template: 'target-id' },
    });
  } finally {
    http.restore();
  }
});
