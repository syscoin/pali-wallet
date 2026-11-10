import {
  createDeviceUnlockEnrollment,
  deviceUnlockUserRefusal,
  isDeviceUnlockUserRefusal,
  type DeviceUnlockEnrollmentSnapshot,
} from './deviceUnlockEnrollment';

describe('protected presence failure classification', () => {
  const initial = Object.freeze({
    installationId: '11'.repeat(16),
    walletBindingId: '22'.repeat(32),
    pairFingerprint: '33'.repeat(32),
    enrollmentId: '44'.repeat(16),
  });
  const fixture = () => {
    let reference: DeviceUnlockEnrollmentSnapshot | null = initial;
    let reads = 0;
    let beforeRead: () => void = () => undefined;
    const bytes = new Uint8Array(32).fill(7);
    const owner = createDeviceUnlockEnrollment({
      randomId: () => '55'.repeat(16),
      enrollment: {
        read: async () => {
          beforeRead();
          reads++;
          return reference;
        },
        compareAndSet: async () => false,
      },
      credentials: {
        available: async () => true,
        read: async () => bytes,
        stage: async () => undefined,
        remove: async () => undefined,
      },
    });
    return {
      owner,
      bytes,
      get reads() {
        return reads;
      },
      beforeRead(value: () => void) {
        beforeRead = value;
      },
      replace(value: DeviceUnlockEnrollmentSnapshot | null) {
        reference = value;
      },
    };
  };

  it('propagates a storage read failure and erases a key already read', async () => {
    const f = fixture(),
      error = Error('read failure');
    f.beforeRead(() => {
      if (f.reads === 1) throw error;
    });
    await expect(f.owner.verifyPresence(() => undefined)).rejects.toBe(error);
    expect(f.bytes).toEqual(new Uint8Array(32));
    expect(isDeviceUnlockUserRefusal(error)).toBe(false);
  });

  it('does not mark missing or changed enrollment as a user refusal', async () => {
    for (const replacement of [
      null,
      { ...initial, pairFingerprint: '66'.repeat(32) },
    ]) {
      const f = fixture();
      f.beforeRead(() => {
        if (f.reads === 1 || replacement === null) f.replace(replacement);
      });
      const error = await f.owner
        .verifyPresence(() => undefined)
        .catch((value) => value);
      expect(error).toBeInstanceOf(Error);
      expect(isDeviceUnlockUserRefusal(error)).toBe(false);
    }
  });

  it('preserves only a trusted adapter user-refusal marker', async () => {
    const error = deviceUnlockUserRefusal();
    const owner = createDeviceUnlockEnrollment({
      randomId: () => '55'.repeat(16),
      enrollment: {
        read: async () => initial,
        compareAndSet: async () => false,
      },
      credentials: {
        available: async () => true,
        read: async () => {
          throw error;
        },
        stage: async () => undefined,
        remove: async () => undefined,
      },
    });
    await expect(owner.verifyPresence(() => undefined)).rejects.toBe(error);
    expect(isDeviceUnlockUserRefusal(error)).toBe(true);
    expect(isDeviceUnlockUserRefusal(Error(error.message))).toBe(false);
  });
});
