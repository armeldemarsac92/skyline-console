// SPDX-License-Identifier: Apache-2.0

export function findFlavor(flavors, ref) {
  if (!ref) return undefined;
  return (
    flavors.find((flavor) => flavor.id === ref) ||
    flavors.find((flavor) => flavor.name === ref)
  );
}

export async function resolveMagnumFlavors(item, nova) {
  if (!item.flavor_id && !item.master_flavor_id) return {};
  const { flavors = [] } = await nova.flavors.list();
  return {
    flavor: findFlavor(flavors, item.flavor_id),
    masterFlavor: findFlavor(flavors, item.master_flavor_id),
  };
}
