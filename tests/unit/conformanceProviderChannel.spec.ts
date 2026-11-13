/** @jest-environment jsdom */
import { expectedProviderIdentity } from '../../e2e/harness/extensionVersion';
import {
  installConformanceInstrumentation,
  openOfficialDapp,
} from '../../e2e/harness/testDappConformance';
import { announceProvider } from '../../source/scripts/ContentScript/inject/utils';

import type { BrowserContext } from '@playwright/test';

jest.mock('@playwright/test', () => ({
  expect: (value: unknown) => expect(value),
}));

const environmentKeys = [
  'PALI_TEST_DAPP_CHANNEL',
  'PALI_CANARY_BUILD_NUMBER',
  'PALI_EXTENSION_CHANNEL',
] as const;
const original = Object.fromEntries(
  environmentKeys.map((key) => [key, process.env[key]])
);
const listeners: Array<[string, EventListenerOrEventListenerObject]> = [];
beforeEach(() => {
  const add = window.addEventListener.bind(window);
  jest
    .spyOn(window, 'addEventListener')
    .mockImplementation((type, listener, options) => {
      if (listener) listeners.push([type, listener]);
      add(type, listener, options);
    });
  delete (window as any).__paliConformanceProvider;
});
afterEach(() => {
  for (const [type, listener] of listeners.splice(0))
    window.removeEventListener(type, listener);
  jest.restoreAllMocks();
  for (const key of environmentKeys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

it.each(['production', 'canary'])(
  'binds only the canonical %s provider, notification channel and picker',
  async (channel) => {
    if (channel === 'production') delete process.env.PALI_TEST_DAPP_CHANNEL;
    else process.env.PALI_TEST_DAPP_CHANNEL = channel;
    process.env.PALI_CANARY_BUILD_NUMBER = '42';
    process.env.PALI_EXTENSION_CHANNEL = channel;
    const expected = expectedProviderIdentity(process.env);
    let providerEventName!: (name: string) => string;
    let sysProviderKey!: string;
    jest.isolateModules(() => {
      // Exercise the same build-channel namespace used by the shipped content script.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      ({
        providerEventName,
        SYS_PROVIDER_KEY: sysProviderKey,
      } = require('../../source/scripts/ContentScript/providerChannel'));
    });
    expect(expected.notificationEvent).toBe(
      providerEventName('paliNotification')
    );
    expect(expected.stateKey).toBe(providerEventName('paliProvider'));
    expect(expected.sysProviderKey).toBe(sysProviderKey);
    let routeHandler!: (route: any) => Promise<void>;
    let initialize!: () => void;
    const picker = { click: jest.fn(async () => undefined) };
    const page = {
      goto: jest.fn(async () => undefined),
      waitForFunction: jest.fn(async () => undefined),
      getByRole: jest.fn(() => picker),
    };
    const context = {
      route: jest.fn(async (_pattern, handler) => {
        routeHandler = handler;
      }),
      addInitScript: jest.fn(async (callback, argument) => {
        initialize = () => callback(argument);
      }),
      serviceWorkers: () => [
        {
          evaluate: async () => {
            await routeHandler({
              request: () => ({
                url: () => 'https://pali-conformance.invalid/rpc',
                postDataJSON: () => ({ method: 'eth_sendRawTransaction' }),
              }),
              abort: async () => undefined,
            });
            return true;
          },
        },
      ],
      newPage: async () => page,
    } as unknown as BrowserContext;
    await installConformanceInstrumentation(context);
    initialize();
    const provider = () => ({
      request: jest.fn(async () => ['selected-account']),
      on: jest.fn(),
    });
    const other = provider();
    process.env.PALI_EXTENSION_CHANNEL =
      channel === 'canary' ? 'production' : 'canary';
    announceProvider(other, 'other-channel');
    expect((window as any).__paliConformanceProvider).toBeUndefined();
    process.env.PALI_EXTENSION_CHANNEL = channel;
    const selected = provider();
    announceProvider(selected, 'selected-channel');
    const state = (window as any).__paliConformance;
    expect(state.providers).toEqual([
      {
        name: expected.name,
        rdns: expected.rdns,
        icon: expect.any(String),
        uuid: 'selected-channel',
      },
    ]);
    await (window as any).__paliConformanceProvider.request({
      method: 'eth_accounts',
    });
    expect(state.requests).toHaveLength(1);
    expect(other.request).not.toHaveBeenCalled();
    const notify = (event: string) =>
      window.dispatchEvent(
        new CustomEvent(event, {
          detail: JSON.stringify({
            method: 'pali_accountsChanged',
            params: ['selected-account'],
          }),
        })
      );
    notify(
      channel === 'canary' ? 'paliNotification' : 'pali-canary:paliNotification'
    );
    expect(state.notifications).toHaveLength(0);
    notify(providerEventName('paliNotification'));
    expect(state.notifications).toHaveLength(1);
    await openOfficialDapp(context);
    expect(page.getByRole).toHaveBeenCalledWith('button', {
      name: `Use ${expected.name}`,
      exact: true,
    });
  }
);
