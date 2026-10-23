/** @jest-environment jsdom */
jest.unmock('scripts/Background/controllers/chainlist');
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';

import ChainListService from 'scripts/Background/controllers/chainlist';
import dappReducer from 'state/dapp';
import vaultReducer, { setActiveNetwork, setIsBitcoinBased } from 'state/vault';
import vaultGlobalReducer, { setNetworks } from 'state/vaultGlobal';
import { INetwork, INetworkType } from 'types/network';

import { ChainIcon } from './ChainIcon';
import { NetworkMenu } from './Header/Menus/NetworkMenu';

let mockStore: ReturnType<typeof createStore>;
const mockReadChain = jest.fn();
const mockNavigate = jest.fn();
const mockController = jest.fn(
  async (_method: string[], [network]: INetwork[]) => {
    act(() => {
      // The same Redux publication made by an admitted network switch. Keep the
      // real NetworkMenu and its persistent ChainIcon mounted across selection.
      mockStore.dispatch(setActiveNetwork(network));
      mockStore.dispatch(
        setIsBitcoinBased(network.kind === INetworkType.Syscoin)
      );
    });
  }
);

jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: (...args: any[]) => mockReadChain(...args),
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockStore.getState(),
    dispatch: (action: any) => mockStore.dispatch(action),
  },
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockController }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: mockNavigate }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (copyKey: string, copyValues?: any) =>
      jest
        .requireActual('../../tests/helpers/localizedUiCopy')
        .localizedUiCopy(copyKey, copyValues) ??
      (
        ((key: string) =>
          ({
            'networkMenu.evmNetworks': 'EVM networks',
            'networkMenu.utxoNetworks': 'UTXO networks',
          }[key] || key)) as any
      )(copyKey, copyValues),
    i18n: { language: 'en' },
  }),
}));
jest.mock('components/index', () => ({ Icon: () => null }));
jest.mock('@ant-design/icons', () => ({}));

const originalFetch = globalThis.fetch;
const originalGet = chrome.storage.local.get;
const originalSet = chrome.storage.local.set;
const originalRead = FileReader.prototype.readAsDataURL;
const completedImages: string[] = [];
const held: Array<{ resolve: (value: any) => void }> = [];
const metadata = [
  [137, 'polygon'],
  [10, 'optimism'],
  [100, 'gnosis'],
  [250, 'fantom'],
  [2, 'expanse'],
  [1101, 'polygon-zkevm'],
  [4242, 'nexi'],
  [31337, 'local-test'],
  [43114, 'avalanche'],
  [42220, 'celo'],
  [25, 'cronos'],
].map(([chainId, icon]) => ({
  chainId,
  icon,
  name: icon,
  nativeCurrency: { symbol: 'TEST', decimals: 18, name: 'TEST' },
  rpc: [],
}));
const network = (
  chainId: number,
  label: string,
  kind = INetworkType.Ethereum
): INetwork => ({
  chainId,
  label,
  kind,
  url: `https://${kind}-${chainId}.synthetic.invalid`,
  currency: kind === INetworkType.Syscoin ? 'ltc' : 'eth',
  slip44: kind === INetworkType.Syscoin ? 2 : 60,
});
const ethereum = network(1, 'Ethereum');
const base = network(8453, 'Base');
const polygon = network(137, 'Polygon');
const optimism = network(10, 'Optimism');
const gnosis = network(100, 'Gnosis');
const fantom = network(250, 'Fantom');
const expanse = network(2, 'Expanse');
const litecoin = network(2, 'Litecoin', INetworkType.Syscoin);
const zkEvm = network(1101, 'Polygon zkEVM');
const unavailable = network(4242, 'Unavailable icon');

function createStore() {
  return configureStore({
    reducer: {
      vault: vaultReducer,
      vaultGlobal: vaultGlobalReducer,
      dapp: dappReducer,
    },
    middleware: (defaults) => defaults({ serializableCheck: false }),
  });
}
const imageBytes = (label: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><title>${label}</title><rect width="1" height="1" fill="red"/></svg>`;
const reply = (label: string) =>
  ({
    ok: true,
    blob: async () => new Blob([imageBytes(label)], { type: 'image/svg+xml' }),
  } as Response);
const imageData = (label: string) =>
  `data:image/svg+xml;base64,${Buffer.from(imageBytes(label)).toString(
    'base64'
  )}`;
const useIconResponse = (
  response: (url: string) => Promise<Response> | Response
) =>
  jest.mocked(fetch).mockImplementation(async (input: any) => {
    const url = String(input);
    return url === 'https://chainlist.org/rpcs.json'
      ? ({ ok: true, json: async () => metadata } as Response)
      : response(url);
  });
const deferred = () => {
  let resolve!: (value: any) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  const result = { promise, resolve };
  held.push(result);
  return result;
};
const header = (label: string) => screen.getByTitle(label).closest('button')!;
const image = (label: string) => header(label).querySelector('img');
const mount = (initial: INetwork, choices: INetwork[] = []) => {
  const networks = [initial, ...choices];
  mockStore.dispatch(
    setNetworks({
      ethereum: Object.fromEntries(
        networks
          .filter((item) => item.kind === INetworkType.Ethereum)
          .map((item) => [item.chainId, item])
      ),
      syscoin: Object.fromEntries(
        networks
          .filter((item) => item.kind === INetworkType.Syscoin)
          .map((item) => [item.chainId, item])
      ),
    })
  );
  mockStore.dispatch(setActiveNetwork(initial));
  mockStore.dispatch(setIsBitcoinBased(initial.kind === INetworkType.Syscoin));
  return render(
    <Provider store={mockStore}>
      <MemoryRouter>
        <NetworkMenu />
      </MemoryRouter>
    </Provider>
  );
};
const choose = async (current: INetwork, next: INetwork) => {
  fireEvent.click(header(current.label));
  const menu = screen.getByRole('menu');
  const group = within(menu).getByRole('menuitem', {
    name: next.kind === INetworkType.Syscoin ? 'UTXO networks' : 'EVM networks',
  });
  if (group.getAttribute('aria-expanded') !== 'true') fireEvent.click(group);
  fireEvent.click(within(menu).getByRole('menuitem', { name: next.label }));
  await waitFor(() => expect(header(next.label)).toBeVisible());
  expect(mockController).toHaveBeenLastCalledWith(
    ['wallet', 'setActiveNetwork'],
    [next]
  );
};

beforeEach(() => {
  completedImages.length = 0;
  jest
    .spyOn(FileReader.prototype, 'readAsDataURL')
    .mockImplementation(function (blob) {
      this.addEventListener(
        'loadend',
        () => completedImages.push(String(this.result)),
        { once: true }
      );
      originalRead.call(this, blob);
    });
  mockStore = createStore();
  mockController.mockClear();
  mockReadChain
    .mockClear()
    .mockImplementation(async (_method, [chainId, kind]) =>
      ChainListService.getInstance().getChainById(chainId, kind)
    );
  chrome.storage.local.get = jest.fn((_keys, callback) => callback({})) as any;
  chrome.storage.local.set = jest.fn((_values, callback) =>
    callback?.()
  ) as any;
  globalThis.fetch = jest.fn();
  useIconResponse(reply);
});
afterEach(async () => {
  cleanup();
  await act(async () => {
    held.splice(0).forEach(({ resolve }) => resolve({ ok: false }));
  });
  globalThis.fetch = originalFetch;
  jest.restoreAllMocks();
  chrome.storage.local.get = originalGet;
  chrome.storage.local.set = originalSet;
});

it('replaces the real header known SVG with the selected chain image after its successful load', async () => {
  mount(ethereum, [polygon]);
  expect(header(ethereum.label).querySelector('svg')).not.toBeNull();
  await choose(ethereum, polygon);
  const url = 'https://c1.coinlore.com/img/25x25/polygon.png';
  await waitFor(() => expect(fetch).toHaveBeenCalledWith(url));
  await waitFor(() =>
    expect(image(polygon.label)).toHaveAttribute('src', imageData(url))
  );
});

it('does not replace a newly selected local image with an older remote image completion', async () => {
  const old = deferred();
  useIconResponse((url) =>
    url.includes('/optimism.png') ? old.promise : reply(url)
  );
  mount(optimism, [base]);
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      'https://c1.coinlore.com/img/25x25/optimism.png'
    )
  );
  await choose(optimism, base);
  const localUrl = image(base.label)!.getAttribute('src');
  await act(async () => old.resolve(reply('old optimism')));
  await waitFor(() =>
    expect(completedImages).toContain(imageData('old optimism'))
  );
  expect(image(base.label)).toHaveAttribute('src', localUrl);
});

it('does not replace the newer remote chain image with an old successful completion', async () => {
  const old = deferred();
  useIconResponse((url) =>
    url.includes('/gnosis.png') ? old.promise : reply(url)
  );
  mount(gnosis, [fantom]);
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      'https://c1.coinlore.com/img/25x25/gnosis.png'
    )
  );
  await choose(gnosis, fantom);
  const currentUrl = 'https://c1.coinlore.com/img/25x25/fantom.png';
  await waitFor(() =>
    expect(image(fantom.label)).toHaveAttribute('src', imageData(currentUrl))
  );
  await act(async () => old.resolve(reply('old gnosis')));
  await waitFor(() =>
    expect(completedImages).toContain(imageData('old gnosis'))
  );
  expect(image(fantom.label)).toHaveAttribute('src', imageData(currentUrl));
});

it('keeps same-number EVM and UTXO chain images separate through the real service lookup', async () => {
  mount(expanse, [litecoin]);
  const firstUrl = 'https://c1.coinlore.com/img/25x25/expanse.png';
  await waitFor(() =>
    expect(image(expanse.label)).toHaveAttribute('src', imageData(firstUrl))
  );
  await choose(expanse, litecoin);
  const nextUrl = 'https://c1.coinlore.com/img/25x25/litecoin.png';
  await waitFor(() =>
    expect(image(litecoin.label)).toHaveAttribute('src', imageData(nextUrl))
  );
});

it('loads a fresh chain image and reuses its same-family cached value on remount', async () => {
  const view = mount(zkEvm);
  const url = 'https://c1.coinlore.com/img/25x25/polygon-zkevm.png';
  await waitFor(() =>
    expect(mockReadChain).toHaveBeenCalledWith(
      ['wallet', 'getChainById'],
      [1101, INetworkType.Ethereum]
    )
  );
  await waitFor(() =>
    expect(image(zkEvm.label)).toHaveAttribute('src', imageData(url))
  );
  const calls = jest.mocked(fetch).mock.calls.length;
  view.unmount();
  mount(zkEvm);
  expect(image(zkEvm.label)).toHaveAttribute('src', imageData(url));
  expect(fetch).toHaveBeenCalledTimes(calls);
});

it('shows a fallback rather than claiming a chain image after every image source fails', async () => {
  useIconResponse(() => ({ ok: false } as Response));
  mount(unavailable);
  await waitFor(() =>
    expect(
      jest
        .mocked(fetch)
        .mock.calls.filter(([url]) => String(url).includes('nexi'))
    ).toHaveLength(4)
  );
  await waitFor(() => expect(image(unavailable.label)).toBeNull());
  expect(header(unavailable.label).querySelector('svg')).not.toBeNull();
});

it('retains the 50ms lazy start and shares one pending image across simultaneous consumers', async () => {
  const pending = deferred();
  const url = 'https://c1.coinlore.com/img/25x25/local-test.png';
  useIconResponse(() => pending.promise);
  jest.useFakeTimers();
  try {
    render(
      <>
        <ChainIcon chainId={31337} networkKind={INetworkType.Ethereum} />
        <ChainIcon chainId={31337} networkKind={INetworkType.Ethereum} />
      </>
    );
    await act(async () => jest.advanceTimersByTimeAsync(49));
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTimeAsync(1));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(url);
  } finally {
    jest.useRealTimers();
  }
  await act(async () => pending.resolve(reply('shared image')));
  await waitFor(() =>
    expect(screen.getAllByAltText('Chain 31337')).toHaveLength(2)
  );
  screen
    .getAllByAltText('Chain 31337')
    .forEach((img) =>
      expect(img).toHaveAttribute('src', imageData('shared image'))
    );
});

it('keeps a shared request available when its original consumer unmounts', async () => {
  const pending = deferred();
  useIconResponse(() => pending.promise);
  const first = render(
    <ChainIcon chainId={43114} networkKind={INetworkType.Ethereum} />
  );
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  first.unmount();
  render(<ChainIcon chainId={43114} networkKind={INetworkType.Ethereum} />);
  await act(async () => pending.resolve(reply('avalanche image')));
  await waitFor(() =>
    expect(screen.getByAltText('Chain 43114')).toHaveAttribute(
      'src',
      imageData('avalanche image')
    )
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('reuses the current chain request after an A to B to A header transition', async () => {
  const pending = deferred();
  useIconResponse(() => pending.promise);
  const celo = network(42220, 'Celo');
  mount(celo, [ethereum]);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  await choose(celo, ethereum);
  expect(image(ethereum.label)).toBeNull();
  await choose(ethereum, celo);
  await act(async () => pending.resolve(reply('current celo')));
  await waitFor(() =>
    expect(image(celo.label)).toHaveAttribute('src', imageData('current celo'))
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('detaches retired image error events from the current cached header image', async () => {
  mount(base, [polygon]);
  const retired = image(base.label)!;
  await choose(base, polygon);
  const current = image(polygon.label)!;
  expect(current).not.toBe(retired);
  fireEvent.error(retired);
  expect(image(polygon.label)).toBe(current);
  expect(current).toHaveAttribute(
    'src',
    imageData('https://c1.coinlore.com/img/25x25/polygon.png')
  );
  fireEvent.error(current);
  expect(image(polygon.label)).toBeNull();
});

it('preserves omitted-kind lookup semantics without caching that result for an explicit family', async () => {
  const view = render(<ChainIcon chainId={25} />);
  await waitFor(() =>
    expect(mockReadChain).toHaveBeenCalledWith(
      ['wallet', 'getChainById'],
      [25, undefined]
    )
  );
  expect(fetch).not.toHaveBeenCalled();
  view.rerender(<ChainIcon chainId={25} networkKind={INetworkType.Ethereum} />);
  const url = 'https://c1.coinlore.com/img/25x25/cronos.png';
  await waitFor(() =>
    expect(screen.getByAltText('Chain 25')).toHaveAttribute(
      'src',
      imageData(url)
    )
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('keeps local SVG and URL icons offline and falls back after a current local image error', () => {
  render(
    <>
      <div data-testid="local-svg">
        <ChainIcon chainId={1} networkKind={INetworkType.Ethereum} />
      </div>
      <div data-testid="local-url">
        <ChainIcon chainId={8453} networkKind={INetworkType.Ethereum} />
      </div>
    </>
  );
  expect(screen.getByTestId('local-svg').querySelector('svg')).not.toBeNull();
  const local = within(screen.getByTestId('local-url')).getByAltText(
    'Chain 8453'
  );
  expect(local).toHaveAttribute('src', 'test-file-stub');
  fireEvent.error(local);
  expect(
    within(screen.getByTestId('local-url')).queryByAltText('Chain 8453')
  ).toBeNull();
  expect(screen.getByTestId('local-url').querySelector('svg')).not.toBeNull();
  expect(mockReadChain).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
