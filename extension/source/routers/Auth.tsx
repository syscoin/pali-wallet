import React, { useEffect } from 'react';
import { Import } from 'containers/common/Import';

import {
  Switch,
  Route,
  // Redirect,
  useLocation,
} from 'react-router-dom';

import {
  useController,
  useStore,
  useUtils,
  useBrowser
} from 'hooks/index';

import {
  Home, 
  Receive,
  ConnectWallet,
  ConnectedAccounts,
  Send,
  SendConfirm,
  Start
} from 'containers/auth/index';

import {
  AboutView,
  AccountView,
  AutolockView,
  ConnectHardwareWalletView,
  CurrencyView,
  DeleteWalletView,
  MainView,
  NewAccountView,
  PhraseView,
  PrivateKeyView
} from 'containers/auth/Settings/views';

import {
  Create,
  CreateTokenConfirm,
  IssueAsset,
  IssueAssetConfirm,
  IssueNFT,
  CreateAndIssueNFTConfirm,
  UpdateAsset,
  UpdateAssetConfirm,
  TransferOwnership,
  TransferOwnershipConfirm,
  MintNFT,
  MintNFTConfirm,
  SignAndSend,
  SignPSBT,
} from 'containers/auth/Transactions/views';

import { SendMatchProps } from './types';

export const AuthRouter = () => {
  const location = useLocation();
  const controller = useController();
  const isUnlocked = !controller.wallet.isLocked();

  const { getHost, alert, history } = useUtils();
  const { browser } = useBrowser();

  const {
    accounts,
    confirmingTransaction,
    creatingAsset,
    issuingNFT,
    issuingAsset,
    updatingAsset,
    transferringOwnership,
    signingTransaction,
    signingPSBT,
    mintNFT,
    currentURL,
    canConnect
  } = useStore();

  const connectedAccounts = accounts.filter((account) => {
    return (
      account.connectedTo.findIndex((url: any) => {
        return url == getHost(currentURL);
      }) > -1
    );
  });

  useEffect(() => {
    if (
      isUnlocked
    ) {
      window.addEventListener('mousemove', () => {
        browser.runtime.sendMessage({
          type: 'SET_MOUSE_MOVE',
          target: 'background',
        });
      });
    }
  }, [
    isUnlocked,
  ]);

  useEffect(() => {
    const redirectRoute = controller.appRoute();

    if (
      redirectRoute == '/send/confirm' &&
      !controller.wallet.account.getTransactionItem().tempTx
    ) {
      history.push('/home');

      return;
    }

    if (
      redirectRoute == '/updateAsset/confirm' &&
      !controller.wallet.account.getTransactionItem().updateAssetItem
    ) {
      history.push('/home');

      return;
    }

    if (!isUnlocked && accounts.length > 0) {
      history.push('/app.html');

      return;
    }

    if (
      confirmingTransaction &&
      controller.wallet.account.getTransactionItem().tempTx &&
      isUnlocked
    ) {
      history.push('/send/confirm');

      return;
    }

    if (signingTransaction && isUnlocked) {
      history.push('/sign');

      return;
    }

    if (mintNFT && isUnlocked) {
      history.push('/mintNFT');

      return;
    }

    if (signingPSBT && isUnlocked) {
      history.push('/signPsbt');

      return;
    }

    if (creatingAsset && isUnlocked) {
      history.push('/create');

      return;
    }

    if (issuingAsset && isUnlocked) {
      history.push('/issueAsset');

      return;
    }

    if (issuingNFT && isUnlocked) {
      history.push('/issueNFT');

      return;
    }

    if (updatingAsset && isUnlocked) {
      history.push('/updateAsset');

      return;
    }

    if (transferringOwnership && isUnlocked) {
      history.push('/transferOwnership');

      return;
    }

    if (
      !confirmingTransaction &&
      controller.wallet.account.getTransactionItem().tempTx
    ) {
      history.push('/home');

      return;
    }

    if (canConnect && isUnlocked) {
      if (connectedAccounts.length <= 0) {
        history.push('/connect-wallet');

        return;
      }

      history.push('/connected-accounts');

      return;
    }

    if (!canConnect && isUnlocked) {
      if (connectedAccounts.length > 0) {
        history.push('/home');

        return;
      }

      history.push('/home');

      return;
    }

    if (confirmingTransaction && !canConnect && isUnlocked) {
      history.push('/send/confirm');

      return;
    }

    if (redirectRoute !== '/app.html') {
      history.push(redirectRoute);
    }
  }, [canConnect, isUnlocked, confirmingTransaction, updatingAsset]);

  useEffect(() => {
    alert.removeAll();
    controller.appRoute(location.pathname);
  }, [location]);

  return (
    <>
      <div className="absolute w-full h-full">
        <Switch>
          <Route path="/app.html" component={Start} exact />

          {isUnlocked ? (
            <>
              <Route path="/home" component={Home} exact />
              <Route path="/send/confirm" component={SendConfirm} exact />
              <Route path="/sign" component={SignAndSend} exact />
              <Route path="/signPsbt" component={SignPSBT} exact />
              <Route path="/create" component={Create} exact />
              <Route
                path="/create/confirm"
                component={CreateTokenConfirm}
                exact
              />
              <Route path="/issueAsset" component={IssueAsset} exact />
              <Route
                path="/issueAsset/confirm"
                component={IssueAssetConfirm}
                exact
              />
              <Route path="/mintNFT" component={MintNFT} exact />
              <Route
                path="/mintNFT/confirm"
                component={MintNFTConfirm}
                exact
              />
              <Route path="/updateAsset" component={UpdateAsset} exact />
              <Route
                path="/updateAsset/confirm"
                component={UpdateAssetConfirm}
                exact
              />
              <Route path="/issueNFT" component={IssueNFT} exact />
              <Route
                path="/issueNFT/confirm"
                component={CreateAndIssueNFTConfirm}
                exact
              />
              <Route
                path="/transferOwnership"
                component={TransferOwnership}
                exact
              />
              <Route
                path="/transferOwnership/confirm"
                component={TransferOwnershipConfirm}
                exact
              />
              <Route path="/send" component={Send} exact />
              <Route
                path="/send/:address"
                render={({ match }: SendMatchProps) => (
                  <Send initAddress={match.params.address} />
                )}
                exact
              />
              <Route path="/receive" component={Receive} exact />
              <Route
                path='/general'
                component={MainView}
                exact
              />
              <Route path="/general-autolock" component={AutolockView} exact />
              <Route path="/general-about" component={AboutView} exact />
              <Route path="/general-phrase" component={PhraseView} exact />
              <Route path="/general-delete" component={DeleteWalletView} exact />
              <Route path="/general-currency" component={CurrencyView} exact />

              <Route
                path='/account'
                component={MainView}
                exact
              />
              <Route
                path='/account-priv'
                render={(props) => (
                  <PrivateKeyView {...props} id='0' />
                )}
                exact
              />
              <Route path="/account-hardware" component={ConnectHardwareWalletView} exact />
              <Route path="/account-newaccount" component={NewAccountView} exact />
              <Route path="/account-details" component={AccountView} exact />

              {canConnect && (
                <>
                  <Route path="/connect-wallet" component={ConnectWallet} exact />

                  {connectedAccounts.length > 0 && (
                    <>
                      <Route
                        path="/connected-accounts"
                        component={ConnectedAccounts}
                        exact
                      />
                    </>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <Route path="/import" component={Import} exact />
            </>
          )}
        </Switch>
      </div>
    </>
  );
};
