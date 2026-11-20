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

import Base from 'components/Form';
import { inject, observer } from 'mobx-react';
import { hasMagnumPolicy } from 'resources/magnum/capabilities';

export class StepInfo extends Base {
  get title() {
    return t('Info');
  }

  get name() {
    return t('Info');
  }

  get isEdit() {
    return !!this.props.extra;
  }

  get isStep() {
    return true;
  }

  get defaultValue() {
    let values = { server_type: 'vm' };

    if (this.isEdit) {
      const {
        extra: {
          name,
          public: publics,
          hidden,
          registry_enabled,
          tls_disabled,
          driver,
          tags,
          insecure_registry,
          server_type,
        } = {},
      } = this.props;
      values = {
        name,
        coe: 'kubernetes',
        public: publics,
        hidden,
        registry_enabled,
        tls_disabled,
        driver,
        tags,
        insecure_registry,
        server_type,
      };
    }
    return values;
  }

  get formItems() {
    return [
      {
        name: 'name',
        label: t('Cluster Template Name'),
        type: 'input',
        placeholder: t('Please input cluster template name'),
        required: true,
      },
      {
        name: 'driver',
        label: t('Magnum Driver'),
        type: 'select',
        options: [
          ...new Set(
            ['', 'k8s_capi_helm_v1', this.props.extra?.driver].filter(
              (value) => value !== undefined && value !== null
            )
          ),
        ].map((value) => ({ value, label: value || t('Service default') })),
      },
      {
        name: 'server_type',
        label: t('Server Type'),
        type: 'select',
        options: [
          ...new Set(['vm', this.props.extra?.server_type].filter(Boolean)),
        ].map((value) => ({ value, label: value })),
      },
      {
        name: 'tags',
        label: t('Tags'),
        type: 'input',
        placeholder: t('Comma-separated tags'),
      },
      {
        name: 'insecure_registry',
        label: t('Insecure Registry'),
        type: 'input',
      },
      {
        name: 'public',
        label: t('Public'),
        type: 'check',
        display: hasMagnumPolicy('clustertemplate:publish'),
      },
      {
        name: 'hidden',
        label: t('Hidden'),
        type: 'check',
        display: hasMagnumPolicy('clustertemplate:publish'),
      },
      {
        name: 'registry_enabled',
        label: t('Enable Registry'),
        type: 'check',
      },
      {
        name: 'tls_disabled',
        label: t('Disable TLS'),
        type: 'check',
      },
    ];
  }
}

export default inject('rootStore')(observer(StepInfo));
