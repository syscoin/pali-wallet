import { fixtureDeviceAuthorization } from '../native-send-ui/fixtureDeviceAuthorization';
import { events } from './state';

/** Browser rendering fixture; the actual native implementation uses OS authorization only. */
export async function authorizePublicView(signal: AbortSignal, check: () => void) {
  check(); events.push('view:auth');
  await fixtureDeviceAuthorization.request('public-view', signal, check);
  check();
}
export const isNativeCredentialPromptActive = () => fixtureDeviceAuthorization.isAnyPromptActive();
export const getPublicViewAuthorizationStatus = async () => 'ready' as const;
