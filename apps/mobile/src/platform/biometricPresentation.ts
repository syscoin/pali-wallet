import { genericBiometrics, type BiometricPresentation } from '../core/biometricPresentation';

/** Unsupported platforms use honest generic presentation without hardware probing. */
export async function readBiometricPresentation(): Promise<BiometricPresentation> { return genericBiometrics; }
