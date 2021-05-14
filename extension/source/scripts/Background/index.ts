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

declare global {
  interface Window {
    controller: Readonly<IMasterController>;
    senderURL: string | undefined;
  }
}

if (!window.controller) {
  window.controller = Object.freeze(MasterController());
  setInterval(window.controller.stateUpdater, 3 * 60 * 1000);
}

browser.runtime.onInstalled.addListener((): void => {
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

    const createPopup = async (url: string) => {
      return await browser.windows.create({
        url,
        type: 'popup',
        width: 372,
        height: 600,
        left: 900,
        top: 90
      });
    }

    if (typeof request == 'object') {
      if (type == 'CONNECT_WALLET' && target == 'background') {
        const URL = browser.runtime.getURL('app.html');

        store.dispatch(setSenderURL(sender.url));
        store.dispatch(updateCanConnect(true));

        await createPopup(URL);

        window.senderURL = sender.url;

        return;
      }

      if (type == 'WALLET_UPDATED' && target == 'background') {
        browser.tabs.sendMessage(tabId, {
          type: 'WALLET_UPDATED',
          target: 'contentScript',
          connected: false
        });

        return;
      }

      if (type == 'SUBSCRIBE' && target == 'background') {
        console.log('subscribe ok')

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

        store.dispatch(removeConnection({
          accountId: request.id,
          url: request.url
        }));

        browser.tabs.sendMessage(tabId, {
          type: 'WALLET_UPDATED',
          target: 'contentScript',
          connected: false
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

        browser.tabs.sendMessage(tabId, {
          type: 'WALLET_UPDATED',
          target: 'contentScript',
          connected: false
        });

        return;
      }

      if (type == 'CONFIRM_CONNECTION' && target == 'background') {
        if (window.senderURL == store.getState().wallet.currentURL) {
          store.dispatch(updateCanConnect(false));

          browser.tabs.sendMessage(tabId, {
            type: 'WALLET_UPDATED',
            target: 'contentScript',
            connected: false
          });

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
          type: 'WALLET_UPDATED',
          target: 'contentScript',
          connected: false
        });

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
          return account.connectedTo.find((url) => url === store.getState().wallet.currentURL);
        });

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

        const URL = browser.runtime.getURL('app.html');

        await createPopup(URL);

        browser.tabs.sendMessage(tabId, {
          type: 'SEND_TOKEN',
          target: 'contentScript',
          complete: true
        });

        browser.tabs.sendMessage(tabId, {
          type: 'WALLET_UPDATED',
          target: 'contentScript',
          connected: false
        });
      }   

      if (type == 'CREATE_TOKEN' && target == 'background') {
        const {
          precision,
          symbol,
          maxsupply,
          fee,
          description,
          receiver,
          rbf
        } = request;

        window.controller.wallet.account.createSPT({
          precision,
          symbol,
          maxsupply,
          fee,
          description,
          receiver,
          rbf
        });
        
        store.dispatch(createAsset(true));

        const URL = browser.runtime.getURL('app.html');

        await createPopup(URL);

        browser.tabs.sendMessage(tabId, {
          type: 'CREATE_TOKEN',
          target: 'contentScript',
          complete: true
        });
      }

      if (type == 'ISSUE_SPT' && target == 'background') {
        const {
          assetGuid,
          amount,
          receiver,
          fee,
          rbf
        } = request;

        window.controller.wallet.account.issueSPT({
          assetGuid,
          amount,
          fee,
          receiver,
          rbf
        });

        store.dispatch(issueAsset(true));

        const URL = browser.runtime.getURL('app.html');

        await createPopup(URL);

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
          fee,
          receiver,
          rbf
        } = request;

        window.controller.wallet.account.issueNFT({
          assetGuid,
          nfthash,
          fee,
          receiver,
          rbf
        });

        store.dispatch(issueNFT(true));
        const URL = browser.runtime.getURL('app.html');

        await createPopup(URL);

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

       // if (type == 'GET_USERMINTEDTOKENS' && target == 'background') {

      //   //logica da funcão que ta no script que te passei
      //   tokensMinted = window.controller.wallet.account.getUsermintedTokens()
      //   browser.tabs.sendMessage(tabId, {
      //         type: 'SEND_STATE_TO_PAGE',
      //         target: 'contentScript',even
      //         usertokens:  tokensMinted
    
    
      //       });
      //     }
    }
  });

  browser.runtime.onConnect.addListener((port) => {
    browser.tabs.query({ active: true })
      .then((tabs) => {
        store.dispatch(updateCurrentURL(tabs[0].url));
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