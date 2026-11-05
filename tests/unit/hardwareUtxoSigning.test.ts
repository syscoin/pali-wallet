jest.unmock('syscoinjs-lib');
jest.mock('@trezor/connect-webextension', () => ({
  __esModule: true,
  default: {
    init: jest.fn(),
    signTransaction: jest.fn(),
    dispose: jest.fn(),
  },
}));

import { HardwareWalletManager } from '@sidhujag/sysweb3-keyring/cjs/hardware-wallet-manager';
import { LedgerKeyring } from '@sidhujag/sysweb3-keyring/cjs/ledger';
import {
  createLedgerPsbtSigner,
  createTrezorPsbtSigner,
} from '@sidhujag/sysweb3-keyring/cjs/transactions/hardware-psbt';
import { SyscoinTransactionsCore } from '@sidhujag/sysweb3-keyring/cjs/transactions/syscoin-core';
import { TrezorKeyring } from '@sidhujag/sysweb3-keyring/cjs/trezor';
import TrezorTransport from '@sidhujag/sysweb3-keyring/cjs/trezor/connect';
import http from 'http';
import https from 'https';
import { utils as sys } from 'syscoinjs-lib';

import {
  createUtxoFixture,
  exportFixturePsbt,
  importFixturePsbt,
  UTXO_FIXTURE_PATH,
  UTXO_FIXTURE_SEED,
  verifyFixtureSignature,
} from '../../e2e/harness/utxoFixture';
import { getSyscoinUTXOTestnetNetwork } from '../../source/utils/defaultNetworks';

const TrezorConnect = jest.requireMock('@trezor/connect-webextension').default;

// Only device I/O/connection discovery is synthetic. Installed SDK scope checks,
// PSBT conversion, policy construction, signature insertion and finalization run.
// Public fixture keys must never be funded. No USB/HID/device compatibility claim.
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
};

describe.each(['Ledger', 'Trezor'] as const)(
  'installed %s UTXO signing boundary (mock physical device)',
  (kind) => {
    let fixture: ReturnType<typeof createUtxoFixture>;
    let sdk: SyscoinTransactionsCore;
    let state: any;
    let device: jest.Mock;
    let signedDeviceReply: any;
    let attemptPsbt: any;
    let networkSpies: jest.SpyInstance[];
    let softwareSigner: jest.Mock;
    let sessionCurrent: boolean;
    let manager: any;
    let trezorAdapter: any;

    const request = () => JSON.parse(JSON.stringify(fixture.single));
    const ownedRead = () => ({
      assertCurrent: () => undefined,
      fetch: globalThis.fetch,
      signal: new AbortController().signal,
    });
    const sign = () => sdk.signPSBT({ psbt: request() }, ownedRead());

    beforeEach(async () => {
      jest.clearAllMocks();
      // The installed SDK checks the extension host before loading Connect.
      // Only its device I/O is mocked; the SDK's adapter and guards still run.
      Object.assign(chrome, {
        runtime: {
          ...chrome.runtime,
          id: 'pali-public-hardware-fixture',
          getManifest: () => ({ ['manifest_version']: 3 }),
          onConnect: { addListener: jest.fn() },
          onMessageExternal: { addListener: jest.fn() },
        },
        tabs: { get: jest.fn(), create: jest.fn(), update: jest.fn() },
        windows: { getCurrent: jest.fn() },
      });
      if (kind === 'Trezor') {
        await TrezorTransport.init({
          manifest: {
            appName: 'Pali public fixture',
            appUrl: 'https://paliwallet.com',
            email: 'test@example.invalid',
          },
        });
      }
      jest.spyOn(console, 'log').mockImplementation(() => undefined);
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const denyNetwork = () => {
        throw new Error('Hardware fixture must not access a network');
      };
      networkSpies = [
        jest.spyOn(http, 'request').mockImplementation(denyNetwork),
        jest.spyOn(http, 'get').mockImplementation(denyNetwork),
        jest.spyOn(https, 'request').mockImplementation(denyNetwork),
        jest.spyOn(https, 'get').mockImplementation(denyNetwork),
        jest.spyOn(globalThis, 'fetch').mockImplementation(denyNetwork),
      ];
      fixture = createUtxoFixture();
      const hd = new sys.HDSigner(UTXO_FIXTURE_SEED, '', true);
      const key = hd.deriveKeypair(UTXO_FIXTURE_PATH);
      const devicePsbt = importFixturePsbt(request());
      devicePsbt.signInput(0, key);
      const partial = devicePsbt.data.inputs[0].partialSig[0];
      devicePsbt.finalizeAllInputs();
      signedDeviceReply =
        kind === 'Ledger'
          ? {
              fingerprint: Buffer.from(hd.getMasterFingerprint()).toString(
                'hex'
              ),
              signatures: [
                {
                  inputIndex: 0,
                  pubkeyHex: Buffer.from(partial.pubkey).toString('hex'),
                  signatureHex: Buffer.from(partial.signature).toString('hex'),
                },
              ],
            }
          : {
              success: true,
              payload: {
                serializedTx: devicePsbt.extractTransaction().toHex(),
              },
            };
      device = jest.fn().mockResolvedValue(signedDeviceReply);
      sessionCurrent = true;
      state = {
        activeAccountType: kind,
        activeAccountId: 0,
        accounts: {
          [kind]: {
            0: {
              id: 0,
              address: fixture.userAddress,
              xpub: fixture.userXpub,
              [kind === 'Ledger' ? 'isLedgerWallet' : 'isTrezorWallet']: true,
            },
          },
        },
        activeNetwork: {
          ...getSyscoinUTXOTestnetNetwork(),
          url: 'https://offline.invalid',
        },
      };
      // Exercise the actual retry classification, but never initialize a device
      // manager (which starts a status interval and native transport discovery).
      manager = Object.create(HardwareWalletManager.prototype);
      manager.retryConfig = {
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 5000,
        backoffMultiplier: 2,
      };
      manager.emit = jest.fn();
      manager.on = jest.fn();
      manager.delay = jest.fn().mockResolvedValue(undefined);
      manager.ensureConnection = jest.fn().mockResolvedValue(undefined);
      manager.getLedgerConnection = jest.fn().mockResolvedValue({});
      const ledger = new LedgerKeyring(manager, {
        getStatus: () => ({ connected: true }),
        connect: jest.fn(),
        disconnect: jest.fn(),
        evm: {} as any,
        utxo: { signPsbt: (...args: unknown[]) => device(...args) } as any,
      });
      const trezor: any = Object.create(TrezorKeyring.prototype);
      trezorAdapter = trezor;
      trezor.initialized = true;
      trezor.hardwareWalletManager = manager;
      trezor.paths = {};
      (TrezorConnect.signTransaction as jest.Mock).mockImplementation(
        (...args: unknown[]) => device(...args)
      );
      softwareSigner = jest.fn(() => {
        throw new Error('Hardware account must not use a software signer');
      });
      sdk = new SyscoinTransactionsCore(
        softwareSigner,
        softwareSigner,
        () => state,
        {
          ledger: createLedgerPsbtSigner(ledger),
          trezor: createTrezorPsbtSigner(trezor),
        },
        () => () => {
          if (!sessionCurrent)
            throw new Error('Wallet signing context changed');
        }
      );
      const internal = sdk as any;
      const actual = internal.signPSBTWithMethod;
      jest
        .spyOn(internal, 'signPSBTWithMethod')
        .mockImplementation((...args) => {
          attemptPsbt = args[0];
          return actual(...args);
        });
    });

    afterEach(() => {
      expect(softwareSigner).not.toHaveBeenCalled();
      for (const spy of networkSpies) expect(spy).not.toHaveBeenCalled();
      jest.restoreAllMocks();
    });

    it('returns a cryptographically valid, unchanged SIGHASH_ALL transaction', async () => {
      const signed = await sign();
      expect(verifyFixtureSignature(fixture, signed, false)).toBeTruthy();
      expect(device).toHaveBeenCalledTimes(1);
      if (kind === 'Ledger') {
        const [approved] = device.mock.calls[0];
        expect(approved).toMatchObject({
          currency: state.activeNetwork.currency,
          slip44: 1,
          accountIndex: 0,
          accountXpub: fixture.userXpub,
        });
        const sent = sys.bitcoinjs.Psbt.fromBase64(approved.psbtBase64);
        expect(sent.inputCount).toBe(1);
        expect(sent.txOutputs).toHaveLength(2);
        expect(
          Buffer.from(sent.data.inputs[0].nonWitnessUtxo).toString('hex')
        ).toBe(Buffer.from(fixture.parentTxs[0].toBuffer()).toString('hex'));
      } else {
        expect(device.mock.calls[0][0]).toMatchObject({
          coin: 'tsys',
          inputs: [
            {
              ['prev_hash']: fixture.parentTxs[0].getId(),
              ['prev_index']: 0,
              ['address_n']:
                trezorAdapter.convertToAddressNFormat(UTXO_FIXTURE_PATH),
              ['script_type']: 'SPENDWITNESS',
            },
          ],
          outputs: [{ amount: '90000' }, { amount: '9000' }],
        });
      }
    });

    it.each(['rejection', 'disconnect'])(
      'does not leak signatures or retry after explicit device %s',
      async (failure) => {
        const error = Object.assign(
          new Error(
            failure === 'rejection' ? 'User rejected' : 'Device disconnected'
          ),
          failure === 'rejection'
            ? { statusCode: 0x6985 }
            : { name: 'TransportError' }
        );
        const connectRejection = kind === 'Trezor' && failure === 'rejection';
        if (connectRejection) {
          TrezorConnect.signTransaction.mockResolvedValueOnce({
            success: false,
            error: {
              message: 'denied by the user',
              code: 'Failure_ActionCancelled',
            },
          });
          await expect(sign()).rejects.toThrow(
            'Trezor sign failed: denied by the user'
          );
          expect(TrezorConnect.signTransaction).toHaveBeenCalledTimes(1);
          expect(TrezorConnect.dispose).toHaveBeenCalledTimes(1);
          expect(trezorAdapter.initialized).toBe(false);
        } else {
          device.mockRejectedValueOnce(error);
          await expect(sign()).rejects.toBe(error);
        }
        expect(device).toHaveBeenCalledTimes(connectRejection ? 0 : 1);
        expect(manager.delay).not.toHaveBeenCalled();
        for (const input of attemptPsbt.data.inputs) {
          expect(input.partialSig).toBeUndefined();
          expect(input.finalScriptWitness).toBeUndefined();
        }
      }
    );

    it.each(['account', 'network', 'session'])(
      'discards a valid device result after %s changes during approval',
      async (change) => {
        const entered = deferred<void>();
        const response = deferred<any>();
        device.mockImplementationOnce(() => {
          entered.resolve();
          return response.promise;
        });
        const signing = sign();
        await entered.promise;
        if (change === 'account') state.activeAccountId = 1;
        if (change === 'network')
          state.activeNetwork = {
            ...state.activeNetwork,
            url: 'https://other.invalid',
          };
        if (change === 'session') sessionCurrent = false;
        response.resolve(signedDeviceReply);
        await expect(signing).rejects.toMatchObject({
          name: 'AbortError',
          message: 'Wallet signing context changed',
        });
        expect(device).toHaveBeenCalledTimes(1);
        expect(manager.delay).not.toHaveBeenCalled();
        // Caller-owned request is never mutated, even if the Trezor adapter has
        // finalized its private parsed copy before the enclosing SDK guard runs.
        expect(
          importFixturePsbt(request()).data.inputs[0].finalScriptWitness
        ).toBeUndefined();
      }
    );

    it('does not sign a different-account input even if the device could', async () => {
      const invalid = importFixturePsbt(request());
      invalid.data.inputs[0].bip32Derivation[0].path = "m/84'/1'/1'/0/0";
      await expect(
        sdk.signPSBT({ psbt: exportFixturePsbt(invalid) }, ownedRead())
      ).rejects.toThrow();
      expect(device).not.toHaveBeenCalled();
    });

    if (kind === 'Ledger') {
      it('rejects a tampered device signature before finalizing the transaction', async () => {
        const reply = JSON.parse(JSON.stringify(signedDeviceReply));
        reply.signatures[0].signatureHex = `${reply.signatures[0].signatureHex.slice(
          0,
          -4
        )}0001`;
        device.mockResolvedValueOnce(reply);
        await expect(sign()).rejects.toThrow(/signature/i);
        expect(device).toHaveBeenCalledTimes(1);
        expect(attemptPsbt.data.inputs[0].finalScriptWitness).toBeUndefined();
      });
    }
  }
);
