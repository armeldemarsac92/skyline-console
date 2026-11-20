// SPDX-License-Identifier: Apache-2.0
import client from 'client';
import { ClustersStore } from 'stores/magnum/clusters';
import { buildClusterBody } from './lifecycle';
import { mockMagnum } from '../../../test/unit/magnum';

jest.mock('client', () => ({
  magnum: require('client/magnum').default,
  nova: {
    keypairs: { list: async () => ({ keypairs: [] }) },
    flavors: {
      list: async () => ({ flavors: [{ id: 'nova-id', name: 'compute' }] }),
    },
  },
  heat: {
    stacks: {
      list: jest.fn(async ({ id }) => ({
        stacks: [{ id, stack_name: 'legacy' }],
      })),
    },
  },
}));
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

it('keeps the Heat stack link for legacy clusters and treats the CAPI release name as a different resource', async () => {
  const http = mockMagnum(({ path }) => {
    if (path === '/v1/clustertemplates/heat')
      return { data: { driver: 'k8s_fedora_coreos_v1' } };
    if (path === '/v1/clustertemplates/capi')
      return { data: { driver: 'k8s_capi_helm_v1' } };
    return null;
  });
  try {
    const store = new ClustersStore();
    const heat = await store.detailDidFetch({
      cluster_template_id: 'heat',
      stack_id: 'stack-uuid',
    });
    const capi = await store.detailDidFetch({
      cluster_template_id: 'capi',
      stack_id: 'helm-release',
      flavor_id: 'compute',
    });
    expect(heat.stack.id).toBe('stack-uuid');
    expect(capi.stack).toBeUndefined();
    expect(capi.flavor?.id).toBe('nova-id');
    expect(client.heat.stacks.list).toHaveBeenCalledTimes(1);
  } finally {
    http.restore();
  }
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

it('creates a CAPI cluster with zero manual workers using microversion 1.10', async () => {
  const http = mockMagnum(
    ({ method, path }) =>
      method === 'POST' &&
      path === '/v1/clusters' && { status: 202, data: { uuid: 'empty' } }
  );
  try {
    const template = {
      driver: 'k8s_capi_helm_v1',
      labels: { auto_scaling_enabled: 'true' },
    };
    const form = {
      node_count: 0,
      clusterTemplate: { selectedRowKeys: ['tmpl'], selectedRows: [template] },
    };
    expect(() => buildClusterBody(form)).toThrow();
    const body = buildClusterBody({ ...form, auto_scaling_enabled: 'false' });
    await new ClustersStore().create(body);
    expect(http.requests[0]).toMatchObject({
      body: { node_count: 0 },
      headers: { 'OpenStack-API-Version': 'container-infra 1.10' },
    });
  } finally {
    http.restore();
  }
});
