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

import React from 'react';
import { observable, runInAction } from 'mobx';
import { inject, observer } from 'mobx-react';
import Base from 'containers/TabDetail';
import { clusterStatus, healthStatus } from 'resources/magnum/cluster';
import { ClustersStore } from 'stores/magnum/clusters';
import BaseDetail from './BaseDetail';
import NodeGroups from './NodeGroups';
import Access from './Access';
import actionConfigs from '../actions';

export class ClustersDetail extends Base {
  init() {
    this.store = observable({ detail: {}, isLoading: true });
  }

  componentWillUnmount() {
    this.request = null;
  }

  fetchData = async (params, silent) => {
    if (this.request === null) return;

    // Fetch and enrich in isolation until the current request can publish.
    const request = new ClustersStore();
    const { id } = this;
    this.request = request;
    if (this.state.notFound) {
      this.setState({ notFound: false });
    }
    if (!silent) {
      runInAction(() => {
        this.store.isLoading = true;
      });
    }

    let detail;
    try {
      detail = await request.fetchDetail({
        ...this.params,
        ...params,
        id,
        all_projects: this.isAdminPage,
        silent,
      });
    } catch (error) {
      if (this.request === request) this.catch(error);
    }
    if (this.request !== request) return;

    runInAction(() => {
      this.store.detail = id && detail?.uuid === id ? { ...detail, id } : {};
      this.store.isLoading = false;
    });
  };

  get name() {
    return t('Cluster Detail');
  }

  get listUrl() {
    return this.getRoutePath('containerInfraClusters');
  }

  get policy() {
    return 'cluster:get';
  }

  get actionConfigs() {
    if (this.isAdminPage) {
      return actionConfigs.actionConfigsAdmin;
    }
    return actionConfigs.actionConfigs;
  }

  get detailInfos() {
    return [
      {
        title: t('Name'),
        dataIndex: 'name',
      },
      {
        title: t('Created At'),
        dataIndex: 'created_at',
        valueRender: 'toLocalTime',
      },
      {
        title: t('Updated At'),
        dataIndex: 'updated_at',
        valueRender: 'toLocalTime',
      },
      {
        title: t('Status'),
        dataIndex: 'status',
        valueMap: clusterStatus,
      },
      {
        title: t('Status Reason'),
        dataIndex: 'status_reason',
      },
      {
        title: t('Health Status'),
        dataIndex: 'health_status',
        render: (value) => healthStatus[value] || value || '-',
      },
    ];
  }

  get tabs() {
    return [
      {
        title: t('Detail'),
        key: 'general_info',
        component: BaseDetail,
      },
      { title: t('Node Groups'), key: 'nodegroups', component: NodeGroups },
      { title: t('Cluster Access'), key: 'access', component: Access },
    ];
  }
}

const ObservedClustersDetail = observer(ClustersDetail);

export default inject('rootStore')(
  observer(function ScopedClustersDetail(props) {
    const { rootStore, location, match } = props;
    const key = JSON.stringify([
      rootStore.selectedRegion,
      rootStore.projectId,
      location.pathname,
      match.params.id,
    ]);
    return <ObservedClustersDetail key={key} {...props} />;
  })
);
