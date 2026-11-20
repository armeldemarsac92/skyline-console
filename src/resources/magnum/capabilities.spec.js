// SPDX-License-Identifier: Apache-2.0
import root from 'stores/root';
import client from 'client';
import { ClustersStore } from 'stores/magnum/clusters';
import { isCapiHelm } from './capabilities';

jest.mock('stores/root', () => ({
  __esModule: true,
  default: { selectedRegion: 'East' },
}));

const legacy = {
  driver: null,
  server_type: 'vm',
  cluster_distro: 'ubuntu',
  coe: 'kubernetes',
};
const capi = 'k8s_capi_helm_v1';
const heat = 'k8s_fedora_coreos_v1';
const bindings = (driver) => [{ ...legacy, driver }];

beforeEach(() => {
  root.selectedRegion = 'East';
  GLOBAL_VARIABLES.magnumDriverMappings = {
    East: bindings(capi),
    West: bindings(heat),
  };
});

afterEach(() => {
  delete GLOBAL_VARIABLES.magnumDriverMappings;
  jest.restoreAllMocks();
});

it('uses the selected region and exact legacy triplet, with explicit drivers taking precedence', () => {
  expect(isCapiHelm({ template: legacy })).toBe(true);
  expect(legacy.driver).toBeNull();
  expect(isCapiHelm({ ...legacy, driver: heat })).toBe(false);
  expect(isCapiHelm({ ...legacy, coe: undefined })).toBe(false);
  root.selectedRegion = 'West';
  expect(isCapiHelm(legacy)).toBe(false);
  root.selectedRegion = 'unmapped';
  expect(isCapiHelm(legacy)).toBe(false);
  expect(isCapiHelm({ ...legacy, driver: capi })).toBe(true);
});

it('withholds CAPI actions for conflicting bindings and a chart label alone', () => {
  GLOBAL_VARIABLES.magnumDriverMappings.East = [
    ...bindings(capi),
    ...bindings(heat),
  ];
  expect(isCapiHelm(legacy)).toBe(false);
  expect(
    isCapiHelm({ labels: { capi_helm_chart_version: '0.29.0+mustelinet.5' } })
  ).toBe(false);
});

it('loads Heat only for a recognized Heat template, including a regional binding', async () => {
  const store = new ClustersStore();
  jest.spyOn(store.templateClient, 'show').mockResolvedValue(legacy);
  jest.spyOn(client.nova.keypairs, 'list').mockResolvedValue({ keypairs: [] });
  const stacks = jest
    .spyOn(store.stackClient, 'list')
    .mockResolvedValue({ stacks: [{ id: 'stack' }] });
  const cluster = { stack_id: 'stack', cluster_template_id: 'template' };
  await store.detailDidFetch({ ...cluster });
  expect(stacks).not.toHaveBeenCalled();
  root.selectedRegion = 'unmapped';
  await store.detailDidFetch({ ...cluster });
  expect(stacks).not.toHaveBeenCalled();
  root.selectedRegion = 'West';
  const detail = await store.detailDidFetch({ ...cluster });
  expect(stacks).toHaveBeenCalledTimes(1);
  expect(detail.stack.id).toBe('stack');
});
