// SPDX-License-Identifier: Apache-2.0
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Input,
  Modal,
  Radio,
  Space,
  Spin,
} from 'antd';
import { strToU8, zipSync } from 'fflate';
import FileSaver from 'file-saver';
import { Observer, observer } from 'mobx-react';
import client from 'client';
import { hasMagnumPolicy, isCapiHelm } from 'resources/magnum/capabilities';
import {
  buildKubeconfig,
  generateClientRequest,
} from 'resources/magnum/kubeconfig';
import globalRootStore from 'stores/root';

const credentialVersion = '1.12';
const certificateRequestPattern =
  /^-----BEGIN (CERTIFICATE REQUEST|NEW CERTIFICATE REQUEST)-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END \1-----$/;

function errorDetail(error) {
  const { status, data } = error.response || {};
  const detail =
    data?.errors?.[0]?.detail || data?.faultstring || data?.message;
  const reason = typeof detail === 'string' ? detail : undefined;
  if (status === 403) {
    return reason
      ? t('Magnum denied this action ({reason}).', { reason })
      : t('Magnum denied this action.');
  }
  return reason || error.message;
}

function useOperation() {
  const active = useRef(false);
  const inFlight = useRef(false);
  const [state, setState] = useState({ loading: false });

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const run = useCallback(async (title, action) => {
    if (!active.current || inFlight.current) return undefined;
    inFlight.current = true;
    setState({ loading: true });
    try {
      const value = await action(() => active.current);
      if (active.current) {
        setState({ loading: false, value });
        return value;
      }
    } catch (error) {
      if (active.current) {
        setState({
          loading: false,
          error: { message: title, description: errorDetail(error) },
        });
      }
    } finally {
      inFlight.current = false;
    }
    return undefined;
  }, []);

  return [state, run];
}

function saveText(text, filename) {
  FileSaver.saveAs(
    new Blob([text], { type: 'text/plain;charset=utf-8' }),
    filename
  );
}

function saveConfig(config, files) {
  if (!files) {
    saveText(config, 'config');
    return;
  }
  const entries = { config: strToU8(config) };
  Object.entries(files).forEach(([name, content]) => {
    entries[`${name}.pem`] = strToU8(content);
  });
  FileSaver.saveAs(
    new Blob([zipSync(entries)], { type: 'application/zip' }),
    'kubeconfig.zip'
  );
}

function certificatePem(response) {
  const pem = response?.pem;
  if (
    typeof pem !== 'string' ||
    !pem.startsWith('-----BEGIN CERTIFICATE-----')
  ) {
    throw new Error(t('Magnum did not return a PEM certificate.'));
  }
  return pem;
}

async function readCA(uuid) {
  return certificatePem(await client.magnum.certificates.show(uuid));
}

async function signCSR(uuid, csr) {
  return certificatePem(
    await client.magnum.certificates.create({ cluster_uuid: uuid, csr })
  );
}

function KubeconfigDownload({ cluster, tlsDisabled, canRead, canSign }) {
  const [requestedMode, setRequestedMode] = useState('certificate');
  const [withPem, setWithPem] = useState(false);
  const [download, runDownload] = useOperation();
  const canGenerateKey = canSign && !!window.crypto?.subtle;
  let mode = canGenerateKey ? requestedMode : 'keystone';
  if (tlsDisabled) mode = 'none';
  const { uuid, api_address: server } = cluster;
  const tlsKnown = typeof tlsDisabled === 'boolean';

  const onDownload = () =>
    runDownload(t('Could not download the kubeconfig.'), async (isActive) => {
      const files = {};
      if (!tlsDisabled) {
        files.ca = await readCA(uuid);
        if (!isActive()) return;
        if (mode === 'certificate') {
          const { csr, key } = await generateClientRequest();
          if (!isActive()) return;
          files.cert = await signCSR(uuid, csr);
          files.key = key;
        }
      }
      if (isActive()) {
        saveConfig(
          buildKubeconfig(cluster, mode, files),
          !tlsDisabled && withPem ? files : undefined
        );
      }
    });

  return (
    <Card title={t('Kubeconfig')}>
      <Space direction="vertical">
        {!server && (
          <Alert
            type="info"
            message={t(
              'The kubeconfig will be available after the Kubernetes API address is assigned.'
            )}
          />
        )}
        {!tlsKnown && (
          <Alert
            type="warning"
            message={t(
              'The cluster template did not provide its TLS settings.'
            )}
          />
        )}
        {tlsDisabled && (
          <Alert
            type="info"
            message={t(
              'TLS is disabled. This kubeconfig contains no identity.'
            )}
          />
        )}
        {tlsKnown && !tlsDisabled && (
          <>
            {canRead ? (
              <>
                <Radio.Group
                  value={mode}
                  onChange={(event) => setRequestedMode(event.target.value)}
                  disabled={download.loading}
                >
                  <Radio value="certificate" disabled={!canGenerateKey}>
                    {t('Client certificate')}
                  </Radio>
                  <Radio value="keystone">{t('Keystone token')}</Radio>
                </Radio.Group>
                {!canSign && (
                  <div>
                    {t(
                      'You do not have permission to sign a client certificate for this cluster.'
                    )}
                  </div>
                )}
                {canSign && !canGenerateKey && (
                  <div>
                    {t(
                      'Generating a client certificate requires a secure browser context.'
                    )}
                  </div>
                )}
                {mode === 'keystone' ? (
                  <div>
                    {t(
                      'Export OS_TOKEN before running kubectl. The cluster must support Keystone authentication.'
                    )}
                  </div>
                ) : (
                  <div>
                    {t(
                      'The downloaded kubeconfig contains the client private key.'
                    )}
                  </div>
                )}
                <Checkbox
                  checked={withPem}
                  onChange={(event) => setWithPem(event.target.checked)}
                  disabled={download.loading}
                >
                  {t('Include PEM files in a ZIP')}
                </Checkbox>
              </>
            ) : (
              <Alert
                type="warning"
                message={t(
                  'Downloading the kubeconfig requires permission to read the cluster CA.'
                )}
              />
            )}
          </>
        )}
        <Button
          type="primary"
          loading={download.loading}
          disabled={!server || !tlsKnown || (!tlsDisabled && !canRead)}
          onClick={onDownload}
        >
          {t('Download kubeconfig')}
        </Button>
        {download.error && <Alert type="error" {...download.error} />}
      </Space>
    </Card>
  );
}

function Certificates({ uuid, tlsDisabled, canRead, canSign, capi }) {
  const [csr, setCSR] = useState('');
  const [ca, runRead] = useOperation();
  const [signing, runSign] = useOperation();

  const onSign = () =>
    runSign(t('Could not sign the certificate request.'), () =>
      signCSR(uuid, csr.trim())
    );

  return (
    <Card title={t('Kubernetes certificates')}>
      <Space direction="vertical" style={{ width: '100%' }}>
        {tlsDisabled ? (
          <Alert
            type="info"
            message={t(
              'CA lookup and certificate signing are unavailable when TLS is disabled.'
            )}
          />
        ) : (
          <>
            {canRead ? (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Button
                  loading={ca.loading}
                  onClick={() =>
                    runRead(t('Could not read the cluster CA.'), () =>
                      readCA(uuid)
                    )
                  }
                >
                  {t('Show CA certificate')}
                </Button>
                {ca.error && <Alert type="error" {...ca.error} />}
                {ca.value && (
                  <>
                    <Input.TextArea
                      aria-label={t('CA Certificate')}
                      value={ca.value}
                      rows={6}
                      readOnly
                    />
                    <Button onClick={() => saveText(ca.value, 'ca.pem')}>
                      {t('Download CA certificate')}
                    </Button>
                  </>
                )}
              </Space>
            ) : (
              <div>
                {t('You do not have permission to read the cluster CA.')}
              </div>
            )}
            {canSign ? (
              <>
                <label htmlFor={`magnum-csr-${uuid}`}>
                  {t('Certificate signing request (PEM)')}
                </label>
                <Input.TextArea
                  id={`magnum-csr-${uuid}`}
                  rows={5}
                  value={csr}
                  readOnly={signing.loading}
                  onChange={(event) => setCSR(event.target.value)}
                />
                <Button
                  disabled={!certificateRequestPattern.test(csr.trim())}
                  loading={signing.loading}
                  onClick={onSign}
                >
                  {t('Sign certificate request')}
                </Button>
                {signing.error && <Alert type="error" {...signing.error} />}
                {signing.value && (
                  <>
                    <Input.TextArea
                      aria-label={t('Signed client certificate')}
                      value={signing.value}
                      rows={6}
                      readOnly
                    />
                    <Button onClick={() => saveText(signing.value, 'cert.pem')}>
                      {t('Download signed certificate')}
                    </Button>
                  </>
                )}
              </>
            ) : (
              <div>
                {t(
                  'You do not have permission to sign a certificate request for this cluster.'
                )}
              </div>
            )}
          </>
        )}
        {capi && (
          <Alert
            type="info"
            message={t('Kubernetes CA rotation is unavailable with CAPI Helm.')}
          />
        )}
      </Space>
    </Card>
  );
}

function CredentialRotation({ cluster, permitted, onStatusChange }) {
  const { uuid, name } = cluster;
  const [visible, setVisible] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [capability, readCapability] = useOperation();
  const [rotation, runRotation] = useOperation();
  const [status, readStatus] = useOperation();

  const discover = useCallback(
    () =>
      readCapability(
        t('Could not check support for credential rotation.'),
        () => client.magnum.supportsVersion(credentialVersion)
      ),
    [readCapability]
  );

  useEffect(() => {
    if (permitted) discover();
  }, [discover, permitted]);

  const refresh = () =>
    readStatus(t('Could not refresh the cluster status.'), async (isActive) => {
      const updated = await client.magnum.clusters.show(uuid);
      if (isActive()) onStatusChange(updated);
      return updated;
    });

  const rotate = async () => {
    const success = await runRotation(
      t('Could not rotate the OpenStack application credential.'),
      async () => {
        const options = client.magnum.versionOptions(credentialVersion);
        await client.magnum.credentials.patch(
          uuid,
          undefined,
          undefined,
          options
        );
        return true;
      }
    );
    if (success) {
      setVisible(false);
      setAccepted(true);
      refresh();
    }
  };

  return (
    <Card title={t('OpenStack application credential')}>
      <Space direction="vertical" style={{ width: '100%' }}>
        {!permitted && (
          <div>
            {t(
              'You do not have permission to rotate this cluster’s OpenStack application credential.'
            )}
          </div>
        )}
        {permitted && capability.loading && <Spin size="small" />}
        {permitted && capability.error && (
          <>
            <Alert type="error" {...capability.error} />
            <Button onClick={discover}>{t('Retry')}</Button>
          </>
        )}
        {permitted && capability.value === false && (
          <Alert
            type="info"
            message={t(
              'Credential rotation requires Magnum API microversion 1.12.'
            )}
          />
        )}
        {permitted && capability.value && (
          <Button disabled={status.loading} onClick={() => setVisible(true)}>
            {t('Rotate OpenStack application credential')}
          </Button>
        )}
        {accepted && (
          <>
            <Alert
              type="info"
              message={t('Magnum accepted the credential rotation request.')}
            />
            {status.error && <Alert type="error" {...status.error} />}
            {status.value && (
              <Alert
                type={
                  status.value.status === 'UPDATE_FAILED' ? 'error' : 'info'
                }
                message={t('Cluster status is {status}.', {
                  status: status.value.status,
                })}
                description={status.value.status_reason}
              />
            )}
            <Button loading={status.loading} onClick={refresh}>
              {t('Refresh status')}
            </Button>
          </>
        )}
      </Space>
      <Modal
        title={t('Rotate OpenStack application credential')}
        visible={visible && permitted}
        onCancel={() => setVisible(false)}
        onOk={rotate}
        confirmLoading={rotation.loading}
        cancelButtonProps={{ disabled: rotation.loading }}
        closable={!rotation.loading}
        maskClosable={false}
        destroyOnClose
      >
        <p>
          {t(
            'Rotate the OpenStack application credential for {name}? A successful rotation may transfer ownership of the cluster to your account.',
            { name }
          )}
        </p>
        {rotation.error && <Alert type="error" {...rotation.error} />}
      </Modal>
    </Card>
  );
}

function Access({ detail }) {
  const [updated, setUpdated] = useState();
  const cluster =
    updated?.source === detail ? { ...detail, ...updated.value } : detail;
  const capi = isCapiHelm(cluster);
  const tlsDisabled = cluster.template?.tls_disabled;

  return (
    <Observer>
      {() => {
        const canRead = hasMagnumPolicy('certificate:get', cluster);
        const canSign = hasMagnumPolicy('certificate:create', cluster);
        return (
          <Space direction="vertical" style={{ width: '100%' }}>
            <KubeconfigDownload
              cluster={cluster}
              tlsDisabled={tlsDisabled}
              canRead={canRead}
              canSign={canSign}
            />
            <Certificates
              uuid={cluster.uuid}
              tlsDisabled={tlsDisabled}
              canRead={canRead}
              canSign={canSign}
              capi={capi}
            />
            {capi && (
              <CredentialRotation
                cluster={cluster}
                permitted={hasMagnumPolicy('credential:rotate', cluster)}
                onStatusChange={(value) =>
                  setUpdated({ source: detail, value })
                }
              />
            )}
          </Space>
        );
      }}
    </Observer>
  );
}

export default observer(function ClusterAccess({ detail }) {
  const { projectId, selectedRegion } = globalRootStore;
  return (
    <Access
      key={`${selectedRegion}:${projectId}:${detail.uuid}`}
      detail={detail}
    />
  );
});
