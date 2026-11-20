// SPDX-License-Identifier: Apache-2.0

function capiHelmLabel(cluster, key) {
  // The driver overlays cluster labels on template labels, even if Magnum replaced them.
  return cluster.labels?.[key] ?? cluster.template?.labels?.[key];
}

const sanitized = (value) =>
  String(value)
    .replace(/[^a-zA-Z0-9.\-/ _]+/g, '')
    .trim();

export function autoscaling(cluster) {
  const value = sanitized(
    capiHelmLabel(cluster, 'auto_scaling_enabled')
  ).toLowerCase();
  if (['true', '1', 'yes', 'on', 'y', 't'].includes(value)) return true;
  if (['false', '0', 'no', 'off', 'n', 'f'].includes(value)) return false;
  return undefined;
}

function integerLabel(value) {
  const text = sanitized(value);
  if (!/^-?\d(?:_?\d)*$/.test(text)) return undefined;
  const number = Number(text.replace(/_/g, ''));
  return Number.isSafeInteger(number) ? number : undefined;
}

export function defaultWorkerAutoscalingBounds(cluster) {
  // Magnum does not expose the driver's operator defaults for missing labels.
  return {
    min: integerLabel(capiHelmLabel(cluster, 'min_node_count')),
    max: integerLabel(capiHelmLabel(cluster, 'max_node_count')),
  };
}
