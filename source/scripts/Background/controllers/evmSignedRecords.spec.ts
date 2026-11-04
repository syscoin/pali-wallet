import { EVM_SIGNED_RECORD_PREFIX } from '../../../wallet/evmSignedRecords';
import { walletPersistenceGate } from 'state/paliStorage';
import { chromeStorage } from 'utils/storageAPI';

import { createChromeEvmSignedRecordStorage } from './evmSignedRecords';

jest.mock('@sidhujag/sysweb3-keyring', () => ({
  captureEvmSubmission: jest.fn(),
  submitSignedEvmTransaction: jest.fn(),
}));
jest.mock('utils/storageAPI', () => ({
  chromeStorage: { getItems: jest.fn(), setItem: jest.fn() },
}));
const profile = '0x' + '11'.repeat(32),
  hash = '0x' + '22'.repeat(32);
const envelope = (domain: string, recordId: string) => ({
  version: 1,
  profileId: profile,
  domain,
  recordId,
  nonce: 'A'.repeat(16),
  ciphertext: 'A'.repeat(24),
});
const value = () =>
  JSON.stringify({
    version: 1,
    profileId: profile,
    revision: 0,
    root: envelope('org.syscoin.pali.evm.signed.root.v1', 'manifest'),
    entries: [
      {
        hash,
        chainId: '7654321',
        from: '0x' + '33'.repeat(20),
        nonce: 0,
        phase: 'signed',
        createdAt: 1,
        signer: { id: 0, type: 'HDAccount' },
        operation: 'send',
        chunks: [envelope('org.syscoin.pali.evm.signed.chunk.v1', hash + '/0')],
      },
    ],
  });
let disk: Record<string, unknown>;
beforeEach(() => {
  disk = {};
  walletPersistenceGate.blocked = false;
  jest
    .mocked(chromeStorage.getItems)
    .mockImplementation(async () => ({ ...disk }));
  jest.mocked(chromeStorage.setItem).mockImplementation(async (key, raw) => {
    disk[key] = raw;
  });
});
afterEach(() => jest.resetAllMocks());
it('acknowledges a complete single-key write and readback under current guard', async () => {
  const port = createChromeEvmSignedRecordStorage(),
    check = jest.fn();
  expect(await port.compareAndSet(profile, undefined, value(), check)).toBe(
    true
  );
  expect(await port.read(profile)).toBe(value());
  expect(check.mock.calls.length).toBeGreaterThanOrEqual(2);
  expect(chromeStorage.setItem).toHaveBeenCalledTimes(1);
});
it('refuses a changed predecessor without writing', async () => {
  disk[EVM_SIGNED_RECORD_PREFIX + profile] = value();
  const port = createChromeEvmSignedRecordStorage();
  expect(
    await port.compareAndSet(profile, undefined, value(), () => undefined)
  ).toBe(false);
  expect(chromeStorage.setItem).not.toHaveBeenCalled();
});
it('preserves malformed present storage rather than treating it as missing', async () => {
  disk[EVM_SIGNED_RECORD_PREFIX + profile] = false;
  await expect(
    createChromeEvmSignedRecordStorage().read(profile)
  ).rejects.toThrow('CORRUPT');
});
it('quarantines an ambiguous write while retaining its committed bytes', async () => {
  const port = createChromeEvmSignedRecordStorage();
  jest
    .mocked(chromeStorage.setItem)
    .mockImplementationOnce(async (key, raw) => {
      disk[key] = raw;
      throw Error('ack lost');
    });
  await expect(
    port.compareAndSet(profile, undefined, value(), () => undefined)
  ).rejects.toThrow('REOPEN_REQUIRED');
  expect(disk[EVM_SIGNED_RECORD_PREFIX + profile]).toBe(value());
  await expect(port.read(profile)).rejects.toThrow('REOPEN_REQUIRED');
  expect(await createChromeEvmSignedRecordStorage().read(profile)).toBe(
    value()
  );
});
it('late revocation does not roll back the acknowledged signed record', async () => {
  const port = createChromeEvmSignedRecordStorage();
  let checks = 0;
  await expect(
    port.compareAndSet(profile, undefined, value(), () => {
      if (++checks === 3) throw Error('revoked');
    })
  ).rejects.toThrow('revoked');
  expect(disk[EVM_SIGNED_RECORD_PREFIX + profile]).toBe(value());
});
