import { setStringAsync, StringFormat } from 'expo-clipboard';
import { SECRET_CLIPBOARD_LIFETIME_MS } from '../../../../source/shared/secretClipboard';

/** Copy only an already-authenticated presentation; dispatched native writes cannot be revoked. */
export async function copyNativeSecret(read: () => string, isCurrent: () => boolean): Promise<void> {
  const check = () => { if (isCurrent() !== true) throw new Error('COPY_CANCELLED'); };
  check();
  const value = read();
  check();
  const copied = await setStringAsync(value, {
    inputFormat: StringFormat.PLAIN_TEXT,
    android: { isSensitive: true },
    ios: { localOnly: true, expiresAt: new Date(Date.now() + SECRET_CLIPBOARD_LIFETIME_MS) },
  });
  check();
  if (!copied) throw new Error('COPY_FAILED');
}
