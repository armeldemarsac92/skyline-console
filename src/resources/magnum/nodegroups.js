// SPDX-License-Identifier: Apache-2.0
import client from 'client';
import { listAll } from 'client/magnum';
import { effectiveDriver, hasMagnumPolicy, isCapiHelm } from './capabilities';
import { autoscaling, defaultWorkerAutoscalingBounds } from './labels';

export { autoscaling };

const eligibleStates = [
  'CREATE_COMPLETE',
  'UPDATE_COMPLETE',
  'UPDATE_FAILED',
  'RESUME_COMPLETE',
  'RESTORE_COMPLETE',
  'ROLLBACK_COMPLETE',
  'SNAPSHOT_COMPLETE',
  'CHECK_COMPLETE',
  'ADOPT_COMPLETE',
];

export const canChangeCluster = ({ status } = {}) =>
  eligibleStates.includes(status);
export const canChangeGroup = (group) =>
  !group.pending && canChangeCluster(group);
export const canPatchCluster = (cluster) =>
  canChangeCluster(cluster) && cluster.status !== 'UPDATE_FAILED';
export const clusterBelongsToProject = (cluster, projectId) =>
  Boolean(projectId && cluster.project_id === projectId);
export const isDefaultWorker = ({ role, is_default: isDefault }) =>
  isDefault === true && role === 'worker';
export const isInProgress = ({ status } = {}) =>
  status?.endsWith('_IN_PROGRESS');
export const isFailed = ({ status } = {}) => status?.endsWith('_FAILED');

const allowed = (rule, allProjects, admin) =>
  hasMagnumPolicy(rule) && (!admin || hasMagnumPolicy(allProjects));

export const canListGroups = (admin) =>
  allowed('nodegroup:get_all', 'nodegroup:get_all_all_projects', admin);
export const canShowGroup = (admin) =>
  allowed('nodegroup:get', 'nodegroup:get_one_all_projects', admin);
export const canPatchResize = (admin) =>
  allowed('cluster:update', 'cluster:update_all_projects', admin) &&
  hasMagnumPolicy('cluster:update_health_status');

const autoscalingBounds = (cluster, group) => {
  if (
    !isCapiHelm(cluster) ||
    group.role === 'master' ||
    autoscaling(cluster) !== true
  ) {
    return undefined;
  }
  if (isDefaultWorker(group)) {
    return defaultWorkerAutoscalingBounds(cluster);
  }
  return {
    min: group.min_node_count ?? group.node_count,
    max: group.max_node_count ?? group.node_count,
  };
};

export function manualResizeRestriction(cluster, group) {
  if (group.role === 'master') return undefined;
  const scaling = autoscaling(cluster);
  if (
    (!effectiveDriver(cluster) && scaling === true) ||
    (isCapiHelm(cluster) && scaling === undefined)
  ) {
    return t(
      'Manual resize is unavailable until the driver and autoscaling settings are verified.'
    );
  }
  const bounds = autoscalingBounds(cluster, group);
  if (
    bounds &&
    (bounds.min === undefined ||
      bounds.max === undefined ||
      bounds.min !== bounds.max)
  ) {
    return t('The autoscaler controls this group.');
  }
  return undefined;
}

export const autoscalingRange = (cluster, group) => {
  const bounds = autoscalingBounds(cluster, group);
  if (!bounds) return undefined;
  const { min, max } = bounds;
  if (min === undefined && max === undefined) return t('Unknown');
  return `${min ?? t('Unknown')} – ${max ?? t('Unknown')}`;
};

export function resizeLimits(cluster, group, zeroSupported, instancesLeft) {
  const controlPlane = group.role === 'master';
  const driver = effectiveDriver(cluster);
  const zeroAllowed =
    zeroSupported &&
    driver &&
    (!isCapiHelm(cluster) || autoscaling(cluster) === false);
  const effectiveMin = isDefaultWorker(group)
    ? autoscalingBounds(cluster, group)?.min
    : undefined;
  const min = controlPlane
    ? 1
    : Math.max(
        group.min_node_count ?? 0,
        effectiveMin ?? 0,
        zeroAllowed ? 0 : 1
      );
  const caps = [controlPlane ? undefined : group.max_node_count || undefined];
  if (instancesLeft >= 0) caps.push(group.node_count + instancesLeft);
  const max = Math.min(...caps.filter((cap) => cap !== undefined));
  return { min, max: Number.isFinite(max) ? max : undefined };
}

export const versionOptions = (version) =>
  client.magnum.versionOptions(version);

export const listGroups = (clusterId, version, params = {}) =>
  listAll(
    (query) =>
      client.magnum.clusters.nodegroups.list(
        clusterId,
        query,
        versionOptions(version)
      ),
    'nodegroups',
    params
  );

export const showGroup = (clusterId, groupId, version) =>
  client.magnum.clusters.nodegroups.show(
    clusterId,
    groupId,
    null,
    versionOptions(version)
  );

export const magnumError = (error, fallback) => {
  const data = error?.response?.data ?? error?.data;
  return (
    data?.faultstring ||
    data?.errors?.[0]?.detail ||
    data?.title ||
    data?.message ||
    error?.message ||
    fallback
  );
};

export const magnumStatus = (error) => error?.response?.status ?? error?.status;
