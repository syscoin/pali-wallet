import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Modal } from 'react-native';
import type { NativeOperationCredential } from '../custody/types';
import { Button } from '../ui';
import { useBiometricPresentation } from '../platform/useBiometricPresentation';
import { isWalletPin, PinEntryScreen, type BiometricPresentation } from './PinEntry';

export type TransactionAuthenticationProps = {
  title?: string;
  description?: string;
  confirmLabel?: string;
  identity: string;
  method: NativeOperationCredential['method'];
  biometrics?: BiometricPresentation;
  busy: boolean;
  error?: string;
  onConfirm(credential: NativeOperationCredential): void;
  onCancel(): void;
};

/** A reference-style PIN page. Custody, not this view, verifies PIN or OS presence. */
export function TransactionAuthentication({ identity, method, biometrics, busy, error, onConfirm, onCancel,
  title = 'Authorize send', description = 'Enter your Pali PIN to continue.' }: TransactionAuthenticationProps) {
  const detectedBiometrics = useBiometricPresentation();
  const presentation = biometrics ?? detectedBiometrics;
  const binding = useMemo(() => ({ identity, method }), [identity, method]);
  const owner = useRef({ binding, active: true, submitted: false, wasBusy: false, error });
  const automaticBiometric = useRef<typeof binding | null>(null);
  const latest = useRef({ onConfirm, onCancel, busy });
  const [attempt, setAttempt] = useState(0);
  useLayoutEffect(() => { latest.current = { onConfirm, onCancel, busy }; }, [onConfirm, onCancel, busy]);
  useLayoutEffect(() => {
    const current = { binding, active: true, submitted: false, wasBusy: false, error: undefined as string | undefined };
    owner.current = current;
    return () => { current.active = false; };
  }, [binding]);
  useLayoutEffect(() => {
    const current = owner.current;
    if (current.binding !== binding) return;
    if (!busy && (current.wasBusy || error !== current.error)) {
      current.submitted = false;
      setAttempt(value => value + 1);
    }
    current.wasBusy = busy;
    current.error = error;
  }, [binding, busy, error]);
  const confirm = useCallback((credential: NativeOperationCredential) => {
    const current = owner.current;
    if (current.binding !== binding || !current.active || current.submitted || latest.current.busy || credential.method === 'pin' && !isWalletPin(credential.pin)) return;
    current.submitted = true;
    latest.current.onConfirm(credential);
  }, [binding]);
  useEffect(() => {
    if (method !== 'biometric' || busy || automaticBiometric.current === binding ||
        owner.current.binding !== binding || !owner.current.active) return;
    automaticBiometric.current = binding;
    confirm({ method: 'biometric' });
  }, [binding, busy, confirm, method]);
  const cancel = () => {
    const current = owner.current;
    if (current.binding !== binding || !current.active) return;
    current.active = false;
    latest.current.onCancel();
  };
  return <Modal visible animationType="slide" onRequestClose={cancel}>
    <PinEntryScreen key={`${identity}:${method}`} title={title} description={busy ? 'Authorizing…' : description}
      resetKey={attempt} busy={busy} error={error} onBack={cancel}
      onComplete={pin => confirm({ method: 'pin', pin })}
      footer={method === 'biometric' ? <Button title={`Use ${presentation.label}`} icon={presentation.icon}
        variant="secondary" disabled={busy} onPress={() => confirm({ method: 'biometric' })} /> : undefined} />
  </Modal>;
}
