// Copyright 2022 99cloud
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { flavorArchitectures, flavorCategoryList } from 'resources/nova/flavor';
import { formatSize } from 'utils';
import { isCapiHelm } from './capabilities';

export function templateFlavor(selection, useFlavorNames, ref, previousFlavor) {
  const id = selection?.selectedRowKeys?.[0];
  if (!id) return null;
  const row = selection.selectedRows?.[0];
  if (ref && id === (previousFlavor?.id || ref)) return ref;
  return useFlavorNames ? row?.name || id : id;
}

export function renderMagnumFlavor(view, master = false) {
  const detail = view.detailData;
  const key = master ? 'master_flavor_id' : 'flavor_id';
  const ref = detail[key];
  const removed = detail[`original_${key}`];
  if (removed) return `${removed} (${t('The resource has been deleted')})`;
  if (!ref) return '-';
  const flavor = master ? detail.masterFlavor : detail.flavor;
  if (isCapiHelm(detail) && !flavor?.id) return ref;
  return view.getLinkRender('flavorDetail', flavor?.name || ref, {
    id: flavor?.id || ref,
  });
}

export const getBaseTemplateColumns = (self) => [
  {
    title: t('ID/Name'),
    dataIndex: 'name',
    routeName: self.getRouteName('containerInfraClusterTemplateDetail'),
  },
  { title: t('Tags'), dataIndex: 'tags', isHideable: true },
  {
    title: t('Project ID/Name'),
    dataIndex: 'project_name',
    isHideable: true,
    hidden: !self.isAdminPage,
  },
  {
    title: t('Network Driver'),
    isHideable: true,
    dataIndex: 'network_driver',
  },
  {
    title: t('Keypair'),
    isHideable: true,
    dataIndex: 'keypair_id',
    hidden: self.isAdminPage,
    render: (value) => {
      if (value) {
        return self.getLinkRender('keypairDetail', value, { id: value });
      }
      return value || '-';
    },
  },
];

export const getBaseSimpleFlavorColumns = (self) => [
  {
    title: t('ID/Name'),
    dataIndex: 'name',
    routeName: self ? self.getRouteName('flavorDetail') : '',
  },
  {
    title: t('Architecture'),
    dataIndex: 'architecture',
    valueMap: flavorArchitectures,
  },
  {
    title: t('Category'),
    dataIndex: 'category',
    render: (value) => flavorCategoryList[value] || value || '-',
  },
  {
    title: t('CPU'),
    dataIndex: 'vcpus',
    isHideable: true,
  },
  {
    title: t('Memory'),
    dataIndex: 'ram',
    isHideable: true,
    render: (ram) => formatSize(ram, 2),
  },
];
