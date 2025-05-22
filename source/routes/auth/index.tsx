import React, { lazy } from 'react';
import { Route, Routes } from 'react-router-dom';

// Lazy load auth components
const CreatePass = lazy(() =>
  import('../../pages/CreatePass').then((module) => ({
    default: module.CreatePass,
  }))
);
const Import = lazy(() =>
  import('../../pages/Import').then((module) => ({ default: module.Import }))
);
const SeedConfirm = lazy(() =>
  import('../../pages/SeedConfirm').then((module) => ({
    default: module.SeedConfirm,
  }))
);
const Start = lazy(() =>
  import('../../pages/Start').then((module) => ({ default: module.Start }))
);
const External = lazy(() =>
  import('../../pages/External').then((module) => ({
    default: module.External,
  }))
);

const AuthRoutes: React.FC = () => (
  <Routes>
    <Route index element={<Start />} />
    <Route path="create-password" element={<CreatePass />} />
    <Route path="import" element={<Import />} />
    <Route path="seed-confirm" element={<SeedConfirm />} />
    <Route path="external" element={<External />} />
  </Routes>
);

export default AuthRoutes;
