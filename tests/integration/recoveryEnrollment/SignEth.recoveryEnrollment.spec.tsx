/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
import { EthereumTransactions } from '@sidhujag/sysweb3-keyring/cjs/transactions/ethereum';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { fork, ChildProcess } from 'child_process';
import { Wallet } from 'ethers/wallet';
import fs from 'fs';
import path from 'path';
import React from 'react';

import EthSign from '../../../source/pages/Transactions/SignEth';
import { dispatchBackgroundEvent } from 'utils/browser';
import { defaultAbiCoder, hexlify, toUtf8Bytes } from 'utils/ethersV6Compat';

// Only renderer/controller transport and unused hardware/UTXO adapters are
// replaced. Hashing, encoding, validator dispatch and SDK ECDSA stay real.
jest.mock('@trezor/connect-webextension', () => ({
  __esModule: true,
  default: {},
}));
jest.mock('syscoinjs-lib', () => ({
  utils: { bitcoinjs: {} },
  networks: { bitcoin: {}, syscoin: {} },
}));
jest.mock('state/store', () => ({ __esModule: true, default: {} }));
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/index', () => ({
  useQueryData: () => mockQuery,
  useUtils: () => ({
    alert: { error: jest.fn(), info: jest.fn(), success: jest.fn() },
    useCopyClipboard: () => [false, jest.fn()],
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('utils/alarmUtils', () => ({ createTemporaryAlarm: jest.fn() }));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('utils/errorHandling', () => ({
  handleTransactionError: () => false,
}));
jest.mock('utils/network', () => ({ getNetworkChain: () => 'ethereum' }));
jest.mock('components/Loading', () => ({
  LoadingComponent: () => null,
  PqSigningOverlay: () => null,
}));
jest.mock('components/index', () => ({
  Button: ({ children, onClick, disabled, loading }: any) => (
    <button disabled={disabled || loading} onClick={onClick}>
      {children}
    </button>
  ),
  ErrorModal: ({ show, log }: any) =>
    show ? <div role="alert">{log}</div> : null,
  WarningModal: () => null,
  DeviceWaitingBanner: () => null,
  Icon: () => null,
  IconButton: ({ children }: any) => <span>{children}</span>,
}));

const TEST_KEY = `0x${'11'.repeat(32)}`; // Public test key, never funded publicly.
const owner = new Wallet(TEST_KEY);
let mockState: any;
let mockQuery: any;
let mockMetadata: any;
let backend: ChildProcess;
let backendInfo: any;
let requestId = 0;
const pending = new Map<
  number,
  { reject: (reason: Error) => void; resolve: (value: any) => void }
>();
const backendCall = (command: string, params?: unknown): Promise<any> =>
  new Promise((resolve, reject) => {
    const id = ++requestId;
    pending.set(id, { resolve, reject });
    backend.send!({ id, command, params });
  });
const sdk = new EthereumTransactions(
  () => ({ chainId: mockMetadata.chainId } as any),
  () => ({ address: owner.address, decryptedPrivateKey: TEST_KEY }),
  () =>
    ({
      accounts: { HDAccount: { 0: { address: owner.address } } },
      activeAccountId: 0,
      activeAccountType: 'HDAccount',
      activeNetwork: { chainId: mockMetadata.chainId },
    } as any),
  {} as any,
  {} as any
);
const mockEmitter = jest.fn(async (method: string[], args: any[]) => {
  if (method.at(-1) === 'hydrateSmartAccount') return mockMetadata;
  if (method.at(-1) === 'checkAddressBlacklist')
    return { isBlacklisted: false, severity: 'low' };
  expect(method).toEqual(['wallet', 'signSmartAccountActionDigestInternal']);
  expect(args[1]).toEqual({ id: 0, type: 'HDAccount' });
  return sdk.ethSign(args[0]);
});

beforeAll(async () => {
  backend = fork(
    path.join(__dirname, 'backendFixture.cjs'),
    [
      process.env.RECOVERY_BACKEND_ROOT!,
      path.resolve(__dirname, '../../..'),
      owner.address,
    ],
    { execPath: process.execPath, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }
  );
  backend.stdout!.on('data', (chunk) => process.stdout.write(chunk));
  backend.stderr!.on('data', (chunk) => process.stderr.write(chunk));
  backend.on('message', (message: any) => {
    const waiting = pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id);
    if (message.error) waiting.reject(new Error(message.error));
    else waiting.resolve(message.result);
  });
  backend.on('exit', (code) => {
    for (const waiting of pending.values())
      waiting.reject(new Error(`Backend exited ${code}`));
    pending.clear();
  });
  backendInfo = await backendCall('start');
}, 90000);

afterAll(async () => {
  if (backend?.connected) await backendCall('stop');
  backend?.kill();
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function sign(
  message: string,
  account = backendInfo.accountAddress,
  chainId = 57057
) {
  jest.mocked(dispatchBackgroundEvent).mockClear();
  mockEmitter.mockClear();
  const authData = defaultAbiCoder.encode(
    ['address[]', 'uint64'],
    [[owner.address], 1]
  );
  mockMetadata = {
    auth: {
      module: 'ecdsa',
      validator: backendInfo.validatorAddress,
      data: authData,
    },
    chainId,
    isDeployed: true,
    installedModules: [
      {
        type: 'validator',
        id: 'ecdsa',
        address: backendInfo.validatorAddress,
        config: { owners: [owner.address], threshold: 1 },
        data: authData,
      },
    ],
  };
  mockState = {
    vault: {
      accounts: {
        HDAccount: {
          0: {
            address: owner.address,
            balances: { ethereum: '0' },
            label: 'Public test owner',
          },
        },
        SmartAccount: {
          0: {
            address: account,
            balances: { ethereum: '0' },
            label: 'Local recovery account',
            isSmartAccount: true,
            smartAccount: mockMetadata,
          },
        },
      },
      activeAccount: { type: 'SmartAccount', id: 0 },
      activeNetwork: { chainId, currency: 'ETH', url: backendInfo.rpcUrl },
      isBitcoinBased: false,
    },
  };
  mockQuery = {
    host: 'http://app.test.local',
    eventName: 'personal_sign',
    0: hexlify(toUtf8Bytes(message)),
    1: account,
  };
  const original = { ...mockQuery };
  jest.spyOn(window, 'close').mockImplementation(() => undefined);
  const view = render(<EthSign />);
  const confirm = await screen.findByRole('button', {
    name: 'buttons.confirm',
  });
  await waitFor(() =>
    expect((confirm as HTMLButtonElement).disabled).toBe(false)
  );
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  fireEvent.click(confirm);
  await waitFor(() => expect(dispatchBackgroundEvent).toHaveBeenCalledTimes(1));
  expect(mockQuery).toEqual(original);
  expect(
    mockEmitter.mock.calls.filter(
      ([method]) => method.at(-1) === 'signSmartAccountActionDigestInternal'
    )
  ).toHaveLength(1);
  const [event, signature] = jest.mocked(dispatchBackgroundEvent).mock.calls[0];
  expect(event).toBe('personal_sign.http://app.test.local');
  expect(signature).toMatch(/^0x[0-9a-f]+$/i);
  // No test-side prefixing, wrapping, hashing or signature assembly.
  view.unmount();
  jest.restoreAllMocks();
  return signature;
}

it('enrolls with actual Pali personal_sign output on a real account and rejects changed context/replay', async () => {
  const challenge = await backendCall('challenge');
  expect(challenge.status).toBe(200);
  const c = challenge.body;
  const wrongChain = await sign(c.message, backendInfo.accountAddress, 57058);
  expect(
    await backendCall('enroll', { challengeId: c.id, signature: wrongChain })
  ).toMatchObject({ status: 400, body: { error: 'invalid_signature' } });
  const wrongAccount = await sign(c.message, backendInfo.otherAccountAddress);
  expect(
    await backendCall('enroll', { challengeId: c.id, signature: wrongAccount })
  ).toMatchObject({ status: 400, body: { error: 'invalid_signature' } });
  const changedMessage = await sign(`${c.message}\nAltered request`);
  expect(
    await backendCall('enroll', {
      challengeId: c.id,
      signature: changedMessage,
    })
  ).toMatchObject({ status: 400, body: { error: 'invalid_signature' } });
  const signature = await sign(c.message);
  expect(await backendCall('verify', { message: c.message, signature })).toBe(
    '0x1626ba7e'
  );
  const enrolled = await backendCall('enroll', {
    challengeId: c.id,
    signature,
    label: 'Actual Pali component signature',
  });
  expect(enrolled).toMatchObject({
    status: 201,
    body: {
      subscription: {
        account: backendInfo.accountAddress.toLowerCase(),
        chainId: 57057,
      },
    },
  });
  expect(
    await backendCall('enroll', { challengeId: c.id, signature })
  ).toMatchObject({ status: 400, body: { error: 'challenge_expired' } });
  const status = await backendCall('status');
  expect(status.body.subscriptions).toHaveLength(1);
  expect(status.mailCount).toBe(0);
  if (process.env.RECOVERY_ENROLLMENT_EVIDENCE_DIR) {
    fs.writeFileSync(
      path.join(process.env.RECOVERY_ENROLLMENT_EVIDENCE_DIR, 'contracts.json'),
      JSON.stringify(
        {
          ...backendInfo,
          scope:
            'Pali component and SDK signing to local real-contract backend enrollment, not extension-browser E2E',
          expected: {
            enrolledStatus: enrolled.status,
            erc1271: '0x1626ba7e',
            rejected: [
              'wrong chain',
              'wrong account',
              'changed message',
              'replay',
            ],
            subscriptions: status.body.subscriptions.length,
            mailCount: status.mailCount,
          },
        },
        null,
        2
      )
    );
  }
}, 90000);
