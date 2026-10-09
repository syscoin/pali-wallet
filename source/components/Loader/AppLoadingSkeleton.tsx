import React, { useEffect, useState } from 'react';

/** Visible loading and recovery for boot/auth gates and lazy route transitions. */
export const AppLoadingSkeleton: React.FC = () => {
  const [isSlow, setIsSlow] = useState(false);
  useEffect(() => {
    // Reserve a short paint budget before the two-second feedback deadline.
    const timeout = setTimeout(() => setIsSlow(true), 1800);
    return () => clearTimeout(timeout);
  }, []);

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#061120] p-6 text-center text-white">
      <div className="flex gap-3 animate-pulse motion-reduce:animate-none">
        <h1 className="text-[#4DA2CF] font-poppins text-[37.87px] font-bold leading-[37.87px] tracking-[0.379px]">
          Pali
        </h1>
        <h1 className="text-[#4DA2CF] font-poppins text-[37.87px] font-light leading-[37.87px] tracking-[0.379px]">
          Wallet
        </h1>
      </div>
      <p role="status" aria-live="polite" className="mt-6 text-sm">
        {isSlow
          ? 'This view is taking longer to load. You can reload the wallet.'
          : 'Loading wallet view…'}
      </p>
      {isSlow && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 rounded-lg bg-[#4DA2CF] px-5 py-3 font-medium text-[#061120] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
        >
          Reload wallet
        </button>
      )}
    </div>
  );
};

export default AppLoadingSkeleton;
