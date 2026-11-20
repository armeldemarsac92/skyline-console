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

import React from 'react';
import { Alert, Button, Spin } from 'antd';
import { inject, observer } from 'mobx-react';
import { ModalAction } from 'containers/Action';
import Notify from 'components/Notify';
import client from 'client';
import globalProjectStore from 'stores/keystone/project';
import globalRootStore from 'stores/root';
import {
  effectiveDriver,
  hasMagnumPolicy,
  isCapiHelm,
} from 'resources/magnum/capabilities';
import {
  autoscalingRange,
  canChangeCluster,
  canChangeGroup,
  canListGroups,
  canPatchCluster,
  canPatchResize,
  canShowGroup,
  clusterBelongsToProject,
  isDefaultWorker,
  listGroups,
  magnumError,
  manualResizeRestriction,
  resizeLimits,
  showGroup,
  versionOptions,
} from 'resources/magnum/nodegroups';

export class Resize extends ModalAction {
  init() {
    this.state.loading = true;
  }

  static id = 'resize-cluster';

  static title = t('Resize Cluster');

  static get modalSize() {
    return 'middle';
  }

  getModalSize() {
    return 'middle';
  }

  static allowed(cluster) {
    const admin = hasMagnumPolicy('context_is_admin');
    return (
      canChangeCluster(cluster) &&
      (!cluster.project_id ||
        clusterBelongsToProject(cluster, globalRootStore.projectId)) &&
      (hasMagnumPolicy('cluster:resize') ||
        (canPatchCluster(cluster) && canPatchResize(admin)))
    );
  }

  componentDidMount() {
    this.load();
  }

  unMountActions = () => {
    this.unmounted = true;
  };

  get name() {
    return t('Resize Cluster');
  }

  get instanceName() {
    return this.group?.name || this.item.name;
  }

  get isAsyncAction() {
    return true;
  }

  get group() {
    const { groups = [], selectedGroup, sourceGroup } = this.state;
    const group = groups.find(({ uuid }) => uuid === selectedGroup);
    if (!group || !this.cluster) return undefined;

    const { nodeGroup } = this.containerProps;
    if (nodeGroup === sourceGroup) return group;
    return sourceGroup && nodeGroup?.detailed && nodeGroup.uuid === group.uuid
      ? nodeGroup
      : undefined;
  }

  get cluster() {
    const { cluster, sourceItem, region } = this.state;
    const { projectId, selectedRegion } = this.props.rootStore;
    const { id, uuid, labels, project_id: owner, status, template } = this.item;
    if (
      !cluster ||
      (cluster.uuid || cluster.id) !== (uuid || id) ||
      selectedRegion !== region ||
      !clusterBelongsToProject(cluster, projectId)
    ) {
      return undefined;
    }
    if (sourceItem === this.item) return cluster;
    return {
      ...cluster,
      labels: labels ?? cluster.labels,
      project_id: owner ?? cluster.project_id,
      status: status ?? cluster.status,
      template: template ?? cluster.template,
    };
  }

  get resizeRestriction() {
    const { cluster, group } = this;
    if (!group) return undefined;
    if (!canChangeGroup(group)) {
      return t('No node groups are available to resize.');
    }
    return manualResizeRestriction(cluster, group);
  }

  get canSpecifyNodesToRemove() {
    return effectiveDriver(this.cluster) && !isCapiHelm(this.cluster);
  }

  get limits() {
    const { version, instances } = this.state;
    if (!this.group) return { min: 1 };
    return resizeLimits(
      this.cluster,
      this.group,
      version === '1.10',
      instances?.left
    );
  }

  load = async () => {
    this.setState({ loading: true, loadError: undefined });
    try {
      const { magnum } = client;
      const sourceItem = this.item;
      const id = sourceItem.uuid || sourceItem.id;
      const { nodeGroup } = this.containerProps;
      const { projectId, selectedRegion } = this.props.rootStore;
      const admin = hasMagnumPolicy('context_is_admin');
      const patchOnly = !hasMagnumPolicy('cluster:resize');
      if (patchOnly && !canPatchResize(admin)) {
        throw new Error(
          t('You do not have permission to resize this cluster.')
        );
      }
      const hasGroups = await magnum.supportsVersion('1.9');
      const version = hasGroups
        ? (await magnum.supportsVersion('1.10'))
          ? '1.10'
          : '1.9'
        : (await magnum.supportsVersion('1.8'))
        ? '1.8'
        : '1.7';

      const item = sourceItem.project_id
        ? sourceItem
        : {
            ...sourceItem,
            ...(await magnum.clusters.show(id, null, versionOptions(version))),
          };
      const eligible = patchOnly
        ? canPatchCluster(item)
        : canChangeCluster(item);
      if (!eligible || !clusterBelongsToProject(item, projectId)) {
        throw new Error(
          t('You do not have permission to resize this cluster.')
        );
      }
      const template =
        item.template ||
        (item.cluster_template_id
          ? await magnum.clusterTemplates.show(item.cluster_template_id)
          : undefined);
      const cluster = { ...item, template };
      let groups;
      if (hasGroups) {
        if (!canShowGroup(admin) || (!nodeGroup && !canListGroups(admin))) {
          throw new Error(
            t('Node group access is required to resize this cluster.')
          );
        }
        const summaries = nodeGroup ? [nodeGroup] : await listGroups(id, '1.9');
        const eligibleGroups = summaries.filter((group) => {
          if (!group.uuid || !canChangeGroup(group)) return false;
          if (patchOnly) return isDefaultWorker(group);
          return group.role !== 'master' || isCapiHelm(cluster);
        });
        groups = await Promise.all(
          eligibleGroups.map((group) => showGroup(id, group.uuid, '1.9'))
        );
        groups = groups.filter(canChangeGroup);
      } else {
        if (!(await magnum.supportsVersion(version))) {
          throw new Error(
            t('This Magnum endpoint does not support cluster resize.')
          );
        }
        groups = [
          {
            uuid: '',
            name: t('Default Worker'),
            role: 'worker',
            is_default: true,
            node_count: cluster.node_count,
            status: cluster.status,
          },
        ];
      }

      if (!groups.length) {
        throw new Error(t('No node groups are available to resize.'));
      }
      const quota = await globalProjectStore
        .fetchProjectNovaQuota()
        .catch(() => undefined);
      const initialGroup = groups.find(isDefaultWorker) || groups[0];
      if (!this.unmounted) {
        this.setState({
          loading: false,
          cluster,
          sourceItem,
          sourceGroup: nodeGroup,
          region: selectedRegion,
          groups,
          version,
          patchOnly,
          hasGroups,
          instances: quota?.instances,
          selectedGroup: initialGroup.uuid,
          changed_node_count: initialGroup.node_count,
        });
      }
    } catch (error) {
      if (!this.unmounted) {
        this.setState({
          loading: false,
          loadError: magnumError(error, t('Unable to load node groups.')),
        });
      }
    }
  };

  get defaultValue() {
    return {
      nodegroup: this.group?.uuid,
      changed_node_count: this.group?.node_count,
    };
  }

  get nameForStateUpdate() {
    return ['changed_node_count'];
  }

  onValuesChange = ({ nodegroup, changed_node_count: size }) => {
    if (nodegroup !== undefined) {
      const group = this.state.groups.find(({ uuid }) => uuid === nodegroup);
      this.getFormInstance().setFieldsValue({
        changed_node_count: group.node_count,
        nodes_to_remove: undefined,
      });
      this.setState({
        selectedGroup: nodegroup,
        changed_node_count: group.node_count,
        submitError: undefined,
      });
    } else if (size !== undefined && this.state.submitError) {
      this.setState({ submitError: undefined });
    }
  };

  countError(count) {
    const { group, resizeRestriction } = this;
    if (!group) return t('No node groups are available to resize.');
    if (resizeRestriction) return resizeRestriction;
    const { min, max } = this.limits;
    if (
      !Number.isInteger(count) ||
      count < min ||
      (max !== undefined && count > max)
    ) {
      return t('Enter a node count within the allowed limits.');
    }
    if (count === group.node_count) {
      return t('The changed node count can not be equal to the current value');
    }
    if (group.role === 'master' && count % 2 === 0) {
      return t('The control plane requires a positive odd node count.');
    }
    return undefined;
  }

  validateCount = (_, count) => {
    const error = this.countError(count);
    return error ? Promise.reject(new Error(error)) : Promise.resolve();
  };

  get formItems() {
    const { changed_node_count, groups, hasGroups, patchOnly } = this.state;
    const { nodeGroup } = this.containerProps;
    const { node_count: count } = this.group;
    const { min, max } = this.limits;
    const delta = Math.max(0, (changed_node_count ?? count) - count);
    return [
      {
        name: 'nodegroup',
        label: t('Node Group'),
        type: 'select',
        options: groups.map(({ uuid, name }) => ({ value: uuid, label: name })),
        required: true,
        display: hasGroups && !nodeGroup && !patchOnly,
      },
      {
        name: 'current_node_count',
        label: t('Current Node Count'),
        type: 'label',
        content: String(count),
      },
      {
        name: 'changed_node_count',
        label: t('Changed Node Count'),
        type: 'input-int',
        min,
        max,
        step: this.group.role === 'master' ? 2 : 1,
        required: true,
        validator: this.validateCount,
        disabled: !!this.resizeRestriction,
      },
      {
        name: 'instance_delta',
        label: t('Additional Instances'),
        type: 'label',
        content: String(delta),
      },
      {
        name: 'nodes_to_remove',
        label: t('Nodes To Remove'),
        type: 'textarea',
        placeholder: t(
          'Please enter the server ID to be reduced, and separate different ID with ","'
        ),
        validator: (_, value) => {
          const pattern = /^[0-9a-zA-Z]+([0-9a-zA-Z,-][0-9a-zA-Z]+)*$/;
          return !value || pattern.test(value)
            ? Promise.resolve()
            : Promise.reject(new Error(t('Please enter the correct ID')));
        },
        display:
          !patchOnly &&
          this.canSpecifyNodesToRemove &&
          changed_node_count < count,
      },
    ];
  }

  renderForms() {
    const { loading, loadError, submitError, changed_node_count } = this.state;
    const { cluster, group } = this;
    if (loading) return <Spin />;
    if (loadError) {
      return (
        <Alert
          type="error"
          showIcon
          message={loadError}
          action={<Button onClick={this.load}>{t('Retry')}</Button>}
        />
      );
    }
    if (!group) {
      return (
        <Alert
          type="error"
          showIcon
          message={t('No node groups are available to resize.')}
        />
      );
    }
    const range = autoscalingRange(cluster, group);
    return (
      <Spin spinning={this.isSubmitting}>
        {this.resizeRestriction && (
          <Alert
            type="info"
            showIcon
            message={this.resizeRestriction}
            description={range && `${t('Autoscaling Bounds')} · ${range}`}
          />
        )}
        {isCapiHelm(cluster) && changed_node_count === 0 && (
          <Alert
            type="info"
            showIcon
            message={t(
              'Scaling to zero is asynchronous and depends on the installed Kubernetes chart.'
            )}
          />
        )}
        {submitError && <Alert type="error" showIcon message={submitError} />}
        {super.renderForms()}
      </Spin>
    );
  }

  onClickSubmit = (callback) => {
    const { loading, loadError } = this.state;
    if (
      loading ||
      loadError ||
      this.isSubmitting ||
      !this.group ||
      this.resizeRestriction
    ) {
      return;
    }
    this.checkFormInput(async (values) => {
      if (this.isSubmitting) return;
      this.updateSubmitting(true);
      this.setState({ submitError: undefined });
      try {
        await this.onSubmit(values);
      } catch (error) {
        if (!this.unmounted) {
          this.updateSubmitting(false);
          this.setState({ submitError: magnumError(error, this.errorText) });
        }
        return;
      }
      if (!this.unmounted) {
        callback?.(true, false);
        Notify.success(this.successText);
      }
    });
  };

  onSubmit = async ({
    changed_node_count: count,
    nodes_to_remove: nodesToRemove,
  }) => {
    const { patchOnly, hasGroups, version } = this.state;
    const { projectId } = this.props.rootStore;
    const { cluster, group } = this;
    const allowed = patchOnly
      ? canPatchCluster(cluster) &&
        canPatchResize(hasMagnumPolicy('context_is_admin')) &&
        group &&
        isDefaultWorker(group)
      : canChangeCluster(cluster) &&
        hasMagnumPolicy('cluster:resize') &&
        (group?.role !== 'master' || isCapiHelm(cluster));
    if (
      this.unmounted ||
      !group ||
      !canChangeGroup(group) ||
      !allowed ||
      !clusterBelongsToProject(cluster, projectId)
    ) {
      throw new Error(t('You do not have permission to resize this cluster.'));
    }
    const countError = this.countError(count);
    if (countError) throw new Error(countError);
    const id = cluster.uuid || cluster.id;
    const options = versionOptions(version);
    if (patchOnly) {
      await client.magnum.clusters.patch(
        id,
        [{ op: 'replace', path: '/node_count', value: count }],
        null,
        options
      );
    } else {
      const body = { node_count: count };
      if (hasGroups) body.nodegroup = group.uuid;
      if (
        this.canSpecifyNodesToRemove &&
        count < group.node_count &&
        nodesToRemove
      ) {
        body.nodes_to_remove = nodesToRemove.split(',');
      }
      await client.magnum.clusters.resize(id, body, null, options);
    }
    this.containerProps.onResizeAccepted?.(group, count, patchOnly);
  };
}

export default inject('rootStore')(observer(Resize));
