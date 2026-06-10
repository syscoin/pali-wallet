import React from 'react';

/**
 * Branded boot skeleton matching the static HTML loader in views/app.html.
 * Used by boot/auth gates instead of invisible placeholders so the popup
 * never shows a blank dark screen after the HTML loader has been hidden.
 */
export const AppLoadingSkeleton: React.FC = () => (
  <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#061120]">
    <div className="flex gap-3 animate-pulse">
      <h1 className="text-[#4DA2CF] font-poppins text-[37.87px] font-bold leading-[37.87px] tracking-[0.379px]">
        Pali
      </h1>
      <h1 className="text-[#4DA2CF] font-poppins text-[37.87px] font-light leading-[37.87px] tracking-[0.379px]">
        Wallet
      </h1>
    </div>
  </div>
);

export default AppLoadingSkeleton;
