// SPDX-License-Identifier: Apache-2.0
import React, { Component } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Input,
  Modal,
  Space,
  Table,
  Tag,
} from 'antd';
import { inject, observer } from 'mobx-react';
import client from 'client';
import ActionButton from 'components/Tables/Base/ActionButton';
import { clusterStatus } from 'resources/magnum/cluster';
import { hasMagnumPolicy, isCapiHelm } from 'resources/magnum/capabilities';
import {
  autoscaling,
  autoscalingRange,
  canChangeCluster,
  canChangeGroup,
  canListGroups,
  canPatchCluster,
  canPatchResize,
  canShowGroup,
  clusterBelongsToProject,
  isDefaultWorker,
  isFailed,
  isInProgress,
  listGroups,
  magnumError,
  magnumStatus,
  showGroup,
  manualResizeRestriction,
  versionOptions,
} from 'resources/magnum/nodegroups';
import Resize from '../../actions/Resize';
import GroupForm from './GroupForm';
import styles from './index.less';

const bounds = ['min_node_count', 'max_node_count'];
const statusText = (status) => clusterStatus[status] || status || '-';
const valueText = (value) => {
  if (value == null) return '-';
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : value;
};

function GroupDetail({ cluster, group, close, version }) {
  const range = autoscalingRange(cluster, group);
  const fields = [
    [t('Name'), 'name'],
    [t('UUID'), 'uuid'],
    [t('Role'), 'role'],
    [t('Flavor'), 'flavor_id'],
    [t('Node Count'), 'node_count'],
    [t('Minimum Node Count'), 'min_node_count'],
    [t('Maximum Node Count'), 'max_node_count'],
    [t('Node Addresses'), 'node_addresses'],
    [t('Status Reason'), 'status_reason'],
  ];
  const recorded = [
    [t('Image'), 'image_id'],
    [t('Docker Volume Size'), 'docker_volume_size'],
    [t('Labels'), 'labels'],
  ];
  if (version === '1.14') {
    recorded.push(
      [t('Node Labels'), 'node_labels'],
      [t('Node Taints'), 'node_taints']
    );
  }
  return (
    <Modal
      visible
      title={t('Node Group Detail')}
      onCancel={close}
      footer={null}
      width={720}
    >
      <Descriptions size="small" column={1} bordered>
        {fields.map(([label, key]) => (
          <Descriptions.Item key={key} label={label}>
            {valueText(group[key])}
          </Descriptions.Item>
        ))}
        {range !== undefined && (
          <Descriptions.Item label={t('Autoscaling Bounds')}>
            {range}
          </Descriptions.Item>
        )}
        <Descriptions.Item label={t('Default')}>
          {group.is_default ? t('Yes') : t('No')}
        </Descriptions.Item>
        <Descriptions.Item label={t('Status')}>
          {statusText(group.status)}
        </Descriptions.Item>
      </Descriptions>
      <Descriptions
        size="small"
        column={1}
        bordered
        title={t('Values Stored in Magnum')}
      >
        {recorded
          .filter(([, key]) => group[key] != null)
          .map(([label, key]) => (
            <Descriptions.Item key={key} label={label}>
              <pre
                style={{
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                  margin: 0,
                }}
              >
                {valueText(group[key])}
              </pre>
            </Descriptions.Item>
          ))}
      </Descriptions>
    </Modal>
  );
}

export class NodeGroups extends Component {
  pending = new Map();

  loadId = 0;

  constructor(props) {
    super(props);
    this.state = {
      groups: [],
      role: '',
      sortDir: 'asc',
      loading: true,
    };
  }

  componentDidMount() {
    this.load();
  }

  componentDidUpdate(prevProps) {
    if ((prevProps.detail.uuid || prevProps.detail.id) !== this.clusterId) {
      this.pending.clear();
      this.load(false, true);
    }
  }

  componentWillUnmount() {
    clearTimeout(this.timer);
    this.loadId += 1;
  }

  get clusterId() {
    const { detail } = this.props;
    return detail.uuid || detail.id;
  }

  get adminContext() {
    return hasMagnumPolicy('context_is_admin');
  }

  get canMutate() {
    const { detail, rootStore } = this.props;
    return clusterBelongsToProject(detail, rootStore.projectId);
  }

  get busy() {
    return this.pending.size > 0 || !canChangeCluster(this.props.detail);
  }

  get columns() {
    const { sortDir } = this.state;
    const { detail } = this.props;
    return [
      {
        title: t('Name'),
        dataIndex: 'name',
        sorter: true,
        sortOrder: sortDir === 'desc' ? 'descend' : 'ascend',
        sortDirections: ['ascend', 'descend', 'ascend'],
      },
      { title: t('Role'), dataIndex: 'role' },
      {
        title: t('Default'),
        dataIndex: 'is_default',
        render: (value) => (value ? t('Yes') : t('No')),
      },
      { title: t('Flavor'), dataIndex: 'flavor_id', render: valueText },
      { title: t('Node Count'), dataIndex: 'node_count', render: valueText },
      {
        title: t('Minimum Node Count'),
        dataIndex: 'min_node_count',
        render: valueText,
      },
      {
        title: t('Maximum Node Count'),
        dataIndex: 'max_node_count',
        render: valueText,
      },
      ...(isCapiHelm(detail) && autoscaling(detail) === true
        ? [
            {
              title: t('Autoscaling Bounds'),
              key: 'autoscaling',
              render: (_, group) =>
                (group.detailed && autoscalingRange(detail, group)) || '-',
            },
          ]
        : []),
      {
        title: t('Status'),
        dataIndex: 'status',
        render: (status, group) => (
          <Space direction="vertical" size={0}>
            <span>{statusText(group.requestStatus || status)}</span>
            {group.pending && <Tag color="blue">{t('Request Accepted')}</Tag>}
            {(group.requestReason ||
              (isFailed(group) && group.status_reason)) && (
              <div className={styles['cell-message']}>
                {group.requestReason || group.status_reason}
              </div>
            )}
          </Space>
        ),
      },
      { title: t('Action'), key: 'action', render: this.renderActions },
    ];
  }

  load = async (silent = false, reset = false) => {
    const id = this.clusterId;
    if (!id) return;
    clearTimeout(this.timer);
    this.loadId += 1;
    const { loadId } = this;
    const { role, sortDir } = this.state;
    if (!silent) {
      this.setState({
        loading: true,
        error: undefined,
        ...(reset ? { groups: [], modal: undefined } : {}),
      });
    }
    try {
      const supported = await client.magnum.supportsVersion('1.9');
      const readable = canListGroups(this.adminContext);
      if (!supported || !readable) {
        if (loadId === this.loadId)
          this.setState({ supported, readable, loading: false });
        return;
      }
      const version = (await client.magnum.supportsVersion('1.14'))
        ? '1.14'
        : '1.9';
      const params = { sort_key: 'name', sort_dir: sortDir };
      if (role) params.role = role;
      const summaries = await listGroups(id, version, params);
      const byId = new Map(summaries.map((group) => [group.uuid, group]));
      this.pending.forEach(({ group }, uuid) => {
        if (!byId.has(uuid)) byId.set(uuid, { ...group, outsideList: true });
      });
      const tracksCluster = Array.from(this.pending.values()).some(
        ({ operation }) => operation === 'patch'
      );

      const groupDetails = Promise.all(
        Array.from(byId.values(), async (summary) => {
          if (!canShowGroup(this.adminContext)) {
            return {
              ...summary,
              missing: summary.outsideList && (!role || summary.role === role),
            };
          }
          try {
            return {
              ...(await showGroup(id, summary.uuid, version)),
              detailed: true,
            };
          } catch (reason) {
            if (magnumStatus(reason) === 404)
              return { ...summary, missing: true };
            return {
              ...summary,
              detailError: magnumError(
                reason,
                t('Unable to load node group detail.')
              ),
            };
          }
        })
      );
      const [records, cluster] = await Promise.all([
        groupDetails,
        tracksCluster
          ? client.magnum.clusters.show(id, null, versionOptions(version))
          : undefined,
      ]);
      if (loadId !== this.loadId) return;

      const groups = records
        .map((group) => this.applyPending(group, cluster))
        .filter((group) => group && (!role || group.role === role));
      this.setState({
        groups,
        supported,
        readable,
        version,
        loading: false,
        error: undefined,
      });
      if (this.pending.size || groups.some(isInProgress)) {
        this.timer = setTimeout(() => this.refresh(true), 5000);
      }
    } catch (reason) {
      if (loadId !== this.loadId) return;
      this.setState({
        loading: false,
        error: magnumError(reason, t('Unable to load node groups.')),
      });
      if (this.pending.size) {
        this.timer = setTimeout(() => this.refresh(true), 5000);
      }
    }
  };

  refresh = (silent = false) => {
    this.props.refreshDetail?.(true);
    return this.load(silent);
  };

  accepted = (operation, group, matches) => {
    const { detail } = this.props;
    this.pending.set(group.uuid, {
      group,
      operation,
      matches,
      cluster: detail,
    });
    this.setState(({ groups }) => ({
      groups: groups.map((current) =>
        current.uuid === group.uuid ? { ...current, pending: true } : current
      ),
    }));
    this.refresh(true);
  };

  saveGroup = async (values) => {
    const { detail } = this.props;
    const { modal, version } = this.state;
    const { group } = modal;
    const creating = modal.kind === 'create';
    const current = this.currentGroup(group);
    if (
      !this.canMutate ||
      !isCapiHelm(detail) ||
      this.busy ||
      (creating
        ? !detail.api_address || !hasMagnumPolicy('nodegroup:create')
        : !current?.detailed ||
          current.role === 'master' ||
          !canChangeGroup(current) ||
          !hasMagnumPolicy('nodegroup:update'))
    ) {
      throw new Error(t('Unable to save the node group.'));
    }
    const groups = client.magnum.clusters.nodegroups;
    if (creating) {
      const body = {
        name: values.name.trim(),
        role: values.role.trim(),
        node_count: values.node_count,
      };
      if (values.flavor_id) body.flavor_id = values.flavor_id;
      bounds.forEach((key) => {
        if (values[key] != null) body[key] = values[key];
      });
      const result = await groups.create(
        this.clusterId,
        body,
        null,
        versionOptions(version)
      );
      this.accepted(
        'create',
        { ...body, ...result },
        (resultGroup) => !!resultGroup.status
      );
    } else {
      const changed = bounds.filter(
        (key) => (values[key] ?? null) !== (group[key] ?? null)
      );
      if (!changed.length) return;
      const patch = changed.map((key) =>
        values[key] == null
          ? { op: 'remove', path: `/${key}` }
          : {
              op: current[key] === undefined ? 'add' : 'replace',
              path: `/${key}`,
              value: values[key],
            }
      );
      await groups.patch(
        this.clusterId,
        group.uuid,
        patch,
        null,
        versionOptions(version)
      );
      this.accepted('update', current, (result) =>
        changed.every((key) => {
          const fallback = key === 'min_node_count' ? 0 : null;
          return (result[key] ?? fallback) === (values[key] ?? fallback);
        })
      );
    }
  };

  deleteGroup = async () => {
    const { detail } = this.props;
    const { modal, version, deleting } = this.state;
    const group = this.currentGroup(modal.group);
    if (
      deleting ||
      !this.canMutate ||
      !isCapiHelm(detail) ||
      !hasMagnumPolicy('nodegroup:delete') ||
      !group ||
      !this.canDeleteGroup(group)
    ) {
      return;
    }
    this.setState({ deleting: true, deleteError: undefined });
    try {
      await client.magnum.clusters.nodegroups.delete(
        this.clusterId,
        group.uuid,
        null,
        null,
        versionOptions(version)
      );
      this.accepted('delete', group);
      this.setState({ modal: undefined, deleting: false });
    } catch (reason) {
      this.setState({
        deleting: false,
        deleteError: magnumError(reason, t('Unable to delete the node group.')),
      });
    }
  };

  showModal = (kind, group) =>
    this.setState({ modal: { kind, group }, deleteError: undefined });

  closeModal = () => this.setState({ modal: undefined });

  currentGroup(group) {
    const { groups } = this.state;
    return groups.find(({ uuid }) => uuid === group?.uuid);
  }

  canDeleteGroup(group) {
    const { detail } = this.props;
    return (
      !group.is_default &&
      !this.pending.size &&
      !isInProgress(detail) &&
      detail.status !== 'DELETE_COMPLETE' &&
      !isInProgress(group) &&
      group.status !== 'DELETE_COMPLETE'
    );
  }

  applyPending(group, cluster) {
    const entry = this.pending.get(group.uuid);
    if (!entry) return group.missing ? undefined : group;

    // Cluster PATCH updates the cluster status and leaves the worker status alone.
    const patch = entry.operation === 'patch';
    const current = patch ? cluster : group;
    const previous = patch ? entry.cluster : entry.group;
    if (isInProgress(current)) entry.started = true;
    // The first read can still show the previous failure while Magnum queues the retry.
    const deleteFailed =
      entry.operation === 'delete' && current.status === 'DELETE_FAILED';
    const repeatedFailure = deleteFailed && entry.deleteFailed;
    entry.deleteFailed = deleteFailed;
    const failed =
      isFailed(current) &&
      (entry.started ||
        repeatedFailure ||
        current.status !== previous.status ||
        current.status_reason !== previous.status_reason);
    const completed =
      entry.operation === 'delete'
        ? group.missing || group.status === 'DELETE_COMPLETE'
        : !group.missing &&
          (group.detailed || !group.outsideList) &&
          !isInProgress(current) &&
          (entry.started || entry.matches(group));
    if (failed || completed) {
      this.pending.delete(group.uuid);
      if (group.missing) return undefined;
      return failed && patch
        ? {
            ...group,
            requestStatus: cluster.status,
            requestReason: cluster.status_reason,
          }
        : group;
    }
    return {
      ...group,
      pending: true,
      requestStatus: patch ? cluster.status : undefined,
    };
  }

  renderActions = (_, group) => {
    const { detail } = this.props;
    const canResize = hasMagnumPolicy('cluster:resize');
    const canPatch =
      !canResize && isDefaultWorker(group) && canPatchResize(this.adminContext);
    const capi = isCapiHelm(detail);
    const blocked = this.busy || !canChangeGroup(group);
    const resizeRestriction =
      group.detailed && manualResizeRestriction(detail, group);
    if (group.detailError) {
      return (
        <div className={styles['cell-message']} role="alert">
          {group.detailError}
        </div>
      );
    }
    return (
      <Space wrap>
        {group.detailed && (
          <Button type="link" onClick={() => this.showModal('detail', group)}>
            {t('Detail')}
          </Button>
        )}
        {this.canMutate &&
          group.detailed &&
          (canPatch || (canResize && (group.role !== 'master' || capi))) && (
            <ActionButton
              id={`resize-node-group-${group.uuid}`}
              title={t('Resize')}
              item={detail}
              action={Resize}
              actionType="modal"
              isAllowed={
                !blocked &&
                !resizeRestriction &&
                (!canPatch || canPatchCluster(detail))
              }
              needHide={false}
              containerProps={{
                nodeGroup: group,
                onResizeAccepted: (current, count, patchOnly) =>
                  this.accepted(
                    patchOnly ? 'patch' : 'update',
                    current,
                    (next) => next.node_count === count
                  ),
              }}
            />
          )}
        {this.canMutate &&
          capi &&
          group.detailed &&
          group.role !== 'master' &&
          hasMagnumPolicy('nodegroup:update') && (
            <Button
              type="link"
              disabled={blocked}
              onClick={() => this.showModal('bounds', group)}
            >
              {t('Edit Bounds')}
            </Button>
          )}
        {this.canMutate &&
          capi &&
          !group.is_default &&
          hasMagnumPolicy('nodegroup:delete') && (
            <Button
              type="link"
              danger
              disabled={!this.canDeleteGroup(group)}
              onClick={() => this.showModal('delete', group)}
            >
              {t('Delete')}
            </Button>
          )}
      </Space>
    );
  };

  renderModal() {
    const { modal, version, deleting, deleteError } = this.state;
    if (!modal) return null;
    const { detail } = this.props;
    const { kind, group } = modal;
    if (kind === 'detail') {
      const current = this.currentGroup(group) || group;
      return (
        <GroupDetail
          cluster={detail}
          group={current}
          close={this.closeModal}
          version={version}
        />
      );
    }
    if (kind === 'delete') {
      return (
        <Modal
          visible
          title={t('Delete Node Group')}
          onOk={this.deleteGroup}
          okText={t('Delete')}
          okButtonProps={{ danger: true }}
          confirmLoading={deleting}
          onCancel={deleting ? undefined : this.closeModal}
          maskClosable={false}
        >
          {deleteError && <Alert type="error" message={deleteError} showIcon />}
          <p>
            {t('Delete node group {group} from cluster {cluster}?', {
              group: group.name,
              cluster: detail.name,
            })}
          </p>
        </Modal>
      );
    }
    return (
      <GroupForm
        cluster={detail}
        group={group}
        submit={this.saveGroup}
        close={this.closeModal}
      />
    );
  }

  renderContent() {
    const { detail } = this.props;
    const { groups, supported, readable, loading, error } = this.state;
    if (supported === false)
      return (
        <Alert
          type="info"
          message={t('This Magnum endpoint does not support node groups.')}
          showIcon
        />
      );
    if (readable === false)
      return (
        <Alert
          type="info"
          message={t('You do not have permission to list node groups.')}
          showIcon
        />
      );
    const capi = isCapiHelm(detail);
    const scaling = autoscaling(detail);
    return (
      <Space direction="vertical" style={{ width: '100%' }}>
        <Space className={styles.toolbar} wrap>
          {this.canMutate &&
            capi &&
            supported &&
            hasMagnumPolicy('nodegroup:create') && (
              <Button
                type="primary"
                disabled={this.busy || !detail.api_address}
                onClick={() => this.showModal('create')}
              >
                {t('Create Node Group')}
              </Button>
            )}
          <Input.Search
            allowClear
            placeholder={t('Filter by Role')}
            onSearch={(role) => this.setState({ role: role.trim() }, this.load)}
          />
          <Button onClick={() => this.refresh()} loading={loading}>
            {t('Refresh')}
          </Button>
        </Space>
        {capi && !loading && (
          <div>
            {t('Autoscaling')} ·{' '}
            {scaling === undefined
              ? t('Unknown')
              : scaling
              ? t('Enabled')
              : t('Disabled')}
          </div>
        )}
        {error && <Alert type="error" message={error} showIcon />}
        <Table
          columns={this.columns}
          dataSource={groups}
          rowKey="uuid"
          loading={loading}
          scroll={{ x: 'max-content' }}
          onChange={(_, __, sorter, { action }) => {
            if (action === 'sort')
              this.setState(
                { sortDir: sorter.order === 'descend' ? 'desc' : 'asc' },
                this.load
              );
          }}
        />
        {this.renderModal()}
      </Space>
    );
  }

  render() {
    return (
      <div className={styles.panel}>
        <Card>{this.renderContent()}</Card>
      </div>
    );
  }
}

export default inject('rootStore')(observer(NodeGroups));
