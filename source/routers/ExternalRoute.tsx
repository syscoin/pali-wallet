import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

import {
  ChangeAccount,
  ConnectWallet,
  Create,
  CreateAndIssueNFT,
  CreateAndIssueNFTConfirm,
  CreateTokenConfirm,
  MintNFT,
  MintNFTConfirm,
  MintToken,
  MintTokenConfirm,
  SignAndSend,
  SignPSBT,
  TransferOwnership,
  TransferOwnershipConfirm,
  UpdateAsset,
  UpdateAssetConfirm,
} from '../pages';

import { ProtectedRoute } from './ProtectedRoute';

export const ExternalRouter = () => {
  // const params = useParams();

  return (
    <Routes>
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
        element={<Navigate to={{ pathname: '/' }} />}
      />
    </Routes>
  );
};
