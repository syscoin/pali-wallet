import { AppState } from 'react-native';
import { Camera } from 'expo-camera';
import type { PermissionResponse } from 'expo';
import { createPermissionPresentation } from './permissionPresentation';

const presentation = createPermissionPresentation({
  current: () => AppState.currentState ?? 'unknown',
  subscribe(listener) {
    const subscription = AppState.addEventListener('change', listener);
    return () => subscription.remove();
  },
});
let owner: (() => boolean) | null = null;

/** Only the live scanner's OS request may preserve a public draft while inactive. */
export const isCameraPermissionPromptActive = (): boolean =>
  AppState.currentState !== 'background' && presentation.isActive() && owner?.() === true;

export async function requestNativeCameraPermission(isCurrent: () => boolean): Promise<PermissionResponse> {
  const check = () => {
    if (!isCurrent() || AppState.currentState !== 'active') throw Error('Camera permission request interrupted');
  };
  check();
  const current = await Camera.getCameraPermissionsAsync();
  check();
  if (current.granted || !current.canAskAgain) return current;
  if (owner) throw Error('Camera permission request unavailable');
  owner = isCurrent;
  try {
    const result = await presentation.run(() => { check(); return Camera.requestCameraPermissionsAsync(); });
    check();
    return result;
  } finally {
    if (owner === isCurrent) owner = null;
  }
}
