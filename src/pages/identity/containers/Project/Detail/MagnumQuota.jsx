// SPDX-License-Identifier: Apache-2.0
import React, { Component } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
} from 'antd';
import Notify from 'components/Notify';
import { inject, observer } from 'mobx-react';
import { ProjectStore } from 'stores/keystone/project';
import styles from './index.less';

export class MagnumQuotaPanel extends Component {
  constructor(props) {
    super(props);
    this.store = new ProjectStore();
    this.state = { editing: false, saving: false };
  }

  componentDidMount() {
    this.store.fetchProjectMagnumQuota(this.props.projectId);
  }

  componentWillUnmount() {
    this.unmounted = true;
  }

  saveQuota = async ({ hardLimit }) => {
    const { projectId } = this.props;
    this.setState({ saving: true });
    try {
      await this.store.saveProjectMagnumQuota(projectId, hardLimit);
      if (!this.unmounted) {
        this.setState({ editing: false });
      }
    } catch (error) {
      Notify.errorWithDetail(
        error.response || error,
        t('Unable to save the Magnum quota.')
      );
    } finally {
      if (!this.unmounted) {
        this.setState({ saving: false });
      }
    }
  };

  resetQuota = async () => {
    const { projectId } = this.props;
    try {
      await this.store.resetProjectMagnumQuota(projectId);
    } catch (error) {
      Notify.errorWithDetail(
        error.response || error,
        t('Unable to restore the default Magnum quota.')
      );
    }
  };

  renderActions(title, canEdit, canReset) {
    return (
      <Space>
        {canEdit && (
          <Button onClick={() => this.setState({ editing: true })}>
            {title}
          </Button>
        )}
        {canReset && (
          <Popconfirm
            title={t('Restore the default Magnum quota for this project?')}
            onConfirm={this.resetQuota}
          >
            <Button>{t('Restore Default Quota')}</Button>
          </Popconfirm>
        )}
      </Space>
    );
  }

  renderError(status, name) {
    return (
      <Alert
        type="warning"
        message={
          status === 403
            ? t("You don't have access to get {name}.", { name })
            : t('Unable to get {name}.', { name })
        }
      />
    );
  }

  render() {
    const { projectId } = this.props;
    const { editing, saving } = this.state;
    const {
      magnum_cluster: cluster,
      magnum_cluster_id: overrideId,
      magnum_nodes: nodes,
      magnum_quota_error: quotaError,
      magnum_stats_error: statsError,
    } = this.store.magnumQuota;
    const title = overrideId ? t('Edit Quota') : t('Create Quota');
    const canEdit = this.store.canChangeMagnumQuota(
      projectId,
      overrideId ? 'quota:update' : 'quota:create'
    );
    const canReset = this.store.canChangeMagnumQuota(projectId, 'quota:delete');
    const formId = 'project-magnum-quota-form';
    return (
      <div className={styles.wrapper}>
        <Card
          title={t('Magnum quota')}
          loading={!cluster}
          extra={this.renderActions(title, canEdit, canReset)}
        >
          <Descriptions column={1}>
            <Descriptions.Item label={t('Project ID')}>
              {projectId}
            </Descriptions.Item>
            <Descriptions.Item label={t('Limit')}>
              {cluster?.limit ?? '-'}
            </Descriptions.Item>
            <Descriptions.Item label={t('Clusters')}>
              {cluster?.used ?? '-'}
            </Descriptions.Item>
            <Descriptions.Item label={t('Nodes (including control plane)')}>
              {nodes ?? '-'}
            </Descriptions.Item>
          </Descriptions>
          {quotaError && this.renderError(quotaError, t('Magnum quota'))}
          {statsError && this.renderError(statsError, t('Magnum statistics'))}
        </Card>
        <Modal
          title={title}
          visible={editing && canEdit}
          confirmLoading={saving}
          okButtonProps={{ form: formId, htmlType: 'submit' }}
          onCancel={() => !saving && this.setState({ editing: false })}
          destroyOnClose
        >
          <Form
            id={formId}
            onFinish={this.saveQuota}
            initialValues={{ hardLimit: cluster?.limit }}
            preserve={false}
          >
            <Form.Item
              name="hardLimit"
              label={t('Limit')}
              rules={[{ required: true, type: 'integer', min: 0 }]}
            >
              <InputNumber min={0} precision={0} />
            </Form.Item>
          </Form>
        </Modal>
      </div>
    );
  }
}

const ObservedPanel = observer(MagnumQuotaPanel);
const MagnumQuota = ({ match, rootStore }) => {
  const { id: projectId } = match.params;
  const { selectedRegion } = rootStore;
  return (
    <ObservedPanel
      key={`${selectedRegion}/${projectId}`}
      projectId={projectId}
    />
  );
};

export default inject('rootStore')(observer(MagnumQuota));
