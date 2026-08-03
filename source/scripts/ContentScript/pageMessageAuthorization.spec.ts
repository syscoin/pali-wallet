import { isAllowedPageProviderMessageType } from './pageMessageAuthorization';

describe('page-to-extension message authorization', () => {
  it.each(['DISABLE', 'ENABLE', 'IS_UNLOCKED', 'METHOD_REQUEST'])(
    'allows the public provider message %s',
    (type) => {
      expect(isAllowedPageProviderMessageType(type)).toBe(true);
    }
  );

  it.each([
    'CONTROLLER_ACTION',
    'CONTROLLER_STATE_CHANGE',
    'PALI_SLH_DSA_SETUP_PROGRESS',
    'changeNetwork',
    'getCurrentState',
    'lock_wallet',
    'logout',
    'startPolling',
  ])('rejects the internal message %s', (type) => {
    expect(isAllowedPageProviderMessageType(type)).toBe(false);
  });
});
