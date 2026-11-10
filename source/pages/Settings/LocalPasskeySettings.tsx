import { Input } from 'antd';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, PageActionFooter } from '../../components';
import { useLocalPasskeyFlow } from '../../hooks/useLocalPasskeyFlow';
import { createLocalPasskeyController } from '../../utils/localPasskeyController';
import {
  localPasskeySupport,
  type LocalPasskeySupport,
} from '../../utils/passkey/localUnlockCeremony';

import type { LocalPasskeyController } from '../../wallet/localPasskeyTypes';

/** Local installation preference; independent of Smart-account passkeys. */
export function LocalPasskeySettings({
  createController = createLocalPasskeyController,
}: {
  createController?: () => LocalPasskeyController;
}) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [support, setSupport] = useState<LocalPasskeySupport | null>(null);
  const [password, setPassword] = useState('');
  const [readError, setReadError] = useState(false);
  const version = useRef(0);
  const submitting = useRef(false);
  const flow = useLocalPasskeyFlow(createController, (action) => {
    setEnabled(action !== 'disable');
  });
  useEffect(() => {
    let current = true;
    const captured = ++version.current;
    setEnabled(null);
    setSupport(null);
    setReadError(false);
    setPassword('');
    void flow
      .status()
      .then((status) => {
        if (current && version.current === captured) setEnabled(status.enabled);
      })
      .catch(() => {
        if (current && version.current === captured) setReadError(true);
      });
    void localPasskeySupport().then((value) => {
      if (current) setSupport(value);
    });
    return () => {
      current = false;
      version.current++;
    };
  }, [flow.status]);
  const canEdit =
    enabled !== null &&
    (enabled || (support !== null && support !== 'unsupported'));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting.current || flow.busy || !password || !canEdit) return;
    submitting.current = true;
    const captured = ++version.current;
    const entered = password;
    setPassword('');
    try {
      if (enabled) await flow.disable(entered);
      else await flow.enroll(entered);
    } finally {
      if (version.current === captured) submitting.current = false;
    }
  };
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
      {canEdit && (
        <PageActionFooter
          includeInFlow
          error={
            flow.error
              ? t(
                  enabled
                    ? 'localPasskey.disableFailed'
                    : 'localPasskey.enrollFailed'
                )
              : undefined
          }
        >
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
                  version.current++;
                  submitting.current = false;
                  flow.cancel();
                }}
              >
                {t('buttons.cancel')}
              </Button>
            )}
          </div>
        </PageActionFooter>
      )}
    </form>
  );
}

export default LocalPasskeySettings;
