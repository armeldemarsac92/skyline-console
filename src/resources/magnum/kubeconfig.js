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
import { Sequence, Set, Utf8String } from 'asn1js';
import {
  AttributeTypeAndValue,
  CertificationRequest,
  CryptoEngine,
  RelativeDistinguishedNames,
} from 'pkijs';

const execAPIVersion = 'client.authentication.k8s.io/v1beta1';

const keystoneExec = {
  command: '/bin/bash',
  apiVersion: execAPIVersion,
  args: [
    '-c',
    [
      'if [ -z "$OS_TOKEN" ]; then',
      "  echo 'Error: Missing OpenStack credential from environment variable $OS_TOKEN' >&2",
      '  exit 1',
      'fi',
      `printf '{"apiVersion":"${execAPIVersion}","kind":"ExecCredential","status":{"token":"%s"}}\\n' "$OS_TOKEN"`,
    ].join('\n'),
  ],
};

export const buildKubeconfig = (
  { name, api_address: server },
  mode,
  { ca, cert, key } = {}
) => {
  const cluster =
    mode === 'none'
      ? { server }
      : {
          'certificate-authority-data': btoa(ca),
          server,
        };
  let user = { name };
  let contextName = name;
  if (mode === 'certificate') {
    user = {
      name: 'admin',
      user: {
        'client-certificate-data': btoa(cert),
        'client-key-data': btoa(key),
      },
    };
    contextName = 'default';
  } else if (mode === 'keystone') {
    user = { name: 'openstackuser', user: { exec: keystoneExec } };
    contextName = 'openstackuser@kubernetes';
  }

  return yaml.dump(
    {
      apiVersion: 'v1',
      clusters: [{ cluster, name }],
      contexts: [
        { context: { cluster: name, user: user.name }, name: contextName },
      ],
      'current-context': contextName,
      kind: 'Config',
      preferences: {},
      users: [user],
    },
    { noArrayIndent: true, lineWidth: -1 }
  );
};

const toPem = (type, buffer) => {
  const bytes = Array.from(new Uint8Array(buffer), (byte) =>
    String.fromCharCode(byte)
  ).join('');
  const lines = btoa(bytes).match(/.{1,64}/g);
  return `-----BEGIN ${type}-----\n${lines.join(
    '\n'
  )}\n-----END ${type}-----\n`;
};

export const generateClientRequest = async (crypto = window.crypto) => {
  const algorithm = {
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
  };
  const engine = new CryptoEngine({ name: 'WebCrypto', crypto });
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    algorithm,
    true,
    ['sign', 'verify']
  );
  const subject = new Sequence({
    value: [
      ['2.5.4.3', 'admin'],
      ['2.5.4.10', 'system:masters'],
    ].map(
      ([type, value]) =>
        new Set({
          value: [
            new AttributeTypeAndValue({
              type,
              value: new Utf8String({ value }),
            }).toSchema(),
          ],
        })
    ),
  });
  const request = new CertificationRequest({
    subject: RelativeDistinguishedNames.fromBER(subject.toBER(false)),
    attributes: [],
  });
  await request.subjectPublicKeyInfo.importKey(publicKey, engine);
  await request.sign(privateKey, algorithm.hash, engine);
  const key = await crypto.subtle.exportKey('pkcs8', privateKey);

  return {
    csr: toPem('CERTIFICATE REQUEST', request.toSchema().toBER(false)),
    key: toPem('PRIVATE KEY', key),
  };
};
