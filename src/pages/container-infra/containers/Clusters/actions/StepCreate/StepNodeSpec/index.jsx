// Copyright 2021 99cloud
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

import { inject, observer } from 'mobx-react';
import { toJS } from 'mobx';
import Base from 'components/Form';
import globalKeypairStore from 'stores/nova/keypair';
import globalFlavorStore from 'stores/nova/flavor';
import { defaultTip } from 'resources/magnum/cluster';
import { getKeyPairHeader } from 'resources/nova/keypair';
import { getBaseSimpleFlavorColumns } from 'resources/magnum/template';
import { findFlavor } from 'resources/magnum/flavor';
import { masterCountError, workerCountError } from 'resources/magnum/lifecycle';
import { allSettled } from 'utils';
import client from 'client';

function flavorSelection(flavors, ref) {
  const flavor = findFlavor(flavors, ref);
  return {
    selectedRowKeys: flavor ? [flavor.id] : [],
    selectedRows: flavor ? [flavor] : [],
  };
}

export class StepNodeSpec extends Base {
  init() {
    this.keyPairStore = globalKeypairStore;
    this.flavorStore = globalFlavorStore;
    this.getAllInitFunctions();
  }

  get title() {
    return t('Node Spec');
  }

  get name() {
    return t('Node Spec');
  }

  allowed = () => Promise.resolve();

  async getAllInitFunctions() {
    await allSettled([
      this.getKeypairs(),
      this.flavorStore.fetchList(),
      client.magnum
        .supportsVersion('1.10')
        .catch(() => false)
        .then((zeroSupported) => this.setState({ zeroSupported })),
    ]);
    const { current: form } = this.formRef;
    if (!form) return;
    const defaults = this.defaultValue;
    form.setFieldsValue(defaults);
    this.updateContext(defaults);
  }

  getKeypairs() {
    return this.keyPairStore.fetchList();
  }

  get keypairs() {
    return this.keyPairStore.list.data || [];
  }

  get flavors() {
    return toJS(this.flavorStore.list.data) || [];
  }

  get template() {
    return this.props.context?.clusterTemplate?.selectedRows?.[0] || {};
  }

  get defaultValue() {
    const {
      context: {
        keypair,
        masterFlavor,
        flavor,
        master_count,
        node_count,
        auto_scaling_enabled = 'inherit',
      } = {},
    } = this.props;
    const { master_flavor_id, flavor_id, keypair_id } = this.template;

    return {
      master_count: master_count ?? 1,
      node_count: node_count ?? 1,
      auto_scaling_enabled,
      masterFlavor:
        masterFlavor || flavorSelection(this.flavors, master_flavor_id),
      flavor: flavor || flavorSelection(this.flavors, flavor_id),
      keypair: keypair || {
        selectedRowKeys: keypair_id ? [keypair_id] : [],
        selectedRows: this.keypairs.filter((it) => it.id === keypair_id),
      },
    };
  }

  get formDefaultValue() {
    // Template changes clear previous selections in context. Seed the Ant
    // form with the new defaults even when those context keys are undefined.
    return { ...this.props.context, ...this.defaultValue };
  }

  validateWorkers = (_, count) => {
    const error = workerCountError(
      { ...this.props.context, node_count: count },
      this.state.zeroSupported
    );
    return error ? Promise.reject(new Error(error)) : Promise.resolve();
  };

  validateMasters = (_, count) => {
    const error = masterCountError(count, this.template);
    return error ? Promise.reject(new Error(error)) : Promise.resolve();
  };

  get formItems() {
    const {
      keypair: initKeyPair,
      masterFlavor: initMasterFlavor,
      flavor: initFlavor,
    } = this.defaultValue;
    const zeroError = workerCountError(
      { ...this.props.context, node_count: 0 },
      this.state.zeroSupported
    );

    return [
      {
        name: 'keypair',
        label: t('Keypair'),
        type: 'select-table',
        data: this.keypairs,
        initValue: initKeyPair,
        isLoading: this.keyPairStore.list.isLoading,
        header: getKeyPairHeader(this),
        tip: t(
          'The SSH key is a way to remotely log in to the cluster instance. If it’s not set, the value of this in the template will be used.'
        ),
        filterParams: [
          {
            label: t('Name'),
            name: 'name',
          },
        ],
        columns: [
          {
            title: t('Name'),
            dataIndex: 'name',
          },
          {
            title: t('Fingerprint'),
            dataIndex: 'fingerprint',
          },
        ],
      },
      {
        name: 'master_count',
        label: t('Number of Master Nodes'),
        type: 'input-int',
        min: 1,
        step: 2,
        required: true,
        validator: this.validateMasters,
        onChange: (value) => {
          this.updateContext({
            master_count: value,
          });
        },
      },
      {
        name: 'masterFlavor',
        label: t('Flavor of Master Nodes'),
        type: 'select-table',
        required: true,
        tip: defaultTip,
        data: this.flavors,
        initValue: initMasterFlavor,
        columns: getBaseSimpleFlavorColumns(this),
        isLoading: this.flavorStore.list.isLoading,
        filterParams: [
          {
            label: t('Name'),
            name: 'name',
          },
        ],
        onChange: (value) => {
          this.updateContext({
            masterFlavor: value,
          });
        },
      },
      {
        type: 'divider',
      },
      {
        name: 'auto_scaling_enabled',
        label: t('Auto Scaling'),
        type: 'select',
        options: [
          { label: t('Inherit from template'), value: 'inherit' },
          { label: t('Enabled'), value: 'true' },
          { label: t('Disabled'), value: 'false' },
        ],
        onChange: (value) =>
          this.updateContext({ auto_scaling_enabled: value }),
      },
      {
        name: 'node_count',
        label: t('Number of Nodes'),
        type: 'input-int',
        min: zeroError ? 1 : 0,
        required: true,
        validator: this.validateWorkers,
        tip: zeroError,
        onChange: (value) => {
          this.updateContext({
            node_count: value,
          });
        },
      },
      {
        name: 'flavor',
        label: t('Flavor of Nodes'),
        type: 'select-table',
        required: true,
        tip: defaultTip,
        data: this.flavors,
        initValue: initFlavor,
        columns: getBaseSimpleFlavorColumns(this),
        isLoading: this.flavorStore.list.isLoading,
        filterParams: [
          {
            label: t('Name'),
            name: 'name',
          },
        ],
        onChange: (value) => {
          this.updateContext({
            flavor: value,
          });
        },
      },
    ];
  }
}

export default inject('rootStore')(observer(StepNodeSpec));
