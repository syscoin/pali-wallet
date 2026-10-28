import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from 'components/Button';
import { useController } from 'hooks/useController';
import { normalizePrivacyServiceOrigin } from 'utils/privacy/service';

export default function PrivacyServiceSettings({
  onSettled,
}: {
  onSettled: () => void;
}) {
  const { t } = useTranslation();
  const { controllerEmitter } = useController();
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState('');
  const [saved, setSaved] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const owner = useRef({ active: true, revision: 0, saving: false });

  useEffect(() => {
    owner.current.active = true;
    return () => {
      owner.current.active = false;
      owner.current.revision += 1;
    };
  }, []);

  useEffect(() => {
    if (!open || owner.current.saving) return undefined;
    const revision = ++owner.current.revision;
    setLoading(true);
    setError('');
    void controllerEmitter(
      ['privacySettings', 'getServiceOrigin'],
      [],
      10000,
      false
    )
      .then((value) => {
        if (revision !== owner.current.revision) return;
        const current = normalizePrivacyServiceOrigin(value as string);
        setOrigin(current);
        setSaved(current);
      })
      .catch(() => {
        if (revision === owner.current.revision)
          setError(t('privacy.serviceLoadFailed'));
      })
      .finally(() => {
        if (revision === owner.current.revision) setLoading(false);
      });
    return () => {
      owner.current.revision += 1;
    };
  }, [open, controllerEmitter, t, loadAttempt]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (owner.current.saving || loading) return;
    let normalized: string;
    try {
      normalized = normalizePrivacyServiceOrigin(origin);
    } catch {
      setError(t('privacy.serviceInvalid'));
      return;
    }
    if (normalized === saved) {
      setOrigin(normalized);
      setError('');
      return;
    }
    owner.current.revision += 1;
    owner.current.saving = true;
    setSaving(true);
    setError('');
    setSuccess(false);
    try {
      const result = await controllerEmitter(
        ['privacySettings', 'setServiceOrigin'],
        [normalized, saved],
        30000,
        false
      );
      if (!owner.current.active) return;
      if (result !== normalized)
        throw new Error('privacy_service_update_failed');
      setOrigin(normalized);
      setSaved(normalized);
      setSuccess(true);
    } catch {
      if (owner.current.active) setError(t('privacy.serviceSaveFailed'));
    } finally {
      if (owner.current.active) {
        setSaving(false);
        // A failed or timed-out save may have already cleared public pool data.
        onSettled();
      }
      owner.current.saving = false;
    }
  };

  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-sm text-brand-royalbluemedium underline rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
        {t('privacy.serviceSettings')}
      </summary>
      {open && (
        <form className="mt-3 space-y-3" onSubmit={save} noValidate>
          <p className="text-xs text-brand-gray200">
            {t('privacy.serviceHelp')}
          </p>
          <label
            htmlFor="privacy-service-origin"
            className="block text-sm text-white"
          >
            {t('privacy.serviceOrigin')}
          </label>
          <input
            id="privacy-service-origin"
            type="url"
            value={origin}
            onChange={(event) => {
              setOrigin(event.target.value);
              setError('');
              setSuccess(false);
            }}
            disabled={loading || saving}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'privacy-service-error' : undefined}
            className="w-full rounded-lg border border-alpha-whiteAlpha300 bg-bkg-4 p-3 text-sm text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-royalblue"
          />
          {error && (
            <p
              id="privacy-service-error"
              role="alert"
              className="text-xs text-brand-red"
            >
              {error}
            </p>
          )}
          {error && !saved && (
            <button
              type="button"
              className="rounded p-1 text-xs text-brand-royalbluemedium underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
              onClick={() => setLoadAttempt((value) => value + 1)}
            >
              {t('privacy.retry')}
            </button>
          )}
          {success && (
            <p role="status" className="text-xs text-brand-gray200">
              {t('privacy.serviceSaved')}
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            fullWidth
            disabled={loading || saving || !origin || origin === saved}
            loading={saving}
          >
            {t('buttons.save')}
          </Button>
        </form>
      )}
    </details>
  );
}
