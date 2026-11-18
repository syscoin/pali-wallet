import { ExclamationIcon } from '@heroicons/react/outline';
import React, { type ReactNode } from 'react';

export function InlineFeedback({
  children,
  role,
  tone = 'warning',
}: {
  children: ReactNode;
  role?: 'alert' | 'status';
  tone?: 'warning' | 'error';
}) {
  return (
    <p
      role={role}
      className={`flex items-start gap-1.5 text-xs font-medium leading-4 ${
        tone === 'error' ? 'text-warning-error' : 'text-brand-yellowInfo'
      }`}
    >
      <ExclamationIcon aria-hidden="true" className="h-4 w-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
