import type { PermissionResponse } from 'expo';

export const isCameraPermissionPromptActive = (): boolean => false;
export async function requestNativeCameraPermission(_isCurrent: () => boolean): Promise<PermissionResponse> {
  throw Error('Camera permission requires a native device');
}
