// SPDX-License-Identifier: Apache-2.0
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
