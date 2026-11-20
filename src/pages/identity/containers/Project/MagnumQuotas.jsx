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
import { MagnumQuotaStore } from 'stores/magnum/quota';

export class MagnumQuotas extends Base {
  init() {
    this.store = new MagnumQuotaStore();
  }

  get aliasPolicy() {
    return 'magnum:quota:get_all';
  }

  get name() {
    return t('Magnum quotas');
  }

  get hasTab() {
    return true;
  }

  getColumns = () => [
    {
      title: t('Project ID'),
      dataIndex: 'project_id',
      render: (id) =>
        this.getLinkRender('projectDetail', id, { id }, { tab: 'quota' }),
    },
    {
      title: t('Resource'),
      dataIndex: 'resource',
    },
    {
      title: t('Limit'),
      dataIndex: 'hard_limit',
    },
  ];

  get searchFilters() {
    return [{ label: t('Project ID'), name: 'project_id' }];
  }
}

export default inject('rootStore')(observer(MagnumQuotas));
