import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  IPrivateVaultCapacity,
  PrivateVaultCapacity,
} from 'utils/privacy/privateVaultTypes';

function capacityData(value: unknown): IPrivateVaultCapacity {
  const data = value as IPrivateVaultCapacity | null;
  if (
    !data ||
    ![128, 256, 512].includes(data.capacity) ||
    !Number.isInteger(data.noteCount) ||
    data.noteCount < 0 ||
    data.noteCount > data.capacity ||
    data.bundleLimitBytes !== (data.capacity / 128) * 4 * 1024 * 1024 ||
    !Number.isSafeInteger(data.storedBytes) ||
    data.storedBytes < 0 ||
    data.storedBytes > data.bundleLimitBytes
  )
    throw new Error('privacy_vault_unavailable');
  return data;
}

export default function PrivateVaultCapacitySettings({
  controllerEmitter,
}: {
  controllerEmitter: (...args: any[]) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<IPrivateVaultCapacity>();
  const [choice, setChoice] = useState<PrivateVaultCapacity>(128);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState(false);
  const owner = useRef({ active: true, revision: 0 });
  const current = (revision: number) =>
    owner.current.active &&
    owner.current.revision === revision &&
    document.visibilityState !== 'hidden';
  const load = () => {
    const revision = ++owner.current.revision;
    setPending(true);
    setError(false);
    void controllerEmitter(['privateVault', 'getCapacity'], [], 30000, false)
      .then((value) => {
        const next = capacityData(value);
        if (current(revision)) {
          setData(next);
          setChoice(next.capacity);
        }
      })
      .catch(() => {
        if (current(revision)) setError(true);
      })
      .finally(() => {
        if (current(revision)) setPending(false);
      });
  };
  useEffect(() => {
    owner.current.active = true;
    load();
    return () => {
      owner.current.active = false;
      owner.current.revision++;
    };
  }, []);
  const save = async () => {
    if (pending || !data || choice === data.capacity) return;
    const revision = ++owner.current.revision;
    setPending(true);
    setError(false);
    try {
      const next = capacityData(
        await controllerEmitter(
          ['privateVault', 'setCapacity'],
          [choice],
          30000,
          false
        )
      );
      if (current(revision)) {
        setData(next);
        setChoice(next.capacity);
      }
    } catch {
      if (current(revision)) setError(true);
    } finally {
      if (current(revision)) setPending(false);
    }
  };
  return (
    <div
      className="space-y-2 rounded-lg border border-alpha-whiteAlpha300 p-3 text-xs"
      aria-busy={pending}
    >
      <p>{t('privacy.capacity.explanation')}</p>
      {data && (
        <p>
          {t('privacy.capacity.usage', {
            count: data.noteCount,
            capacity: data.capacity,
          })}
        </p>
      )}
      {data && (
        <p>{t('privacy.capacity.storedBytes', { bytes: data.storedBytes })}</p>
      )}
      <label htmlFor="privacy-capacity">{t('privacy.capacity.label')}</label>
      <select
        className="w-full rounded-lg border border-alpha-whiteAlpha300 bg-bkg-4 p-3 text-white"
        id="privacy-capacity"
        value={choice}
        disabled={pending || !data}
        onChange={(event) =>
          setChoice(Number(event.target.value) as PrivateVaultCapacity)
        }
      >
        <option value={128}>
          {t('privacy.capacity.option', { count: 128, size: 4 })}
        </option>
        <option value={256}>
          {t('privacy.capacity.option', { count: 256, size: 8 })}
        </option>
        <option value={512}>
          {t('privacy.capacity.option', { count: 512, size: 16 })}
        </option>
      </select>
      <p>{t('privacy.capacity.compatibility')}</p>
      {error && <p role="alert">{t('privacy.capacity.error')}</p>}
      {error && !data && (
        <button
          type="button"
          className="rounded p-1 text-brand-royalbluemedium underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50"
          onClick={load}
          disabled={pending}
        >
          {t('privacy.retry')}
        </button>
      )}
      <button
        type="button"
        className="rounded p-1 text-brand-royalbluemedium underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50"
        disabled={pending || !data || choice === data.capacity}
        onClick={() => void save()}
      >
        {t('privacy.capacity.save')}
      </button>
    </div>
  );
}
