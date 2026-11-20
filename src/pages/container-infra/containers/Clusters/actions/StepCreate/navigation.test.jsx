// SPDX-License-Identifier: Apache-2.0
import React from 'react';
import { mount } from 'enzyme';
import { act } from 'react-dom/test-utils';
import { Provider } from 'mobx-react';
import { runInAction } from 'mobx';
import { MemoryRouter } from 'react-router-dom';
import client from 'client';
import globalProjectStore from 'stores/keystone/project';
import globalKeypairStore from 'stores/nova/keypair';
import globalFlavorStore from 'stores/nova/flavor';
import globalTemplateStore, {
  ClusterTemplatesStore,
} from 'stores/magnum/clusterTemplates';
import { mockMagnum } from '../../../../../../../test/unit/magnum';
import CreateCluster, { StepCreate } from './index';

jest.mock('asset/image/load-balancer.png', () => '');
jest.mock('components/QuotaChart', () => () => null);
jest.mock(
  'file-loader?esModule=false!ace-builds/src-noconflict/worker-json',
  () => '',
  { virtual: true }
);

const flavors = [
  { id: 'small-id', name: 'small', vcpus: 1, ram: 2048 },
  { id: 'medium-id', name: 'medium', vcpus: 2, ram: 4096 },
];
const templates = flavors.map(({ id, name }, index) => ({
  id: `model-${index}`,
  uuid: `model-${index}`,
  name: `model-${name}`,
  coe: 'kubernetes',
  driver: 'k8s_capi_helm_v1',
  flavor_id: id,
  master_flavor_id: name,
}));

it('advances with Nova defaults after mouse selection and after switching templates', async () => {
  const translate = global.t;
  const matchMedia = window.matchMedia;
  const previousCSS = global.globalCSS;
  global.t = (message) => message;
  global.globalCSS = { successColor: '#52c41a' };
  window.matchMedia = () => ({
    matches: false,
    addListener() {},
    removeListener() {},
  });
  const enough = { left: -1 };
  jest
    .spyOn(globalProjectStore, 'fetchProjectMagnumQuota')
    .mockImplementation(async () => {
      runInAction(() => {
        globalProjectStore.magnumQuota = { magnum_cluster: enough };
      });
    });
  jest
    .spyOn(globalProjectStore, 'fetchProjectNovaQuota')
    .mockImplementation(async () => {
      runInAction(() => {
        globalProjectStore.novaQuota = {
          instances: enough,
          cores: enough,
          ram: enough,
        };
      });
    });
  jest
    .spyOn(globalProjectStore, 'fetchProjectCinderQuota')
    .mockImplementation(async () => {
      runInAction(() => {
        globalProjectStore.cinderQuota = { volumes: enough };
      });
    });
  jest
    .spyOn(globalTemplateStore, 'fetchList')
    .mockImplementation(async () =>
      globalTemplateStore.list.update({ data: templates })
    );
  jest.spyOn(globalFlavorStore, 'fetchList').mockImplementation(async () => {
    await Promise.resolve();
    globalFlavorStore.list.update({ data: flavors });
  });
  jest.spyOn(globalKeypairStore, 'fetchList').mockResolvedValue([]);
  jest
    .spyOn(ClusterTemplatesStore.prototype, 'fetchDetail')
    .mockImplementation(async function fetchDetail({ id }) {
      this.detail = templates.find((model) => model.id === id);
      return this.detail;
    });
  jest.spyOn(client.magnum, 'supportsVersion').mockResolvedValue(true);
  const http = mockMagnum(({ method, url }) => {
    if (method === 'GET' && url === '/v2.0/networks')
      return { data: { networks: [] } };
    if (method === 'GET' && url === '/v2.0/subnets')
      return { data: { subnets: [] } };
    if (method === 'POST' && url === '/v1/clusters')
      return { status: 202, data: { uuid: 'cluster' } };
    return undefined;
  });

  let wrapper;
  const settle = async (action) => {
    await act(async () => {
      action();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    wrapper.update();
  };
  const click = (label) =>
    settle(() =>
      wrapper
        .find('.step-form-footer-btns button')
        .filterWhere((button) => button.text() === label)
        .simulate('click')
    );
  const choose = (id) =>
    settle(() =>
      wrapper
        .find(`tr[data-row-key="${id}"] input[type="radio"]`)
        .simulate('change', { target: { checked: true } })
    );
  try {
    await settle(() => {
      wrapper = mount(
        <Provider
          rootStore={{
            checkEndpoint: () => true,
            routing: { push: jest.fn() },
          }}
        >
          <MemoryRouter>
            <CreateCluster location={{ search: '' }} />
          </MemoryRouter>
        </Provider>
      );
    });
    await settle(() =>
      wrapper
        .find('input#Info_name')
        .simulate('change', { target: { value: 'test-cluster' } })
    );
    await choose('model-0');
    await click('Next: Node Spec');
    await click('Next: Network Setting');

    const wizard = wrapper.find(StepCreate).instance();
    expect(wizard.state.current).toBe(2);
    expect(wizard.state.data.flavor.selectedRowKeys).toEqual(['small-id']);
    await click('Previous: Node Spec');
    await click('Previous: Cluster Info');
    await choose('model-1');
    await click('Next: Node Spec');
    await settle(() =>
      wrapper
        .find('input[id$="_node_count"]')
        .simulate('change', { target: { value: '2' } })
    );
    await click('Next: Network Setting');

    expect(wizard.state.current).toBe(2);
    expect(wizard.state.data.masterFlavor.selectedRowKeys).toEqual([
      'medium-id',
    ]);
    expect(wizard.getFlavorInput()).toEqual({ newCPU: 6, newRam: 12 });
    await click('Next: Management');
    await click('Next: Additional Labels');
    await click('OK');
    const writes = http.requests.filter(({ method }) => method === 'POST');
    expect(writes).toHaveLength(1);
    expect(writes[0].body).toMatchObject({
      cluster_template_id: 'model-1',
      node_count: 2,
      master_flavor_id: 'medium',
      flavor_id: 'medium',
    });
  } finally {
    wrapper?.unmount();
    http.restore();
    jest.restoreAllMocks();
    global.t = translate;
    global.globalCSS = previousCSS;
    window.matchMedia = matchMedia;
  }
}, 15000);
