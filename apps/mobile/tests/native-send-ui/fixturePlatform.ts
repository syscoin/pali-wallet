// Browser test host for the SDK; the native app installs this through QuickCrypto.
import { Buffer } from '@craftzdog/react-native-buffer';
if (typeof globalThis.Buffer === 'undefined') globalThis.Buffer = Buffer as typeof globalThis.Buffer;
