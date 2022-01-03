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
  Start,
  DetailsView
} from 'containers/auth/index';

import {
  AboutView,
  AccountView,
  AutolockView,
  ConnectHardwareWalletView,
  CurrencyView,
  DeleteWalletView,
  NewAccountView,
  PhraseView,
  PrivateKeyView,
  EditNetworkView,
  CustomRPCView,
  ConnectedSitesView,
  TrustedSitesView
} from 'containers/auth/Settings/views';

import {
  Create,
  CreateTokenConfirm,
  UpdateAsset,
  UpdateAssetConfirm,
  TransferOwnership,
  TransferOwnershipConfirm,
  MintNFT,
  MintNFTConfirm,
  SignAndSend,
  SignPSBT,
  MintToken,
  MintTokenConfirm,
  CreateAndIssueNFT,
  CreateAndIssueNFTConfirm
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
    currentURL,
    canConnect,
    temporaryTransactionState
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
      !controller.wallet.account.getTemporaryTransaction('sendAsset') &&
      !temporaryTransactionState.executing && temporaryTransactionState.type !== 'sendAsset'
    ) {
      history.push('/home');

      return;
    }

    if (
      redirectRoute == '/updateAsset/confirm' &&
      !controller.wallet.account.getTemporaryTransaction('updateAsset')
    ) {
      history.push('/home');

      return;
    }

    if (!isUnlocked && accounts.length > 0) {
      history.push('/app.html');

      return;
    }

    if (
      temporaryTransactionState.executing && temporaryTransactionState.type === 'sendAsset' &&
      controller.wallet.account.getTemporaryTransaction('sendAsset') &&
      isUnlocked
    ) {
      history.push('/send/confirm');

      return;
    }

    if (temporaryTransactionState.executing && temporaryTransactionState.type === 'signAndSendPSBT' && isUnlocked) {
      history.push('/sign');

      return;
    }

    if (temporaryTransactionState.executing && temporaryTransactionState.type === 'mintNFT' && isUnlocked) {
      history.push('/mintNFT');

      return;
    }

    if (temporaryTransactionState.executing && temporaryTransactionState.type === 'signPSBT' && isUnlocked) {
      history.push('/signPsbt');

      return;
    }

    if (temporaryTransactionState.executing && temporaryTransactionState.type === 'newAsset' && isUnlocked) {
      history.push('/create');

      return;
    }

    if (temporaryTransactionState.executing && temporaryTransactionState.type === 'mintAsset' && isUnlocked) {
      history.push('/issueAsset');

      return;
    }

    if (temporaryTransactionState.executing && temporaryTransactionState.type === 'newNFT' && isUnlocked) {
      history.push('/issueNFT');

      return;
    }

    if (temporaryTransactionState.executing && temporaryTransactionState.type === 'updateAsset' && isUnlocked) {
      history.push('/updateAsset');

      return;
    }

    if (temporaryTransactionState.executing && temporaryTransactionState.type === 'transferAsset' && isUnlocked) {
      history.push('/transferOwnership');

      return;
    }

    if (
      !temporaryTransactionState.executing && temporaryTransactionState.type !== 'sendAsset' &&
      controller.wallet.account.getTemporaryTransaction('sendAsset')
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

    if (temporaryTransactionState.executing && temporaryTransactionState.type === 'sendAsset' && !canConnect && isUnlocked) {
      history.push('/send/confirm');

      return;
    }

    if (redirectRoute !== '/app.html') {
      history.push(redirectRoute);
    }
  }, [canConnect, isUnlocked]);

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
              <Route path="/home-tx-details" component={DetailsView} exact />
              <Route path="/send/confirm" component={SendConfirm} exact />
              <Route path="/sign" component={SignAndSend} exact />
              <Route path="/signPsbt" component={SignPSBT} exact />
              <Route path="/create" component={Create} exact />
              <Route
                path="/create/confirm"
                component={CreateTokenConfirm}
                exact
              />
              <Route path="/issueAsset" component={MintToken} exact />
              <Route
                path="/issueAsset/confirm"
                component={MintTokenConfirm}
                exact
              />
              <Route path="/issueNFT" component={CreateAndIssueNFT} exact />
              <Route
                path="/issueNFT/confirm"
                component={CreateAndIssueNFTConfirm}
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

              <Route path="/general-autolock" component={AutolockView} exact />
              <Route path="/general-about" component={AboutView} exact />
              <Route path="/general-phrase" component={PhraseView} exact />
              <Route path="/general-delete" component={DeleteWalletView} exact />
              <Route path="/general-currency" component={CurrencyView} exact />

              <Route
                path='/account-priv'
                component={PrivateKeyView}
                exact
              />
              <Route path="/account-hardware" component={ConnectHardwareWalletView} exact />
              <Route path="/account-newaccount" component={NewAccountView} exact />
              <Route path="/account-details" component={AccountView} exact />

              <Route path="/networks-edit" component={EditNetworkView} exact />
              <Route path="/networks-custom" component={CustomRPCView} exact />
              <Route path="/networks-sites" component={ConnectedSitesView} exact />
              <Route path="/networks-trusted" component={TrustedSitesView} exact />

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
