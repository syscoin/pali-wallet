import React, { Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import {
  ApproveTransactionComponent,
  ChangeAccount,
  ChangeConnectedAccount,
  ConnectWallet,
  CreatePass,
  CreatePasswordImport,
  CustomRPCExternal,
  Decrypt,
  EncryptPubKey,
  EthSign,
  ExternalWatchAsset,
  Import,
  SeedConfirm,
  SendConfirm,
  SendNTokenTransaction,
  SendToken,
  SendTransaction,
  Sign,
  SignAndSend,
  Start,
  SwitchChain,
  SwitchNeworkUtxoEvm,
} from '../pages';
import { Loading } from 'components/Loading';
import { useQuery, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { SwitchNetwork } from 'pages/SwitchNetwork';
import { rehydrateStore } from 'state/rehydrate';
import store from 'state/store';

import { ProtectedRoute } from './ProtectedRoute';

export const ExternalRoute = () => {
  const { navigate } = useUtils();
  const { isUnlocked, controllerEmitter } = useController();

  // defaultRoute stores info from createPopup
  // used to redirect after unlocking the wallet
  const query = useQuery();
  const [defaultRoute] = useState(query.route + '?data=' + query.data);

  useEffect(() => {
    function handleStateChange(message: any) {
      if (message.type === 'CONTROLLER_STATE_CHANGE') {
        rehydrateStore(store, message.data);
      }
    }

    chrome.runtime.onMessage.addListener(handleStateChange);

    return () => {
      chrome.runtime.onMessage.removeListener(handleStateChange);
    };
  }, []);

  useEffect(() => {
    if (isUnlocked && defaultRoute) {
      navigate(`/external/${defaultRoute}`);

      return;
    }

    async function checkExternalRoute() {
      const externalRoute = await controllerEmitter(['appRoute'], [null, true]);
      if (externalRoute !== '/') navigate(externalRoute);
    }

    checkExternalRoute();

    return () => {
      checkExternalRoute();
    };
  }, [isUnlocked]);

  // what is this for?
  // useEffect(() => {
  //   alert.removeAll();
  //   controllerEmitter(['appRoute'], [pathname + search, true]);
  // }, [pathname]);

  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route
          path="/"
          element={
            <Start
              isExternal={true}
              externalRoute={`/external/${defaultRoute}`}
            />
          }
        />
        <Route path="create-password" element={<CreatePass />} />
        <Route
          path="create-password-import"
          element={<CreatePasswordImport />}
        />
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

          <Route
            path="change-active-connected-account"
            element={<ProtectedRoute element={<ChangeConnectedAccount />} />}
          />

          <Route
            path="watch-asset"
            element={<ProtectedRoute element={<ExternalWatchAsset />} />}
          />
          <Route
            path="switch-network"
            element={<ProtectedRoute element={<SwitchNetwork />} />}
          />

          <Route
            path="add-EthChain"
            element={<ProtectedRoute element={<CustomRPCExternal />} />}
          />
          <Route
            path="switch-EthChain"
            element={<ProtectedRoute element={<SwitchChain />} />}
          />
          <Route
            path="switch-UtxoEvm"
            element={<ProtectedRoute element={<SwitchNeworkUtxoEvm />} />}
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
              path="send/nTokenTx"
              element={<ProtectedRoute element={<SendNTokenTransaction />} />}
            />
            <Route
              path="send/approve"
              element={
                <ProtectedRoute element={<ApproveTransactionComponent />} />
              }
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
              path="encryptKey"
              element={<ProtectedRoute element={<EncryptPubKey />} />}
            />
            <Route
              path="decrypt"
              element={<ProtectedRoute element={<Decrypt />} />}
            />
            <Route
              path="sign-psbt"
              element={<ProtectedRoute element={<Sign />} />}
            />
          </Route>
        </Route>

        <Route
          path="external.html"
          element={<Navigate to={{ pathname: '/' }} />}
        />
      </Routes>
    </Suspense>
  );
};
