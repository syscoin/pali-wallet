/* eslint-disable prettier/prettier */
import 'emoji-log';
import { STORE_PORT } from 'constants/index';

import { browser } from 'webextension-polyfill-ts';
import { wrapStore } from 'webext-redux';
import store from 'state/store';
import {
  setSenderURL,
  updateCanConnect,
  updateCurrentURL,
  updateConnectionsArray,
  removeConnection,
  updateCanConfirmTransaction,
  createAsset,
  issueAsset,
  issueNFT,
  setUpdateAsset,
  setTransferOwnership,
  clearAllTransactions,
  signTransactionState,
  signPSBTState
} from 'state/wallet';
import { IAccountState } from 'state/wallet/types';

import MasterController, { IMasterController } from './controllers';
import { getHost } from './helpers';

declare global {
  interface Window {
    controller: Readonly<IMasterController>;
    senderURL: string;
  }
}

if (!window.controller) {
  window.controller = Object.freeze(MasterController());
  setInterval(window.controller.stateUpdater, 3 * 60 * 1000);
}

const getTabs = async (options: any) => {
  return await browser.tabs.query(options);
};

const getConnectedAccountIndex = ({ match }: any) => {
  return store.getState().wallet.accounts.findIndex((account: IAccountState) => {
    return account.connectedTo.find((url: string) => {
      return url === match;
    })
  });
};

const runtimeSendMessageToTabs = async ({ tabId, messageDetails }: any) => {
  return await browser.tabs.sendMessage(Number(tabId), messageDetails);
}

const updateActiveWindow = async ({ windowId, options }: any) => {
  return await browser.windows.update(Number(windowId), options);
}

const observeStore = async (store: any) => {
  let currentState: any;

  const handleChange = async () => {
    const nextState = store.getState();

    if (nextState !== currentState) {
      currentState = nextState;

      const tabs: any = await getTabs({ active: true, windowType: 'normal' });

      for (const tab of tabs) {
        if (tab) {
          if (getConnectedAccountIndex({ match: new URL(String(tab.url)).host }) >= 0) {
            try {
              await runtimeSendMessageToTabs({
                tabId: Number(tab.id),
                messageDetails: {
                  type: 'WALLET_UPDATED',
                  target: 'contentScript',
                  connected: false
                }
              });

              console.log('wallet update sent to the webpage')
            } catch (error) {
              console.log('error', error);
            }
          }
        }
      }
    }
  }

  const unsubscribe = store.subscribe(handleChange);

  await handleChange();

  return unsubscribe;
};

observeStore(store);

const createPopup = async (url: string) => {
  const [tab]: any = await getTabs({ active: true, lastFocusedWindow: true });

  if (tab.title === 'Pali Wallet') {
    return;
  }

  store.dispatch(updateCurrentURL(String(tab.url)));

  const [sysWalletPopup]: any = await getTabs({ url: browser.extension.getURL('app.html') });

  if (sysWalletPopup) {
    await updateActiveWindow({
      windowId: Number(sysWalletPopup.windowId),
      options: {
        drawAttention: true,
        focused: true
      }
    });

    return;
  }

  const sysPopup: any = window.open(url, "Pali Wallet", "width=372, height=600, left=900, top=90");

  sysPopup.onbeforeunload = () => {
    store.dispatch(clearAllTransactions());
  }
};

browser.runtime.onInstalled.addListener(async () => {
  console.emoji('🤩', 'Syscoin extension installed');

  window.controller.stateUpdater();


  browser.runtime.onMessage.addListener(async (request, sender) => {
    const {
      type,
      target
    } = request;

    let tabId: any;

    const tabs = await getTabs({});

    const [tab]: any = await getTabs({ active: true, windowType: 'normal' });

    if (tab) {
      if (getConnectedAccountIndex({ match: new URL(String(tab.url)).host }) >= 0) {
        tabId = tab.id;
      }
    }

    if (typeof request === 'object') {
      if (type == 'CONNECT_WALLET' && target == 'background') {  // OK
        const url = browser.runtime.getURL('app.html');

        store.dispatch(setSenderURL(String(sender.url)));
        store.dispatch(updateCanConnect(true));

        await createPopup(url);

        window.senderURL = String(sender.url);

        return;
      }

      if (type == 'WALLET_ERROR' && target == 'background') {
        const {
          transactionError,
          invalidParams,
          message
        } = request;

        runtimeSendMessageToTabs({ tabId, messageDetails: { type: 'WALLET_ERROR', target: 'contentScript', transactionError, invalidParams, message } });
      }

      if (type == 'TRANSACTION_RESPONSE' && target == 'background') {
        console.log('response transaction', request, tabId)

        runtimeSendMessageToTabs({ tabId, messageDetails: { type: 'TRANSACTION_RESPONSE', target: 'contentScript', response: request.response } });

        const interval = setInterval(async () => {
          if (request.response.txid) {
            const data = await window.controller.wallet.account.getTransactionInfoByTxId(request.response.txid);

            console.log('updating tokens state using txid: ', request.response.txid)
  
            if (data.confirmations > 0) {
              console.log('confirmations > 0')
  
              window.controller.wallet.account.updateTokensState().then(() => {
                console.log('update tokens after transaction in background');
                
                window.controller.wallet.account.setHDSigner(store.getState().wallet.activeAccountId);
              });
  
              clearInterval(interval);
            }
          }
        }, 6000);
      }

      if (type == 'RESET_CONNECTION_INFO' && target == 'background') {
        const { id, url } = request;

        store.dispatch(updateCanConnect(false));
        store.dispatch(removeConnection({ accountId: id, url }));
        store.dispatch(setSenderURL(''));

        browser.tabs.query({ url })
          .then((tabs) => {
            if (tabs) {
              tabs.map((tab: any) => {
                Promise.resolve(browser.tabs.sendMessage(Number(tab.id), {
                  type: 'WALLET_UPDATED',
                  target: 'contentScript',
                  connected: false
                }).then(() => {
                  console.log('wallet updated')
                }).catch(() => {
                  console.log('extension context invalidated in other tabs with the same url, you need to refresh the tab')
                }))
              })
            }
          }).catch((error) => {
            console.log('error getting tabs', error);
          });

        return;
      }

      if (type == 'SELECT_ACCOUNT' && target == 'background') {
        store.dispatch(updateConnectionsArray({
          accountId: request.id,
          url: window.senderURL
        }));

        return;
      }

      if (type == 'CHANGE_CONNECTED_ACCOUNT' && target == 'background') {
        store.dispatch(updateConnectionsArray({
          accountId: request.id,
          url: window.senderURL
        }));

        return;
      }

      if (type == 'CONFIRM_CONNECTION' && target == 'background') {
        if (getHost(window.senderURL)) {
          store.dispatch(updateCanConnect(false));

          for (let tab of tabs) {
            browser.tabs.sendMessage(Number(tab.id), {
              type: 'WALLET_CONNECTION_CONFIRMED',
              target: 'contentScript',
              connectionConfirmed: true,
              state: store.getState().wallet
            }).then(() => {
              console.log('wallet connection confirmed')
            }).catch((error) => {
              console.log('error confirming connection', error);
            });
          }
        }

        return;
      }

      if (type == 'CANCEL_TRANSACTION' && target == 'background') {
        const { item } = request;

        store.dispatch(clearAllTransactions());

        window.controller.wallet.account.clearTransactionItem(item);

        return;
      }

      if (type == 'CLOSE_POPUP' && target == 'background') {
        store.dispatch(updateCanConnect(false));
        store.dispatch(clearAllTransactions());

        browser.tabs.query({ active: true })
          .then(async (tabs) => {
            tabs.map(async (tab) => {
              if (tab.title === 'Pali Wallet') {
                await browser.windows.remove(Number(tab.windowId));
              }
            });
          })
          .catch((error) => {
            console.log('error removing window', error);
          });;

        return;
      }

      if (type == 'SEND_STATE_TO_PAGE' && target == 'background') {
        browser.tabs.sendMessage(Number(sender.tab?.id), {
          type: 'SEND_STATE_TO_PAGE',
          target: 'contentScript',
          state: store.getState().wallet
        });
      }

      if (type == 'CHECK_IS_LOCKED' && target == 'background') {
        const isLocked = window.controller.wallet.isLocked();

        browser.tabs.sendMessage(Number(sender.tab?.id), {
          type: 'CHECK_IS_LOCKED',
          target: 'contentScript',
          isLocked
        });
      }

      if (type == 'SEND_CONNECTED_ACCOUNT' && target == 'background') {
        const connectedAccount : any = store.getState().wallet.accounts.find((account: IAccountState) => {
          return account.connectedTo.find((url) => {
            return url === getHost(store.getState().wallet.currentURL)
          });
        });
        let copyConnectedAccount:any = undefined
        if(connectedAccount !== undefined && connectedAccount !== null){
          console.log('checking connected account')
          console.log(connectedAccount)
          copyConnectedAccount ={
            address: connectedAccount.address,
            balance: connectedAccount.balance,
            assets: connectedAccount.assets,
            connectedTo: connectedAccount.connectedTo,
            id: connectedAccount.id,
            isTrezorWallet: connectedAccount.isTrezorWallet,
            label: connectedAccount.label,
            transactions: connectedAccount.transactions,
            xpub: connectedAccount.xpub
          }
      }
        // delete connectedAccount.xprv;

        browser.tabs.sendMessage(Number(sender.tab?.id), {
          type: 'SEND_CONNECTED_ACCOUNT',
          target: 'contentScript',
          copyConnectedAccount
        });
      }

      if (type == 'CONNECTED_ACCOUNT_XPUB' && target == 'background') {
        browser.tabs.sendMessage(Number(sender.tab?.id), {
          type: 'CONNECTED_ACCOUNT_XPUB',
          target: 'contentScript',
          connectedAccountXpub: window.controller.wallet.account.getConnectedAccountXpub()
        });
      }

      if (type == 'CONNECTED_ACCOUNT_CHANGE_ADDRESS' && target == 'background') {
        browser.tabs.sendMessage(Number(sender.tab?.id), {
          type: 'CONNECTED_ACCOUNT_CHANGE_ADDRESS',
          target: 'contentScript',
          connectedAccountChangeAddress: await window.controller.wallet.account.getChangeAddress()
        });
      }

      if (type == 'CHECK_ADDRESS' && target == 'background') {
        const isValidSYSAddress = window.controller.wallet.account.isValidSYSAddress(request.messageData, store.getState().wallet.activeNetwork);

        browser.tabs.sendMessage(Number(sender.tab?.id), {
          type: 'CHECK_ADDRESS',
          target: 'contentScript',
          isValidSYSAddress
        });
      }

      if (type == 'SIGN_TRANSACTION' && target == 'background') {
        const { messageData } = request;

        window.controller.wallet.account.setCurrentPSBT(messageData);

        store.dispatch(signTransactionState(true));

        const appURL = browser.runtime.getURL('app.html');

        await createPopup(appURL);

        browser.tabs.sendMessage(Number(sender.tab?.id), {
          type: 'SIGN_TRANSACTION',
          target: 'contentScript',
          complete: true
        });
      }

      if (type == 'SIGN_PSBT' && target == 'background') {
        const { messageData } = request;

        window.controller.wallet.account.setCurrentPsbtToSign(messageData);

        store.dispatch(signPSBTState(true));

        const appURL = browser.runtime.getURL('app.html');

        await createPopup(appURL);

        browser.tabs.sendMessage(Number(sender.tab?.id), {
          type: 'SIGN_PSBT',
          target: 'contentScript',
          complete: true
        });
      }

      if (type == 'GET_HOLDINGS_DATA' && target == 'background') {
        const holdingsData = await window.controller.wallet.account.getHoldingsData();

        browser.tabs.sendMessage(Number(sender.tab?.id), {
          type: 'GET_HOLDINGS_DATA',
          target: 'contentScript',
          holdingsData
        });

      }

      if (type == 'SEND_TOKEN' && target == 'background') {
        const {
          fromConnectedAccount,
          toAddress,
          amount,
          fee,
          token,
          isToken,
          rbf
        } = request.messageData;

        window.controller.wallet.account.updateTempTx({
          fromAddress: fromConnectedAccount,
          toAddress,
          amount,
          fee,
          token,
          isToken,
          rbf
        });

        store.dispatch(updateCanConfirmTransaction(true));

        const appURL = browser.runtime.getURL('app.html');

        await createPopup(appURL);

        browser.tabs.sendMessage(Number(sender.tab?.id), {
          type: 'SEND_TOKEN',
          target: 'contentScript',
          complete: true
        });
      }

      if (type == 'DATA_FROM_PAGE_TO_CREATE_TOKEN' && target == 'background') {
        const {
          precision,
          symbol,
          maxsupply,
          description,
          receiver,
          initialSupply,
          capabilityflags,
          notarydetails,
          auxfeedetails,
          notaryAddress,
          payoutAddress
        } = request.messageData;

        if (precision < 0 || precision > 8) {
          throw new Error('invalid precision value');
        }

        if (maxsupply < 0) {
          throw new Error('invalid max supply value');
        }

        if (initialSupply < 0) {
          throw new Error('invalid initial supply value');
        }

        if (!window.controller.wallet.account.isValidSYSAddress(receiver, store.getState().wallet.activeNetwork)) {
          throw new Error('invalid receiver address');
        }

        window.controller.wallet.account.setDataFromPageToCreateNewSPT({
          precision,
          symbol,
          maxsupply,
          description,
          receiver,
          initialSupply,
          capabilityflags,
          notarydetails,
          auxfeedetails,
          notaryAddress,
          payoutAddress
        });

        store.dispatch(createAsset(true));

        const appURL = browser.runtime.getURL('app.html');

        await createPopup(appURL);

        browser.tabs.sendMessage(Number(sender.tab?.id), {
          type: 'DATA_FROM_PAGE_TO_CREATE_TOKEN',
          target: 'contentScript',
          complete: true
        });
      }

      if (type == 'DATA_FROM_WALLET_TO_CREATE_TOKEN' && target == 'background') {
        window.controller.wallet.account.createSPT({
          ...window.controller.wallet.account.getDataFromPageToInitTransaction().dataFromPageToCreateSPT,
          ...window.controller.wallet.account.getDataFromPageToInitTransaction().dataFromWalletToCreateSPT
        });
      }

      if (type == 'ISSUE_SPT' && target == 'background') {
        const {
          amount,
          assetGuid
        } = request.messageData;

        const assetFromAssetGuid = window.controller.wallet.account.getDataAsset(assetGuid);

        if (amount < 0 || amount >= assetFromAssetGuid.balance) {
          throw new Error('invalid amount value');
        }

        window.controller.wallet.account.setDataFromPageToMintSPT({
          assetGuid,
          amount: Number(amount)
        });

        console.log('sending data asset', amount, assetGuid)

        store.dispatch(issueAsset(true));

        const appURL = browser.runtime.getURL('app.html');

        await createPopup(appURL);

        browser.tabs.sendMessage(Number(sender.tab?.id), {
          type: 'ISSUE_SPT',
          target: 'contentScript',
          complete: true
        });
      }

      if (type == 'DATA_FROM_WALLET_TO_MINT_TOKEN' && target == 'background') {
        window.controller.wallet.account.issueSPT({
          ...window.controller.wallet.account.getDataFromPageToInitTransaction().dataFromPageToMintSPT,
          ...window.controller.wallet.account.getDataFromPageToInitTransaction().dataFromWalletToMintSPT
        });
      }

      if (type == 'CREATE_AND_ISSUE_NFT' && target == 'background') {
        const {
          symbol,
          issuer,
          precision,
          description,
          notarydetails,
          auxfeedetails,
          notaryAddress,
          payoutAddress,
        } = request.messageData;

        if (precision < 0 || precision > 8) {
          throw new Error('invalid total shares value');
        }

        if (!window.controller.wallet.account.isValidSYSAddress(issuer, store.getState().wallet.activeNetwork)) {
          throw new Error('invalid receiver address');
        }

        window.controller.wallet.account.setDataFromPageToMintNFT({
          symbol,
          issuer,
          precision,
          description,
          notarydetails,
          auxfeedetails,
          notaryAddress,
          payoutAddress,
        });

        store.dispatch(issueNFT(true));

        const appURL = browser.runtime.getURL('app.html');

        await createPopup(appURL);

        browser.tabs.sendMessage(Number(sender.tab?.id), {
          type: 'CREATE_AND_ISSUE_NFT',
          target: 'contentScript',
          complete: true
        });
      }

      if (type == 'DATA_FROM_WALLET_TO_MINT_NFT' && target == 'background') {
        window.controller.wallet.account.issueNFT({
          ...window.controller.wallet.account.getDataFromPageToInitTransaction().dataFromPageToMintNFT,
          ...window.controller.wallet.account.getDataFromPageToInitTransaction().dataFromWalletToMintNFT
        });
      }

      if (type == 'UPDATE_ASSET' && target == 'background') {
        const {
          assetGuid,
          contract,
          capabilityflags,
          description,
          notarydetails,
          auxfeedetails,
          notaryAddress,
          payoutAddress
        } = request.messageData;

        window.controller.wallet.account.setDataFromPageToUpdateAsset({
          assetGuid,
          contract,
          capabilityflags,
          description,
          notarydetails,
          auxfeedetails,
          notaryAddress,
          payoutAddress
        });

        store.dispatch(setUpdateAsset(true));

        const appURL = browser.runtime.getURL('app.html');

        await createPopup(appURL);

        browser.tabs.sendMessage(Number(sender.tab?.id), {
          type: 'UPDATE_ASSET',
          target: 'contentScript',
          complete: true
        });
      }

      if (type == 'DATA_FROM_WALLET_TO_UPDATE_TOKEN' && target == 'background') {
        window.controller.wallet.account.setUpdateAsset({
          ...window.controller.wallet.account.getDataFromPageToInitTransaction().dataFromPageToUpdateAsset,
          ...window.controller.wallet.account.getDataFromPageToInitTransaction().dataFromWalletToUpdateAsset
        });
      }

      if (type == 'TRANSFER_OWNERSHIP' && target == 'background') {
        const {
          assetGuid,
          newOwner
        } = request.messageData;

        if (!window.controller.wallet.account.isValidSYSAddress(newOwner, store.getState().wallet.activeNetwork)) {
          throw new Error('invalid new owner address');
        }

        window.controller.wallet.account.setDataFromPageToTransferOwnership({
          assetGuid,
          newOwner
        });

        store.dispatch(setTransferOwnership(true));

        const appURL = browser.runtime.getURL('app.html');

        await createPopup(appURL);

        browser.tabs.sendMessage(Number(sender.tab?.id), {
          type: 'TRANSFER_OWNERSHIP',
          target: 'contentScript',
          complete: true
        });
      }

      if (type == 'DATA_FROM_WALLET_TO_TRANSFER_OWNERSHIP' && target == 'background') {
        window.controller.wallet.account.setNewOwnership({
          ...window.controller.wallet.account.getDataFromPageToInitTransaction().dataFromPageToTransferOwnership,
          ...window.controller.wallet.account.getDataFromPageToInitTransaction().dataFromWalletToTransferOwnership
        });
      }

      if (type == 'GET_USER_MINTED_TOKENS' && target == 'background') {
        const tokensMinted = await window.controller.wallet.account.getUserMintedTokens();

        browser.tabs.sendMessage(Number(sender.tab?.id), {
          type: 'GET_USER_MINTED_TOKENS',
          target: 'contentScript',
          userTokens: tokensMinted
        });
      }

      if (type == 'GET_ASSET_DATA' && target == 'background') {
        const assetData = await window.controller.wallet.account.getDataAsset(request.messageData);

        browser.tabs.sendMessage(Number(sender.tab?.id), {
          type: 'GET_ASSET_DATA',
          target: 'contentScript',
          assetData
        });
      }
    }
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name == 'trezor-connect') {
      return;
    }

    // browser.tabs.onActivated.addListener((info) => {
    //   console.log('info tab', info)

    //   if (info.tabId > -1 && info.windowId > -1) {
    //     browser.tabs.query({ active: true, currentWindow: true, windowType: 'normal' }).then((tabs: any) => {
    //       store.dispatch(updateCurrentURL(String(tabs[0].url)));

    //       browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    //         console.log('tabid', tabId, changeInfo, tab)
    //         store.dispatch(updateCurrentURL(String(tabs[0].url)));
    //       })

    //       console.log('tabs query', tabs)
    //     })
    //   }
    // })

    browser.tabs.query({ active: true, lastFocusedWindow: true })
      .then((tabs) => {
        if (tabs[0].title === 'Pali Wallet') {
          return;
        }

        store.dispatch(updateCurrentURL(String(tabs[0].url)));
      });
  });
});

wrapStore(store, { portName: STORE_PORT });

// used only for development mode to automatically reload the extension when starting the browser
// remove this in production

chrome.runtime.onStartup.addListener(() => {
  chrome.runtime.reload();
})
