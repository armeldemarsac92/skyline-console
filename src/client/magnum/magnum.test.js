// SPDX-License-Identifier: Apache-2.0
import root from 'stores/root';
import { mockMagnum } from '../../../test/unit/magnum';
import { MagnumClient, listAll } from './index';

jest.mock('stores/root', () => ({
  __esModule: true,
  default: {
    endpoints: { magnum: '/proxy/region-a/magnum/v1' },
    selectedRegion: 'RegionOne',
  },
}));

let http;
afterEach(() => http.restore());

it('discovers the version at the catalogue prefix and pages through a cluster’s worker pools', async () => {
  const client = new MagnumClient();
  http = mockMagnum(({ path, params }) => {
    if (path === '/')
      return {
        data: {
          versions: [{ id: 'v1', min_version: '1.1', max_version: '1.14' }],
        },
      };
    if (path === '/v1/clusters/c/nodegroups') {
      return {
        data: params.marker
          ? { nodegroups: [{ uuid: 'b' }] }
          : {
              nodegroups: [{ uuid: 'a' }],
              next: 'https://catalog.invalid/v1/clusters/c/nodegroups?marker=a&limit=1',
            },
      };
    }
    return null;
  });
  expect(await client.supportsVersion('1.9')).toBe(true);
  expect(await client.supportsVersion('1.15')).toBe(false);
  const workers = await listAll(
    (params) =>
      client.clusters.nodegroups.list(
        'c',
        params,
        client.versionOptions('1.9')
      ),
    'nodegroups',
    { role: 'worker' }
  );
  expect(workers.map((item) => item.uuid)).toEqual(['a', 'b']);
  expect(http.requests.map((r) => r.url)).toEqual([
    '/proxy/region-a/magnum/',
    '/proxy/region-a/magnum/v1/clusters/c/nodegroups',
    '/proxy/region-a/magnum/v1/clusters/c/nodegroups',
  ]);
  expect(http.requests[2]).toMatchObject({
    params: { role: 'worker', marker: 'a' },
    headers: { 'OpenStack-API-Version': 'container-infra 1.9' },
  });
});

it('discovers afresh when the active region changes even if the proxy path is shared', async () => {
  const client = new MagnumClient();
  http = mockMagnum(() => ({
    data: {
      versions: [
        {
          id: 'v1',
          min_version: '1.1',
          max_version: root.selectedRegion === 'RegionOne' ? '1.8' : '1.14',
        },
      ],
    },
  }));
  expect(await client.supportsVersion('1.9')).toBe(false);
  root.selectedRegion = 'RegionTwo';
  expect(await client.supportsVersion('1.9')).toBe(true);
  expect(http.requests).toHaveLength(2);
});
