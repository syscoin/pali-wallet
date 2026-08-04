jest.mock('scripts/Background', () => ({
  getController: jest.fn(),
}));

jest.mock('@sidhujag/sysweb3-keyring', () => ({
  PsbtUtils: {},
}));

import { getMethodConfig } from './method-registry';
import { methodRequest } from './requests';

describe('provider-facing signing methods', () => {
  it('rejects eth_sign as an unsupported provider method', async () => {
    expect(getMethodConfig('eth_sign')).toBeUndefined();

    await expect(
      methodRequest('malicious.example', {
        method: 'eth_sign',
        params: [
          '0x1111111111111111111111111111111111111111',
          `0x${'22'.repeat(32)}`,
        ],
      })
    ).rejects.toMatchObject({
      code: 4200,
    });
  });
});
