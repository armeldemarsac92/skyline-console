// SPDX-License-Identifier: Apache-2.0
import globalRootStore from 'stores/root';

export const isCapiHelm = (item) =>
  (item?.template || item)?.driver === 'k8s_capi_helm_v1';

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
