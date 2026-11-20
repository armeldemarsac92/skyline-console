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
import Base from 'containers/List';
import { serviceState, serviceStatus } from 'resources/nova/service';
import { MagnumServiceStore } from 'stores/magnum/service';
import { getOptions } from 'utils';

export class MagnumService extends Base {
  init() {
    this.store = new MagnumServiceStore();
  }

  get aliasPolicy() {
    return 'magnum:magnum-service:get_all';
  }

  get name() {
    return t('Magnum services');
  }

  get hasTab() {
    return true;
  }

  getColumns = () => [
    { title: t('Name'), dataIndex: 'binary' },
    { title: t('Host'), dataIndex: 'host' },
    { title: t('State'), dataIndex: 'state', valueMap: serviceState },
    {
      title: t('Status'),
      dataIndex: 'disabled',
      valueMap: { true: serviceStatus.disabled, false: serviceStatus.enabled },
    },
    { title: t('Report Count'), dataIndex: 'report_count' },
    {
      title: t('Disabled Reason'),
      dataIndex: 'disabled_reason',
      isHideable: true,
    },
  ];

  get searchFilters() {
    return [
      { label: t('Host'), name: 'host' },
      { label: t('State'), name: 'state', options: getOptions(serviceState) },
    ];
  }
}

export default inject('rootStore')(observer(MagnumService));
