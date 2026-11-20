// SPDX-License-Identifier: Apache-2.0
import React, { useEffect, useState } from 'react';
import { Alert, Form, Input, InputNumber, Modal, Select } from 'antd';
import { FlavorStore } from 'stores/nova/flavor';
import {
  autoscaling,
  isDefaultWorker,
  magnumError,
} from 'resources/magnum/nodegroups';

export default function GroupForm({ cluster, group, close, submit }) {
  const [form] = Form.useForm();
  const [error, setError] = useState();
  const [saving, setSaving] = useState(false);
  const [flavors, setFlavors] = useState([]);
  const [loadingFlavors, setLoadingFlavors] = useState(false);
  const [flavorError, setFlavorError] = useState();
  const scaling = autoscaling(cluster);
  const editing = !!group;
  const inheritedFlavor = cluster.flavor_id || cluster.template?.flavor_id;

  useEffect(() => {
    if (editing) return undefined;
    let active = true;
    setLoadingFlavors(true);
    new FlavorStore().fetchList().then(
      (result) => {
        if (!active) return;
        setFlavors(result);
        setLoadingFlavors(false);
      },
      (reason) => {
        if (!active) return;
        setFlavorError(magnumError(reason, t('Unable to load flavors.')));
        setLoadingFlavors(false);
      }
    );
    return () => {
      active = false;
    };
  }, [editing]);

  const validateBound = (lower) => (_, value) => {
    if (value == null) return Promise.resolve();
    const count = group?.node_count ?? form.getFieldValue('node_count');
    const min = lower && scaling === true ? 1 : 0;
    if (
      !Number.isInteger(value) ||
      value < min ||
      (lower ? value > count : value < count)
    ) {
      return Promise.reject(
        new Error(t('Enter a bound compatible with the current node count.'))
      );
    }
    return Promise.resolve();
  };

  const save = async (values) => {
    if (saving) return;
    setSaving(true);
    setError(undefined);
    try {
      await submit(values);
      close();
    } catch (reason) {
      setError(magnumError(reason, t('Unable to save the node group.')));
      setSaving(false);
    }
  };

  return (
    <Modal
      visible
      title={editing ? t('Edit Node Group Bounds') : t('Create Node Group')}
      onOk={() => form.submit()}
      onCancel={saving ? undefined : close}
      confirmLoading={saving}
      maskClosable={false}
    >
      {error && <Alert type="error" message={error} showIcon />}
      {flavorError && <Alert type="warning" message={flavorError} showIcon />}
      {editing && isDefaultWorker(group) && (
        <Alert
          type="info"
          message={t(
            'Cluster labels and operator settings can override the default worker bounds used by the autoscaler.'
          )}
          showIcon
        />
      )}
      <Form
        form={form}
        name={editing ? 'edit-node-group' : 'create-node-group'}
        layout="vertical"
        initialValues={
          editing
            ? {
                min_node_count: group.min_node_count,
                max_node_count: group.max_node_count,
              }
            : {
                role: 'worker',
                node_count: 1,
                min_node_count: scaling === false ? undefined : 1,
                max_node_count: scaling === true ? 1 : undefined,
              }
        }
        onFinish={save}
      >
        {editing ? (
          <p>
            {group.name} · {t('Current Node Count')} {group.node_count}
          </p>
        ) : (
          <>
            <Form.Item
              name="name"
              label={t('Name')}
              rules={[{ required: true, whitespace: true }]}
            >
              <Input maxLength={255} />
            </Form.Item>
            <Form.Item
              name="role"
              label={t('Role')}
              rules={[
                { required: true, whitespace: true },
                {
                  validator: (_, value) =>
                    value?.trim().toLowerCase() === 'master'
                      ? Promise.reject(
                          new Error(t('The master role is reserved.'))
                        )
                      : Promise.resolve(),
                },
              ]}
            >
              <Input maxLength={255} />
            </Form.Item>
            <Form.Item name="flavor_id" label={t('Flavor')}>
              <Select
                loading={loadingFlavors}
                placeholder={
                  inheritedFlavor
                    ? `${t('Inherited Flavor')} (${inheritedFlavor})`
                    : t('Inherited Flavor')
                }
                options={flavors.map(({ name }) => ({
                  value: name,
                  label: name,
                }))}
                allowClear
                showSearch
                optionFilterProp="label"
              />
            </Form.Item>
            <p>
              {t('Image')} {cluster.template?.image_id || '-'}
            </p>
            <Form.Item
              name="node_count"
              label={t('Node Count')}
              rules={[{ required: true, type: 'integer', min: 1 }]}
            >
              <InputNumber min={1} precision={0} />
            </Form.Item>
          </>
        )}
        <Form.Item
          name="min_node_count"
          label={t('Minimum Node Count')}
          dependencies={['node_count']}
          rules={[
            { required: scaling === true },
            { validator: validateBound(true) },
          ]}
        >
          <InputNumber min={scaling === true ? 1 : 0} precision={0} />
        </Form.Item>
        <Form.Item
          name="max_node_count"
          label={t('Maximum Node Count')}
          dependencies={['node_count']}
          rules={[
            { required: scaling === true },
            { validator: validateBound(false) },
          ]}
        >
          <InputNumber min={0} precision={0} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
