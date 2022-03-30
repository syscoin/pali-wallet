import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useQuery, useUtils, useStore } from 'hooks/index';
import { getController } from 'utils/browser';

import {
  ChangeAccount,
  ConfirmPhrase,
  ConnectWallet,
  Create,
  CreateAndIssueNFT,
  CreateAndIssueNFTConfirm,
  CreatePass,
  CreatePhrase,
  CreateTokenConfirm,
  Import,
  MintNFT,
  MintNFTConfirm,
  MintToken,
  MintTokenConfirm,
  SignAndSend,
  SignPSBT,
  Start,
  TransferOwnership,
  TransferOwnershipConfirm,
  UpdateAsset,
  UpdateAssetConfirm,
} from '../pages';

import { ProtectedRoute } from './ProtectedRoute';

export const ExternalRoute = () => {
  const {
    wallet: { isLocked },
    appRoute,
  } = getController();
  const { navigate, alert } = useUtils();
  const { accounts } = useStore();
  const { pathname } = useLocation();

  const query = useQuery();
  const route = query.get('route');
  const [defaultRoute] = useState(route);
  const isUnlocked = !isLocked();

  useEffect(() => {
    const externalRoute = appRoute('/start', true);

    if (isUnlocked && accounts && defaultRoute) {
      navigate(`/external/${defaultRoute}`);

      return;
    }

    if (externalRoute !== '/start') navigate(externalRoute);
  }, [isUnlocked, accounts]);

  useEffect(() => {
    alert.removeAll();
    appRoute(pathname);
  }, [pathname]);

  return (
    <Routes>
      <Route path="/start" element={<Start />} />
      <Route path="create-password" element={<CreatePass />} />
      <Route path="import" element={<Import />} />
      <Route path="phrase/create" element={<CreatePhrase />} />
      <Route path="phrase/confirm" element={<ConfirmPhrase />} />

      <Route path="external">
        <Route path="create-password" element={<CreatePass />} />
        <Route path="import" element={<Import />} />
        <Route path="phrase/create" element={<CreatePhrase />} />
        <Route path="phrase/confirm" element={<ConfirmPhrase />} />

        <Route
          path="connect-wallet"
          element={<ProtectedRoute element={<ConnectWallet />} />}
        />

        <Route
          path="change-account"
          element={<ProtectedRoute element={<ChangeAccount />} />}
        />

        {/* /tx/ */}
        <Route path="tx">
          <Route
            path="create"
            element={<ProtectedRoute element={<Create />} />}
          />
          <Route
            path="create/confirm"
            element={<ProtectedRoute element={<CreateTokenConfirm />} />}
          />
          <Route
            path="sign"
            element={<ProtectedRoute element={<SignAndSend />} />}
          />
          <Route
            path="sign-psbt"
            element={<ProtectedRoute element={<SignPSBT />} />}
          />

          {/* /tx/asset */}
          <Route path="asset">
            <Route
              path="issue"
              element={<ProtectedRoute element={<MintToken />} />}
            />
            <Route
              path="issue/confirm"
              element={<ProtectedRoute element={<MintTokenConfirm />} />}
            />
            <Route
              path="transfer"
              element={<ProtectedRoute element={<TransferOwnership />} />}
            />
            <Route
              path="transfer/confirm"
              element={
                <ProtectedRoute element={<TransferOwnershipConfirm />} />
              }
            />
            <Route
              path="update"
              element={<ProtectedRoute element={<UpdateAsset />} />}
            />
            <Route
              path="update/confirm"
              element={<ProtectedRoute element={<UpdateAssetConfirm />} />}
            />

            {/* /tx/asset/nft */}
            <Route path="nft">
              <Route
                path="issue"
                element={<ProtectedRoute element={<CreateAndIssueNFT />} />}
              />
              <Route
                path="issue/confirm"
                element={
                  <ProtectedRoute element={<CreateAndIssueNFTConfirm />} />
                }
              />
              <Route
                path="mint"
                element={<ProtectedRoute element={<MintNFT />} />}
              />
              <Route
                path="mint/confirm"
                element={<ProtectedRoute element={<MintNFTConfirm />} />}
              />
            </Route>
          </Route>
        </Route>
      </Route>

      <Route
        path="external.html"
        element={<Navigate to={{ pathname: '/start' }} />}
      />
    </Routes>
  );
};
