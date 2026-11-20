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

import Base from '../client/base';
import { getOriginEndpoint } from '../client/constants';

// Only reuse the marker. Magnum can return a public URL outside Skyline's proxy.
export async function listAll(fetchPage, key, params = {}) {
  const items = [];
  const seen = new Set();
  let query = { ...params };
  for (;;) {
    // Each page depends on the previous response's marker.
    // eslint-disable-next-line no-await-in-loop
    const page = await fetchPage(query);
    items.push(...page[key]);
    if (!page.next) return items;
    const next = new URL(page.next, window.location.href).searchParams;
    const marker = next.get('marker');
    if (!marker || seen.has(marker)) {
      throw new Error(t('Invalid pagination marker returned by Magnum.'));
    }
    seen.add(marker);
    query = { ...params, marker };
    if (next.has('limit')) query.limit = next.get('limit');
  }
}

const minorVersion = (version) =>
  /^1\.\d+$/.test(version) ? Number(version.split('.')[1]) : NaN;

export class MagnumClient extends Base {
  get serviceUrl() {
    return (getOriginEndpoint('magnum') || '')
      .replace(/\/+$/, '')
      .replace(/\/v1$/, '');
  }

  get baseUrl() {
    return `${this.serviceUrl}/v1`;
  }

  versionOptions(version) {
    return {
      headers: { 'OpenStack-API-Version': `container-infra ${version}` },
    };
  }

  async supportsVersion(version) {
    const root = require('stores/root').default;
    const url = this.serviceUrl;
    const context = JSON.stringify([url, root.selectedRegion, root.projectId]);
    if (this.discovery?.context !== context) {
      const request = this.originRequest.get(`${url}/`).then(({ versions }) => {
        const api = versions?.find((item) => item.id === 'v1');
        if (
          !Number.isFinite(minorVersion(api?.min_version)) ||
          !Number.isFinite(minorVersion(api?.max_version))
        ) {
          throw new Error(
            t('Magnum did not return its supported API versions.')
          );
        }
        return api;
      });
      this.discovery = { context, request };
      request.catch(() => {
        if (this.discovery?.request === request) this.discovery = null;
      });
    }
    const api = await this.discovery.request;
    const requested = minorVersion(version);
    return (
      minorVersion(api.min_version) <= requested &&
      requested <= minorVersion(api.max_version)
    );
  }

  get resources() {
    return [
      {
        name: 'clusters',
        key: 'clusters',
        responseKey: 'cluster',
        subResources: [{ key: 'nodegroups', responseKey: 'nodegroup' }],
        extendOperations: [
          {
            name: 'resize',
            key: 'actions/resize',
            method: 'post',
          },
          {
            name: 'upgrade',
            key: 'actions/upgrade',
            method: 'post',
          },
        ],
      },
      {
        name: 'clusterTemplates',
        key: 'clustertemplates',
        responseKey: 'clustertemplate',
      },
      { key: 'certificates' },
      { key: 'credentials' },
      { key: 'stats' },
      { key: 'mservices' },
      {
        key: 'quotas',
        subResources: [
          {
            name: 'cluster',
            key: 'Cluster',
          },
        ],
        extendOperations: [
          {
            name: 'updateQuota',
            key: 'Cluster',
            method: 'patch',
          },
        ],
      },
    ];
  }
}

const magnumClient = new MagnumClient();
export default magnumClient;
