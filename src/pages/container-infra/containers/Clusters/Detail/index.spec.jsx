// SPDX-License-Identifier: Apache-2.0
import React from 'react';
import { mount } from 'enzyme';
import { act } from 'react-dom/test-utils';
import { observable, runInAction } from 'mobx';
import { Provider } from 'mobx-react';
import { MemoryRouter } from 'react-router-dom';
import client from 'client';
import NotFound from 'components/Cards/NotFound';
import Notify from 'components/Notify';
import ItemActionButtons from 'components/Tables/Base/ItemActionButtons';
import { ClustersStore } from 'stores/magnum/clusters';
import ClustersDetail from './index';
import BaseDetail from './BaseDetail';

jest.mock('asset/image/load-balancer.png', () => '');
jest.mock('components/QuotaChart', () => () => null);
jest.mock(
  'file-loader?esModule=false!ace-builds/src-noconflict/worker-json',
  () => '',
  { virtual: true }
);
jest.mock('stores/root', () => ({
  __esModule: true,
  default: {
    endpoints: { magnum: '/api/openstack/magnum' },
    policies: ['get', 'delete', 'update', 'resize', 'upgrade'].map((rule) => ({
      rule: `magnum:cluster:${rule}`,
      allowed: true,
    })),
  },
}));

const firstId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const secondId = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const cluster = (uuid, name) => ({ uuid, name, status: 'CREATE_COMPLETE' });
const routeProps = (id) => ({
  match: { params: { id } },
  location: { pathname: `/container-infra/clusters/detail/${id}` },
});

function View({ id, rootStore }) {
  return (
    <Provider rootStore={rootStore}>
      <MemoryRouter>
        <ClustersDetail {...routeProps(id)} />
      </MemoryRouter>
    </Provider>
  );
}

function pendingResponse() {
  let resolve;
  let reject;
  const promise = new Promise((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
}

describe('Cluster detail request ownership', () => {
  let wrapper;
  let rootStore;
  let showCluster;

  const settle = async (update) => {
    await act(async () => {
      update();
    });
    wrapper.update();
  };

  const open = (id) =>
    settle(() => {
      if (wrapper) {
        wrapper.setProps({ id });
        return;
      }
      wrapper = mount(<View id={id} rootStore={rootStore} />);
    });

  const actionItem = () => wrapper.find(ItemActionButtons).prop('item');
  const refresh = () =>
    wrapper
      .find('button')
      .filterWhere((button) => button.find('.anticon-sync').exists())
      .simulate('click');

  beforeEach(() => {
    global.t = (message) => message;
    window.matchMedia = () => ({
      matches: false,
      addListener() {},
      removeListener() {},
    });
    rootStore = observable({
      selectedRegion: 'RegionOne',
      projectId: 'project-one',
      routing: { location: { search: '' } },
    });
    showCluster = jest.spyOn(client.magnum.clusters, 'show');
    jest
      .spyOn(ClustersStore.prototype, 'detailDidFetch')
      .mockImplementation(async (item) => item);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    jest.restoreAllMocks();
  });

  it('keeps the new cluster in the detail and in actions when the earlier URL resolves last', async () => {
    const first = pendingResponse();
    const second = pendingResponse();
    showCluster
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    await open(firstId);
    await open(secondId);
    expect(showCluster.mock.calls.map(([id]) => id)).toEqual([
      firstId,
      secondId,
    ]);

    await settle(() => second.resolve(cluster(secondId, 'Second cluster')));
    expect(actionItem().id).toBe(secondId);
    await settle(() => first.resolve(cluster(firstId, 'First cluster')));

    expect(wrapper.text()).toContain('Second cluster');
    expect(wrapper.text()).not.toContain('First cluster');
    expect(actionItem().id).toBe(secondId);
  });

  it('ignores an older refresh error and preserves the current not-found behavior', async () => {
    showCluster.mockResolvedValueOnce(cluster(firstId, 'First cluster'));
    await open(firstId);
    const warnings = jest.spyOn(Notify, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const earlier = pendingResponse();
    const latest = pendingResponse();
    showCluster
      .mockReturnValueOnce(earlier.promise)
      .mockReturnValueOnce(latest.promise);

    await settle(() => wrapper.find(BaseDetail).prop('refreshDetail')());
    await settle(refresh);
    await settle(() => latest.resolve(cluster(firstId, 'Refreshed cluster')));
    await settle(() => earlier.reject({ response: { status: 404 } }));

    expect(wrapper.text()).toContain('Refreshed cluster');
    expect(warnings).not.toHaveBeenCalled();
    expect(actionItem().id).toBe(firstId);

    showCluster.mockRejectedValueOnce({ response: { status: 404 } });
    await settle(refresh);
    expect(wrapper.find(NotFound)).toHaveLength(1);
    expect(wrapper.find(ItemActionButtons)).toHaveLength(0);
    expect(warnings).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['selectedRegion', 'RegionTwo'],
    ['projectId', 'project-two'],
  ])('reloads the same UUID when %s changes', async (field, value) => {
    const previousScope = pendingResponse();
    const newScope = pendingResponse();
    showCluster
      .mockReturnValueOnce(previousScope.promise)
      .mockReturnValueOnce(newScope.promise);
    await open(firstId);
    await settle(() =>
      previousScope.resolve(cluster(firstId, 'Previous scope'))
    );
    expect(actionItem().name).toBe('Previous scope');

    await settle(() =>
      runInAction(() => {
        rootStore[field] = value;
      })
    );
    expect(wrapper.find(ItemActionButtons)).toHaveLength(0);
    expect(wrapper.text()).not.toContain('Previous scope');

    await settle(() => newScope.resolve(cluster(firstId, 'Current scope')));
    expect(actionItem().name).toBe('Current scope');
  });

  it('withholds actions and tabs when Magnum omits or returns a different UUID', async () => {
    showCluster
      .mockResolvedValueOnce({ name: 'Missing UUID' })
      .mockResolvedValueOnce(cluster(secondId, 'Mismatched UUID'));
    await open(firstId);
    expect(wrapper.find(ItemActionButtons)).toHaveLength(0);
    expect(wrapper.find(BaseDetail)).toHaveLength(0);

    await settle(refresh);
    expect(wrapper.find(ItemActionButtons)).toHaveLength(0);
    expect(wrapper.find(BaseDetail)).toHaveLength(0);
  });
});
