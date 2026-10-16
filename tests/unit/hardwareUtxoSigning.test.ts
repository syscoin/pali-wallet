jest.unmock('syscoinjs-lib');
jest.unmock('tiny-secp256k1');
jest.mock('@trezor/connect-webextension', () => ({
  __esModule: true,
  default: { signTransaction: jest.fn(), dispose: jest.fn(), on: jest.fn() },
  DEVICE_EVENT: 'device-event',
}));

import { HardwareWalletManager } from '@sidhujag/sysweb3-keyring/cjs/hardware-wallet-manager';
import { LedgerKeyring } from '@sidhujag/sysweb3-keyring/cjs/ledger';
import { SyscoinTransactions } from '@sidhujag/sysweb3-keyring/cjs/transactions/syscoin';
import { TrezorKeyring } from '@sidhujag/sysweb3-keyring/cjs/trezor';
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
    let sdk: SyscoinTransactions;
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
    const sign = () => sdk.signPSBT({ psbt: request() });

    beforeEach(() => {
      jest.clearAllMocks();
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
          ? [[0, partial]]
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
      const ledger: any = new LedgerKeyring(manager);
      ledger.ledgerUtxoClient = {
        getMasterFingerprint: jest
          .fn()
          .mockResolvedValue(
            Buffer.from(hd.getMasterFingerprint()).toString('hex')
          ),
        getExtendedPubkey: jest.fn().mockResolvedValue(fixture.userXpub),
        signPsbt: (...args: unknown[]) => device(...args),
      };
      ledger.ledgerEVMClient = {};
      // Registration is its own device operation; this test provides an already
      // registered policy, while retaining actual policy+PSBTv2 construction.
      ledger.getOrRegisterHmac = jest.fn().mockResolvedValue(Buffer.alloc(32));
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
      sdk = new SyscoinTransactions(
        softwareSigner,
        softwareSigner,
        () => state,
        () => fixture.userAddress,
        ledger,
        trezor,
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
        const [psbtV2, policy] = device.mock.calls[0];
        expect(psbtV2.getGlobalInputCount()).toBe(1);
        expect(psbtV2.getGlobalOutputCount()).toBe(2);
        expect(
          Buffer.from(psbtV2.getInputNonWitnessUtxo(0)).toString('hex')
        ).toBe(Buffer.from(fixture.parentTxs[0].toBuffer()).toString('hex'));
        expect(policy.descriptorTemplate).toBe('wpkh(@0/**)');
      } else {
        expect(device.mock.calls[0][0]).toMatchObject({
          coin: 'tsys',
          inputs: [
            {
              ['prev_hash']: fixture.parentTxs[0].getId(),
              ['script_type']: 'SPENDWITNESS',
            },
          ],
          outputs: [{ amount: '90000' }, { amount: '9000' }],
        });
      }
    });

    if (kind === 'Trezor')
      it('lets installed Connect enhance a BIP84 amount from its exact public parent', () => {
        const { validateTrezorInputs, enhanceTrezorInputs } =
          jest.requireActual('@trezor/connect/lib/api/bitcoin/inputs');
        const converted = trezorAdapter.convertToTrezorFormat({
          psbt: importFixturePsbt(request()),
          coin: 'tsys',
          network: sys.syscoinNetworks.testnet,
        });
        expect(() =>
          validateTrezorInputs(converted.inputs, {
            network: sys.syscoinNetworks.testnet,
          })
        ).not.toThrow();
        // Connect's validator requires amount for BIP49, not BIP84; its normal
        // referenced-transaction enhancement can supply this amount. Missing
        // inline BIP84 amount alone is therefore not a confirmed device failure.
        expect(converted.inputs[0].amount).toBeUndefined();
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        enhanceTrezorInputs(converted.inputs, fixture.parentTxs);
        expect(converted.inputs[0].amount.toString()).toBe('100000');
        expect(device).not.toHaveBeenCalled();
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
            payload: {
              error: 'denied by the user',
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
        await expect(signing).rejects.toThrow('Wallet signing context changed');
        expect(device).toHaveBeenCalledTimes(1);
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
        sdk.signPSBT({ psbt: exportFixturePsbt(invalid) })
      ).rejects.toThrow();
      expect(device).not.toHaveBeenCalled();
    });
  }
);
