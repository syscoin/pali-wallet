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

export const ExternalRoute = () => {
  const {
    wallet: { isLocked },
  } = getController();
  const { navigate } = useUtils();

  const query = useQuery();
  const route = query.get('route');

  // const isUnlocked = !isLocked();

  useEffect(() => {
    if (route) navigate(`/external/${route}`);
  }, []);

  return (
    <Routes>
      <Route path="/" element={<Start external />} />

      <Route path="create-password" element={<CreatePass />} />
      <Route path="import" element={<Import />} />
      <Route path="phrase/create" element={<CreatePhrase />} />
      <Route path="phrase/confirm" element={<ConfirmPhrase />} />

      <Route path="external">
        <Route path="connect-wallet" element={<ConnectWallet />} />

        <Route path="change-account" element={<ChangeAccount />} />

        {/* /tx/ */}
        <Route path="tx">
          <Route path="create" element={<Create />} />
          <Route path="create/confirm" element={<CreateTokenConfirm />} />
          <Route path="sign" element={<SignAndSend />} />
          <Route path="sign-psbt" element={<SignPSBT />} />

          {/* /tx/asset */}
          <Route path="asset">
            <Route path="issue" element={<MintToken />} />
            <Route path="issue/confirm" element={<MintTokenConfirm />} />
            <Route path="transfer" element={<TransferOwnership />} />
            <Route
              path="transfer/confirm"
              element={<TransferOwnershipConfirm />}
            />
            <Route path="update" element={<UpdateAsset />} />
            <Route path="update/confirm" element={<UpdateAssetConfirm />} />

            {/* /tx/asset/nft */}
            <Route path="nft">
              <Route path="issue" element={<CreateAndIssueNFT />} />
              <Route
                path="issue/confirm"
                element={<CreateAndIssueNFTConfirm />}
              />
              <Route path="mint" element={<MintNFT />} />
              <Route path="mint/confirm" element={<MintNFTConfirm />} />
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
