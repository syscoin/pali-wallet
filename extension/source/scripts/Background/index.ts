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
 
} from 'state/wallet';

import MasterController, { IMasterController } from './controllers';
import { IAccountState } from 'state/wallet/types';
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

const observeStore = async (store: any) => {
  let currentState: any;

  const handleChange = async () => {
    let nextState = store.getState();

    console.log('next state', nextState)

    // return new Promise(async (resolve) => {
      if (nextState !== currentState) {
        currentState = nextState;

        const tabs = await browser.tabs.query({
          active: true,
          windowType: 'normal'
        });

        console.log('current state', currentState)
        // resolve('ok state is ok');

          browser.tabs.query({ active: true, windowType: 'normal' })
          .then((tabs) => {
            console.log('tabs', tabs, tabs[0])
            
            const isAccountConnected = store.getState().wallet.accounts.findIndex((account: IAccountState) => {
              return account.connectedTo.find((url: string) => {
                return url === new URL(`${tabs[0].url}`).host;
              })
            }) >= 0;

            console.log('is account', isAccountConnected)

            if (isAccountConnected) {
              browser.tabs.sendMessage(Number(tabs[0].id), {
                type: 'WALLET_UPDATED',
                target: 'contentScript',
                connected: false
              }).then((response) => {
                console.log('wallet updated', response)
              })
            }
          });

        return;
      }
    // });
  }

  let unsubscribe = store.subscribe(handleChange);

  handleChange().then(() => {
    console.log('handle change ok')
  });

  return unsubscribe;
}

observeStore(store).then(() => {
  console.log('observe store ok')
});

browser.runtime.onInstalled.addListener(async () => {
  console.emoji('🤩', 'Syscoin extension installed');

  window.controller.stateUpdater();

  browser.runtime.onMessage.addListener(async (request, sender) => {
    const {
      type,
      target
    } = request;

    const tabs = await browser.tabs.query({
      active: true,
      windowType: 'normal'
    });

    const tabId = Number(tabs[0].id);
    let createTokenFee: number = 0.00001;
    let mintSPTFee: number = 0.00001;
    let mintNFTFee: number = 0.00001;
    let rbfCreateToken: boolean = false;
    let rbfMintSPT: boolean = false;
    let rbfMintNFT: boolean = false;

    const createPopup = async (url: string) => {
      const allWindows = await browser.windows.getAll({
        windowTypes: ['popup']
      });

      if (allWindows[0]) {
        await browser.windows.update(Number(allWindows[0].id), {
          drawAttention: true,
          focused: true
        });

        return;
      }

      await browser.windows.create({
        url,
        type: 'popup',
        width: 372,
        height: 600,
        left: 900,
        top: 90
      });
    };

    if (typeof request == 'object') {
      if (type == 'CONNECT_WALLET' && target == 'background') {
        const url = browser.runtime.getURL('app.html');

        store.dispatch(setSenderURL(getHost(`${sender.url}`)));
        store.dispatch(updateCanConnect(true));

        await createPopup(url);

        window.senderURL = getHost(`${sender.url}`);

        console.log('wndow sender ur', window.senderURL)

        return;
      }

      if (type == 'ISSUE_ASSETGUID' && target == 'background') {
        
        browser.tabs.sendMessage(tabId, {
          type: 'ISSUE_ASSETGUID',
          target: 'contentScript',
          eventResult: 'complete'
        });
      }

      if (type == 'RESET_CONNECTION_INFO' && target == 'background') {
        store.dispatch(setSenderURL(''));
        store.dispatch(updateCanConnect(false));

        console.log('remove connection url', request.url, getHost(request.url))

        store.dispatch(removeConnection({
          accountId: request.id,
          url: getHost(request.url)
        }));

        Promise.resolve(browser.tabs.sendMessage(Number(tabs[0].id), {
          type: 'WALLET_UPDATED',
          target: 'contentScript',
          connected: false
        }).then((response) => {
          console.log('wallet updated', response)
        }))

        return;
      }

      if (type == 'SELECT_ACCOUNT' && target == 'background') {
        console.log('sender url', window.senderURL);

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
        if (window.senderURL == getHost(store.getState().wallet.currentURL)) {
          store.dispatch(updateCanConnect(false));
          
          return;
        }

        return;
      }

      if (type == 'CANCEL_TRANSACTION' && target == 'background') {
        store.dispatch(updateCanConfirmTransaction(false));
        store.dispatch(createAsset(false));
        store.dispatch(issueAsset(false));
        store.dispatch(issueNFT(false));

        return;
      }

      if (type == 'CLOSE_POPUP' && target == 'background') {
        store.dispatch(updateCanConnect(false));
        store.dispatch(updateCanConfirmTransaction(false));
        store.dispatch(createAsset(false));
        store.dispatch(issueAsset(false));
        store.dispatch(issueNFT(false));

        browser.tabs.sendMessage(tabId, {
          type: 'DISCONNECT',
          target: 'contentScript'
        });

        return;
      }

      if (type == 'SEND_STATE_TO_PAGE' && target == 'background') {
        browser.tabs.sendMessage(tabId, {
          type: 'SEND_STATE_TO_PAGE',
          target: 'contentScript',
          state: store.getState().wallet
        });
      }

      if (type == 'SEND_CONNECTED_ACCOUNT' && target == 'background') {
        const connectedAccount = store.getState().wallet.accounts.find((account: IAccountState) => {
          return account.connectedTo.find((url) => {
            console.log(url === getHost(store.getState().wallet.currentURL))
            return url === getHost(store.getState().wallet.currentURL)
          });
        });

        console.log('connected account', connectedAccount)

        browser.tabs.sendMessage(tabId, {
          type: 'SEND_CONNECTED_ACCOUNT',
          target: 'contentScript',
          connectedAccount
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
        } = request;

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

        browser.tabs.sendMessage(tabId, {
          type: 'SEND_TOKEN',
          target: 'contentScript',
          complete: true
        });
      }

      if (type == 'SEND_FEE_TO_CREATE_TOKEN' && target == 'background') {
        console.log('create token fee before', createTokenFee)
        createTokenFee = request.createTokenFee;
        console.log('create token fee after', createTokenFee)
      }

      if (type == 'SEND_FEE_TO_MINT_SPT' && target == 'background') {
        console.log('mint token fee before', mintSPTFee)
        mintSPTFee = request.mintSPTFee;
        console.log('mint token fee after', mintSPTFee)
      }

      if (type == 'SEND_FEE_TO_MINT_NFT' && target == 'background') {
        console.log('mint token fee before', mintNFTFee)
        mintNFTFee = request.mintNFTFee;
        console.log('mint token fee after', mintNFTFee)
      }

      if (type == 'RBF_TO_CREATE_TOKEN' && target == 'background') {
        console.log('create token rbf before', rbfCreateToken)
        rbfCreateToken = request.rbfCreateToken;
        console.log('create token rbf after', rbfCreateToken)
      }

      if (type == 'RBF_TO_MINT_SPT' && target == 'background') {
        console.log('mint token rbf before', rbfMintSPT)
        rbfMintSPT = request.rbfMintSPT;
        console.log('mint token rbf after', rbfMintSPT)
      }

      if (type == 'RBF_TO_MINT_NFT' && target == 'background') {
        console.log('mint nft rbf before', rbfMintNFT)
        rbfMintNFT = request.rbfMintNFT;
        console.log('mint nft rbf after', rbfMintNFT)
      }

      if (type == 'CREATE_TOKEN' && target == 'background') {
        const {
          precision,
          symbol,
          maxsupply,
          description,
          receiver,
        } = request;

        console.log('create token fee', createTokenFee)

        window.controller.wallet.account.createSPT({
          precision,
          symbol,
          maxsupply,
          fee: createTokenFee,
          description,
          receiver,
          rbf: rbfCreateToken
        });

        store.dispatch(createAsset(true));

        const appURL = browser.runtime.getURL('app.html');

        await createPopup(appURL);

        browser.tabs.sendMessage(tabId, {
          type: 'CREATE_TOKEN',
          target: 'contentScript',
          complete: true
        });
      }

      if (type == 'ISSUE_SPT' && target == 'background') {
        const {
          amount,
          receiver,
          assetGuid
        } = request;

        console.log('reqiest mint spt', request)

        window.controller.wallet.account.issueSPT({
          assetGuid: assetGuid,
          amount: Number(amount),
          fee: mintSPTFee,
          receiver: receiver,
          rbf: rbfMintSPT
        });

        store.dispatch(issueAsset(true));

        const appURL = browser.runtime.getURL('app.html');

        await createPopup(appURL);

        browser.tabs.sendMessage(tabId, {
          type: 'ISSUE_SPT',
          target: 'contentScript',
          complete: true
        });
      }

      if (type == 'ISSUE_NFT' && target == 'background') {
        const {
          assetGuid,
          nfthash,
          receiver,
        } = request;

        window.controller.wallet.account.issueNFT({
          assetGuid,
          nfthash,
          fee: mintNFTFee,
          receiver,
          rbf: rbfMintSPT
        });

        store.dispatch(issueNFT(true));

        const appURL = browser.runtime.getURL('app.html');

        await createPopup(appURL);

        browser.tabs.sendMessage(tabId, {
          type: 'ISSUE_NFT',
          target: 'contentScript',
          complete: true
        });
      }

      // receive message sent by contentScript using browser.runtime.sendMessage
      if (type == 'CREATE_COLLECTION' && target == 'background') {
        const {
          collectionName,
          description,
          sysAddress,
          symbol,
          property1,
          property2,
          property3,
          attribute1,
          attribute2,
          attribute3
        } = request;

        // example of how you can use the arguments
        window.controller.wallet.account.createCollection(collectionName, description, sysAddress, symbol, property1, property2, property3, attribute1, attribute2, attribute3)
        
        // to use this arguments at frontend you can create a function as 'getCollection' in accountController and call it in the react component

        // you can use these data to call a function as in the SEND_TOKEN if or the ISSUE_SPT, you call a function using the arguments in the message request item, here lets just check if that everything is ok and send the 'createCollection' as a response

        const createCollection: string = 'create collection is working';

        console.log('[background]: data from createCollection', collectionName, description, sysAddress, symbol, property1, property2, property3, attribute1, attribute2, attribute3)

        // if everything is fine, you should see the result in the console of the page (createCollection)

        // send message to contentScript after calling the function needed to say it worked (and send the result, in this case we will call createCollection)
        browser.tabs.sendMessage(tabId, {
          type: 'CREATE_COLLECTION',
          target: 'contentScript',
          createCollection
        });
      }

      if (type == 'GET_USERMINTEDTOKENS' && target == 'background') {
        console.log('tokens minted get user minted tokens url state', store.getState().wallet.blockbookURL)

        const tokensMinted = await window.controller.wallet.account.getUserMintedTokens();

        console.log('tokens minted', tokensMinted)

        browser.tabs.sendMessage(tabId, {
          type: 'GET_USERMINTEDTOKENS',
          target: 'contentScript',
          userTokens: tokensMinted
        });
      }
    }
  });

  browser.runtime.onConnect.addListener((port) => {
    browser.tabs.query({ active: true })
      .then((tabs) => {
        store.dispatch(updateCurrentURL(`${tabs[0].url}`));
      });

    port.onDisconnect.addListener(async () => {
      store.dispatch(updateCanConnect(false));
      store.dispatch(updateCanConfirmTransaction(false));
      store.dispatch(createAsset(false));

      const all = await browser.windows.getAll();

      if (all.length > 1) {
        const windowId = Number(all[1].id);

        await browser.windows.remove(windowId);
      }
    })
  });
});

wrapStore(store, { portName: STORE_PORT });
