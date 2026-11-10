import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useLocalPasskeyFlow } from '../../hooks/useLocalPasskeyFlow';
import { createLocalPasskeyController } from '../../utils/localPasskeyController';
import { localPasskeySupport } from '../../utils/passkey/localUnlockCeremony';
import { Button } from '../Button';

import type { LocalPasskeyController } from '../../wallet/localPasskeyTypes';

/** Optional local unlock; the ordinary password form remains available. */
export function LocalPasskeyUnlock({
  createController = createLocalPasskeyController,
  onUnlocked,
  disabled = false,
  onStart,
  onSettled,
}: {
  createController?: () => LocalPasskeyController;
  disabled?: boolean;
  onSettled?(): void;
  onStart?(): boolean;
  onUnlocked(): void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  const flow = useLocalPasskeyFlow(createController, onUnlocked);
  const mounted = useRef(false);
  const attempt = useRef(0);
  useEffect(() => {
    let current = true;
    mounted.current = true;
    setEnabled(false);
    void Promise.all([flow.status(), localPasskeySupport()])
      .then(([status, support]) => {
        if (current) setEnabled(status.enabled && support !== 'unsupported');
      })
      .catch(() => {
        if (current) setEnabled(false);
      });
    return () => {
      current = false;
      mounted.current = false;
    };
  }, [flow.status]);
  const unlock = async () => {
    if (disabled || !enabled || flow.busy || onStart?.() === false) return;
    const current = ++attempt.current;
    try {
      await flow.unlock();
    } finally {
      if (mounted.current && attempt.current === current) onSettled?.();
    }
  };
  const cancel = () => {
    attempt.current++;
    flow.cancel();
    onSettled?.();
  };
  if (!enabled) return null;
  return (
    <div className="w-full max-w-[17.5rem] space-y-3">
      <Button
        type="button"
        variant="neutral"
        fullWidth
        loading={flow.busy}
        disabled={disabled}
        onClick={() => void unlock()}
      >
        {t('localPasskey.unlock')}
      </Button>
      {flow.busy && (
        <Button type="button" variant="ghost" fullWidth onClick={cancel}>
          {t('buttons.cancel')}
        </Button>
      )}
      {flow.error && (
        <p role="alert" className="text-sm text-content-error">
          {t('localPasskey.unlockFailed')}
        </p>
      )}
    </div>
  );
}
