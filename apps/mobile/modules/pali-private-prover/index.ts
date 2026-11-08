import type {
  IPrivacyProofInput,
  IPrivacyProofOptions,
} from '../../../../source/utils/privacy/proverTypes';

// Imported only by the explicit qualification path until native qualification is complete.
// Loading this entry does not create a WebView or import the proof arithmetic.
export async function runNativePrivacyProof(
  input: IPrivacyProofInput,
  options: IPrivacyProofOptions
) {
  const { requireNativeModule } = await import('expo-modules-core');
  const { runProof } = await import('./runner');
  return runProof(requireNativeModule('PaliPrivateProver'), input, options);
}
