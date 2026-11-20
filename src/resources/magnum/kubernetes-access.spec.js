// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import yaml from 'js-yaml';
import { buildKubeconfig } from './kubeconfig';

test('TLS-disabled kubeconfig reproduces the CLI file without a credential', () => {
  expect(
    buildKubeconfig(
      { name: 'dev', api_address: 'http://api.example:8080' },
      'none'
    )
  ).toBe(
    'apiVersion: v1\n' +
      'clusters:\n' +
      '- cluster:\n' +
      '    server: http://api.example:8080\n' +
      '  name: dev\n' +
      'contexts:\n' +
      '- context:\n' +
      '    cluster: dev\n' +
      '    user: dev\n' +
      '  name: dev\n' +
      'current-context: dev\n' +
      'kind: Config\n' +
      'preferences: {}\n' +
      'users:\n' +
      '- name: dev\n'
  );
});

test('Keystone kubeconfig reads the exported OS_TOKEN when kubectl runs', () => {
  const config = yaml.load(
    buildKubeconfig(
      { name: 'dev', api_address: 'https://api.example:6443' },
      'keystone',
      { ca: 'public CA' }
    )
  );

  expect(config.clusters[0].cluster).toEqual({
    'certificate-authority-data': btoa('public CA'),
    server: 'https://api.example:6443',
  });
  expect(config['current-context']).toBe('openstackuser@kubernetes');
  expect(config.users[0]).toEqual({
    name: 'openstackuser',
    user: {
      exec: {
        command: '/bin/bash',
        apiVersion: 'client.authentication.k8s.io/v1beta1',
        args: ['-c', expect.stringContaining('$OS_TOKEN')],
      },
    },
  });
});
