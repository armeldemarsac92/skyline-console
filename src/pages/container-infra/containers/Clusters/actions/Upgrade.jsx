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

import { inject, observer } from 'mobx-react';
import { ModalAction } from 'containers/Action';
import { ClustersStore } from 'stores/magnum/clusters';
import { ClusterTemplatesStore } from 'stores/magnum/clusterTemplates';
import { getBaseTemplateColumns } from 'resources/magnum/template';
import client from 'client';
import { hasMagnumPolicy, isCapiHelm } from 'resources/magnum/capabilities';

export class Upgrade extends ModalAction {
  static id = 'upgrade-cluster';

  static title = t('Upgrade Cluster');

  static policy = 'cluster:upgrade';

  static allowed = async (item, containerProps) => {
    if (
      !isCapiHelm(item) ||
      !/_COMPLETE$/.test(item.status) ||
      !hasMagnumPolicy('cluster:upgrade') ||
      (containerProps?.isAdminPage &&
        !hasMagnumPolicy('cluster:upgrade_all_projects'))
    )
      return false;
    return client.magnum.supportsVersion('1.8').catch(() => false);
  };

  static get modalSize() {
    return 'large';
  }

  getModalSize() {
    return 'large';
  }

  init() {
    this.store = new ClustersStore();
    this.templateStore = new ClusterTemplatesStore();
    this.getClustertemplates();
  }

  async getClustertemplates() {
    await this.templateStore.fetchList();
  }

  get clusterTemplates() {
    return (this.templateStore.list.data || []).filter(
      (template) =>
        template.uuid !== this.item.cluster_template_id &&
        template.coe === 'kubernetes' &&
        isCapiHelm(template)
    );
  }

  selectTarget = async (selection) => {
    const [template] = selection?.selectedRows || [];
    this.selectedTemplateId = template?.uuid;
    this.setState({ kubeVersion: undefined, incompatibleImage: false });
    if (!template?.image_id) return;
    try {
      const image = await client.glance.images.show(template.image_id);
      if (this.selectedTemplateId !== template.uuid) return;
      const version = image.kube_version || image.properties?.kube_version;
      this.setState({ kubeVersion: version, incompatibleImage: !version });
    } catch {
      // Magnum also validates the image when the user cannot read its metadata.
    }
  };

  get formItems() {
    return [
      {
        name: 'currentTemplate',
        label: t('Current Cluster Template'),
        type: 'label',
        content: this.item.template?.name || this.item.cluster_template_id,
      },
      {
        name: 'clusterTemplate',
        label: t('Cluster Template'),
        type: 'select-table',
        data: this.clusterTemplates,
        isLoading: this.templateStore.list.isLoading,
        required: true,
        onChange: this.selectTarget,
        tip: t(
          'This upgrade applies to the control plane and every worker group in {name}.',
          { name: this.item.name }
        ),
        filterParams: [
          {
            label: t('Name'),
            name: 'name',
          },
        ],
        columns: [
          ...getBaseTemplateColumns(this),
          { title: t('Image'), dataIndex: 'image_id' },
        ],
      },
      {
        name: 'kubeVersion',
        type: 'label',
        label: t('Target Kubernetes Version'),
        content:
          this.state.kubeVersion ||
          (this.state.incompatibleImage
            ? t('The image is missing the kube_version property.')
            : '-'),
      },
    ];
  }

  onSubmit = (values) => {
    if (this.state.incompatibleImage)
      return Promise.reject(
        new Error(t('The image is missing the kube_version property.'))
      );
    const { clusterTemplate } = values;
    const { selectedRowKeys = [] } = clusterTemplate;
    const data = {
      cluster_template: selectedRowKeys[0],
    };
    return this.store.upgrade({ id: this.item.id }, data);
  };
}

export default inject('rootStore')(observer(Upgrade));
