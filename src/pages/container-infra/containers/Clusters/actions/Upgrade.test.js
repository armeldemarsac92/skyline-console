// SPDX-License-Identifier: Apache-2.0
import client from 'client';
import { Upgrade } from './Upgrade';

jest.mock('client', () => ({ glance: { images: { show: jest.fn() } } }));
jest.mock('containers/Action', () => ({ ModalAction: class {} }));

it('waits for the selected Glance image before allowing a cluster-wide upgrade', async () => {
  let complete;
  client.glance.images.show.mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    })
  );
  const modal = new Upgrade();
  modal.state = {};
  modal.item = { id: 'cluster' };
  modal.setState = (values) => Object.assign(modal.state, values);
  modal.store = { upgrade: jest.fn() };
  const selection = {
    selectedRowKeys: ['template'],
    selectedRows: [{ uuid: 'template', image_id: 'image' }],
  };
  modal.selectTarget(selection);
  const pending = modal.onSubmit({ clusterTemplate: selection });
  expect(modal.store.upgrade).not.toHaveBeenCalled();
  complete({ id: 'image' });
  await expect(pending).rejects.toThrow();
  expect(modal.store.upgrade).not.toHaveBeenCalled();
});
