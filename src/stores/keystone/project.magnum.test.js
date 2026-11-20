import globalRootStore from 'stores/root';
import { ProjectStore } from './project';
import { MagnumQuotaStore } from '../magnum/quota';
import { mockMagnum } from '../../../test/unit/magnum';

jest.mock('resources/magnum/capabilities', () => ({
  hasMagnumPolicy: jest.fn(() => true),
}));

class ProjectQuotaStore extends ProjectStore {
  get novaQuotaClient() {
    return {
      detail: async () => ({ quota_set: { instances: { limit: 8 } } }),
    };
  }

  get neutronQuotaClient() {
    return { details: async () => ({ quota: { network: { limit: 4 } } }) };
  }
}

let magnum;
let store;

beforeEach(() => {
  jest
    .spyOn(globalRootStore, 'checkEndpoint')
    .mockImplementation((service) => service === 'magnum');
  store = new ProjectQuotaStore();
});

afterEach(() => {
  magnum?.restore();
  jest.restoreAllMocks();
});

it('uses each selected project for the limit and both consumption counters', async () => {
  const projects = {
    first: { id: 11, hard_limit: 6, clusters: 2, nodes: 7 },
    second: { id: 12, hard_limit: 0, clusters: 0, nodes: 0 },
  };
  let releaseFirst;
  const firstStats = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  magnum = mockMagnum(async ({ path, params }) => {
    if (path === '/v1/stats') {
      const { clusters, nodes } = projects[params.project_id];
      if (params.project_id === 'first') {
        await firstStats;
      }
      return { status: 200, data: { clusters, nodes } };
    }
    const [, , , projectId] = path.split('/');
    const { id, hard_limit } = projects[projectId];
    return { status: 200, data: { id, hard_limit } };
  });

  const pending = store.fetchProjectQuota({ project_id: 'first' });
  const second = await store.fetchProjectQuota({ project_id: 'second' });
  releaseFirst();
  const first = await pending;

  expect(first.magnum_cluster).toMatchObject({ limit: 6, used: 2, left: 4 });
  expect(first.magnum_nodes).toBe(7);
  expect(second.magnum_cluster).toMatchObject({ limit: 0, used: 0, left: 0 });
  expect(second.magnum_nodes).toBe(0);
  expect(store.quota.magnum_cluster_id).toBe(12);
});

it.each([403, 404])(
  'retains all quota limits if stats returns %s',
  async (status) => {
    magnum = mockMagnum(({ path }) =>
      path === '/v1/stats'
        ? { status, data: {} }
        : { status: 200, data: { hard_limit: 7 } }
    );

    const quota = await store.fetchProjectQuota({ project_id: 'first' });

    expect(quota.instances.limit).toBe(8);
    expect(quota.network.limit).toBe(4);
    expect(quota.magnum_cluster).toEqual({ limit: 7, left: null });
    expect(quota.magnum_nodes).toBeUndefined();
    expect(quota.magnum_stats_error).toBe(status);
  }
);

it('lists explicit quotas across pages and reads the server default after deletion', async () => {
  let hasOverride = true;
  magnum = mockMagnum(({ method, path, params }) => {
    if (path === '/v1/quotas') {
      return params.marker
        ? { status: 200, data: { quotas: [{ id: 12, project_id: 'second' }] } }
        : {
            status: 200,
            data: {
              quotas: [{ id: 11, project_id: 'first', hard_limit: 0 }],
              next: '/v1/quotas?marker=11',
            },
          };
    }
    if (method === 'DELETE') {
      hasOverride = false;
      return { status: 204 };
    }
    if (path === '/v1/stats') {
      return { status: 200, data: { clusters: 2, nodes: 5 } };
    }
    return {
      status: 200,
      data: hasOverride ? { id: 11, hard_limit: 0 } : { hard_limit: 9 },
    };
  });
  const quotaStore = new MagnumQuotaStore();
  expect(await quotaStore.requestListAll()).toEqual([
    { id: 11, project_id: 'first', hard_limit: 0 },
    { id: 12, project_id: 'second' },
  ]);
  expect(magnum.requests.map(({ params }) => params)).toEqual([
    expect.objectContaining({ all_tenants: true }),
    expect.objectContaining({ all_tenants: true, marker: '11' }),
  ]);
  await store.fetchProjectMagnumQuota('first');
  await store.resetProjectMagnumQuota('first');
  expect(store.magnumQuota.magnum_cluster).toMatchObject({
    limit: 9,
    used: 2,
    left: 7,
  });
  expect(store.magnumQuota.magnum_cluster_id).toBeUndefined();
  expect(magnum.requests.slice(-2)).toEqual([
    expect.objectContaining({
      method: 'DELETE',
      path: '/v1/quotas/first/Cluster',
    }),
    expect.objectContaining({
      method: 'GET',
      path: '/v1/quotas/first/Cluster',
    }),
  ]);
});
