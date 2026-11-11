export type NativeLedgerFailureCategory =
  | 'permission'
  | 'bluetooth-off'
  | 'disconnected'
  | 'unsupported'
  | 'retry';

/** Display classification only; never grants connection or signing authority. */
export function nativeLedgerFailureCategory(
  error: unknown
): NativeLedgerFailureCategory {
  const seen = new Set<unknown>();
  const inspect = (
    value: unknown,
    depth: number
  ): NativeLedgerFailureCategory => {
    if (!value || typeof value !== 'object' || seen.has(value) || depth > 3)
      return 'retry';
    seen.add(value);
    const field = (key: string) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor && 'value' in descriptor ? descriptor.value : undefined;
    };
    // Official Ledger BLE tags and react-native-ble-plx BleErrorCode values.
    const tag = field('_tag'),
      code = field('errorCode');
    if (tag === 'BlePermissionsNotGranted' || code === 101) return 'permission';
    if (tag === 'BlePoweredOff' || code === 102) return 'bluetooth-off';
    if (
      tag === 'DeviceConnectionNotFound' ||
      tag === 'PeerRemovedPairingError' ||
      code === 201
    )
      return 'disconnected';
    if (
      tag === 'BleNotSupported' ||
      tag === 'BleTransportNotSupportedError' ||
      code === 100
    )
      return 'unsupported';
    for (const key of ['err', 'cause', 'originalError']) {
      const category = inspect(field(key), depth + 1);
      if (category !== 'retry') return category;
    }
    return 'retry';
  };
  return inspect(error, 0);
}

export function nativeLedgerFailureMessage(
  category: NativeLedgerFailureCategory,
  fallback: string
): string {
  switch (category) {
    case 'permission':
      return 'Bluetooth access is not allowed. Open Settings and allow Bluetooth access for Pali, then try again.';
    case 'bluetooth-off':
      return 'Bluetooth is turned off. Turn it on in your device settings, then try again.';
    case 'disconnected':
      return 'Your Ledger disconnected. Unlock it, keep it nearby, and reconnect.';
    case 'unsupported':
      return 'Bluetooth Ledger connections are not supported on this device.';
    default:
      return fallback;
  }
}
