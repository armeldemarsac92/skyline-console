// SPDX-License-Identifier: Apache-2.0
import { runInAction } from 'mobx';
import globalRootStore from 'stores/root';
import { mockMagnum } from '../../../../../../../test/unit/magnum';
import { StepCreate } from '.';
import { StepInfo } from './StepInfo';
import { StepLabel } from './StepLabel';
import { StepNodeSpec } from './StepNodeSpec';

jest.mock('asset/image/load-balancer.png', () => '');
jest.mock('components/QuotaChart', () => () => null);
jest.mock(
  'file-loader?esModule=false!ace-builds/src-noconflict/worker-json',
  () => '',
  { virtual: true }
);

class LoadedTemplateWizard extends StepCreate {
  getDetail() {}
}

beforeEach(() => {
  jest.spyOn(StepNodeSpec.prototype, 'init').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

const flavor = {
  selectedRowKeys: ['worker-id'],
  selectedRows: [{ id: 'worker-id', name: 'worker-name' }],
};

it.each([
  ['the service default', '', {}, 'worker-name'],
  [
    'the driver in Glance properties',
    '',
    { properties: { magnum_driver: 'k8s_fedora_coreos_v1' } },
    'worker-id',
  ],
  [
    'the driver in top-level Glance metadata',
    '',
    { magnum_driver: 'k8s_fedora_coreos_v1' },
    'worker-id',
  ],
  [
    'the explicit driver over Glance metadata',
    'k8s_capi_helm_v1',
    { magnum_driver: 'k8s_fedora_coreos_v1' },
    'worker-name',
  ],
])(
  'serializes Nova flavors using %s when creating a template',
  async (_, driver, imageMetadata, ref) => {
    const http = mockMagnum(() => ({ data: {} }));
    try {
      const wizard = new LoadedTemplateWizard({});
      await wizard.onSubmit({
        name: 'test',
        driver,
        server_type: 'vm',
        flavor,
        masterFlavor: flavor,
        images: {
          selectedRowKeys: ['image'],
          selectedRows: [
            { originData: { os_distro: 'ubuntu', ...imageMetadata } },
          ],
        },
        externalNetwork: { selectedRowKeys: ['public-network'] },
      });
      expect(http.requests.map(({ method, body }) => [method, body])).toEqual([
        [
          'POST',
          {
            coe: 'kubernetes',
            name: 'test',
            server_type: 'vm',
            flavor_id: ref,
            master_flavor_id: ref,
            image_id: 'image',
            external_network_id: 'public-network',
            fixed_network: null,
            fixed_subnet: null,
            keypair_id: null,
            ...(driver ? { driver } : {}),
          },
        ],
      ]);
    } finally {
      http.restore();
    }
  }
);

it('uses the stored legacy distro when an edit changes the image and flavor', async () => {
  const { selectedRegion } = globalRootStore;
  const mappings = GLOBAL_VARIABLES.magnumDriverMappings;
  const extra = {
    coe: 'kubernetes',
    driver: null,
    server_type: 'vm',
    cluster_distro: 'ubuntu',
    external_network_id: 'public-network',
    image_id: 'old-image',
    flavor_id: 'old-flavor',
  };
  runInAction(() => {
    globalRootStore.selectedRegion = 'edit-region';
  });
  GLOBAL_VARIABLES.magnumDriverMappings = {
    'edit-region': [
      {
        coe: 'kubernetes',
        server_type: 'vm',
        cluster_distro: 'ubuntu',
        driver: 'k8s_capi_helm_v1',
      },
    ],
  };
  const http = mockMagnum(() => ({ data: {} }));
  try {
    const wizard = new LoadedTemplateWizard({
      location: { pathname: '/container-infra/cluster-template/update' },
      match: { params: { id: 'legacy' } },
    });
    wizard.state.extra = extra;
    await wizard.onSubmit({
      ...new StepInfo({ extra }).defaultValue,
      flavor,
      externalNetwork: { selectedRowKeys: ['public-network'] },
      images: {
        selectedRowKeys: ['new-image'],
        selectedRows: [{ originData: { os_distro: 'flatcar' } }],
      },
    });

    expect(http.requests.map(({ method, body }) => [method, body])).toEqual([
      [
        'PATCH',
        [
          { op: 'replace', path: '/flavor_id', value: 'worker-name' },
          { op: 'replace', path: '/image_id', value: 'new-image' },
        ],
      ],
    ]);
  } finally {
    http.restore();
    GLOBAL_VARIABLES.magnumDriverMappings = mappings;
    runInAction(() => {
      globalRootStore.selectedRegion = selectedRegion;
    });
  }
});

it('selects the Nova rows for stored IDs and names before the selection table loads', () => {
  const worker = { id: 'worker-id', name: 'worker-name' };
  const master = { id: 'master-id', name: 'master-name' };
  const nodeSpec = new StepNodeSpec({
    extra: {
      driver: null,
      flavor_id: worker.name,
      flavor: worker,
      master_flavor_id: master.id,
      masterFlavor: master,
    },
  });

  expect(nodeSpec.defaultValue).toMatchObject({
    flavor: { selectedRowKeys: ['worker-id'], selectedRows: [worker] },
    masterFlavor: { selectedRowKeys: ['master-id'], selectedRows: [master] },
  });
});

it('patches only the edited tag on a legacy template for a member without publish permission', async () => {
  const previousPolicies = globalRootStore.policies;
  runInAction(() => {
    globalRootStore.policies = [
      { rule: 'magnum:clustertemplate:update', allowed: true },
      { rule: 'magnum:clustertemplate:publish', allowed: false },
    ];
  });
  const http = mockMagnum(() => ({ data: {} }));
  try {
    const extra = {
      coe: 'kubernetes',
      driver: null,
      flavor_id: 'worker-id',
      flavor: { id: 'worker-id', name: 'worker-name' },
      master_flavor_id: 'master-name',
      masterFlavor: { id: 'master-id', name: 'master-name' },
      external_network_id: 'public-network',
      labels: { autoscaling: false, count: 0, image_tag: 'false' },
      public: true,
      hidden: false,
      tags: 'old',
    };
    const props = { extra };
    const info = new StepInfo(props);
    const wizard = new LoadedTemplateWizard({
      location: { pathname: '/container-infra/cluster-template/update' },
      match: { params: { id: 'legacy' } },
    });
    wizard.state.extra = extra;
    const publication = info.formItems.filter(({ name }) =>
      ['public', 'hidden'].includes(name)
    );
    expect(publication.map(({ display }) => display)).toEqual([false, false]);
    expect(info.defaultValue.driver).toBe('');

    await wizard.onSubmit({
      ...info.defaultValue,
      ...new StepNodeSpec(props).defaultValue,
      ...new StepLabel(props).defaultValue,
      externalNetwork: { selectedRowKeys: ['public-network'] },
      public: false,
      hidden: true,
      tags: 'new',
    });

    expect(http.requests.map(({ method, body }) => [method, body])).toEqual([
      ['PATCH', [{ op: 'replace', path: '/tags', value: 'new' }]],
    ]);
  } finally {
    http.restore();
    runInAction(() => {
      globalRootStore.policies = previousPolicies;
    });
  }
});

it('honors a policy that grants publishing and preserves an omitted legacy label map', async () => {
  const previousPolicies = globalRootStore.policies;
  runInAction(() => {
    globalRootStore.policies = [
      { rule: 'magnum:clustertemplate:publish', allowed: true },
    ];
  });
  const http = mockMagnum(() => ({ data: {} }));
  try {
    const extra = {
      coe: 'kubernetes',
      driver: null,
      external_network_id: 'public-network',
      public: false,
      hidden: false,
    };
    const info = new StepInfo({ extra });
    const wizard = new LoadedTemplateWizard({
      location: { pathname: '/container-infra/cluster-template/update' },
      match: { params: { id: 'legacy' } },
    });
    wizard.state.extra = extra;
    const publication = info.formItems.filter(({ name }) =>
      ['public', 'hidden'].includes(name)
    );
    expect(publication.map(({ display }) => display)).toEqual([true, true]);
    await wizard.onSubmit({
      ...info.defaultValue,
      ...new StepLabel({ extra }).defaultValue,
      externalNetwork: { selectedRowKeys: ['public-network'] },
      public: true,
    });
    expect(http.requests.map(({ method, body }) => [method, body])).toEqual([
      ['PATCH', [{ op: 'replace', path: '/public', value: 'true' }]],
    ]);
  } finally {
    http.restore();
    runInAction(() => {
      globalRootStore.policies = previousPolicies;
    });
  }
});
