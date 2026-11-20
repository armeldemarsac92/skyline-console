import React from 'react';
import { mount } from 'enzyme';
import { act } from 'react-dom/test-utils';
import { Provider } from 'mobx-react';
import { Button, Select } from 'antd';
import client from 'client';
import ActionButton from 'components/Tables/Base/ActionButton';
import Resize from 'pages/container-infra/containers/Clusters/actions/Resize';
import NodeGroups from 'pages/container-infra/containers/Clusters/Detail/NodeGroups';
import globalProjectStore from 'stores/keystone/project';
import { hasMagnumPolicy } from 'resources/magnum/capabilities';
import { mockMagnum } from './magnum';

jest.mock('asset/image/load-balancer.png', () => '');
jest.mock('components/QuotaChart', () => () => null);

jest.mock(
  'file-loader?esModule=false!ace-builds/src-noconflict/worker-json',
  () => '',
  { virtual: true }
);

jest.mock('resources/magnum/capabilities', () => ({
  hasMagnumPolicy: jest.fn(() => true),
  isCapiHelm: (item) => item.template?.driver === 'k8s_capi_helm_v1',
}));

const cluster = {
  uuid: 'cluster-uuid',
  name: 'kube-prod',
  status: 'CREATE_COMPLETE',
  api_address: 'https://kube.example.test',
  node_count: 5,
  project_id: 'project-1',
  template: {
    driver: 'k8s_capi_helm_v1',
    labels: { auto_scaling_enabled: 'false' },
  },
};

const groups = [
  {
    uuid: 'master-uuid',
    name: 'controllers',
    role: 'master',
    is_default: true,
    node_count: 1,
  },
  {
    uuid: 'worker-uuid',
    name: 'general',
    role: 'worker',
    is_default: true,
    node_count: 2,
  },
  {
    uuid: 'compute-uuid',
    name: 'compute',
    role: 'batch',
    is_default: false,
    node_count: 3,
    flavor_id: 'compute.large',
  },
].map((group) => ({ status: 'CREATE_COMPLETE', ...group }));

const clusterPath = '/v1/clusters/cluster-uuid';
const base = `${clusterPath}/nodegroups`;
const resizePath = `${clusterPath}/actions/resize`;

const read = (path, records = groups, maxVersion = '1.14') => {
  if (path === '/') {
    return {
      data: {
        versions: [{ id: 'v1', min_version: '1.1', max_version: maxVersion }],
      },
    };
  }
  if (maxVersion === '1.8') return undefined;
  if (path === base) return { data: { nodegroups: records } };
  const group = records.find(({ uuid }) => path === `${base}/${uuid}`);
  if (group)
    return { data: { min_node_count: 0, max_node_count: 10, ...group } };
  return undefined;
};

describe('Magnum node groups', () => {
  let wrapper;
  let http;
  let refreshDetail;

  const settle = async (action = () => {}) => {
    await act(async () => {
      action();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    wrapper.update();
  };

  const mountGroups = async (props = {}, systemRole = {}) => {
    await settle(() => {
      wrapper = mount(
        <Provider rootStore={{ projectId: 'project-1', ...systemRole }}>
          <NodeGroups
            detail={cluster}
            refreshDetail={refreshDetail}
            {...props}
          />
        </Provider>
      );
    });
  };

  const row = (id) => wrapper.find(`tr[data-row-key="${id}"]`);
  const button = (container, label) =>
    container.find(Button).filterWhere((item) => item.text() === label);

  const sizeInput = () =>
    document.querySelector('input[id$="changed_node_count"]');
  const editSize = (value) =>
    wrapper
      .find('input[id$="changed_node_count"]')
      .simulate('change', { target: { value } });
  const submit = () =>
    document.querySelector('.ant-modal-footer .ant-btn-primary').click();

  const mountListResize = async (item = cluster) => {
    await settle(() => {
      wrapper = mount(
        <Provider rootStore={{ projectId: 'project-1' }}>
          <ActionButton
            id="resize-cluster"
            title="Resize Cluster"
            item={item}
            action={Resize}
            actionType="modal"
            isAllowed
          />
        </Provider>
      );
    });
    await settle(() => button(wrapper, 'Resize Cluster').simulate('click'));
  };

  beforeEach(() => {
    client.magnum.discovery = undefined;
    global.globalCSS = { successColor: '#52c41a' };
    window.matchMedia = () => ({
      matches: false,
      addListener() {},
      removeListener() {},
    });
    global.t = (message, values = {}) =>
      message.replace(/\{(\w+)\}/g, (match, key) => values[key] ?? match);
    hasMagnumPolicy.mockImplementation((rule) => rule !== 'context_is_admin');
    refreshDetail = jest.fn();
    jest.spyOn(globalProjectStore, 'fetchProjectNovaQuota').mockResolvedValue({
      instances: { left: 1, limit: 10, used: 9 },
    });
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    if (http) http.restore();
    document.body.innerHTML = '';
    delete global.globalCSS;
    jest.restoreAllMocks();
  });

  it('resizes the selected pool through Magnum and keeps both default groups protected', async () => {
    let count = 3;
    let refused = true;
    let status = 'CREATE_COMPLETE';
    http = mockMagnum(({ method, path }) => {
      if (method === 'GET')
        return read(
          path,
          groups.map((g) =>
            g.uuid === 'compute-uuid' ? { ...g, node_count: count, status } : g
          )
        );
      if (method === 'POST' && path === resizePath) {
        if (refused)
          return { status: 409, data: { faultstring: 'The cluster is busy' } };
        count = 4;
        status = 'UPDATE_IN_PROGRESS';
        return { status: 202, data: { uuid: 'cluster-uuid' } };
      }
      return undefined;
    });
    await mountGroups();

    expect(row('compute-uuid').text()).toContain('compute.large');
    expect(button(row('master-uuid'), 'Delete')).toHaveLength(0);
    expect(button(row('worker-uuid'), 'Delete')).toHaveLength(0);
    expect(button(row('compute-uuid'), 'Delete')).toHaveLength(1);

    await settle(() => button(row('compute-uuid'), 'Resize').simulate('click'));
    expect(sizeInput().value).toBe('3');
    expect(sizeInput().getAttribute('aria-valuemax')).toBe('4');
    await settle(() => editSize('4'));
    await settle(submit);
    expect(document.body.textContent).toContain('The cluster is busy');
    expect(sizeInput().value).toBe('4');

    refused = false;
    await settle(submit);
    const mutations = http.requests.filter(({ method }) => method !== 'GET');
    expect(mutations.map(({ body }) => body)).toEqual([
      { nodegroup: 'compute-uuid', node_count: 4 },
      { nodegroup: 'compute-uuid', node_count: 4 },
    ]);
    expect(refreshDetail).toHaveBeenCalled();
    expect(row('worker-uuid').find('td').at(4).text()).toBe('2');
    expect(row('compute-uuid').find('td').at(4).text()).toBe('4');
    expect(row('compute-uuid').text()).toContain('Request Accepted');
    status = 'UPDATE_COMPLETE';
    await settle(() => button(wrapper, 'Refresh').simulate('click'));
    expect(row('compute-uuid').text()).not.toContain('Request Accepted');
  });

  it('offers PATCH-only sizing for the default worker with both policies', async () => {
    hasMagnumPolicy.mockImplementation((rule) => rule !== 'cluster:resize');
    let count = 2;
    let clusterStatus = 'CREATE_COMPLETE';
    http = mockMagnum(({ method, path }) => {
      if (method === 'GET' && path === clusterPath) {
        return {
          data: {
            ...cluster,
            status: clusterStatus,
            status_reason: 'OpenStack quota exceeded',
          },
        };
      }
      if (method === 'GET')
        return read(
          path,
          groups.map((g) =>
            g.uuid === 'worker-uuid' ? { ...g, node_count: count } : g
          )
        );
      if (method === 'PATCH' && path === clusterPath) {
        count = 3;
        clusterStatus = 'UPDATE_IN_PROGRESS';
        return { status: 202, data: { uuid: 'cluster-uuid' } };
      }
      return undefined;
    });
    await mountGroups();
    expect(button(row('compute-uuid'), 'Resize')).toHaveLength(0);
    expect(button(row('master-uuid'), 'Resize')).toHaveLength(0);
    await settle(() => button(row('worker-uuid'), 'Resize').simulate('click'));
    expect(sizeInput().value).toBe('2');
    await settle(() => editSize('3'));
    await settle(submit);
    expect(http.requests.filter(({ method }) => method !== 'GET')).toEqual([
      expect.objectContaining({
        method: 'PATCH',
        path: clusterPath,
        body: [{ op: 'replace', path: '/node_count', value: 3 }],
      }),
    ]);
    expect(row('worker-uuid').text()).toContain('Request Accepted');
    clusterStatus = 'UPDATE_FAILED';
    count = 2;
    await settle(() => button(wrapper, 'Refresh').simulate('click'));
    expect(row('worker-uuid').text()).toContain('OpenStack quota exceeded');
    expect(row('worker-uuid').text()).not.toContain('Request Accepted');
    hasMagnumPolicy.mockImplementation(
      (rule) =>
        !['cluster:resize', 'cluster:update_health_status'].includes(rule)
    );
    await settle(() => button(wrapper, 'Refresh').simulate('click'));
    expect(button(row('worker-uuid'), 'Resize')).toHaveLength(0);
  });

  it('uses the historical cluster resize route on a Magnum 1.8 endpoint', async () => {
    http = mockMagnum(({ method, path }) => {
      if (method === 'GET') return read(path, [], '1.8');
      if (method === 'POST' && path === resizePath)
        return { status: 202, data: { uuid: 'cluster-uuid' } };
      return undefined;
    });
    await mountListResize();
    expect(sizeInput().value).toBe('5');
    expect(sizeInput().getAttribute('aria-valuemin')).toBe('1');
    await settle(() => editSize('6'));
    await settle(submit);
    expect(http.requests.map(({ method, path }) => [method, path])).toEqual([
      ['GET', '/'],
      ['POST', resizePath],
    ]);
    expect(http.requests[1]).toEqual(
      expect.objectContaining({
        body: { node_count: 6 },
        headers: expect.objectContaining({
          'OpenStack-API-Version': 'container-infra 1.8',
        }),
      })
    );
  });

  it('selects the destination group from the existing cluster list action', async () => {
    http = mockMagnum(({ method, path }) => {
      if (method === 'GET' && path === clusterPath) return { data: cluster };
      if (method === 'GET') return read(path);
      if (method === 'POST' && path === resizePath)
        return { status: 202, data: { uuid: 'cluster-uuid' } };
      return undefined;
    });
    await mountListResize({ ...cluster, project_id: undefined });
    const selector = wrapper
      .find(Select)
      .filterWhere((item) => item.prop('id')?.endsWith('nodegroup'));
    expect(sizeInput().value).toBe('2');
    await settle(() => selector.prop('onChange')('compute-uuid'));
    expect(sizeInput().value).toBe('3');
    await settle(() => editSize('4'));
    await settle(submit);
    expect(http.requests.find(({ method }) => method === 'POST').body).toEqual({
      nodegroup: 'compute-uuid',
      node_count: 4,
    });
  });

  it('creates a group with a Nova flavor, edits only the changed bound and deletes the group', async () => {
    const id = 'compute-uuid';
    let provisioned;
    http = mockMagnum(({ method, path, url, body }) => {
      if (method === 'GET' && url.endsWith('/flavors/detail')) {
        return {
          data: { flavors: [{ id: 'compute-flavor', name: 'compute.large' }] },
        };
      }
      if (method === 'GET' && path === `${base}/${id}` && !provisioned) {
        return { status: 404, data: { faultstring: 'Group does not exist' } };
      }
      if (method === 'GET')
        return read(path, [
          ...groups.slice(0, 2),
          ...(provisioned ? [provisioned] : []),
        ]);
      if (method === 'POST' && path === base) {
        provisioned = {
          uuid: id,
          ...body,
          status: 'CREATE_COMPLETE',
          is_default: false,
        };
        return { status: 202, data: { uuid: id } };
      }
      if (method === 'PATCH' && path === `${base}/${id}`) {
        provisioned = {
          ...provisioned,
          max_node_count: 7,
          status: 'UPDATE_COMPLETE',
        };
        return { status: 202, data: provisioned };
      }
      if (method === 'DELETE' && path === `${base}/${id}`) {
        provisioned = undefined;
        return { status: 204 };
      }
      return undefined;
    });
    await mountGroups({
      detail: { ...cluster, template: { driver: cluster.template.driver } },
    });
    await settle(() => button(wrapper, 'Create Node Group').simulate('click'));
    const field = (idPart) => wrapper.find(`input[id="${idPart}"]`);
    await settle(() =>
      field('create-node-group_name').simulate('change', {
        target: { value: 'compute' },
      })
    );
    const flavors = wrapper
      .find(Select)
      .filterWhere((item) => item.prop('id') === 'create-node-group_flavor_id');
    await settle(() => flavors.prop('onChange')('compute.large'));
    await settle(submit);
    expect(row(id)).toHaveLength(1);

    await settle(() => button(row(id), 'Edit Bounds').simulate('click'));
    await settle(() =>
      field('edit-node-group_max_node_count').simulate('change', {
        target: { value: '7' },
      })
    );
    await settle(submit);
    expect(row(id).find('td').at(6).text()).toBe('7');

    await settle(() => button(row(id), 'Delete').simulate('click'));
    expect(document.body.textContent).toContain(
      'Delete node group compute from cluster kube-prod?'
    );
    await settle(submit);
    expect(row(id)).toHaveLength(0);
    expect(
      http.requests
        .filter(({ method }) => method !== 'GET')
        .map(({ method, path, body }) => ({ method, path, body }))
    ).toEqual([
      {
        method: 'POST',
        path: base,
        body: {
          name: 'compute',
          role: 'worker',
          node_count: 1,
          flavor_id: 'compute.large',
          min_node_count: 1,
        },
      },
      {
        method: 'PATCH',
        path: `${base}/${id}`,
        body: [{ op: 'replace', path: '/max_node_count', value: 7 }],
      },
      { method: 'DELETE', path: `${base}/${id}`, body: null },
    ]);
    const deletion = http.requests.find(({ method }) => method === 'DELETE');
    expect(deletion.headers['OpenStack-API-Version']).toBe(
      'container-infra 1.14'
    );
    expect(deletion.params).toEqual({});
  });

  it('reads own groups with a system reader role and project-scoped Magnum policies', async () => {
    hasMagnumPolicy.mockImplementation((rule) =>
      ['nodegroup:get_all', 'nodegroup:get', 'cluster:resize'].includes(rule)
    );
    http = mockMagnum(({ method, path }) => method === 'GET' && read(path));
    await mountGroups(
      {
        location: {
          pathname: '/container-infra-admin/clusters-admin/cluster-uuid',
        },
      },
      {
        hasAdminRole: true,
        roles: [{ name: 'reader' }, { name: 'member' }],
      }
    );
    expect(row('compute-uuid').text()).toContain('compute.large');
    expect(button(row('compute-uuid'), 'Resize')).toHaveLength(1);
  });

  it('shows a foreign project cluster as read-only in the project view', async () => {
    hasMagnumPolicy.mockReturnValue(true);
    http = mockMagnum(({ method, path }) => method === 'GET' && read(path));
    await mountGroups({ detail: { ...cluster, project_id: 'project-2' } });
    expect(button(row('compute-uuid'), 'Detail')).toHaveLength(1);
    expect(button(row('compute-uuid'), 'Resize')).toHaveLength(0);
    expect(button(row('compute-uuid'), 'Edit Bounds')).toHaveLength(0);
    expect(button(row('compute-uuid'), 'Delete')).toHaveLength(0);
    expect(button(wrapper, 'Create Node Group')).toHaveLength(0);
  });

  it('loads project ownership for a cluster list row before permitting resize', async () => {
    http = mockMagnum(({ method, path }) => {
      if (method !== 'GET') return undefined;
      if (path === clusterPath)
        return { data: { ...cluster, project_id: 'project-2' } };
      return read(path);
    });
    await mountListResize({ ...cluster, project_id: undefined });
    expect(document.body.textContent).toContain(
      'You do not have permission to resize this cluster.'
    );
    expect(
      http.requests.map(({ method, path }) => [method, path])
    ).toContainEqual(['GET', clusterPath]);
    expect(sizeInput()).toBeNull();
  });

  it('allows cleanup of a failed pool and stops tracking a confirmed repeat failure', async () => {
    const id = 'compute-uuid';
    http = mockMagnum(({ method, path }) => {
      if (method === 'GET')
        return read(
          path,
          groups.map((group) =>
            group.uuid === id
              ? {
                  ...group,
                  status: 'DELETE_FAILED',
                  status_reason: 'The worker is still in use',
                }
              : group
          )
        );
      if (method === 'DELETE' && path === `${base}/${id}`)
        return { status: 204 };
      return undefined;
    });
    await mountGroups({ detail: { ...cluster, status: 'CREATE_FAILED' } });
    expect(button(row(id), 'Delete').prop('disabled')).toBe(false);
    await settle(() => button(row(id), 'Delete').simulate('click'));
    await settle(submit);
    await settle(() => button(wrapper, 'Refresh').simulate('click'));
    expect(row(id).text()).toContain('The worker is still in use');
    expect(row(id).text()).not.toContain('Request Accepted');
    expect(button(row(id), 'Delete').prop('disabled')).toBe(false);
  });
});
