// SPDX-License-Identifier: Apache-2.0
import { isCapiHelm } from './capabilities';
import { resolveMagnumFlavors } from './flavor';
import { autoscaling, defaultWorkerAutoscalingBounds } from './labels';

export async function resolveCapiFlavors(item, template, nova) {
  return isCapiHelm(template) ? resolveMagnumFlavors(item, nova) : {};
}

function clusterLabels(additionalLabels, management) {
  const entries = additionalLabels
    .filter(({ value }) => value?.key)
    .map(({ value }) => [value.key, value.value]);
  Object.entries(management).forEach(([key, value]) => {
    if (value === 'true' || value === 'false') entries.push([key, value]);
  });
  return Object.fromEntries(entries);
}

function workerLabelSource(values, labels) {
  const {
    clusterTemplate,
    additionalLabels = [],
    auto_scaling_enabled,
  } = values;
  return {
    template: clusterTemplate?.selectedRows?.[0],
    labels: labels || clusterLabels(additionalLabels, { auto_scaling_enabled }),
  };
}

export function workerCountError(values, zeroSupported, labels = undefined) {
  const { node_count } = values;
  if (!Number.isInteger(node_count) || node_count < 0) {
    return t('Enter a whole number of workers greater than or equal to zero.');
  }
  if (node_count !== 0) return '';

  const cluster = workerLabelSource(values, labels);
  if (!isCapiHelm(cluster) || !zeroSupported) {
    return t('Zero workers require a CAPI Helm template and Magnum API 1.10.');
  }
  return autoscaling(cluster) === false
    ? ''
    : t(
        'Disable autoscaling explicitly to create a CAPI cluster with zero workers.'
      );
}

export function autoscalingBoundsError(values, labels = undefined) {
  const { node_count } = values;
  const cluster = workerLabelSource(values, labels);
  if (
    node_count <= 0 ||
    !isCapiHelm(cluster) ||
    autoscaling(cluster) !== true
  ) {
    return '';
  }
  const { min, max } = defaultWorkerAutoscalingBounds(cluster);
  if (min !== undefined && (min < 1 || min > node_count)) {
    return t(
      'The autoscaling minimum must be between 1 and the initial worker count.'
    );
  }
  if (min !== undefined && max !== undefined && max < min) {
    return t('The autoscaling maximum must be at least the minimum.');
  }
  return '';
}

export function masterCountError(count, template) {
  if (!Number.isInteger(count) || count < 1) {
    return t('Enter a positive whole number of master nodes.');
  }
  if (isCapiHelm(template) && count % 2 === 0) {
    return t('CAPI Helm requires an odd number of master nodes.');
  }
  return '';
}

export function masterLoadBalancerError(count, enabled) {
  return count > 1 && enabled !== true
    ? t(
        'Enable the load balancer when creating a cluster with multiple master nodes.'
      )
    : '';
}

export function buildClusterBody(values, { zeroSupported = false } = {}) {
  const {
    additionalLabels = [],
    labelMode = 'merge',
    clusterTemplate,
    keypair,
    auto_healing_enabled,
    auto_scaling_enabled,
    newNetwork,
    fixedNetwork,
    fixedSubnet,
    flavor,
    masterFlavor,
    ...body
  } = values;
  const labels = clusterLabels(additionalLabels, {
    auto_healing_enabled,
    auto_scaling_enabled,
  });
  if (Object.keys(labels).length) {
    body.labels = labels;
    body.merge_labels = labelMode === 'merge';
  }
  const template = clusterTemplate?.selectedRows?.[0];
  if (body.node_count !== undefined) {
    const error =
      workerCountError(values, zeroSupported, labels) ||
      autoscalingBoundsError(values, labels);
    if (error) throw new Error(error);
  }
  if (body.master_count !== undefined || body.node_count === 0) {
    const error =
      masterCountError(body.master_count, template) ||
      masterLoadBalancerError(
        body.master_count,
        body.master_lb_enabled ?? template?.master_lb_enabled
      );
    if (error) throw new Error(error);
  }
  const selected = (field) => field?.selectedRowKeys?.[0] || null;
  return {
    ...body,
    cluster_template_id: selected(clusterTemplate),
    keypair: selected(keypair),
    master_flavor_id:
      masterFlavor?.selectedRows?.[0]?.name || selected(masterFlavor),
    flavor_id: flavor?.selectedRows?.[0]?.name || selected(flavor),
    fixed_network: newNetwork ? null : selected(fixedNetwork),
    fixed_subnet: newNetwork ? null : selected(fixedSubnet),
  };
}
