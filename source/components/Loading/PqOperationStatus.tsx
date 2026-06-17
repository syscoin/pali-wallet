import React, { useEffect, useMemo, useState } from 'react';

import { LoadingSvg } from 'components/Icon/Icon';

type PqOperationStatusProps = {
  expectedSeconds: number;
  progressLabel?: string;
  progressPercent?: number;
  show: boolean;
  startedAt?: number;
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

export const PqOperationStatus = ({
  expectedSeconds,
  progressLabel,
  progressPercent: explicitProgressPercent,
  show,
  startedAt,
  title,
  warningSeconds = expectedSeconds,
}: PqOperationStatusProps) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!show) {
      setElapsedSeconds(0);
      return undefined;
    }

    const startedAtMs = startedAt || Date.now();
    setElapsedSeconds(
      Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000))
    );
    const interval = window.setInterval(() => {
      setElapsedSeconds(
        Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000))
      );
    }, 1000);

    return () => window.clearInterval(interval);
  }, [show, startedAt]);

  const progressPercent = useMemo(() => {
    if (!show) return 0;
    if (typeof explicitProgressPercent === 'number') {
      return Math.max(0, Math.min(99, Math.floor(explicitProgressPercent)));
    }
    return Math.min(98, Math.floor((elapsedSeconds / expectedSeconds) * 100));
  }, [elapsedSeconds, expectedSeconds, explicitProgressPercent, show]);

  if (!show) {
    return null;
  }

  const isPastExpected = elapsedSeconds >= warningSeconds;

  return (
    <div className="mb-3 rounded-lg border border-brand-blue500 border-opacity-40 bg-brand-blue500 bg-opacity-10 p-3 text-left">
      <div className="mb-2 flex items-center gap-2">
        <LoadingSvg className="h-4 w-4 flex-shrink-0 animate-spin text-brand-royalblue" />
        <p className="text-xs font-medium text-brand-white">{title}</p>
      </div>
      <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-alpha-whiteAlpha200">
        <div
          className="h-full rounded-full bg-brand-royalblue transition-all duration-500"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
      <p className="text-xs text-brand-graylight">
        Elapsed {formatDuration(elapsedSeconds)}.{' '}
        {isPastExpected
          ? 'Still working locally; this can take longer on slower machines.'
          : `Expected around ${formatDuration(expectedSeconds)}.`}
        {progressLabel ? ` ${progressLabel}` : ''}
      </p>
    </div>
  );
};
