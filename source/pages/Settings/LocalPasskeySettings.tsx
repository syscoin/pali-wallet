import { Input } from 'antd';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, PageActionFooter } from '../../components';
import { useLocalPasskeyFlow } from '../../hooks/useLocalPasskeyFlow';
import { createLocalPasskeyController } from '../../utils/localPasskeyController';
import {
  localPasskeySupport,
  type LocalPasskeySupport,
} from '../../utils/passkey/localUnlockCeremony';
import {
  PasswordCooldownError,
  type LocalPasskeyController,
} from '../../wallet/localPasskeyTypes';

/** Local installation preference; independent of Smart-account passkeys. */
export function LocalPasskeySettings({
  createController = createLocalPasskeyController,
}: {
  createController?: () => LocalPasskeyController;
}) {
  const { t, i18n } = useTranslation();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [support, setSupport] = useState<LocalPasskeySupport | null>(null);
  const [password, setPassword] = useState('');
  const [readError, setReadError] = useState(false);
  const [requestedEnabled, setRequestedEnabled] = useState<boolean | null>(
    null
  );
  const [expiredCooldown, setExpiredCooldown] =
    useState<PasswordCooldownError>();
  const version = useRef(0);
  const submitting = useRef(false);
  const cancellation = useRef<Promise<void>>();
  const flow = useLocalPasskeyFlow(createController);
  const readStatus = useCallback(
    async (captured: number) => {
      if (version.current !== captured) return;
      setEnabled(null);
      setReadError(false);
      try {
        const status = await flow.status();
        if (version.current === captured) setEnabled(status.enabled);
      } catch {
        if (version.current === captured) setReadError(true);
      }
    },
    [flow.status]
  );
  useEffect(() => {
    let current = true;
    const captured = ++version.current;
    submitting.current = false;
    cancellation.current = undefined;
    setSupport(null);
    setPassword('');
    setRequestedEnabled(null);
    void readStatus(captured);
    void localPasskeySupport().then((value) => {
      if (current) setSupport(value);
    });
    return () => {
      current = false;
      version.current++;
    };
  }, [readStatus]);
  const cooldown =
    flow.error instanceof PasswordCooldownError ? flow.error : undefined;
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(
      () => setExpiredCooldown(cooldown),
      cooldown.retryAfterSeconds * 1000
    );
    return () => clearTimeout(timer);
  }, [cooldown]);
  const canEdit =
    enabled !== null &&
    (enabled || (support !== null && support !== 'unsupported'));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting.current || flow.busy || !password || !canEdit) return;
    submitting.current = true;
    const captured = ++version.current;
    const entered = password;
    const requested = !enabled;
    setPassword('');
    setRequestedEnabled(requested);
    try {
      const completed = await (requested
        ? flow.enroll(entered)
        : flow.disable(entered));
      if (version.current !== captured) return;
      // Cancellation can retire the reply after the durable change committed.
      await cancellation.current;
      if (version.current !== captured) return;
      if (completed) setEnabled(requested);
      else await readStatus(captured);
    } finally {
      if (version.current === captured) {
        submitting.current = false;
        cancellation.current = undefined;
      }
    }
  };
  let error: string | undefined;
  if (cooldown) {
    if (cooldown !== expiredCooldown) {
      const retryTime = new Intl.RelativeTimeFormat(i18n.language).format(
        cooldown.retryAfterSeconds,
        'second'
      );
      error = t('start.unlockRateLimited', { retryTime });
    }
  } else if (flow.error && enabled !== null && enabled !== requestedEnabled) {
    error = t(
      requestedEnabled
        ? 'localPasskey.enrollFailed'
        : 'localPasskey.disableFailed'
    );
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="flex w-full flex-1 flex-col gap-5 px-4 pb-4"
      aria-labelledby="local-passkey-title"
    >
      <section className="space-y-3 rounded-2xl border border-brand-gray300 p-4">
        <div>
          <h2 id="local-passkey-title" className="sr-only">
            {t('localPasskey.title')}
          </h2>
          <p className="text-sm text-brand-graylight">
            {t('localPasskey.description')}
          </p>
        </div>
        <p role="status" className="text-sm font-medium">
          {t(
            readError
              ? 'localPasskey.unavailable'
              : enabled === null
              ? 'localPasskey.loading'
              : enabled
              ? 'localPasskey.enabled'
              : 'localPasskey.disabled'
          )}
        </p>
        {support === 'unsupported' && (
          <p className="text-sm text-brand-graylight">
            {t('localPasskey.unsupported')}
          </p>
        )}
        {canEdit && (
          <div className="space-y-2">
            <label htmlFor="local-passkey-password" className="block text-sm">
              {t('localPasskey.password')}
            </label>
            <Input.Password
              id="local-passkey-password"
              autoComplete="current-password"
              value={password}
              disabled={flow.busy}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
        )}
      </section>
      <p className="text-xs leading-relaxed text-brand-graylight">
        {t('localPasskey.localOnly')}
      </p>
      {(canEdit || error) && (
        <PageActionFooter includeInFlow error={error}>
          {canEdit && (
            <div className="space-y-3">
              <Button
                type="submit"
                variant={enabled ? 'neutral' : 'primary'}
                fullWidth
                loading={flow.busy}
                disabled={!password}
              >
                {t(enabled ? 'localPasskey.turnOff' : 'localPasskey.setUp')}
              </Button>
              {flow.busy && (
                <Button
                  type="button"
                  variant="ghost"
                  fullWidth
                  onClick={() => {
                    if (!submitting.current || cancellation.current) return;
                    cancellation.current = flow.cancel();
                    setEnabled(null);
                  }}
                >
                  {t('buttons.cancel')}
                </Button>
              )}
            </div>
          )}
        </PageActionFooter>
      )}
    </form>
  );
}

export default LocalPasskeySettings;
