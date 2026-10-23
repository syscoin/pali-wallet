/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Provider } from 'react-redux';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';

import en from 'assets/locales/en.json';
import ManageNetwork from 'pages/Settings/ManageNetwork';
import MainController from 'scripts/Background/controllers/MainController';
import { loadState, walletPersistenceGate } from 'state/paliStorage';
import store from 'state/store';
import { restoreVaultSnapshot } from 'state/vault';
import vaultCache from 'state/vaultCache';
import {
  setActiveSlip44,
  setIsSwitchingAccount,
  setNetworks,
  setNetworkStatus,
} from 'state/vaultGlobal';
import { INetwork, INetworkType } from 'types/network';

// The real manager, ChainIcon, glyph, dialog, router, Redux and registry
// persistence are exercised. Unrelated worker construction is not started.
jest.mock('scripts/Background', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock(
  'scripts/Background/controllers/providers/patchFetchWithPaliHeaders',
  () => ({
    patchFetchWithPaliHeaders: jest.fn(),
  })
);
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('utils/syscoinPsbtValues', () => ({}));
// The installed icon CJS entry imports this ESM subpath. Use the package's
// identical CJS implementation under standard Jest without replacing glyphs.
jest.mock('@ant-design/colors/es/generate', () =>
  jest.requireActual('@ant-design/colors/lib/generate')
);
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values: Record<string, unknown> = {}) => {
      const message = key
        .split('.')
        .reduce((entry: any, part) => entry?.[part], en);
      return typeof message === 'string'
        ? message.replace(/{{(\w+)}}/g, (_match, name) =>
            String(values[name] ?? '')
          )
        : key;
    },
  }),
}));
const mockAlert = { error: jest.fn() };
const mockEmitter = jest.fn(async () => {
  throw new Error('Unexpected worker request');
});
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    navigate: jest.requireActual('react-router-dom').useNavigate(),
    alert: mockAlert,
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockEmitter,
    connectionUnavailable: false,
  }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => ({
    isUnlocked: true,
    isLoading: false,
    connectionUnavailable: false,
  }),
}));
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button/Button').Button,
  IconButton: jest.requireActual('components/IconButton/IconButton').IconButton,
  Icon: jest.requireActual('components/Icon/Icon').Icon,
  Tooltip: jest.requireActual('components/Tooltip/Tooltip').Tooltip,
  ConfirmationModal: jest.requireActual('components/Modal/Modal')
    .ConfirmationModal,
}));

const active: INetwork = {
  chainId: 1,
  kind: INetworkType.Ethereum,
  slip44: 60,
  label: 'Active control',
  currency: 'eth',
  url: 'https://active.synthetic.invalid',
  default: true,
};
const ids = [5, 11155111] as const;
const identity = (label: string, chainId: number) =>
  `${label} (EVM · ${en.settings.chainNumber.replace(
    '{{chainId}}',
    String(chainId)
  )})`;
// Ask the standard Testing Library role query to resolve the actual name.
// This avoids importing its transitive accessibility implementation directly.
const accessibleNameOf = (element: HTMLElement, role: 'button' | 'dialog') => {
  let observed = '';
  within(document.body).getByRole(role, {
    name: (name, candidate) => {
      if (candidate !== element) return false;
      observed = name;
      return true;
    },
  });
  return observed;
};
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
let wallet: any;
let records: Record<string, any>;
let writes: Array<Record<string, any>>;
let unexpectedReads: string[];
const originalChrome = global.chrome;
const originalFetch = global.fetch;
const originalResizeObserver = global.ResizeObserver;

const EditTarget = () => {
  const { state } = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="edit-target">
        {JSON.stringify(state.selected)}
      </output>
      <button onClick={() => navigate(-1)}>Back to manager</button>
    </>
  );
};
const registry = () => clone(store.getState().vaultGlobal.networks);
const persistedRegistry = async () =>
  clone((await loadState()).vaultGlobal.networks);

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
  records = {};
  writes = [];
  unexpectedReads = [];
  global.fetch = jest.fn(async (input) => {
    unexpectedReads.push(String(input));
    throw new Error('No network allowed in component proof');
  });
  global.ResizeObserver = class {
    observe() {
      return undefined;
    }
    unobserve() {
      return undefined;
    }
    disconnect() {
      return undefined;
    }
  } as any;
  global.chrome = {
    runtime: { id: 'network-manager-public-identity-proof' },
    storage: {
      local: {
        get: (keys: string[], done: (value: any) => void) =>
          done(
            Object.fromEntries(
              keys
                .filter((key) => key in records)
                .map((key) => [key, clone(records[key])])
            )
          ),
        set: (items: Record<string, any>, done: () => void) => {
          writes.push(clone(items));
          Object.assign(records, clone(items));
          done();
        },
        remove: (keys: string[], done: () => void) => {
          keys.forEach((key) => delete records[key]);
          done();
        },
      },
    },
  } as any;
  vaultCache.clearCache();
  walletPersistenceGate.blocked = false;
  store.dispatch(
    restoreVaultSnapshot({
      ...store.getState().vault,
      activeNetwork: active,
      isBitcoinBased: false,
    })
  );
  store.dispatch(setActiveSlip44(60));
  store.dispatch(setNetworkStatus('idle'));
  store.dispatch(setIsSwitchingAccount(false));
  store.dispatch(setNetworks({ ethereum: { 1: active }, syscoin: {} }));
  wallet = Object.create(MainController.prototype);
  wallet.walletStateGeneration = 0;
  wallet.walletSessionGeneration = 0;
  wallet.isRemovingNetwork = false;
  wallet.resetAutoLockTimer = jest.fn();
  // Optional public metadata enrichment is not an identity authority.
  wallet.evmAssetsController = {
    detectCoinGeckoIds: jest.fn().mockResolvedValue(null),
  };
});
afterEach(() => {
  cleanup();
  expect(unexpectedReads).toEqual([]);
  expect(mockEmitter).not.toHaveBeenCalled();
  expect(mockAlert.error).not.toHaveBeenCalled();
  vaultCache.clearCache();
  global.chrome = originalChrome;
  global.fetch = originalFetch;
  global.ResizeObserver = originalResizeObserver;
  jest.restoreAllMocks();
});

async function exercise(labels: readonly string[]) {
  // Actual controller + reducer + storage publication prove duplicate labels
  // are allowed on distinct chain IDs; no RPC/signing operation is requested.
  const registered = [];
  for (let index = 0; index < ids.length; index++) {
    registered.push(
      await wallet.addCustomRpc({
        ...active,
        chainId: ids[index],
        label: labels[index],
        default: false,
        url: 'https://rpc-' + ids[index] + '.synthetic.invalid',
      })
    );
  }
  expect(registered.map((network: INetwork) => network.label)).toEqual(labels);
  const beforeLive = registry();
  const beforeDisk = await persistedRegistry();
  expect(beforeDisk).toEqual(beforeLive);
  const beforeWrites = writes.length;
  const user = userEvent.setup();
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/settings/networks/edit']}>
        <Routes>
          <Route path="/settings/networks/edit" element={<ManageNetwork />} />
          <Route
            path="/settings/networks/custom-rpc"
            element={<EditTarget />}
          />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
  const targetRows = () => {
    const list = document.querySelector(
      '[data-navigation-scroll="settings-manage-networks"]'
    )!;
    return Array.from(list.querySelectorAll('li')).filter((row) =>
      labels.some((label) => row.textContent?.includes(label))
    );
  };
  expect(targetRows()).toHaveLength(2);
  const observations: Array<Record<string, unknown>> = [];
  for (let index = 0; index < ids.length; index++) {
    let row = targetRows()[index];
    const edit = within(row).getByRole('button', {
      name: en.buttons.edit + ': ' + identity(labels[index], ids[index]),
    });
    const remove = within(row).getByRole('button', {
      name: en.buttons.remove + ': ' + identity(labels[index], ids[index]),
    });
    expect(within(row).getByText(`EVM · Chain ${ids[index]}`)).toBeVisible();
    expect(row.querySelector('span[title]')).toHaveAttribute(
      'title',
      identity(labels[index], ids[index])
    );
    const glyph = row.querySelector('svg')!;
    expect(glyph).toHaveAttribute('viewBox', '0 0 100 100');
    expect(glyph.querySelector('text')).toBeNull();
    const observation: Record<string, unknown> = {
      expectedChainId: ids[index],
      rowText: row.textContent,
      editName: accessibleNameOf(edit, 'button'),
      removeName: accessibleNameOf(remove, 'button'),
      realChainGlyph: glyph.outerHTML,
    };
    await user.click(edit);
    await screen.findByTestId('edit-target');
    const selected = JSON.parse(screen.getByTestId('edit-target').textContent!);
    expect(selected).toEqual({
      chainId: ids[index],
      kind: INetworkType.Ethereum,
    });
    observation.editTarget = selected;
    await user.click(screen.getByRole('button', { name: 'Back to manager' }));
    row = targetRows()[index];
    await user.click(
      within(row).getByRole('button', {
        name: en.buttons.remove + ': ' + identity(labels[index], ids[index]),
      })
    );
    const dialog = await screen.findByRole('dialog');
    observation.dialogName = accessibleNameOf(dialog, 'dialog');
    expect(dialog).toHaveAccessibleName(
      en.settings.confirmRemoveNetwork.replace(
        '{{networkName}}',
        identity(labels[index], ids[index])
      )
    );
    expect(within(dialog).getByText(`EVM · Chain ${ids[index]}`)).toBeVisible();
    observation.dialogText = dialog.textContent;
    const cancel = within(dialog).getByRole('button', {
      name: en.buttons.cancel,
    });
    // Exercise actual native Tab + Enter on the real dialog Cancel.
    for (let count = 0; count < 8 && document.activeElement !== cancel; count++)
      await user.tab();
    expect(cancel).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(registry()).toEqual(beforeLive);
    expect(await persistedRegistry()).toEqual(beforeDisk);
    expect(writes).toHaveLength(beforeWrites);
    observations.push(observation);
  }
  expect(store.getState().vault.activeNetwork).toEqual(active);
  console.info(
    'network_manager_label_identity=' +
      JSON.stringify({
        labels,
        observations,
        creationWrites: beforeWrites,
        postCancelWrites: writes.length - beforeWrites,
        registry: beforeLive,
        noSigningOrBroadcast: true,
        scope:
          'JSDOM accessible-name and real-component regression; not browser-native AX',
      })
  );
  return observations;
}

it('healthy distinct labels remain distinguishable and Edit/keyboard Cancel preserve exact registrations', async () => {
  const result = await exercise(['Goerli control', 'Sepolia control']);
  expect(new Set(result.map((row) => row.rowText)).size).toBe(2);
  expect(new Set(result.map((row) => row.editName)).size).toBe(2);
  expect(new Set(result.map((row) => row.dialogName)).size).toBe(2);
});

it('same-label known-icon registrations remain distinguishable after all exact Edit and Cancel controls', async () => {
  const result = await exercise(['Same label', 'Same label']);
  // Both identities must differ after all exact target and no-write controls.
  expect(
    new Set(
      result.map((row) =>
        JSON.stringify({
          rowText: row.rowText,
          editName: row.editName,
          removeName: row.removeName,
          glyph: row.realChainGlyph,
          dialogName: row.dialogName,
          dialogText: row.dialogText,
        })
      )
    ).size
  ).toBe(2);
});
