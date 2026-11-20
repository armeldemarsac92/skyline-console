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

  static allowed = async (item) => {
    if (
      !isCapiHelm(item) ||
      !/_COMPLETE$/.test(item.status) ||
      !hasMagnumPolicy('cluster:upgrade') ||
      (hasMagnumPolicy('context_is_admin') &&
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

  get name() {
    return t('Upgrade Cluster');
  }

  get isAsyncAction() {
    return true;
  }

  get disableSubmit() {
    return (
      super.disableSubmit ||
      this.state.checkingImage ||
      this.state.incompatibleImage
    );
  }

  unMountActions = () => {
    this.selectedTemplateId = undefined;
  };

  selectTarget = (selection) => {
    const [template] = selection?.selectedRows || [];
    this.selectedTemplateId = template?.uuid;
    this.imageCheck = undefined;
    this.setState({
      checkingImage: !!template?.image_id,
      kubeVersion: undefined,
      incompatibleImage: false,
    });
    if (!template?.image_id) return;
    this.imageCheck = client.glance.images.show(template.image_id).then(
      (image) => {
        const kubeVersion =
          image.kube_version || image.properties?.kube_version;
        return { kubeVersion, incompatibleImage: !kubeVersion };
      },
      // A private image can be usable by Magnum without exposing metadata to Skyline.
      (error) => ({ incompatibleImage: error.response?.status === 404 })
    );
    this.imageCheck.then((result) => {
      if (this.selectedTemplateId === template.uuid)
        this.setState({ checkingImage: false, ...result });
    });
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

  onSubmit = async ({ clusterTemplate }) => {
    const [id] = clusterTemplate.selectedRowKeys;
    if (id !== this.selectedTemplateId) this.selectTarget(clusterTemplate);
    const result = await this.imageCheck;
    if (!id || this.selectedTemplateId !== id || result?.incompatibleImage) {
      throw new Error(t('The image is missing the kube_version property.'));
    }
    return this.store.upgrade({ id: this.item.id }, { cluster_template: id });
  };
}

export default inject('rootStore')(observer(Upgrade));
