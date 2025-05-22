import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

import { Layout } from './components/Layout';
import { LoadingSpinner } from './components/LoadingSpinner';
import { ProtectedRoute } from './components/ProtectedRoute';

// Lazy load route components
const Home = lazy(() =>
  import('./pages/Home').then((module) => ({ default: module.Home }))
);
const AuthRoutes = lazy(() => import('./routes/auth'));
const NetworkRoutes = lazy(() => import('./routes/network'));
const TransactionRoutes = lazy(() => import('./routes/transaction'));

const App: React.FC = () => (
  <Layout title="Pali Wallet">
    <Suspense fallback={<LoadingSpinner />}>
      <Routes>
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="/home/*" element={<ProtectedRoute element={<Home />} />} />
        <Route path="/auth/*" element={<AuthRoutes />} />
        <Route path="/network/*" element={<NetworkRoutes />} />
        <Route path="/transaction/*" element={<TransactionRoutes />} />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </Suspense>
  </Layout>
);

export default App;
