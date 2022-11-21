import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';

import {
  ChangeAccount,
  ConnectWallet,
  CreateToken,
  CreateNFT,
  CreatePass,
  EthSign,
  Import,
  MintNFT,
  MintToken,
  SendToken,
  SendConfirm,
  SendTransaction,
  SignAndSend,
  Sign,
  Start,
  TransferToken,
  UpdateToken,
  SeedConfirm,
  EditPriorityFee,
  ApproveTransactionComponent,
} from '../pages';
import { useQuery, useUtils } from 'hooks/index';
import { getController } from 'utils/browser';

import { ProtectedRoute } from './ProtectedRoute';

export const ExternalRoute = () => {
  const { wallet, appRoute } = getController();
  const { navigate, alert } = useUtils();
  const { pathname, search } = useLocation();

  // defaultRoute stores info from createPopup
  // used to redirect after unlocking the wallet
  const query = useQuery();
  const [defaultRoute] = useState(query.route + '?data=' + query.data);

  const isUnlocked = wallet.isUnlocked();

  useEffect(() => {
    if (isUnlocked && defaultRoute) {
      navigate(`/external/${defaultRoute}`);

      return;
    }

    const externalRoute = appRoute(null, true);
    if (externalRoute !== '/') navigate(externalRoute);
  }, [isUnlocked]);

  useEffect(() => {
    alert.removeAll();
    appRoute(pathname + search, true);
  }, [pathname]);

  return (
    <Routes>
      <Route path="/" element={<Start />} />
      <Route path="create-password" element={<CreatePass />} />
      <Route path="import" element={<Import />} />
      <Route path="phrase" element={<SeedConfirm />} />

      <Route path="external">
        <Route path="import" element={<Import />} />
        <Route path="phrase" element={<SeedConfirm />} />

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
            path="send"
            element={<ProtectedRoute element={<SendToken />} />}
          />
          <Route
            path="send/confirm"
            element={<ProtectedRoute element={<SendConfirm />} />}
          />
          <Route
            path="send/ethTx"
            element={<ProtectedRoute element={<SendTransaction />} />}
          />
          <Route
            path="send/approve"
            element={
              <ProtectedRoute element={<ApproveTransactionComponent />} />
            }
          />
          <Route
            path="send/ethTx/edit/priority"
            element={<ProtectedRoute element={<EditPriorityFee />} />}
          />
          <Route
            path="sign"
            element={<ProtectedRoute element={<SignAndSend />} />}
          />
          <Route
            path="ethSign"
            element={<ProtectedRoute element={<EthSign />} />}
          />
          <Route
            path="sign-psbt"
            element={<ProtectedRoute element={<Sign />} />}
          />

          {/* /tx/asset */}
          <Route path="asset">
            <Route
              path="create"
              element={<ProtectedRoute element={<CreateToken />} />}
            />
            <Route
              path="mint"
              element={<ProtectedRoute element={<MintToken />} />}
            />
            <Route
              path="transfer"
              element={<ProtectedRoute element={<TransferToken />} />}
            />
            <Route
              path="update"
              element={<ProtectedRoute element={<UpdateToken />} />}
            />

            {/* /tx/asset/nft */}
            <Route path="nft">
              <Route
                path="create"
                element={<ProtectedRoute element={<CreateNFT />} />}
              />
              <Route
                path="mint"
                element={<ProtectedRoute element={<MintNFT />} />}
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
