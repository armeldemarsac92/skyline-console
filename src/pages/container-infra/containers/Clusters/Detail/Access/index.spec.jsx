// SPDX-License-Identifier: Apache-2.0
import React from 'react';
import { mount } from 'enzyme';
import { act } from 'react-dom/test-utils';
import { Button, Checkbox, Modal } from 'antd';
import { createPrivateKey, webcrypto, X509Certificate } from 'crypto';
import { Integer, Utf8String } from 'asn1js';
import {
  AttributeTypeAndValue,
  Certificate,
  CertificationRequest,
  CryptoEngine,
} from 'pkijs';
import { strFromU8, unzipSync } from 'fflate';
import yaml from 'js-yaml';
import FileSaver from 'file-saver';
import client from 'client';
import globalRootStore from 'stores/root';
import { generateClientRequest } from 'resources/magnum/kubeconfig';
import { mockMagnum } from '../../../../../../../test/unit/magnum';
import Access from './index';

jest.mock('stores/root', () => ({
  __esModule: true,
  default: {
    endpoints: { magnum: '/api/openstack/magnum' },
    projectId: 'project',
    selectedRegion: 'RegionOne',
    user: {
      project: { id: 'project' },
      user: { id: 'owner' },
      roles: [{ name: 'member' }],
    },
    policies: [],
  },
}));

const cluster = {
  uuid: 'cluster-uuid',
  name: 'kube-prod',
  api_address: 'https://kube.example.test',
  template: { driver: 'k8s_capi_helm_v1', tls_disabled: false },
  project_id: 'project',
  user_id: 'owner',
};
const rules = [
  { rule: 'magnum:certificate:get', allowed: true },
  { rule: 'magnum:certificate:create', allowed: true },
  { rule: 'magnum:credential:rotate', allowed: false },
];

const readBlob = (blob, type) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    if (type === 'binary') reader.readAsArrayBuffer(blob);
    else reader.readAsText(blob);
  });

async function testAuthority() {
  const { subtle } = webcrypto;
  const algorithm = {
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
  };
  const keys = await subtle.generateKey(algorithm, true, ['sign', 'verify']);
  const engine = new CryptoEngine({
    name: 'Test WebCrypto',
    crypto: webcrypto,
  });
  const ca = new Certificate();
  ca.serialNumber = new Integer({ value: 1 });
  ca.issuer.typesAndValues = [
    new AttributeTypeAndValue({
      type: '2.5.4.3',
      value: new Utf8String({ value: 'Test CA' }),
    }),
  ];
  ca.subject = ca.issuer;
  ca.notBefore.value = new Date('2026-01-01');
  ca.notAfter.value = new Date('2027-01-01');
  await ca.subjectPublicKeyInfo.importKey(keys.publicKey, engine);
  await ca.sign(keys.privateKey, 'SHA-256', engine);

  const encode = (cert) => {
    const der = Buffer.from(cert.toSchema().toBER(false)).toString('base64');
    return `-----BEGIN CERTIFICATE-----\n${der
      .match(/.{1,64}/g)
      .join('\n')}\n-----END CERTIFICATE-----\n`;
  };

  return {
    ca: encode(ca),
    sign: async (pem) => {
      const der = Buffer.from(pem.replace(/-----[^-]+-----|\s/g, ''), 'base64');
      const csr = CertificationRequest.fromBER(der);
      expect(await csr.verify(engine)).toBe(true);
      const leaf = new Certificate();
      leaf.serialNumber = new Integer({ value: 2 });
      leaf.issuer = ca.subject;
      leaf.subject = csr.subject;
      leaf.notBefore = ca.notBefore;
      leaf.notAfter = ca.notAfter;
      leaf.subjectPublicKeyInfo = csr.subjectPublicKeyInfo;
      await leaf.sign(keys.privateKey, 'SHA-256', engine);
      return encode(leaf);
    },
  };
}

describe('Kubernetes access', () => {
  let wrapper;
  let http;
  let saved;
  let originalCrypto;

  const settle = async (action) => {
    await act(async () => {
      await action();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    wrapper.update();
  };

  const show = (detail = cluster) =>
    settle(() => {
      wrapper = mount(<Access detail={detail} />);
    });

  const button = (label) =>
    wrapper.find(Button).filterWhere((item) => item.text() === label);

  const click = (label) => settle(() => button(label).prop('onClick')());

  beforeEach(() => {
    global.t.mockImplementation((message, values = {}) =>
      message.replace(/{(\w+)}/g, (match, key) => values[key] ?? match)
    );
    globalRootStore.policies = rules;
    client.magnum.discovery = null;
    originalCrypto = Object.getOwnPropertyDescriptor(window, 'crypto');
    Object.defineProperty(window, 'crypto', {
      configurable: true,
      value: webcrypto,
    });
    saved = jest.spyOn(FileSaver, 'saveAs').mockImplementation(() => {});
  });

  afterEach(() => {
    wrapper?.unmount();
    http?.restore();
    wrapper = undefined;
    http = undefined;
    if (originalCrypto) Object.defineProperty(window, 'crypto', originalCrypto);
    else delete window.crypto;
    jest.restoreAllMocks();
  });

  it('downloads one ZIP with a matching kubeconfig, CA and signed client certificate', async () => {
    const authority = await testAuthority();
    http = mockMagnum(async ({ method, path, body }) => {
      if (method === 'GET' && path === '/v1/certificates/cluster-uuid') {
        return { data: { pem: authority.ca } };
      }
      if (method === 'POST' && path === '/v1/certificates') {
        expect(body).toEqual({
          cluster_uuid: cluster.uuid,
          csr: expect.stringContaining('-----BEGIN CERTIFICATE REQUEST-----'),
        });
        return { status: 201, data: { pem: await authority.sign(body.csr) } };
      }
      return undefined;
    });

    await show();
    await settle(() =>
      wrapper.find(Checkbox).prop('onChange')({ target: { checked: true } })
    );
    await click('Download kubeconfig');
    expect(saved).toHaveBeenCalledTimes(1);
    const [[download, filename]] = saved.mock.calls;
    expect(filename).toBe('kubeconfig.zip');
    const files = unzipSync(new Uint8Array(await readBlob(download, 'binary')));
    expect(Object.keys(files)).toEqual([
      'config',
      'ca.pem',
      'cert.pem',
      'key.pem',
    ]);
    const config = yaml.load(strFromU8(files.config));
    expect(config['current-context']).toBe('default');
    expect(config.clusters[0].cluster).toEqual({
      server: cluster.api_address,
      'certificate-authority-data': btoa(authority.ca),
    });
    expect(strFromU8(files['ca.pem'])).toBe(authority.ca);
    const cert = strFromU8(files['cert.pem']);
    const key = strFromU8(files['key.pem']);
    expect(config.users).toEqual([
      {
        name: 'admin',
        user: {
          'client-certificate-data': btoa(cert),
          'client-key-data': btoa(key),
        },
      },
    ]);
    const leaf = new X509Certificate(cert);
    expect(leaf.subject).toBe('CN=admin\nO=system:masters');
    expect(leaf.checkPrivateKey(createPrivateKey(key))).toBe(true);
    expect(leaf.verify(new X509Certificate(authority.ca).publicKey)).toBe(true);
    expect(http.requests.map(({ method, path }) => [method, path])).toEqual([
      ['GET', '/v1/certificates/cluster-uuid'],
      ['POST', '/v1/certificates'],
    ]);
    expect(JSON.stringify(http.requests)).not.toContain('PRIVATE KEY');
  });

  it('keeps a PEM request editable after a server refusal, independently of CA lookup', async () => {
    const authority = await testAuthority();
    const { csr } = await generateClientRequest(webcrypto);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    http = mockMagnum(({ method, path, body }) => {
      if (method === 'GET' && path === '/v1/certificates/cluster-uuid') {
        return { data: { pem: authority.ca } };
      }
      if (method === 'POST' && path === '/v1/certificates') {
        expect(body).toEqual({ cluster_uuid: cluster.uuid, csr: csr.trim() });
        return {
          status: 403,
          data: { errors: [{ detail: 'Certificate signing was denied.' }] },
        };
      }
      return undefined;
    });

    await show();
    await click('Show CA certificate');
    expect(
      wrapper.find('textarea[aria-label="CA Certificate"]').prop('value')
    ).toBe(authority.ca);
    const input = () => wrapper.find('textarea#magnum-csr-cluster-uuid');
    await settle(() => input().simulate('change', { target: { value: csr } }));
    await click('Sign certificate request');
    expect(wrapper.text()).toContain('Certificate signing was denied.');
    expect(input().prop('value')).toBe(csr);
    expect(button('Download CA certificate')).toHaveLength(1);
  });

  it('downloads an identity-free kubeconfig for an existing CAPI cluster with TLS disabled', async () => {
    http = mockMagnum(() => undefined);
    globalRootStore.policies = [
      { rule: 'magnum:credential:rotate', allowed: false },
    ];
    const withoutTLS = {
      ...cluster,
      api_address: 'http://kube.example.test:8080',
      template: { ...cluster.template, tls_disabled: true },
    };
    await show({ ...withoutTLS, api_address: null });
    expect(button('Download kubeconfig').prop('disabled')).toBe(true);
    expect(wrapper.text()).toContain(
      'after the Kubernetes API address is assigned.'
    );

    await settle(() => wrapper.setProps({ detail: withoutTLS }));
    expect(wrapper.text()).toContain('This kubeconfig contains no identity.');
    expect(wrapper.text()).toContain(
      'Kubernetes CA rotation is unavailable with CAPI Helm.'
    );
    expect(button('Show CA certificate')).toHaveLength(0);
    expect(button('Sign certificate request')).toHaveLength(0);
    expect(button('Rotate OpenStack application credential')).toHaveLength(0);
    await click('Download kubeconfig');
    const [[download, filename]] = saved.mock.calls;
    expect(filename).toBe('config');
    const config = yaml.load(await readBlob(download));
    expect(config.users).toEqual([{ name: cluster.name }]);
    expect(config.clusters[0].cluster).toEqual({
      server: 'http://kube.example.test:8080',
    });
    expect(http.requests).toHaveLength(0);
  });

  it('requests rotation at 1.12 and reloads the status and reason by cluster UUID after acceptance', async () => {
    globalRootStore.policies = rules.slice(0, 2);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const reason = 'Applying the new application credential failed.';
    http = mockMagnum(({ method, path, body, headers }) => {
      if (method === 'GET' && path === '/') {
        return {
          data: {
            versions: [{ id: 'v1', min_version: '1.1', max_version: '1.14' }],
          },
        };
      }
      if (method === 'PATCH' && path === '/v1/credentials/cluster-uuid') {
        expect(body).toBeUndefined();
        expect(headers['OpenStack-API-Version']).toBe('container-infra 1.12');
        return { status: 202, data: { uuid: cluster.uuid } };
      }
      if (method === 'GET' && path === '/v1/clusters/cluster-uuid') {
        return {
          data: {
            uuid: cluster.uuid,
            status: 'UPDATE_FAILED',
            status_reason: reason,
          },
        };
      }
      return undefined;
    });

    await show();
    await click('Rotate OpenStack application credential');
    expect(wrapper.find(Modal).text()).toContain('may transfer ownership');
    await settle(() => wrapper.find(Modal).prop('onOk')());
    expect(wrapper.text()).toContain(
      'Magnum accepted the credential rotation request.'
    );
    expect(wrapper.text()).toContain(reason);
    expect(http.requests.map(({ method, path }) => [method, path])).toEqual([
      ['GET', '/'],
      ['PATCH', '/v1/credentials/cluster-uuid'],
      ['GET', '/v1/clusters/cluster-uuid'],
    ]);
  });
});
