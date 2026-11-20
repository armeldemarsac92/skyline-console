// SPDX-License-Identifier: Apache-2.0
import { isCapiHelm } from './capabilities';

export async function resolveCapiFlavors(item, template, nova) {
  if (!isCapiHelm(template) || (!item.flavor_id && !item.master_flavor_id))
    return {};
  const { flavors = [] } = await nova.flavors.list();
  const find = (ref) =>
    flavors.find((flavor) => flavor.id === ref || flavor.name === ref);
  return {
    flavor: find(item.flavor_id),
    masterFlavor: find(item.master_flavor_id),
  };
}

export function templateFlavor(selection, driver, previous) {
  const id = selection?.selectedRowKeys?.[0];
  if (!id) return null;
  const row = selection.selectedRows?.[0];
  if (previous && (previous === id || previous === row?.name)) return previous;
  return !driver || driver === 'k8s_capi_helm_v1' ? row?.name || id : id;
}

export function buildClusterBody(values) {
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
  const labels = {};
  additionalLabels.forEach(({ value }) => {
    if (value?.key) labels[value.key] = value.value;
  });
  Object.entries({ auto_healing_enabled, auto_scaling_enabled }).forEach(
    ([key, value]) => {
      if (value === 'true' || value === 'false') labels[key] = value;
    }
  );
  if (Object.keys(labels).length) {
    body.labels = labels;
    body.merge_labels = labelMode === 'merge';
  }
  const template = clusterTemplate?.selectedRows?.[0];
  if (body.node_count === 0 && template?.driver === 'k8s_capi_helm_v1') {
    const autoscaling =
      labels.auto_scaling_enabled ?? template.labels?.auto_scaling_enabled;
    if (String(autoscaling).toLowerCase() !== 'false') {
      throw new Error(
        t(
          'Disable autoscaling explicitly to create a CAPI cluster with zero workers.'
        )
      );
    }
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
