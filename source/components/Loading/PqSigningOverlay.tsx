import React, { useEffect, useMemo, useState } from 'react';

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
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

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
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-brand-black bg-opacity-60 px-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="pq-signing-title"
      aria-describedby="pq-signing-description"
      data-testid="pq-signing-overlay"
    >
      <div className="w-full max-w-[22rem] rounded-2xl border border-alpha-whiteAlpha300 bg-bkg-7 p-5 text-center shadow-xl">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-blue500 bg-opacity-20">
          <LoadingSvg className="h-6 w-6 animate-spin text-brand-royalblue" />
        </div>

        <h2
          id="pq-signing-title"
          className="mb-2 text-base font-semibold text-brand-white"
        >
          {title}
        </h2>
        <p
          id="pq-signing-description"
          className="mb-4 text-xs leading-5 text-brand-graylight"
        >
          {subtitle}
        </p>

        <div className="mb-3 h-2 overflow-hidden rounded-full bg-alpha-whiteAlpha200">
          <div
            className="h-full rounded-full bg-brand-royalblue transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        <p className="text-xs text-brand-graylight">
          Elapsed {formatDuration(elapsedSeconds)}.{' '}
          {isPastExpected
            ? 'Still working locally; slower machines can take longer.'
            : `Expected around ${formatDuration(expectedSeconds)}.`}
        </p>
      </div>
    </div>
  );
};
