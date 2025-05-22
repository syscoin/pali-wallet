import React, { lazy } from 'react';
import { Route, Routes } from 'react-router-dom';

import { ProtectedRoute } from '../../components/ProtectedRoute';

// Lazy load transaction components
const Receive = lazy(() =>
  import('../../pages/Receive').then((module) => ({ default: module.Receive }))
);
const Faucet = lazy(() =>
  import('../../pages/Faucet').then((module) => ({ default: module.Faucet }))
);
const SendEth = lazy(() =>
  import('../../pages/Send/SendEth').then((module) => ({
    default: module.SendEth,
  }))
);
const SendSys = lazy(() =>
  import('../../pages/Send/SendSys').then((module) => ({
    default: module.SendSys,
  }))
);
const SendConfirm = lazy(() =>
  import('../../pages/Send/Confirm').then((module) => ({
    default: module.SendConfirm,
  }))
);
const Transactions = lazy(() =>
  import('../../pages/Transactions').then((module) => ({
    default: module.Transactions,
  }))
);

const TransactionRoutes: React.FC = () => (
  <Routes>
    <Route index element={<ProtectedRoute element={<Transactions />} />} />
    <Route path="receive" element={<ProtectedRoute element={<Receive />} />} />
    <Route path="faucet" element={<ProtectedRoute element={<Faucet />} />} />
    <Route path="send">
      <Route path="eth" element={<ProtectedRoute element={<SendEth />} />} />
      <Route path="sys" element={<ProtectedRoute element={<SendSys />} />} />
      <Route
        path="confirm"
        element={<ProtectedRoute element={<SendConfirm />} />}
      />
    </Route>
    <Route
      path="history"
      element={<ProtectedRoute element={<Transactions />} />}
    />
  </Routes>
);

export default TransactionRoutes;
