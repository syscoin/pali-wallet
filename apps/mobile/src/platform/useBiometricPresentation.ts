import { useEffect, useState } from 'react';
import { genericBiometrics, type BiometricPresentation } from '../core/biometricPresentation';
import { readBiometricPresentation } from './biometricPresentation';

export function useBiometricPresentation(): BiometricPresentation {
  const [presentation, setPresentation] = useState(genericBiometrics);
  useEffect(() => {
    let current = true;
    void readBiometricPresentation().then(value => { if (current) setPresentation(value); }).catch(() => undefined);
    return () => { current = false; };
  }, []);
  return presentation;
}
