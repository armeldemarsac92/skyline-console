// SPDX-License-Identifier: Apache-2.0
import { memoize } from 'lodash';
import globalRootStore from 'stores/root';

const settings = GLOBAL_VARIABLES;

const triplet = (model) =>
  JSON.stringify([model.server_type, model.cluster_distro, model.coe]);

// The installed Magnum drivers can differ between regions. Index only exact,
// operator-attested tuples; conflicting entries must not enable an action.
const indexDrivers = memoize((rules) => {
  const drivers = new Map();
  rules.forEach((rule) => {
    if (!rule?.server_type || !rule.cluster_distro || !rule.coe) return;
    const key = triplet(rule);
    const driver =
      typeof rule.driver === 'string' && rule.driver ? rule.driver : null;
    drivers.set(
      key,
      drivers.has(key) && drivers.get(key) !== driver ? null : driver
    );
  });
  return drivers;
});

export function effectiveDriver(item) {
  const model = item?.template || item;
  if (model?.driver) return model.driver;
  if (!model?.server_type || !model.cluster_distro || !model.coe) return null;
  const region = globalRootStore.selectedRegion;
  const rules = region && settings.magnumDriverMappings?.[region];
  return Array.isArray(rules)
    ? indexDrivers(rules).get(triplet(model)) || null
    : null;
}

export const isCapiHelm = (item) =>
  effectiveDriver(item) === 'k8s_capi_helm_v1';

export const isHeatDriver = (item) =>
  [
    'k8s_fedora_coreos_v1',
    'k8s_fedora_atomic_v1',
    'k8s_fedora_ironic_v1',
  ].includes(effectiveDriver(item));

export function hasMagnumPolicy(rule, cluster) {
  const { policies = [], user = {} } = globalRootStore;
  const policy = policies.find((item) => item.rule === `magnum:${rule}`);
  const roles = (user?.roles || []).map((role) => role.name);
  if (policy) {
    if (rule === 'certificate:get' || rule === 'certificate:create') {
      return (
        policy.allowed &&
        (!cluster ||
          roles.includes('admin') ||
          cluster.user_id === user?.user?.id)
      );
    }
    return policy.allowed;
  }
  // The Hibiscus Skyline API server does not ship the credential rotation rule.
  return (
    rule === 'credential:rotate' &&
    policies.length > 0 &&
    roles.includes('member') &&
    !!cluster?.project_id &&
    cluster.project_id === user?.project?.id
  );
}
