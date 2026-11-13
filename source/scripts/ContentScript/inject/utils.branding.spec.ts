/** @jest-environment jsdom */
import { announceProvider } from './utils';

const original = process.env.PALI_EXTENSION_CHANNEL;
afterEach(() => {
  if (original === undefined) delete process.env.PALI_EXTENSION_CHANNEL;
  else process.env.PALI_EXTENSION_CHANNEL = original;
});

it.each([
  ['stable', 'Pali Wallet', 'com.paliwallet'],
  ['canary', 'Pali Wallet Canary', 'com.paliwallet.canary'],
])(
  'announces the %s identity in dapp wallet pickers',
  (channel, name, rdns) => {
    process.env.PALI_EXTENSION_CHANNEL = channel;
    const listener = jest.fn();
    const provider = {};
    window.addEventListener('eip6963:announceProvider', listener);
    try {
      announceProvider(provider, 'fixture-uuid');
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].detail).toEqual({
        info: {
          name,
          rdns,
          icon: expect.any(String),
          uuid: 'fixture-uuid',
        },
        provider,
      });
    } finally {
      window.removeEventListener('eip6963:announceProvider', listener);
    }
  }
);
