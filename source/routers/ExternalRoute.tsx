import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';

import {
  ChangeAccount,
  ConnectWallet,
  CreateToken,
  CreateNFT,
  CreatePass,
  Import,
  MintNFT,
  MintToken,
  SendToken,
  SendConfirm,
  SignAndSend,
  Sign,
  Start,
  TransferToken,
  UpdateToken,
  SeedConfirm,
} from '../pages';
import { useQuery, useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';

import { ProtectedRoute } from './ProtectedRoute';

export const ExternalRoute = () => {
  const { wallet, appRoute } = getController();
  const { navigate, alert } = useUtils();
  const accounts = useSelector((state: RootState) => state.vault.accounts);
  const { pathname, search } = useLocation();

  // defaultRoute stores info from createPopup
  // used to redirect after unlocking the wallet
  const query = useQuery();
  const [defaultRoute] = useState(query.route + '?data=' + query.data);

  const isUnlocked = wallet.isUnlocked();

  useEffect(() => {
    const externalRoute = appRoute(null, true);

    if (isUnlocked && accounts && defaultRoute) {
      navigate(`/external/${defaultRoute}`);

      return;
    }

    if (externalRoute !== '/start') navigate(externalRoute);
  }, [isUnlocked, accounts]);

  useEffect(() => {
    alert.removeAll();
    appRoute(pathname + search, true);
  }, [pathname]);

  return (
    <Routes>
      <Route path="start" element={<Start />} />
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
            path="sign"
            element={<ProtectedRoute element={<SignAndSend />} />}
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
        element={<Navigate to={{ pathname: '/start' }} />}
      />
    </Routes>
  );
};
