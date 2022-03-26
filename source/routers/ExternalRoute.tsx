import { useUtils, useQuery } from 'hooks/index';
import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
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

export const ExternalRouter = () => {
  const {
    wallet: { isLocked },
    appRoute,
  } = getController();
  const { navigate } = useUtils();

  const query = useQuery();
  const route = query.get('route');

  const isUnlocked = !isLocked();
  // const storedRoute = appRoute();

  useEffect(() => {
    // if (!isUnlocked) navigate('/');

    // if (isUnlocked) navigate(`/external/${route}`);

    console.log('route', route, isUnlocked);

    // if (storedRoute !== '/') navigate(storedRoute);
  }, []);

  return (
    <Routes>
      <Route path="/" element={<Start />} />

      <Route path="create-password" element={<CreatePass />} />
      <Route path="import" element={<Import />} />
      <Route path="phrase/create" element={<CreatePhrase />} />
      <Route path="phrase/confirm" element={<ConfirmPhrase />} />

      <Route path="external">
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
        element={<Navigate to={{ pathname: '/external.html' }} />}
      />
    </Routes>
  );
};
