import React, { useLayoutEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { OperationAuthenticationPrompt } from '../core/operationAuthentication';
import { nativeOperationAuthentication } from '../platform/operationAuthentication';
import { TransactionAuthentication } from './TransactionAuthentication';
import { useBiometricPresentation } from '../platform/useBiometricPresentation';

const titles = {
  transaction: 'Authorize transaction',
  message: 'Authorize signature',
  'account-change': 'Authorize change',
  'secret-read': 'Unlock private information',
  'private-reconciliation': 'Review private transaction',
};

export function NativeOperationAuthentication({ isProtectedPromptActive }: { isProtectedPromptActive(): boolean }) {
  const biometrics = useBiometricPresentation();
  const [prompt, setPrompt] = useState<OperationAuthenticationPrompt | null>(null);
  const protectedPrompt = useRef(isProtectedPromptActive);
  useLayoutEffect(() => { protectedPrompt.current = isProtectedPromptActive; }, [isProtectedPromptActive]);
  useLayoutEffect(() => {
    const detach = nativeOperationAuthentication.attach(setPrompt);
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active' && !(state === 'inactive' && nativeOperationAuthentication.isVerifying() && protectedPrompt.current()))
        nativeOperationAuthentication.cancel();
    });
    return () => { subscription.remove(); detach(); };
  }, []);
  if (!prompt) return null;
  return <TransactionAuthentication key={prompt.request.id} identity={prompt.request.id} biometrics={biometrics}
    title={titles[prompt.request.purpose]} description={prompt.request.purpose === 'private-reconciliation'
      ? 'Unlock this private note to review its saved transaction. This does not sign or resend it.'
      : prompt.request.biometricsEnabled ? `Confirm with ${biometrics.label} or use your PIN.` : 'Enter your Pali PIN to continue.'}
    method={prompt.request.biometricsEnabled ? 'biometric' : 'pin'} busy={prompt.busy} error={prompt.error}
    onConfirm={prompt.confirm} onCancel={prompt.cancel} />;
}
