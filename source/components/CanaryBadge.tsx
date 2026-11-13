import React from 'react';

/** A build-time label, independent of wallet state and update availability. */
export const CanaryBadge = ({ className = '' }: { className?: string }) =>
  process.env.PALI_EXTENSION_CHANNEL === 'canary' ? (
    <span
      aria-label="Pali Wallet Canary"
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#F6C453]/40 bg-[#F6C453]/10 px-2 py-0.5 font-poppins text-[10px] font-semibold leading-4 tracking-wide text-[#F6C453] ${className}`}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full bg-current"
      />
      Canary
    </span>
  ) : null;

export const CanaryBanner = () =>
  process.env.PALI_EXTENSION_CHANNEL === 'canary' ? (
    <div className="flex justify-center pb-2">
      <CanaryBadge />
    </div>
  ) : null;
