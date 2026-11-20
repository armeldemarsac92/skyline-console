import { runInAction } from 'mobx';
import globalRootStore from 'stores/root';
import { Service } from 'pages/configuration/containers/SystemInfo';
import { MagnumServiceStore } from './service';
import { mockMagnum } from '../../../test/unit/magnum';

jest.mock('asset/image/load-balancer.png', () => '');
jest.mock('components/QuotaChart', () => () => null);
jest.mock(
  'file-loader?esModule=false!ace-builds/src-noconflict/worker-json',
  () => '',
  { virtual: true }
);

it('only shows conductors when Magnum is present and explicitly allowed', async () => {
  let endpointAvailable = true;
  const systemInfo = new Service({
    rootStore: {
      checkEndpoint: (name) => name === 'magnum' && endpointAvailable,
    },
  });
  const canSeeConductors = () =>
    systemInfo.tabs.some(({ key }) => key === 'magnumService');
  const originalPolicies = globalRootStore.policies;
  const setPolicies = (policies) =>
    runInAction(() => {
      globalRootStore.policies = policies;
    });
  const conductor = {
    id: 1,
    host: 'magnum.example.test',
    binary: 'magnum-conductor',
    state: 'up',
    report_count: 7,
    disabled: false,
  };
  const magnum = mockMagnum(() => ({
    status: 200,
    data: { mservices: [conductor] },
  }));

  try {
    setPolicies([]);
    expect(canSeeConductors()).toBe(false);
    setPolicies([{ rule: 'magnum:magnum-service:get_all', allowed: false }]);
    expect(canSeeConductors()).toBe(false);
    setPolicies([{ rule: 'magnum:magnum-service:get_all', allowed: true }]);
    endpointAvailable = false;
    expect(canSeeConductors()).toBe(false);
    endpointAvailable = true;
    expect(canSeeConductors()).toBe(true);

    const store = new MagnumServiceStore();
    await store.fetchList();
    expect(store.list.data).toEqual([conductor]);
    expect(magnum.requests).toEqual([
      expect.objectContaining({ method: 'GET', path: '/v1/mservices' }),
    ]);
  } finally {
    setPolicies(originalPolicies);
    magnum.restore();
  }
});
