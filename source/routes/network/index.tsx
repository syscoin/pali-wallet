import React, { lazy } from 'react';
import { Route, Routes } from 'react-router-dom';

import { ProtectedRoute } from '../../components/ProtectedRoute';

// Lazy load network components
const SwitchNetwork = lazy(() =>
  import('../../pages/SwitchNetwork/SwitchNetwork').then((module) => ({
    default: module.SwitchNetwork,
  }))
);
const CustomRPC = lazy(() =>
  import('../../pages/Settings/CustomRPC').then((module) => ({
    default: module.default,
  }))
);
const ManageNetwork = lazy(() =>
  import('../../pages/Settings/ManageNetwork').then((module) => ({
    default: module.default,
  }))
);
const SwitchEthereumChain = lazy(() =>
  import('../../pages/Settings/SwitchEthereumChain').then((module) => ({
    default: module.default,
  }))
);
const SwitchNetworkUtxoEvm = lazy(() =>
  import('../../pages/Settings/SwitchNetworkUtxoEvm').then((module) => ({
    default: module.default,
  }))
);

const NetworkRoutes: React.FC = () => (
  <Routes>
    <Route index element={<ProtectedRoute element={<SwitchNetwork />} />} />
    <Route
      path="switch"
      element={<ProtectedRoute element={<SwitchNetwork />} />}
    />
    <Route
      path="custom-rpc"
      element={<ProtectedRoute element={<CustomRPC />} />}
    />
    <Route
      path="manage"
      element={<ProtectedRoute element={<ManageNetwork />} />}
    />
    <Route
      path="switch-ethereum"
      element={<ProtectedRoute element={<SwitchEthereumChain />} />}
    />
    <Route
      path="switch-utxo-evm"
      element={<ProtectedRoute element={<SwitchNetworkUtxoEvm />} />}
    />
  </Routes>
);

export default NetworkRoutes;
