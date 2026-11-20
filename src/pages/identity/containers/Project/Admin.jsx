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
import { inject, observer } from 'mobx-react';
import TabList from 'containers/TabList';
import { hasMagnumPolicy } from 'resources/magnum/capabilities';
import Project from './index';
import MagnumQuotas from './MagnumQuotas';

class ProjectAdmin extends TabList {
  get enableMagnumQuotas() {
    return (
      this.props.rootStore.checkEndpoint('magnum') &&
      hasMagnumPolicy('quota:get_all')
    );
  }

  get tabs() {
    return [
      { title: t('Projects'), key: 'projects', component: Project },
      {
        title: t('Magnum quotas'),
        key: 'magnumQuotas',
        component: MagnumQuotas,
      },
    ];
  }

  render() {
    if (!this.enableMagnumQuotas) {
      return <Project {...this.props} />;
    }
    return super.render();
  }
}

export default inject('rootStore')(observer(ProjectAdmin));
