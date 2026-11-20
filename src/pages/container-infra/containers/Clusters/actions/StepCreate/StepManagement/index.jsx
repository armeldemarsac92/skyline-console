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

export class StepManagement extends Base {
  get title() {
    return t('Cluster Management');
  }

  get name() {
    return t('Cluster Management');
  }

  get defaultValue() {
    return {
      create_timeout: 60,
      auto_healing_enabled: 'inherit',
    };
  }

  get formItems() {
    const options = [
      { label: t('Inherit from template'), value: 'inherit' },
      { label: t('Enabled'), value: 'true' },
      { label: t('Disabled'), value: 'false' },
    ];
    return [
      {
        name: 'auto_healing_enabled',
        label: t('Auto Healing'),
        type: 'select',
        options,
      },
      {
        name: 'discovery_url',
        label: t('Discovery URL'),
        type: 'input',
        tip: t(
          'Recorded by Magnum. CAPI Helm manages discovery through Cluster API.'
        ),
      },
      {
        name: 'docker_volume_size',
        label: t('Docker Volume Size (GiB)'),
        type: 'input-int',
        min: 1,
        tip: t(
          'Recorded by Magnum. CAPI Helm uses the boot volume settings from the cluster and template.'
        ),
      },
      {
        name: 'create_timeout',
        label: t('Timeout (Minute)'),
        type: 'input-int',
        min: 0,
        tip: t('The timeout for cluster creation in minutes.'),
      },
    ];
  }
}

export default inject('rootStore')(observer(StepManagement));
