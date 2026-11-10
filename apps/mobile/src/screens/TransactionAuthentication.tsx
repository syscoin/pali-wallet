import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  autoBiometric?: boolean;
  busy: boolean;
  error?: string;
  onConfirm(credential: NativeOperationCredential): void;
  onCancel(): void;
};

/** A reference-style PIN page. Custody, not this view, verifies PIN or OS presence. */
export function TransactionAuthentication({ identity, method, biometrics, autoBiometric = false, busy, error, onConfirm, onCancel,
  title = 'Authorize send', description = 'Enter your Pali PIN to continue.' }: TransactionAuthenticationProps) {
  const detectedBiometrics = useBiometricPresentation();
  const presentation = biometrics ?? detectedBiometrics;
  const binding = useMemo(() => ({ identity, method }), [identity, method]);
  const owner = useRef({ binding, active: true, submitted: false, wasBusy: false, error });
  const latest = useRef({ onConfirm, onCancel, busy });
  const [attempt, setAttempt] = useState(0);
  const automatic = useRef<object | null>(null);
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
  useLayoutEffect(() => {
    if (autoBiometric && method === 'biometric' && !busy && !error && automatic.current !== binding) {
      automatic.current = binding;
      confirm({ method: 'biometric' });
    }
  }, [autoBiometric, binding, method, busy, error, confirm]);
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
      footer={method === 'biometric' && !autoBiometric ? <Button title={`Use ${presentation.label}`} icon={presentation.icon}
        variant="secondary" disabled={busy} onPress={() => confirm({ method: 'biometric' })} /> : undefined} />
  </Modal>;
}
