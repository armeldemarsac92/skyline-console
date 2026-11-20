// SPDX-License-Identifier: Apache-2.0
import React from 'react';
import { Button } from 'antd';
import { mount } from 'enzyme';
import { act } from 'react-dom/test-utils';
import { runInAction } from 'mobx';
import { Provider } from 'mobx-react';
import globalRootStore from 'stores/root';
import MagnumQuota from 'pages/identity/containers/Project/Detail/MagnumQuota';
import { ManageQuota } from 'pages/identity/containers/Project/actions/ManageQuota';
import { mockMagnum } from './magnum';

jest.mock('asset/image/load-balancer.png', () => '');
jest.mock('components/QuotaChart', () => () => null);
jest.mock(
  'file-loader?esModule=false!ace-builds/src-noconflict/worker-json',
  () => '',
  { virtual: true }
);
jest.mock('pages/base/containers/Overview/components/QuotaOverview', () => ({
  quotaCardList: [
    { type: 'compute', value: [{ key: 'instances', text: 'Instances' }] },
    { type: 'networks', value: [{ key: 'network', text: 'Networks' }] },
  ],
}));

it('only submits changed quotas from the general quota form', () => {
  class LoadedManageQuota extends ManageQuota {
    init() {
      this.projectStore = {
        quota: {
          instances: { limit: 8 },
          network: { limit: 5 },
          magnum_cluster: { limit: 3 },
        },
      };
    }
  }
  const modal = new LoadedManageQuota({
    item: { id: 'project-1' },
    rootStore: { checkEndpoint: (endpoint) => endpoint === 'magnum' },
  });
  const attemptedMagnum = { ...modal.defaultValue, magnum_cluster: 0 };
  expect(modal.getSubmitData(attemptedMagnum)).toEqual({
    project_id: 'project-1',
    data: {},
  });
  expect(modal.getSubmitData({ ...attemptedMagnum, instances: 10 })).toEqual({
    project_id: 'project-1',
    data: { instances: 10 },
  });
});

it('reads and edits the selected project using only Magnum policies and requests', async () => {
  const originalPolicies = globalRootStore.policies;
  const originalMatchMedia = window.matchMedia;
  const originalTranslate = global.t;
  window.matchMedia = () => ({
    matches: false,
    addListener() {},
    removeListener() {},
  });
  const rules = ['quota:get', 'stats:get_all', 'quota:create', 'quota:update'];
  const setPolicies = (policies) =>
    runInAction(() => {
      globalRootStore.policies = policies;
    });
  global.t = (message) => message;
  setPolicies(rules.map((rule) => ({ rule: `magnum:${rule}`, allowed: true })));
  jest
    .spyOn(globalRootStore, 'checkEndpoint')
    .mockImplementation((endpoint) => endpoint === 'magnum');

  const projectId = 'selected-project';
  const quotaPath = `/v1/quotas/${projectId}/Cluster`;
  let override;
  const magnum = mockMagnum(({ method, path, params, body }) => {
    if (method === 'GET' && path === quotaPath) {
      return { data: override || { hard_limit: 9 } };
    }
    if (
      method === 'GET' &&
      path === '/v1/stats' &&
      params.project_id === projectId
    ) {
      return { data: { clusters: 2, nodes: 6 } };
    }
    if (
      (method === 'POST' && path === '/v1/quotas') ||
      (method === 'PATCH' && path === quotaPath)
    ) {
      override = { id: 13, hard_limit: body.hard_limit };
      return { data: override };
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  });
  let wrapper;
  const settle = async (callback) => {
    await act(async () => {
      callback();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    wrapper.update();
  };
  const editLimit = async (label, limit) => {
    wrapper
      .find(Button)
      .filterWhere((button) => button.text() === label)
      .simulate('click');
    const form = () => wrapper.find('form#project-magnum-quota-form');
    expect(form()).toHaveLength(1);
    await settle(() => {
      form()
        .find('input')
        .simulate('change', { target: { value: String(limit) } });
      form().simulate('submit');
    });
  };
  try {
    await settle(() => {
      wrapper = mount(
        <Provider rootStore={globalRootStore}>
          <MagnumQuota match={{ params: { id: projectId } }} />
        </Provider>
      );
    });
    expect(
      wrapper.find('td.ant-descriptions-item').map((item) => item.text())
    ).toEqual([
      `Project ID${projectId}`,
      'Limit9',
      'Clusters2',
      'Nodes (including control plane)6',
    ]);
    await editLimit('Create Quota', 0);
    await editLimit('Edit Quota', 3);
    expect(
      magnum.requests
        .filter(({ method }) => method !== 'GET')
        .map(({ method, path, body }) => [method, path, body])
    ).toEqual([
      [
        'POST',
        '/v1/quotas',
        { project_id: projectId, resource: 'Cluster', hard_limit: 0 },
      ],
      [
        'PATCH',
        quotaPath,
        { project_id: projectId, resource: 'Cluster', hard_limit: 3 },
      ],
    ]);
  } finally {
    wrapper?.unmount();
    setPolicies(originalPolicies);
    window.matchMedia = originalMatchMedia;
    global.t = originalTranslate;
    magnum.restore();
    jest.restoreAllMocks();
  }
});
