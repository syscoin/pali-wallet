import { Dialog } from '@headlessui/react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  CenterPanel,
  DialogBody,
  DialogHeader,
  DialogPrimitive,
} from 'components/Dialog';
import { LoadingSvg } from 'components/Icon/Icon';

type PqSigningOverlayProps = {
  expectedSeconds: number;
  show: boolean;
  subtitle: string;
  title: string;
  warningSeconds?: number;
};

const formatDuration = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes === 0) {
    return `${remainingSeconds}s`;
  }
  return `${minutes}m ${remainingSeconds.toString().padStart(2, '0')}s`;
};

export const PqSigningOverlay = ({
  expectedSeconds,
  show,
  subtitle,
  title,
  warningSeconds = expectedSeconds,
}: PqSigningOverlayProps) => {
  const { t } = useTranslation();
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!show) {
      setStartedAt(null);
      setElapsedSeconds(0);
      return undefined;
    }

    const startedAtMs = Date.now();
    setStartedAt(startedAtMs);
    setElapsedSeconds(0);
    const interval = window.setInterval(() => {
      setElapsedSeconds(
        Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000))
      );
    }, 1000);

    return () => window.clearInterval(interval);
  }, [show]);

  const progressPercent = useMemo(() => {
    if (!show || !startedAt) return 0;
    return Math.min(98, Math.floor((elapsedSeconds / expectedSeconds) * 100));
  }, [elapsedSeconds, expectedSeconds, show, startedAt]);

  if (!show) {
    return null;
  }

  const isPastExpected = elapsedSeconds >= warningSeconds;

  return (
    <DialogPrimitive initialFocus={panelRef} onClose={() => undefined}>
      <CenterPanel
        padded={false}
        scroll={false}
        className="flex flex-col focus:outline-none"
        ref={panelRef}
        tabIndex={-1}
        aria-busy
        data-testid="pq-signing-overlay"
      >
        <DialogHeader
          title={title}
          icon={<LoadingSvg className="animate-spin text-accent-primary" />}
        />
        <DialogBody>
          <Dialog.Description className="mb-4 text-sm leading-relaxed text-content-secondary">
            {subtitle}
          </Dialog.Description>

          <div className="mb-3 h-2 overflow-hidden rounded-full bg-alpha-whiteAlpha200">
            <div
              className="h-full rounded-full bg-brand-royalblue transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <p className="text-xs text-content-muted">
            {t('send.pqSigningElapsed', {
              duration: formatDuration(elapsedSeconds),
            })}{' '}
            {isPastExpected
              ? t('send.pqSigningWorking')
              : t('send.pqSigningExpected', {
                  duration: formatDuration(expectedSeconds),
                })}
          </p>
        </DialogBody>
      </CenterPanel>
    </DialogPrimitive>
  );
};
