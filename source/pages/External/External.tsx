import React, { FC } from 'react';
import { BrowserRouter } from 'react-router-dom';

import { ExternalRoute } from 'routers/ExternalRoute';

const External: FC = () => (
  // Don't signal app ready here - let the actual route components handle it
  // Start component (for unauthenticated) and route components (for authenticated)
  // will signal when they have content ready

  <BrowserRouter>
    <div className="w-full min-w-popup max-w-popup h-full min-h-popup font-poppins text-xl overflow-x-hidden">
      <ExternalRoute />
    </div>
  </BrowserRouter>
);
export default External;
