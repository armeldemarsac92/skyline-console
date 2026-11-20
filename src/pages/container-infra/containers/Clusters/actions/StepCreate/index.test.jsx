// SPDX-License-Identifier: Apache-2.0
import client from 'client';
import globalFlavorStore from 'stores/nova/flavor';
import { ClustersStore } from 'stores/magnum/clusters';
import { mockMagnum } from '../../../../../../../test/unit/magnum';
import { StepCreate } from './index';
import { StepLabel } from './StepLabel';
import { StepNodeSpec } from './StepNodeSpec';

jest.mock('client', () => ({
  magnum: require('client/magnum').default,
}));
jest.mock('src/containers/Action', () => ({ StepAction: Object }));
jest.mock(
  'components/Form',
  () =>
    class {
      getRouteName(name) {
        return name;
      }
    }
);
jest.mock('resources/nova/keypair', () => ({ getKeyPairHeader: () => null }));
jest.mock('stores/root', () => ({
  __esModule: true,
  default: {
    endpoints: { magnum: '/proxy/magnum' },
    selectedRegion: 'RegionOne',
  },
}));

function createForm(values) {
  const wizard = new StepCreate();
  wizard.store = new ClustersStore();
  wizard.state = { data: values };
  return wizard;
}

function nodeForm(context) {
  const node = new StepNodeSpec();
  node.props = { context };
  node.state = { zeroSupported: true };
  node.keyPairStore = { list: { data: [] } };
  node.flavorStore = globalFlavorStore;
  node.updateContext = (values) => Object.assign(node.props.context, values);
  return node;
}

function validateLabels(context, additionalLabels) {
  const labels = new StepLabel();
  labels.props = { context };
  const field = labels.formItems.find(
    (item) => item.name === 'additionalLabels'
  );
  return field.validator({}, additionalLabels);
}

const labelRows = (labels) =>
  Object.entries(labels).map(([key, value]) => ({ value: { key, value } }));

const flavor = { id: 'nova-2', name: 'medium', vcpus: 2, ram: 4096 };
const template = {
  uuid: 'template',
  driver: 'k8s_capi_helm_v1',
  labels: { auto_scaling_enabled: 'true', kube_tag: 'v1.36.5' },
  master_lb_enabled: true,
  master_flavor_id: 'medium',
  flavor_id: 'nova-2',
};
const legacyTemplate = {
  ...template,
  driver: undefined,
  server_type: 'vm',
  cluster_distro: 'ubuntu',
  coe: 'kubernetes',
};
const clusterForm = (model = template, overrides = {}) => ({
  clusterTemplate: { selectedRowKeys: [model.uuid], selectedRows: [model] },
  master_count: 1,
  node_count: 0,
  ...overrides,
});
const translate = global.t;

function mockCreate(maxVersion = '1.10') {
  return mockMagnum(({ method, path }) => {
    if (method === 'GET' && path === '/') {
      return {
        data: {
          versions: [{ id: 'v1', min_version: '1.1', max_version: maxVersion }],
        },
      };
    }
    if (method === 'POST' && path === '/v1/clusters') {
      return { status: 202, data: { uuid: 'cluster' } };
    }
    return null;
  });
}

beforeEach(() => {
  global.t = (message) => message;
  client.magnum.discovery = null;
  GLOBAL_VARIABLES.magnumDriverMappings = {
    RegionOne: [
      {
        server_type: 'vm',
        cluster_distro: 'ubuntu',
        coe: 'kubernetes',
        driver: 'k8s_capi_helm_v1',
      },
    ],
  };
});

afterEach(() => {
  global.t = translate;
  delete GLOBAL_VARIABLES.magnumDriverMappings;
});

it('uses Nova row IDs for template flavor defaults and includes those instances in quota', () => {
  const previous = globalFlavorStore.list.data;
  globalFlavorStore.list.update({
    data: [{ id: 'nova-1', name: 'nova-2', vcpus: 1, ram: 2048 }, flavor],
  });
  try {
    const context = clusterForm(template, { node_count: 2 });
    const node = nodeForm(context);
    expect(
      node.formItems.find((field) => field.name === 'masterFlavor').initValue
    ).toEqual({ selectedRowKeys: ['nova-2'], selectedRows: [flavor] });
    expect(node.defaultValue.flavor).toEqual({
      selectedRowKeys: ['nova-2'],
      selectedRows: [flavor],
    });
    const wizard = createForm(context);
    expect(wizard.getFlavorInput()).toEqual({ newCPU: 6, newRam: 12 });
  } finally {
    globalFlavorStore.list.update({ data: previous });
  }
});

it('only accepts zero in the node form once autoscaling is disabled', async () => {
  const node = nodeForm(clusterForm(legacyTemplate));
  const workers = () =>
    node.formItems.find((field) => field.name === 'node_count');
  expect(workers().min).toBe(1);
  await expect(workers().validator({}, 0)).rejects.toThrow();

  node.formItems
    .find((field) => field.name === 'auto_scaling_enabled')
    .onChange('false');
  expect(workers().min).toBe(0);
  await expect(workers().validator({}, 0)).resolves.toBeUndefined();
});

it.each([
  ['an older API', '1.9', template, { auto_scaling_enabled: 'false' }],
  [
    'an unknown driver',
    '1.10',
    { ...template, driver: undefined },
    { auto_scaling_enabled: 'false' },
  ],
  [
    'autoscaling inherited despite replacement',
    '1.10',
    legacyTemplate,
    {
      labelMode: 'replace',
      additionalLabels: [{ value: { key: 'team', value: 'science' } }],
    },
  ],
  [
    'an even control plane',
    '1.10',
    template,
    { master_count: 2, auto_scaling_enabled: 'false' },
  ],
  [
    'multiple masters without a load balancer',
    '1.10',
    template,
    {
      master_count: 3,
      master_lb_enabled: false,
      auto_scaling_enabled: 'false',
    },
  ],
])(
  'submits no zero-worker request with %s',
  async (_, version, model, extra) => {
    const http = mockCreate(version);
    try {
      await expect(
        createForm().onSubmit(clusterForm(model, extra))
      ).rejects.toThrow();
      expect(http.requests.filter(({ method }) => method === 'POST')).toEqual(
        []
      );
    } finally {
      http.restore();
    }
  }
);

it('creates zero workers on a supported API while preserving inherited labels', async () => {
  const http = mockCreate();
  try {
    const wizard = createForm();
    await wizard.onSubmit(
      clusterForm(legacyTemplate, { auto_scaling_enabled: 'false' })
    );
    expect(http.requests.map(({ method }) => method)).toEqual(['GET', 'POST']);
    expect(http.requests[1]).toMatchObject({
      body: {
        master_count: 1,
        node_count: 0,
        merge_labels: true,
        labels: { auto_scaling_enabled: 'false' },
      },
      headers: { 'OpenStack-API-Version': 'container-infra 1.10' },
    });
  } finally {
    http.restore();
  }
});

it('allows a user to fix an invalid inherited minimum on the Labels step', async () => {
  const model = {
    ...legacyTemplate,
    labels: { ...legacyTemplate.labels, min_node_count: '0' },
  };
  const context = clusterForm(model, { node_count: 3, labelMode: 'replace' });
  const http = mockCreate();
  try {
    const unrelated = labelRows({ team: 'science' });
    await expect(validateLabels(context, unrelated)).rejects.toThrow();
    await expect(
      createForm().onSubmit({ ...context, additionalLabels: unrelated })
    ).rejects.toThrow();
    expect(http.requests).toEqual([]);

    const fixed = labelRows({ min_node_count: '1', max_node_count: '2' });
    await expect(validateLabels(context, fixed)).resolves.toBeUndefined();
    await createForm().onSubmit({ ...context, additionalLabels: fixed });
    expect(http.requests).toHaveLength(1);
    expect(http.requests[0]).toMatchObject({
      method: 'POST',
      body: {
        node_count: 3,
        merge_labels: false,
        labels: { min_node_count: '1', max_node_count: '2' },
      },
    });
  } finally {
    http.restore();
  }
});

it.each([
  ['minimum above the initial worker count', { min_node_count: '3' }],
  ['maximum below the minimum', { min_node_count: '2', max_node_count: '1' }],
])('rejects an autoscaling %s in the form and on submit', async (_, labels) => {
  const context = clusterForm(template, { node_count: 2 });
  const additionalLabels = labelRows(labels);
  const http = mockCreate();
  try {
    await expect(validateLabels(context, additionalLabels)).rejects.toThrow();
    await expect(
      createForm().onSubmit({ ...context, additionalLabels })
    ).rejects.toThrow();
    expect(http.requests).toEqual([]);
  } finally {
    http.restore();
  }
});

it('leaves bounds to the operator when an effective value is unknown', async () => {
  const context = clusterForm(template, { node_count: 2 });
  const maxOnly = labelRows({ max_node_count: '1' });
  await expect(validateLabels(context, maxOnly)).resolves.toBeUndefined();
});
