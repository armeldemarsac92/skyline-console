// SPDX-License-Identifier: Apache-2.0
import root from 'stores/root';
import * as capabilities from './capabilities';

jest.mock('stores/root', () => ({
  user: {
    user: { id: 'member' },
    project: { id: 'project' },
    roles: [{ name: 'member' }],
  },
  policies: [{ rule: 'magnum:nodegroup:get', allowed: true }],
}));

it('honours explicit refusals and limits the missing Hibiscus credential rule to members of the cluster project', () => {
  const cluster = { project_id: 'project' };
  expect(capabilities.hasMagnumPolicy('nodegroup:get', cluster)).toBe(true);
  expect(capabilities.hasMagnumPolicy('nodegroup:delete', cluster)).toBe(false);
  expect(capabilities.hasMagnumPolicy('credential:rotate', cluster)).toBe(true);
  expect(
    capabilities.hasMagnumPolicy('credential:rotate', { project_id: 'other' })
  ).toBe(false);
  root.policies.push({ rule: 'magnum:credential:rotate', allowed: false });
  expect(capabilities.hasMagnumPolicy('credential:rotate', cluster)).toBe(
    false
  );
});
