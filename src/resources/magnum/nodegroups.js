// SPDX-License-Identifier: Apache-2.0
import client from 'client';
import { listAll } from 'client/magnum';
import { hasMagnumPolicy, isCapiHelm } from './capabilities';

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

const clusterLabels = (cluster) => ({
  ...cluster.template?.labels,
  ...cluster.labels,
});

export const autoscaling = (cluster) => {
  const value = String(clusterLabels(cluster).auto_scaling_enabled)
    .trim()
    .toLowerCase();
  if (['true', '1', 'yes', 'on', 'y', 't'].includes(value)) return true;
  if (['false', '0', 'no', 'off', 'n', 'f'].includes(value)) return false;
  return undefined;
};

const integerLabel = (value, fallback) => {
  const text = String(value).trim();
  return /^[+-]?\d+$/.test(text) ? Number(text) : fallback;
};

export const usesAutoscaler = (cluster, group) => {
  if (
    !isCapiHelm(cluster) ||
    group.role === 'master' ||
    autoscaling(cluster) !== true
  )
    return false;
  const labels = clusterLabels(cluster);
  const defaultWorker = isDefaultWorker(group);
  const min =
    group.min_node_count == null ||
    (defaultWorker && group.min_node_count === 1)
      ? group.node_count
      : group.min_node_count;
  const max = group.max_node_count ?? group.node_count;
  return defaultWorker
    ? integerLabel(labels.min_node_count, min) !==
        integerLabel(labels.max_node_count, max)
    : min !== max;
};

export function resizeLimits(cluster, group, zeroSupported, instancesLeft) {
  const controlPlane = group.role === 'master';
  const driver = cluster.template?.driver || cluster.driver;
  const zeroAllowed =
    zeroSupported &&
    driver &&
    (!isCapiHelm(cluster) || autoscaling(cluster) === false);
  const min = controlPlane
    ? 1
    : Math.max(group.min_node_count ?? 0, zeroAllowed ? 0 : 1);
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
