import React, { FC, useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';

import { Router } from 'routers/index';

const External: FC = () => {
  useEffect(() => {
    // Clear ONLY popup detection flags when external tab closes
    // Don't touch vault or session data
    const handleBeforeUnload = () => {
      chrome.storage.local.remove(['pali-popup-open', 'pali-popup-timestamp']);
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // Also clear on component unmount, but be more careful
      chrome.storage.local.remove(['pali-popup-open', 'pali-popup-timestamp']);
    };
  }, []);

  return (
    // Don't signal app ready here - let the actual route components handle it
    // Start component (for unauthenticated) and route components (for authenticated)
    // will signal when they have content ready

    <BrowserRouter>
      <div className="w-full min-w-popup max-w-popup h-full min-h-popup font-poppins text-xl overflow-x-hidden">
        <Router />
      </div>
    </BrowserRouter>
  );
};
export default External;
