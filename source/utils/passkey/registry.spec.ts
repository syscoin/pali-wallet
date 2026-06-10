import { PasskeyBackupStatus } from 'types/network';

import {
  clearPasskeyAccountRecords,
  clearPendingCreationPasskey,
  clearPendingPasskeyRecord,
  getPasskeyAccountRecords,
  getPendingCreationPasskey,
  passkeyRegistrationToProfile,
  setActivePasskeyRecord,
  setPendingCreationPasskey,
  setPendingPasskeyRecord,
} from './registry';
import type { PasskeyRegistrationResult } from './webauthn';

const ACCOUNT = '0xAbC0000000000000000000000000000000000001';

const profileFixture = (suffix: string) => ({
  backupStatus: PasskeyBackupStatus.Synced,
  credentialId: `credential-${suffix}`,
  credentialIdHash: `0xhash${suffix}`,
  passkeyName: `Passkey ${suffix}`,
  publicKey: {
    originHash: '0xorigin',
    originLength: 20,
    rpIdHash: '0xrpid',
    x: `0xx${suffix}`,
    y: `0xy${suffix}`,
  },
  userHandle: `handle-${suffix}`,
});

describe('passkey registry', () => {
  const storageBacking = new Map<string, string>();

  beforeAll(() => {
    (globalThis as any).localStorage = {
      getItem: (key: string) => storageBacking.get(key) ?? null,
      removeItem: (key: string) => {
        storageBacking.delete(key);
      },
      setItem: (key: string, value: string) => {
        storageBacking.set(key, value);
      },
    };
  });

  afterAll(() => {
    delete (globalThis as any).localStorage;
  });

  beforeEach(() => {
    storageBacking.clear();
  });

  it('returns empty records for unknown accounts', () => {
    expect(getPasskeyAccountRecords(ACCOUNT)).toEqual({});
  });

  it('stores and reads records case-insensitively by address', () => {
    setActivePasskeyRecord(ACCOUNT, profileFixture('a'));
    expect(
      getPasskeyAccountRecords(ACCOUNT.toLowerCase()).active?.credentialId
    ).toBe('credential-a');
  });

  it('promoting an active record clears any pending record', () => {
    setPendingPasskeyRecord(ACCOUNT, profileFixture('pending'));
    expect(
      getPasskeyAccountRecords(ACCOUNT).pending?.profile.credentialId
    ).toBe('credential-pending');

    setActivePasskeyRecord(ACCOUNT, profileFixture('active'));
    const records = getPasskeyAccountRecords(ACCOUNT);
    expect(records.active?.credentialId).toBe('credential-active');
    expect(records.pending).toBeUndefined();
  });

  it('keeps the active record when only the pending record is cleared', () => {
    setActivePasskeyRecord(ACCOUNT, profileFixture('active'));
    setPendingPasskeyRecord(ACCOUNT, profileFixture('pending'));
    clearPendingPasskeyRecord(ACCOUNT);

    const records = getPasskeyAccountRecords(ACCOUNT);
    expect(records.active?.credentialId).toBe('credential-active');
    expect(records.pending).toBeUndefined();
  });

  it('removes the storage key entirely when no active record remains', () => {
    setPendingPasskeyRecord(ACCOUNT, profileFixture('pending'));
    clearPendingPasskeyRecord(ACCOUNT);
    expect(storageBacking.size).toBe(0);
  });

  it('clears all records for an account', () => {
    setActivePasskeyRecord(ACCOUNT, profileFixture('active'));
    clearPasskeyAccountRecords(ACCOUNT);
    expect(getPasskeyAccountRecords(ACCOUNT)).toEqual({});
  });

  it('manages the single pending-creation slot', () => {
    expect(getPendingCreationPasskey()).toBeNull();
    setPendingCreationPasskey(profileFixture('creation'));

    const pending = getPendingCreationPasskey();
    expect(pending?.profile.credentialId).toBe('credential-creation');
    expect(typeof pending?.createdAt).toBe('number');

    clearPendingCreationPasskey();
    expect(getPendingCreationPasskey()).toBeNull();
  });

  it('survives corrupted storage payloads', () => {
    storageBacking.set(
      `pali-smart-account-passkey:v1:${ACCOUNT.toLowerCase()}`,
      '{not json'
    );
    expect(getPasskeyAccountRecords(ACCOUNT)).toEqual({});
  });

  it('maps a registration result to a credential profile', () => {
    const registration: PasskeyRegistrationResult = {
      backupStatus: PasskeyBackupStatus.DeviceBound,
      credentialId: 'cred-id',
      credentialIdHash: '0xcredhash',
      originHash: '0xoriginhash',
      originLength: 33,
      rawId: 'raw-id',
      rpIdHash: '0xrpidhash',
      userHandle: 'user-handle',
      x: '0x01',
      y: '0x02',
    };

    expect(passkeyRegistrationToProfile(registration, 'My Passkey')).toEqual({
      backupStatus: PasskeyBackupStatus.DeviceBound,
      credentialId: 'cred-id',
      credentialIdHash: '0xcredhash',
      passkeyName: 'My Passkey',
      publicKey: {
        originHash: '0xoriginhash',
        originLength: 33,
        rpIdHash: '0xrpidhash',
        x: '0x01',
        y: '0x02',
      },
      userHandle: 'user-handle',
    });
  });
});
