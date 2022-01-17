/******/ (function (modules) {
  // webpackBootstrap
  /******/ // The module cache
  /******/ var installedModules = {};
  /******/
  /******/ // The require function
  /******/ function __webpack_require__(moduleId) {
    /******/
    /******/ // Check if module is in cache
    /******/ if (installedModules[moduleId]) {
      /******/ return installedModules[moduleId].exports;
      /******/
    }
    /******/ // Create a new module (and put it into the cache)
    /******/ var module = (installedModules[moduleId] = {
      /******/ i: moduleId,
      /******/ l: false,
      /******/ exports: {},
      /******/
    });
    /******/
    /******/ // Execute the module function
    /******/ modules[moduleId].call(
      module.exports,
      module,
      module.exports,
      __webpack_require__
    );
    /******/
    /******/ // Flag the module as loaded
    /******/ module.l = true;
    /******/
    /******/ // Return the exports of the module
    /******/ return module.exports;
    /******/
  }
  /******/
  /******/
  /******/ // expose the modules object (__webpack_modules__)
  /******/ __webpack_require__.m = modules;
  /******/
  /******/ // expose the module cache
  /******/ __webpack_require__.c = installedModules;
  /******/
  /******/ // define getter function for harmony exports
  /******/ __webpack_require__.d = function (exports, name, getter) {
    /******/ if (!__webpack_require__.o(exports, name)) {
      /******/ Object.defineProperty(exports, name, {
        enumerable: true,
        get: getter,
      });
      /******/
    }
    /******/
  };
  /******/
  /******/ // define __esModule on exports
  /******/ __webpack_require__.r = function (exports) {
    /******/ if (typeof Symbol !== 'undefined' && Symbol.toStringTag) {
      /******/ Object.defineProperty(exports, Symbol.toStringTag, {
        value: 'Module',
      });
      /******/
    }
    /******/ Object.defineProperty(exports, '__esModule', { value: true });
    /******/
  };
  /******/
  /******/ // create a fake namespace object
  /******/ // mode & 1: value is a module id, require it
  /******/ // mode & 2: merge all properties of value into the ns
  /******/ // mode & 4: return value when already ns object
  /******/ // mode & 8|1: behave like require
  /******/ __webpack_require__.t = function (value, mode) {
    /******/ if (mode & 1) value = __webpack_require__(value);
    /******/ if (mode & 8) return value;
    /******/ if (
      mode & 4 &&
      typeof value === 'object' &&
      value &&
      value.__esModule
    )
      return value;
    /******/ var ns = Object.create(null);
    /******/ __webpack_require__.r(ns);
    /******/ Object.defineProperty(ns, 'default', {
      enumerable: true,
      value: value,
    });
    /******/ if (mode & 2 && typeof value != 'string')
      for (var key in value)
        __webpack_require__.d(
          ns,
          key,
          function (key) {
            return value[key];
          }.bind(null, key)
        );
    /******/ return ns;
    /******/
  };
  /******/
  /******/ // getDefaultExport function for compatibility with non-harmony modules
  /******/ __webpack_require__.n = function (module) {
    /******/ var getter =
      module && module.__esModule
        ? /******/ function getDefault() {
            return module['default'];
          }
        : /******/ function getModuleExports() {
            return module;
          };
    /******/ __webpack_require__.d(getter, 'a', getter);
    /******/ return getter;
    /******/
  };
  /******/
  /******/ // Object.prototype.hasOwnProperty.call
  /******/ __webpack_require__.o = function (object, property) {
    return Object.prototype.hasOwnProperty.call(object, property);
  };
  /******/
  /******/ // __webpack_public_path__
  /******/ __webpack_require__.p = '';
  /******/
  /******/
  /******/ // Load entry module and return exports
  /******/ return __webpack_require__((__webpack_require__.s = 1246));
  /******/
})(
  /************************************************************************/
  /******/ {
    /***/ 1246: /***/ function (
      module,
      __webpack_exports__,
      __webpack_require__
    ) {
      'use strict';
      // ESM COMPAT FLAG
      __webpack_require__.r(__webpack_exports__);

      // EXPORTS
      __webpack_require__.d(
        __webpack_exports__,
        'shouldInjectProvider',
        function () {
          return /* binding */ shouldInjectProvider;
        }
      );

      // EXTERNAL MODULE: ./node_modules/webextension-polyfill-ts/lib/index.js
      var lib = __webpack_require__(21);

      // CONCATENATED MODULE: ./source/scripts/ContentScript/helpers.ts
      const getMessagesToListenTo = (request) => {
        const complete = request.complete,
          connected = request.connected,
          state = request.state,
          copyConnectedAccount = request.copyConnectedAccount,
          userTokens = request.userTokens,
          connectionConfirmed = request.connectionConfirmed,
          isValidSYSAddress = request.isValidSYSAddress,
          holdingsData = request.holdingsData,
          assetData = request.assetData,
          message = request.message,
          response = request.response,
          isLocked = request.isLocked,
          signedTransaction = request.signedTransaction,
          connectedAccountXpub = request.connectedAccountXpub,
          connectedAccountChangeAddress = request.connectedAccountChangeAddress,
          signedPSBT = request.signedPSBT;
        const postMessagesArray = [
          {
            messageType: 'SEND_STATE_TO_PAGE',
            messageTarget: 'contentScript',
            messageNewTarget: 'connectionsController',
            responseItem: 'state',
            messageResponse: state,
          },
          {
            messageType: 'CHECK_IS_LOCKED',
            messageTarget: 'contentScript',
            messageNewTarget: 'connectionsController',
            responseItem: 'isLocked',
            messageResponse: isLocked,
          },
          {
            messageType: 'SEND_CONNECTED_ACCOUNT',
            messageTarget: 'contentScript',
            messageNewTarget: 'connectionsController',
            responseItem: 'copyConnectedAccount',
            messageResponse: copyConnectedAccount,
          },
          {
            messageType: 'CONNECTED_ACCOUNT_XPUB',
            messageTarget: 'contentScript',
            messageNewTarget: 'connectionsController',
            responseItem: 'connectedAccountXpub',
            messageResponse: connectedAccountXpub,
          },
          {
            messageType: 'CONNECTED_ACCOUNT_CHANGE_ADDRESS',
            messageTarget: 'contentScript',
            messageNewTarget: 'connectionsController',
            responseItem: 'connectedAccountChangeAddress',
            messageResponse: connectedAccountChangeAddress,
          },
          {
            messageType: 'CONNECT_WALLET',
            messageTarget: 'contentScript',
            messageNewTarget: 'connectionsController',
            responseItem: 'complete',
            messageResponse: complete,
          },
          {
            messageType: 'WALLET_UPDATED',
            messageTarget: 'contentScript',
            messageNewTarget: 'connectionsController',
            responseItem: 'connected',
            messageResponse: connected,
          },
          {
            messageType: 'WALLET_CONNECTION_CONFIRMED',
            messageTarget: 'contentScript',
            messageNewTarget: 'connectionsController',
            responseItem: 'connectionConfirmed',
            messageResponse: connectionConfirmed,
          },
          {
            messageType: 'CHECK_ADDRESS',
            messageTarget: 'contentScript',
            messageNewTarget: 'connectionsController',
            responseItem: 'isValidSYSAddress',
            messageResponse: isValidSYSAddress,
          },
          {
            messageType: 'SIGN_AND_SEND',
            messageTarget: 'contentScript',
            messageNewTarget: 'connectionsController',
            responseItem: 'signedTransaction',
            messageResponse: signedTransaction,
          },
          {
            messageType: 'SIGN_PSBT',
            messageTarget: 'contentScript',
            messageNewTarget: 'connectionsController',
            responseItem: 'signedPSBT',
            messageResponse: signedPSBT,
          },
          {
            messageType: 'GET_HOLDINGS_DATA',
            messageTarget: 'contentScript',
            messageNewTarget: 'connectionsController',
            responseItem: 'holdingsData',
            messageResponse: holdingsData,
          },
          {
            messageType: 'GET_USER_MINTED_TOKENS',
            messageTarget: 'contentScript',
            messageNewTarget: 'connectionsController',
            responseItem: 'userTokens',
            messageResponse: userTokens,
          },
          {
            messageType: 'WALLET_ERROR',
            messageTarget: 'contentScript',
            messageNewTarget: 'connectionsController',
            responseItem: 'error',
            messageResponse: message,
          },
          {
            messageType: 'TRANSACTION_RESPONSE',
            messageTarget: 'contentScript',
            messageNewTarget: 'connectionsController',
            responseItem: 'response',
            messageResponse: response,
          },
          {
            messageType: 'SEND_TOKEN',
            messageTarget: 'contentScript',
            messageNewTarget: 'connectionsController',
            responseItem: 'complete',
            messageResponse: complete,
          },
          {
            messageType: 'GET_ASSET_DATA',
            messageTarget: 'contentScript',
            messageNewTarget: 'connectionsController',
            responseItem: 'assetData',
            messageResponse: assetData,
          },
        ];
        return postMessagesArray;
      };
      const listenAndSendMessageFromPageToBackground = (event) => {
        const _event$data = event.data,
          fromConnectedAccount = _event$data.fromConnectedAccount,
          toAddress = _event$data.toAddress,
          amount = _event$data.amount,
          fee = _event$data.fee,
          token = _event$data.token,
          isToken = _event$data.isToken,
          rbf = _event$data.rbf,
          precision = _event$data.precision,
          maxsupply = _event$data.maxsupply,
          receiver = _event$data.receiver,
          initialSupply = _event$data.initialSupply,
          symbol = _event$data.symbol,
          issuer = _event$data.issuer,
          contract = _event$data.contract,
          capabilityflags = _event$data.capabilityflags,
          description = _event$data.description,
          notarydetails = _event$data.notarydetails,
          auxfeedetails = _event$data.auxfeedetails,
          notaryAddress = _event$data.notaryAddress,
          payoutAddress = _event$data.payoutAddress,
          assetGuid = _event$data.assetGuid,
          address = _event$data.address,
          newOwner = _event$data.newOwner,
          psbt = _event$data.psbt,
          psbtToSign = _event$data.psbtToSign;
        const sendToken = {
          fromConnectedAccount,
          toAddress,
          amount,
          fee,
          token,
          isToken,
          rbf,
        };
        const dataFromPageToCreateToken = {
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
          payoutAddress,
        };
        const dataFromPageToIssueToken = {
          amount,
          assetGuid,
        };
        const dataFromPageToCreateAndIssueNFT = {
          symbol,
          issuer,
          precision,
          description,
          notarydetails,
          auxfeedetails,
          notaryAddress,
          payoutAddress,
        };
        const dataFromPageToIssueNFT = {
          amount,
          assetGuid,
        };
        const dataFromPageToUpdateAsset = {
          assetGuid,
          contract,
          capabilityflags,
          description,
          notarydetails,
          auxfeedetails,
          notaryAddress,
          payoutAddress,
        };
        const dataFromPageToTransferOwnership = {
          assetGuid,
          newOwner,
        };
        const browserMessagesArray = [
          {
            messageType: 'SEND_TOKEN',
            messageTarget: 'contentScript',
            messageNewTarget: 'background',
            messageData: sendToken,
          },
          {
            messageType: 'DATA_FROM_PAGE_TO_CREATE_TOKEN',
            messageTarget: 'contentScript',
            messageNewTarget: 'background',
            messageData: dataFromPageToCreateToken,
          },
          {
            messageType: 'ISSUE_SPT',
            messageTarget: 'contentScript',
            messageNewTarget: 'background',
            messageData: dataFromPageToIssueToken,
          },
          {
            messageType: 'CREATE_AND_ISSUE_NFT',
            messageTarget: 'contentScript',
            messageNewTarget: 'background',
            messageData: dataFromPageToCreateAndIssueNFT,
          },
          {
            messageType: 'ISSUE_NFT',
            messageTarget: 'contentScript',
            messageNewTarget: 'background',
            messageData: dataFromPageToIssueNFT,
          },
          {
            messageType: 'UPDATE_ASSET',
            messageTarget: 'contentScript',
            messageNewTarget: 'background',
            messageData: dataFromPageToUpdateAsset,
          },
          {
            messageType: 'TRANSFER_OWNERSHIP',
            messageTarget: 'contentScript',
            messageNewTarget: 'background',
            messageData: dataFromPageToTransferOwnership,
          },
          {
            messageType: 'GET_ASSET_DATA',
            messageTarget: 'contentScript',
            messageNewTarget: 'background',
            messageData: assetGuid,
          },
          {
            messageType: 'GET_USER_MINTED_TOKENS',
            messageTarget: 'contentScript',
            messageNewTarget: 'background',
            messageData: null,
          },
          {
            messageType: 'GET_HOLDINGS_DATA',
            messageTarget: 'contentScript',
            messageNewTarget: 'background',
            messageData: null,
          },
          {
            messageType: 'CHECK_ADDRESS',
            messageTarget: 'contentScript',
            messageNewTarget: 'background',
            messageData: address,
          },
          {
            messageType: 'SIGN_AND_SEND',
            messageTarget: 'contentScript',
            messageNewTarget: 'background',
            messageData: psbt,
          },
          {
            messageType: 'SIGN_PSBT',
            messageTarget: 'contentScript',
            messageNewTarget: 'background',
            messageData: psbtToSign,
          },
          {
            messageType: 'SEND_CONNECTED_ACCOUNT',
            messageTarget: 'contentScript',
            messageNewTarget: 'background',
            messageData: null,
          },
          {
            messageType: 'CONNECTED_ACCOUNT_XPUB',
            messageTarget: 'contentScript',
            messageNewTarget: 'background',
            messageData: null,
          },
          {
            messageType: 'CONNECTED_ACCOUNT_CHANGE_ADDRESS',
            messageTarget: 'contentScript',
            messageNewTarget: 'background',
            messageData: null,
          },
          {
            messageType: 'SEND_STATE_TO_PAGE',
            messageTarget: 'contentScript',
            messageNewTarget: 'background',
            messageData: null,
          },
          {
            messageType: 'CHECK_IS_LOCKED',
            messageTarget: 'contentScript',
            messageNewTarget: 'background',
            messageData: null,
          },
          {
            messageType: 'CONNECT_WALLET',
            messageTarget: 'contentScript',
            messageNewTarget: 'background',
            messageData: null,
          },
        ];
        return browserMessagesArray;
      };
      // CONCATENATED MODULE: ./source/scripts/ContentScript/index.ts

      const doctypeCheck = () => {
        const doctype = window.document.doctype;

        if (doctype) {
          return doctype.name === 'html';
        }

        return true;
      };

      const suffixCheck = () => {
        const prohibitedTypes = [/\.xml$/, /\.pdf$/];
        const currentUrl = window.location.pathname;

        for (let i = 0; i < prohibitedTypes.length; i++) {
          if (prohibitedTypes[i].test(currentUrl)) {
            return false;
          }
        }

        return true;
      };

      const documentElementCheck = () => {
        const documentElement = document.documentElement.nodeName;

        if (documentElement) {
          return documentElement.toLowerCase() === 'html';
        }

        return true;
      };

      const blockedDomainCheck = () => {
        const blockedDomains = ['dropbox.com', 'github.com'];
        const currentUrl = window.location.href;
        let currentRegex;

        for (let i = 0; i < blockedDomains.length; i++) {
          const blockedDomain = blockedDomains[i].replace('.', '\\.');
          currentRegex = new RegExp(
            `(?:https?:\\/\\/)(?:(?!${blockedDomain}).)*$`,
            'u'
          );

          if (!currentRegex.test(currentUrl)) {
            return true;
          }
        }

        return false;
      };

      const shouldInjectProvider = () =>
        doctypeCheck() &&
        suffixCheck() &&
        documentElementCheck() &&
        !blockedDomainCheck();

      const injectScript = (content) => {
        try {
          const container = document.head || document.documentElement;
          const scriptTag = document.createElement('script');
          scriptTag.textContent = content;
          container.insertBefore(scriptTag, container.children[0]);
        } catch (error) {
          console.error('Pali Wallet: Provider injection failed.', error);
        }
      };

      const injectScriptFile = (file) => {
        try {
          const container = document.head || document.documentElement;
          const scriptTag = document.createElement('script');
          scriptTag.src = lib['browser'].runtime.getURL(file);
          container.insertBefore(scriptTag, container.children[0]);
        } catch (error) {
          console.error('Pali Wallet: Provider injection failed.', error);
        }
      };

      if (shouldInjectProvider()) {
        injectScript("window.SyscoinWallet = 'Pali Wallet is installed! :)'");
        window.dispatchEvent(
          new CustomEvent('SyscoinStatus', {
            detail: {
              SyscoinInstalled: true,
              ConnectionsController: false,
            },
          })
        );
        injectScriptFile('js/inpage.bundle.js');
        lib['browser'].runtime.sendMessage({
          type: 'RELOAD_DATA',
          target: 'background',
        });
      }

      window.addEventListener(
        'message',
        (event) => {
          const _event$data = event.data,
            type = _event$data.type,
            target = _event$data.target;

          if (event.source !== window) {
            return;
          }

          const browserMessages =
            listenAndSendMessageFromPageToBackground(event);
          browserMessages.map((_ref) => {
            let messageType = _ref.messageType,
              messageTarget = _ref.messageTarget,
              messageNewTarget = _ref.messageNewTarget,
              messageData = _ref.messageData;

            if (type === messageType && target === messageTarget) {
              return lib['browser'].runtime.sendMessage({
                type: messageType,
                target: messageNewTarget,
                messageData,
              });
            }
          });
        },
        false
      );
      lib['browser'].runtime.onMessage.addListener((request) => {
        const type = request.type,
          target = request.target;
        const messages = getMessagesToListenTo(request);
        messages.map((_ref2) => {
          let messageType = _ref2.messageType,
            messageTarget = _ref2.messageTarget,
            messageNewTarget = _ref2.messageNewTarget,
            responseItem = _ref2.responseItem,
            messageResponse = _ref2.messageResponse;

          if (type === messageType && target === messageTarget) {
            return window.postMessage(
              {
                type: messageType,
                target: messageNewTarget,
                [responseItem]: messageResponse,
              },
              '*'
            );
          }
        });
      });

      /***/
    },

    /***/ 190: /***/ function (module, exports, __webpack_require__) {
      var __WEBPACK_AMD_DEFINE_FACTORY__,
        __WEBPACK_AMD_DEFINE_ARRAY__,
        __WEBPACK_AMD_DEFINE_RESULT__;
      (function (global, factory) {
        if (true) {
          !((__WEBPACK_AMD_DEFINE_ARRAY__ = [module]),
          (__WEBPACK_AMD_DEFINE_FACTORY__ = factory),
          (__WEBPACK_AMD_DEFINE_RESULT__ =
            typeof __WEBPACK_AMD_DEFINE_FACTORY__ === 'function'
              ? __WEBPACK_AMD_DEFINE_FACTORY__.apply(
                  exports,
                  __WEBPACK_AMD_DEFINE_ARRAY__
                )
              : __WEBPACK_AMD_DEFINE_FACTORY__),
          __WEBPACK_AMD_DEFINE_RESULT__ !== undefined &&
            (module.exports = __WEBPACK_AMD_DEFINE_RESULT__));
        } else {
          var mod;
        }
      })(
        typeof globalThis !== 'undefined'
          ? globalThis
          : typeof self !== 'undefined'
          ? self
          : this,
        function (module) {
          /* webextension-polyfill - v0.7.0 - Tue Nov 10 2020 20:24:04 */

          /* -*- Mode: indent-tabs-mode: nil; js-indent-level: 2 -*- */

          /* vim: set sts=2 sw=2 et tw=80: */

          /* This Source Code Form is subject to the terms of the Mozilla Public
           * License, v. 2.0. If a copy of the MPL was not distributed with this
           * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
          'use strict';

          if (
            typeof browser === 'undefined' ||
            Object.getPrototypeOf(browser) !== Object.prototype
          ) {
            const CHROME_SEND_MESSAGE_CALLBACK_NO_RESPONSE_MESSAGE =
              'The message port closed before a response was received.';
            const SEND_RESPONSE_DEPRECATION_WARNING =
              'Returning a Promise is the preferred way to send a reply from an onMessage/onMessageExternal listener, as the sendResponse will be removed from the specs (See https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/API/runtime/onMessage)'; // Wrapping the bulk of this polyfill in a one-time-use function is a minor
            // optimization for Firefox. Since Spidermonkey does not fully parse the
            // contents of a function until the first time it's called, and since it will
            // never actually need to be called, this allows the polyfill to be included
            // in Firefox nearly for free.

            const wrapAPIs = (extensionAPIs) => {
              // NOTE: apiMetadata is associated to the content of the api-metadata.json file
              // at build time by replacing the following "include" with the content of the
              // JSON file.
              const apiMetadata = {
                alarms: {
                  clear: {
                    minArgs: 0,
                    maxArgs: 1,
                  },
                  clearAll: {
                    minArgs: 0,
                    maxArgs: 0,
                  },
                  get: {
                    minArgs: 0,
                    maxArgs: 1,
                  },
                  getAll: {
                    minArgs: 0,
                    maxArgs: 0,
                  },
                },
                bookmarks: {
                  create: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  get: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  getChildren: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  getRecent: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  getSubTree: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  getTree: {
                    minArgs: 0,
                    maxArgs: 0,
                  },
                  move: {
                    minArgs: 2,
                    maxArgs: 2,
                  },
                  remove: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  removeTree: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  search: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  update: {
                    minArgs: 2,
                    maxArgs: 2,
                  },
                },
                browserAction: {
                  disable: {
                    minArgs: 0,
                    maxArgs: 1,
                    fallbackToNoCallback: true,
                  },
                  enable: {
                    minArgs: 0,
                    maxArgs: 1,
                    fallbackToNoCallback: true,
                  },
                  getBadgeBackgroundColor: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  getBadgeText: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  getPopup: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  getTitle: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  openPopup: {
                    minArgs: 0,
                    maxArgs: 0,
                  },
                  setBadgeBackgroundColor: {
                    minArgs: 1,
                    maxArgs: 1,
                    fallbackToNoCallback: true,
                  },
                  setBadgeText: {
                    minArgs: 1,
                    maxArgs: 1,
                    fallbackToNoCallback: true,
                  },
                  setIcon: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  setPopup: {
                    minArgs: 1,
                    maxArgs: 1,
                    fallbackToNoCallback: true,
                  },
                  setTitle: {
                    minArgs: 1,
                    maxArgs: 1,
                    fallbackToNoCallback: true,
                  },
                },
                browsingData: {
                  remove: {
                    minArgs: 2,
                    maxArgs: 2,
                  },
                  removeCache: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  removeCookies: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  removeDownloads: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  removeFormData: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  removeHistory: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  removeLocalStorage: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  removePasswords: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  removePluginData: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  settings: {
                    minArgs: 0,
                    maxArgs: 0,
                  },
                },
                commands: {
                  getAll: {
                    minArgs: 0,
                    maxArgs: 0,
                  },
                },
                contextMenus: {
                  remove: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  removeAll: {
                    minArgs: 0,
                    maxArgs: 0,
                  },
                  update: {
                    minArgs: 2,
                    maxArgs: 2,
                  },
                },
                cookies: {
                  get: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  getAll: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  getAllCookieStores: {
                    minArgs: 0,
                    maxArgs: 0,
                  },
                  remove: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  set: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                },
                devtools: {
                  inspectedWindow: {
                    eval: {
                      minArgs: 1,
                      maxArgs: 2,
                      singleCallbackArg: false,
                    },
                  },
                  panels: {
                    create: {
                      minArgs: 3,
                      maxArgs: 3,
                      singleCallbackArg: true,
                    },
                    elements: {
                      createSidebarPane: {
                        minArgs: 1,
                        maxArgs: 1,
                      },
                    },
                  },
                },
                downloads: {
                  cancel: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  download: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  erase: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  getFileIcon: {
                    minArgs: 1,
                    maxArgs: 2,
                  },
                  open: {
                    minArgs: 1,
                    maxArgs: 1,
                    fallbackToNoCallback: true,
                  },
                  pause: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  removeFile: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  resume: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  search: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  show: {
                    minArgs: 1,
                    maxArgs: 1,
                    fallbackToNoCallback: true,
                  },
                },
                extension: {
                  isAllowedFileSchemeAccess: {
                    minArgs: 0,
                    maxArgs: 0,
                  },
                  isAllowedIncognitoAccess: {
                    minArgs: 0,
                    maxArgs: 0,
                  },
                },
                history: {
                  addUrl: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  deleteAll: {
                    minArgs: 0,
                    maxArgs: 0,
                  },
                  deleteRange: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  deleteUrl: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  getVisits: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  search: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                },
                i18n: {
                  detectLanguage: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  getAcceptLanguages: {
                    minArgs: 0,
                    maxArgs: 0,
                  },
                },
                identity: {
                  launchWebAuthFlow: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                },
                idle: {
                  queryState: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                },
                management: {
                  get: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  getAll: {
                    minArgs: 0,
                    maxArgs: 0,
                  },
                  getSelf: {
                    minArgs: 0,
                    maxArgs: 0,
                  },
                  setEnabled: {
                    minArgs: 2,
                    maxArgs: 2,
                  },
                  uninstallSelf: {
                    minArgs: 0,
                    maxArgs: 1,
                  },
                },
                notifications: {
                  clear: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  create: {
                    minArgs: 1,
                    maxArgs: 2,
                  },
                  getAll: {
                    minArgs: 0,
                    maxArgs: 0,
                  },
                  getPermissionLevel: {
                    minArgs: 0,
                    maxArgs: 0,
                  },
                  update: {
                    minArgs: 2,
                    maxArgs: 2,
                  },
                },
                pageAction: {
                  getPopup: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  getTitle: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  hide: {
                    minArgs: 1,
                    maxArgs: 1,
                    fallbackToNoCallback: true,
                  },
                  setIcon: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  setPopup: {
                    minArgs: 1,
                    maxArgs: 1,
                    fallbackToNoCallback: true,
                  },
                  setTitle: {
                    minArgs: 1,
                    maxArgs: 1,
                    fallbackToNoCallback: true,
                  },
                  show: {
                    minArgs: 1,
                    maxArgs: 1,
                    fallbackToNoCallback: true,
                  },
                },
                permissions: {
                  contains: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  getAll: {
                    minArgs: 0,
                    maxArgs: 0,
                  },
                  remove: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  request: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                },
                runtime: {
                  getBackgroundPage: {
                    minArgs: 0,
                    maxArgs: 0,
                  },
                  getPlatformInfo: {
                    minArgs: 0,
                    maxArgs: 0,
                  },
                  openOptionsPage: {
                    minArgs: 0,
                    maxArgs: 0,
                  },
                  requestUpdateCheck: {
                    minArgs: 0,
                    maxArgs: 0,
                  },
                  sendMessage: {
                    minArgs: 1,
                    maxArgs: 3,
                  },
                  sendNativeMessage: {
                    minArgs: 2,
                    maxArgs: 2,
                  },
                  setUninstallURL: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                },
                sessions: {
                  getDevices: {
                    minArgs: 0,
                    maxArgs: 1,
                  },
                  getRecentlyClosed: {
                    minArgs: 0,
                    maxArgs: 1,
                  },
                  restore: {
                    minArgs: 0,
                    maxArgs: 1,
                  },
                },
                storage: {
                  local: {
                    clear: {
                      minArgs: 0,
                      maxArgs: 0,
                    },
                    get: {
                      minArgs: 0,
                      maxArgs: 1,
                    },
                    getBytesInUse: {
                      minArgs: 0,
                      maxArgs: 1,
                    },
                    remove: {
                      minArgs: 1,
                      maxArgs: 1,
                    },
                    set: {
                      minArgs: 1,
                      maxArgs: 1,
                    },
                  },
                  managed: {
                    get: {
                      minArgs: 0,
                      maxArgs: 1,
                    },
                    getBytesInUse: {
                      minArgs: 0,
                      maxArgs: 1,
                    },
                  },
                  sync: {
                    clear: {
                      minArgs: 0,
                      maxArgs: 0,
                    },
                    get: {
                      minArgs: 0,
                      maxArgs: 1,
                    },
                    getBytesInUse: {
                      minArgs: 0,
                      maxArgs: 1,
                    },
                    remove: {
                      minArgs: 1,
                      maxArgs: 1,
                    },
                    set: {
                      minArgs: 1,
                      maxArgs: 1,
                    },
                  },
                },
                tabs: {
                  captureVisibleTab: {
                    minArgs: 0,
                    maxArgs: 2,
                  },
                  create: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  detectLanguage: {
                    minArgs: 0,
                    maxArgs: 1,
                  },
                  discard: {
                    minArgs: 0,
                    maxArgs: 1,
                  },
                  duplicate: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  executeScript: {
                    minArgs: 1,
                    maxArgs: 2,
                  },
                  get: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  getCurrent: {
                    minArgs: 0,
                    maxArgs: 0,
                  },
                  getZoom: {
                    minArgs: 0,
                    maxArgs: 1,
                  },
                  getZoomSettings: {
                    minArgs: 0,
                    maxArgs: 1,
                  },
                  goBack: {
                    minArgs: 0,
                    maxArgs: 1,
                  },
                  goForward: {
                    minArgs: 0,
                    maxArgs: 1,
                  },
                  highlight: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  insertCSS: {
                    minArgs: 1,
                    maxArgs: 2,
                  },
                  move: {
                    minArgs: 2,
                    maxArgs: 2,
                  },
                  query: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  reload: {
                    minArgs: 0,
                    maxArgs: 2,
                  },
                  remove: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  removeCSS: {
                    minArgs: 1,
                    maxArgs: 2,
                  },
                  sendMessage: {
                    minArgs: 2,
                    maxArgs: 3,
                  },
                  setZoom: {
                    minArgs: 1,
                    maxArgs: 2,
                  },
                  setZoomSettings: {
                    minArgs: 1,
                    maxArgs: 2,
                  },
                  update: {
                    minArgs: 1,
                    maxArgs: 2,
                  },
                },
                topSites: {
                  get: {
                    minArgs: 0,
                    maxArgs: 0,
                  },
                },
                webNavigation: {
                  getAllFrames: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  getFrame: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                },
                webRequest: {
                  handlerBehaviorChanged: {
                    minArgs: 0,
                    maxArgs: 0,
                  },
                },
                windows: {
                  create: {
                    minArgs: 0,
                    maxArgs: 1,
                  },
                  get: {
                    minArgs: 1,
                    maxArgs: 2,
                  },
                  getAll: {
                    minArgs: 0,
                    maxArgs: 1,
                  },
                  getCurrent: {
                    minArgs: 0,
                    maxArgs: 1,
                  },
                  getLastFocused: {
                    minArgs: 0,
                    maxArgs: 1,
                  },
                  remove: {
                    minArgs: 1,
                    maxArgs: 1,
                  },
                  update: {
                    minArgs: 2,
                    maxArgs: 2,
                  },
                },
              };

              if (Object.keys(apiMetadata).length === 0) {
                throw new Error(
                  'api-metadata.json has not been included in browser-polyfill'
                );
              }
              /**
               * A WeakMap subclass which creates and stores a value for any key which does
               * not exist when accessed, but behaves exactly as an ordinary WeakMap
               * otherwise.
               *
               * @param {function} createItem
               *        A function which will be called in order to create the value for any
               *        key which does not exist, the first time it is accessed. The
               *        function receives, as its only argument, the key being created.
               */

              class DefaultWeakMap extends WeakMap {
                constructor(createItem, items = undefined) {
                  super(items);
                  this.createItem = createItem;
                }

                get(key) {
                  if (!this.has(key)) {
                    this.set(key, this.createItem(key));
                  }

                  return super.get(key);
                }
              }
              /**
               * Returns true if the given object is an object with a `then` method, and can
               * therefore be assumed to behave as a Promise.
               *
               * @param {*} value The value to test.
               * @returns {boolean} True if the value is thenable.
               */

              const isThenable = (value) => {
                return (
                  value &&
                  typeof value === 'object' &&
                  typeof value.then === 'function'
                );
              };
              /**
               * Creates and returns a function which, when called, will resolve or reject
               * the given promise based on how it is called:
               *
               * - If, when called, `chrome.runtime.lastError` contains a non-null object,
               *   the promise is rejected with that value.
               * - If the function is called with exactly one argument, the promise is
               *   resolved to that value.
               * - Otherwise, the promise is resolved to an array containing all of the
               *   function's arguments.
               *
               * @param {object} promise
               *        An object containing the resolution and rejection functions of a
               *        promise.
               * @param {function} promise.resolve
               *        The promise's resolution function.
               * @param {function} promise.rejection
               *        The promise's rejection function.
               * @param {object} metadata
               *        Metadata about the wrapped method which has created the callback.
               * @param {integer} metadata.maxResolvedArgs
               *        The maximum number of arguments which may be passed to the
               *        callback created by the wrapped async function.
               *
               * @returns {function}
               *        The generated callback function.
               */

              const makeCallback = (promise, metadata) => {
                return (...callbackArgs) => {
                  if (extensionAPIs.runtime.lastError) {
                    promise.reject(extensionAPIs.runtime.lastError);
                  } else if (
                    metadata.singleCallbackArg ||
                    (callbackArgs.length <= 1 &&
                      metadata.singleCallbackArg !== false)
                  ) {
                    promise.resolve(callbackArgs[0]);
                  } else {
                    promise.resolve(callbackArgs);
                  }
                };
              };

              const pluralizeArguments = (numArgs) =>
                numArgs == 1 ? 'argument' : 'arguments';
              /**
               * Creates a wrapper function for a method with the given name and metadata.
               *
               * @param {string} name
               *        The name of the method which is being wrapped.
               * @param {object} metadata
               *        Metadata about the method being wrapped.
               * @param {integer} metadata.minArgs
               *        The minimum number of arguments which must be passed to the
               *        function. If called with fewer than this number of arguments, the
               *        wrapper will raise an exception.
               * @param {integer} metadata.maxArgs
               *        The maximum number of arguments which may be passed to the
               *        function. If called with more than this number of arguments, the
               *        wrapper will raise an exception.
               * @param {integer} metadata.maxResolvedArgs
               *        The maximum number of arguments which may be passed to the
               *        callback created by the wrapped async function.
               *
               * @returns {function(object, ...*)}
               *       The generated wrapper function.
               */

              const wrapAsyncFunction = (name, metadata) => {
                return function asyncFunctionWrapper(target, ...args) {
                  if (args.length < metadata.minArgs) {
                    throw new Error(
                      `Expected at least ${
                        metadata.minArgs
                      } ${pluralizeArguments(
                        metadata.minArgs
                      )} for ${name}(), got ${args.length}`
                    );
                  }

                  if (args.length > metadata.maxArgs) {
                    throw new Error(
                      `Expected at most ${
                        metadata.maxArgs
                      } ${pluralizeArguments(
                        metadata.maxArgs
                      )} for ${name}(), got ${args.length}`
                    );
                  }

                  return new Promise((resolve, reject) => {
                    if (metadata.fallbackToNoCallback) {
                      // This API method has currently no callback on Chrome, but it return a promise on Firefox,
                      // and so the polyfill will try to call it with a callback first, and it will fallback
                      // to not passing the callback if the first call fails.
                      try {
                        target[name](
                          ...args,
                          makeCallback(
                            {
                              resolve,
                              reject,
                            },
                            metadata
                          )
                        );
                      } catch (cbError) {
                        console.warn(
                          `${name} API method doesn't seem to support the callback parameter, ` +
                            'falling back to call it without a callback: ',
                          cbError
                        );
                        target[name](...args); // Update the API method metadata, so that the next API calls will not try to
                        // use the unsupported callback anymore.

                        metadata.fallbackToNoCallback = false;
                        metadata.noCallback = true;
                        resolve();
                      }
                    } else if (metadata.noCallback) {
                      target[name](...args);
                      resolve();
                    } else {
                      target[name](
                        ...args,
                        makeCallback(
                          {
                            resolve,
                            reject,
                          },
                          metadata
                        )
                      );
                    }
                  });
                };
              };
              /**
               * Wraps an existing method of the target object, so that calls to it are
               * intercepted by the given wrapper function. The wrapper function receives,
               * as its first argument, the original `target` object, followed by each of
               * the arguments passed to the original method.
               *
               * @param {object} target
               *        The original target object that the wrapped method belongs to.
               * @param {function} method
               *        The method being wrapped. This is used as the target of the Proxy
               *        object which is created to wrap the method.
               * @param {function} wrapper
               *        The wrapper function which is called in place of a direct invocation
               *        of the wrapped method.
               *
               * @returns {Proxy<function>}
               *        A Proxy object for the given method, which invokes the given wrapper
               *        method in its place.
               */

              const wrapMethod = (target, method, wrapper) => {
                return new Proxy(method, {
                  apply(targetMethod, thisObj, args) {
                    return wrapper.call(thisObj, target, ...args);
                  },
                });
              };

              let hasOwnProperty = Function.call.bind(
                Object.prototype.hasOwnProperty
              );
              /**
               * Wraps an object in a Proxy which intercepts and wraps certain methods
               * based on the given `wrappers` and `metadata` objects.
               *
               * @param {object} target
               *        The target object to wrap.
               *
               * @param {object} [wrappers = {}]
               *        An object tree containing wrapper functions for special cases. Any
               *        function present in this object tree is called in place of the
               *        method in the same location in the `target` object tree. These
               *        wrapper methods are invoked as described in {@see wrapMethod}.
               *
               * @param {object} [metadata = {}]
               *        An object tree containing metadata used to automatically generate
               *        Promise-based wrapper functions for asynchronous. Any function in
               *        the `target` object tree which has a corresponding metadata object
               *        in the same location in the `metadata` tree is replaced with an
               *        automatically-generated wrapper function, as described in
               *        {@see wrapAsyncFunction}
               *
               * @returns {Proxy<object>}
               */

              const wrapObject = (target, wrappers = {}, metadata = {}) => {
                let cache = Object.create(null);
                let handlers = {
                  has(proxyTarget, prop) {
                    return prop in target || prop in cache;
                  },

                  get(proxyTarget, prop, receiver) {
                    if (prop in cache) {
                      return cache[prop];
                    }

                    if (!(prop in target)) {
                      return undefined;
                    }

                    let value = target[prop];

                    if (typeof value === 'function') {
                      // This is a method on the underlying object. Check if we need to do
                      // any wrapping.
                      if (typeof wrappers[prop] === 'function') {
                        // We have a special-case wrapper for this method.
                        value = wrapMethod(
                          target,
                          target[prop],
                          wrappers[prop]
                        );
                      } else if (hasOwnProperty(metadata, prop)) {
                        // This is an async method that we have metadata for. Create a
                        // Promise wrapper for it.
                        let wrapper = wrapAsyncFunction(prop, metadata[prop]);
                        value = wrapMethod(target, target[prop], wrapper);
                      } else {
                        // This is a method that we don't know or care about. Return the
                        // original method, bound to the underlying object.
                        value = value.bind(target);
                      }
                    } else if (
                      typeof value === 'object' &&
                      value !== null &&
                      (hasOwnProperty(wrappers, prop) ||
                        hasOwnProperty(metadata, prop))
                    ) {
                      // This is an object that we need to do some wrapping for the children
                      // of. Create a sub-object wrapper for it with the appropriate child
                      // metadata.
                      value = wrapObject(value, wrappers[prop], metadata[prop]);
                    } else if (hasOwnProperty(metadata, '*')) {
                      // Wrap all properties in * namespace.
                      value = wrapObject(value, wrappers[prop], metadata['*']);
                    } else {
                      // We don't need to do any wrapping for this property,
                      // so just forward all access to the underlying object.
                      Object.defineProperty(cache, prop, {
                        configurable: true,
                        enumerable: true,

                        get() {
                          return target[prop];
                        },

                        set(value) {
                          target[prop] = value;
                        },
                      });
                      return value;
                    }

                    cache[prop] = value;
                    return value;
                  },

                  set(proxyTarget, prop, value, receiver) {
                    if (prop in cache) {
                      cache[prop] = value;
                    } else {
                      target[prop] = value;
                    }

                    return true;
                  },

                  defineProperty(proxyTarget, prop, desc) {
                    return Reflect.defineProperty(cache, prop, desc);
                  },

                  deleteProperty(proxyTarget, prop) {
                    return Reflect.deleteProperty(cache, prop);
                  },
                }; // Per contract of the Proxy API, the "get" proxy handler must return the
                // original value of the target if that value is declared read-only and
                // non-configurable. For this reason, we create an object with the
                // prototype set to `target` instead of using `target` directly.
                // Otherwise we cannot return a custom object for APIs that
                // are declared read-only and non-configurable, such as `chrome.devtools`.
                //
                // The proxy handlers themselves will still use the original `target`
                // instead of the `proxyTarget`, so that the methods and properties are
                // dereferenced via the original targets.

                let proxyTarget = Object.create(target);
                return new Proxy(proxyTarget, handlers);
              };
              /**
               * Creates a set of wrapper functions for an event object, which handles
               * wrapping of listener functions that those messages are passed.
               *
               * A single wrapper is created for each listener function, and stored in a
               * map. Subsequent calls to `addListener`, `hasListener`, or `removeListener`
               * retrieve the original wrapper, so that  attempts to remove a
               * previously-added listener work as expected.
               *
               * @param {DefaultWeakMap<function, function>} wrapperMap
               *        A DefaultWeakMap object which will create the appropriate wrapper
               *        for a given listener function when one does not exist, and retrieve
               *        an existing one when it does.
               *
               * @returns {object}
               */

              const wrapEvent = (wrapperMap) => ({
                addListener(target, listener, ...args) {
                  target.addListener(wrapperMap.get(listener), ...args);
                },

                hasListener(target, listener) {
                  return target.hasListener(wrapperMap.get(listener));
                },

                removeListener(target, listener) {
                  target.removeListener(wrapperMap.get(listener));
                },
              }); // Keep track if the deprecation warning has been logged at least once.

              let loggedSendResponseDeprecationWarning = false;
              const onMessageWrappers = new DefaultWeakMap((listener) => {
                if (typeof listener !== 'function') {
                  return listener;
                }
                /**
                 * Wraps a message listener function so that it may send responses based on
                 * its return value, rather than by returning a sentinel value and calling a
                 * callback. If the listener function returns a Promise, the response is
                 * sent when the promise either resolves or rejects.
                 *
                 * @param {*} message
                 *        The message sent by the other end of the channel.
                 * @param {object} sender
                 *        Details about the sender of the message.
                 * @param {function(*)} sendResponse
                 *        A callback which, when called with an arbitrary argument, sends
                 *        that value as a response.
                 * @returns {boolean}
                 *        True if the wrapped listener returned a Promise, which will later
                 *        yield a response. False otherwise.
                 */

                return function onMessage(message, sender, sendResponse) {
                  let didCallSendResponse = false;
                  let wrappedSendResponse;
                  let sendResponsePromise = new Promise((resolve) => {
                    wrappedSendResponse = function (response) {
                      if (!loggedSendResponseDeprecationWarning) {
                        console.warn(
                          SEND_RESPONSE_DEPRECATION_WARNING,
                          new Error().stack
                        );
                        loggedSendResponseDeprecationWarning = true;
                      }

                      didCallSendResponse = true;
                      resolve(response);
                    };
                  });
                  let result;

                  try {
                    result = listener(message, sender, wrappedSendResponse);
                  } catch (err) {
                    result = Promise.reject(err);
                  }

                  const isResultThenable =
                    result !== true && isThenable(result); // If the listener didn't returned true or a Promise, or called
                  // wrappedSendResponse synchronously, we can exit earlier
                  // because there will be no response sent from this listener.

                  if (
                    result !== true &&
                    !isResultThenable &&
                    !didCallSendResponse
                  ) {
                    return false;
                  } // A small helper to send the message if the promise resolves
                  // and an error if the promise rejects (a wrapped sendMessage has
                  // to translate the message into a resolved promise or a rejected
                  // promise).

                  const sendPromisedResult = (promise) => {
                    promise
                      .then(
                        (msg) => {
                          // send the message value.
                          sendResponse(msg);
                        },
                        (error) => {
                          // Send a JSON representation of the error if the rejected value
                          // is an instance of error, or the object itself otherwise.
                          let message;

                          if (
                            error &&
                            (error instanceof Error ||
                              typeof error.message === 'string')
                          ) {
                            message = error.message;
                          } else {
                            message = 'An unexpected error occurred';
                          }

                          sendResponse({
                            __mozWebExtensionPolyfillReject__: true,
                            message,
                          });
                        }
                      )
                      .catch((err) => {
                        // Print an error on the console if unable to send the response.
                        console.error(
                          'Failed to send onMessage rejected reply',
                          err
                        );
                      });
                  }; // If the listener returned a Promise, send the resolved value as a
                  // result, otherwise wait the promise related to the wrappedSendResponse
                  // callback to resolve and send it as a response.

                  if (isResultThenable) {
                    sendPromisedResult(result);
                  } else {
                    sendPromisedResult(sendResponsePromise);
                  } // Let Chrome know that the listener is replying.

                  return true;
                };
              });

              const wrappedSendMessageCallback = (
                { reject, resolve },
                reply
              ) => {
                if (extensionAPIs.runtime.lastError) {
                  // Detect when none of the listeners replied to the sendMessage call and resolve
                  // the promise to undefined as in Firefox.
                  // See https://github.com/mozilla/webextension-polyfill/issues/130
                  if (
                    extensionAPIs.runtime.lastError.message ===
                    CHROME_SEND_MESSAGE_CALLBACK_NO_RESPONSE_MESSAGE
                  ) {
                    resolve();
                  } else {
                    reject(extensionAPIs.runtime.lastError);
                  }
                } else if (reply && reply.__mozWebExtensionPolyfillReject__) {
                  // Convert back the JSON representation of the error into
                  // an Error instance.
                  reject(new Error(reply.message));
                } else {
                  resolve(reply);
                }
              };

              const wrappedSendMessage = (
                name,
                metadata,
                apiNamespaceObj,
                ...args
              ) => {
                if (args.length < metadata.minArgs) {
                  throw new Error(
                    `Expected at least ${metadata.minArgs} ${pluralizeArguments(
                      metadata.minArgs
                    )} for ${name}(), got ${args.length}`
                  );
                }

                if (args.length > metadata.maxArgs) {
                  throw new Error(
                    `Expected at most ${metadata.maxArgs} ${pluralizeArguments(
                      metadata.maxArgs
                    )} for ${name}(), got ${args.length}`
                  );
                }

                return new Promise((resolve, reject) => {
                  const wrappedCb = wrappedSendMessageCallback.bind(null, {
                    resolve,
                    reject,
                  });
                  args.push(wrappedCb);
                  apiNamespaceObj.sendMessage(...args);
                });
              };

              const staticWrappers = {
                runtime: {
                  onMessage: wrapEvent(onMessageWrappers),
                  onMessageExternal: wrapEvent(onMessageWrappers),
                  sendMessage: wrappedSendMessage.bind(null, 'sendMessage', {
                    minArgs: 1,
                    maxArgs: 3,
                  }),
                },
                tabs: {
                  sendMessage: wrappedSendMessage.bind(null, 'sendMessage', {
                    minArgs: 2,
                    maxArgs: 3,
                  }),
                },
              };
              const settingMetadata = {
                clear: {
                  minArgs: 1,
                  maxArgs: 1,
                },
                get: {
                  minArgs: 1,
                  maxArgs: 1,
                },
                set: {
                  minArgs: 1,
                  maxArgs: 1,
                },
              };
              apiMetadata.privacy = {
                network: {
                  '*': settingMetadata,
                },
                services: {
                  '*': settingMetadata,
                },
                websites: {
                  '*': settingMetadata,
                },
              };
              return wrapObject(extensionAPIs, staticWrappers, apiMetadata);
            };

            if (
              typeof chrome != 'object' ||
              !chrome ||
              !chrome.runtime ||
              !chrome.runtime.id
            ) {
              throw new Error(
                'This script should only be loaded in a browser extension.'
              );
            } // The build process adds a UMD wrapper around this file, which makes the
            // `module` variable available.

            module.exports = wrapAPIs(chrome);
          } else {
            module.exports = browser;
          }
        }
      );
      //# sourceMappingURL=browser-polyfill.js.map

      /***/
    },

    /***/ 21: /***/ function (module, exports, __webpack_require__) {
      'use strict';

      Object.defineProperty(exports, '__esModule', { value: true });

      exports.browser = __webpack_require__(190);

      /***/
    },

    /******/
  }
);
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIndlYnBhY2s6Ly8vd2VicGFjay9ib290c3RyYXAiLCJ3ZWJwYWNrOi8vLy4vc291cmNlL3NjcmlwdHMvQ29udGVudFNjcmlwdC9oZWxwZXJzLnRzIiwid2VicGFjazovLy8uL3NvdXJjZS9zY3JpcHRzL0NvbnRlbnRTY3JpcHQvaW5kZXgudHMiLCJ3ZWJwYWNrOi8vLy4vbm9kZV9tb2R1bGVzL3dlYmV4dGVuc2lvbi1wb2x5ZmlsbC10cy9ub2RlX21vZHVsZXMvd2ViZXh0ZW5zaW9uLXBvbHlmaWxsL2Rpc3QvYnJvd3Nlci1wb2x5ZmlsbC5qcyIsIndlYnBhY2s6Ly8vLi9ub2RlX21vZHVsZXMvd2ViZXh0ZW5zaW9uLXBvbHlmaWxsLXRzL2xpYi9pbmRleC5qcyJdLCJuYW1lcyI6WyJnZXRNZXNzYWdlc1RvTGlzdGVuVG8iLCJyZXF1ZXN0IiwiY29tcGxldGUiLCJjb25uZWN0ZWQiLCJzdGF0ZSIsImNvcHlDb25uZWN0ZWRBY2NvdW50IiwidXNlclRva2VucyIsImNvbm5lY3Rpb25Db25maXJtZWQiLCJpc1ZhbGlkU1lTQWRkcmVzcyIsImhvbGRpbmdzRGF0YSIsImFzc2V0RGF0YSIsIm1lc3NhZ2UiLCJyZXNwb25zZSIsImlzTG9ja2VkIiwic2lnbmVkVHJhbnNhY3Rpb24iLCJjb25uZWN0ZWRBY2NvdW50WHB1YiIsImNvbm5lY3RlZEFjY291bnRDaGFuZ2VBZGRyZXNzIiwic2lnbmVkUFNCVCIsInBvc3RNZXNzYWdlc0FycmF5IiwibWVzc2FnZVR5cGUiLCJtZXNzYWdlVGFyZ2V0IiwibWVzc2FnZU5ld1RhcmdldCIsInJlc3BvbnNlSXRlbSIsIm1lc3NhZ2VSZXNwb25zZSIsImxpc3RlbkFuZFNlbmRNZXNzYWdlRnJvbVBhZ2VUb0JhY2tncm91bmQiLCJldmVudCIsImRhdGEiLCJmcm9tQ29ubmVjdGVkQWNjb3VudCIsInRvQWRkcmVzcyIsImFtb3VudCIsImZlZSIsInRva2VuIiwiaXNUb2tlbiIsInJiZiIsInByZWNpc2lvbiIsIm1heHN1cHBseSIsInJlY2VpdmVyIiwiaW5pdGlhbFN1cHBseSIsInN5bWJvbCIsImlzc3VlciIsImNvbnRyYWN0IiwiY2FwYWJpbGl0eWZsYWdzIiwiZGVzY3JpcHRpb24iLCJub3RhcnlkZXRhaWxzIiwiYXV4ZmVlZGV0YWlscyIsIm5vdGFyeUFkZHJlc3MiLCJwYXlvdXRBZGRyZXNzIiwiYXNzZXRHdWlkIiwiYWRkcmVzcyIsIm5ld093bmVyIiwicHNidCIsInBzYnRUb1NpZ24iLCJzZW5kVG9rZW4iLCJkYXRhRnJvbVBhZ2VUb0NyZWF0ZVRva2VuIiwiZGF0YUZyb21QYWdlVG9Jc3N1ZVRva2VuIiwiZGF0YUZyb21QYWdlVG9DcmVhdGVBbmRJc3N1ZU5GVCIsImRhdGFGcm9tUGFnZVRvSXNzdWVORlQiLCJkYXRhRnJvbVBhZ2VUb1VwZGF0ZUFzc2V0IiwiZGF0YUZyb21QYWdlVG9UcmFuc2Zlck93bmVyc2hpcCIsImJyb3dzZXJNZXNzYWdlc0FycmF5IiwibWVzc2FnZURhdGEiLCJkb2N0eXBlQ2hlY2siLCJkb2N0eXBlIiwid2luZG93IiwiZG9jdW1lbnQiLCJuYW1lIiwic3VmZml4Q2hlY2siLCJwcm9oaWJpdGVkVHlwZXMiLCJjdXJyZW50VXJsIiwibG9jYXRpb24iLCJwYXRobmFtZSIsImkiLCJsZW5ndGgiLCJ0ZXN0IiwiZG9jdW1lbnRFbGVtZW50Q2hlY2siLCJkb2N1bWVudEVsZW1lbnQiLCJub2RlTmFtZSIsInRvTG93ZXJDYXNlIiwiYmxvY2tlZERvbWFpbkNoZWNrIiwiYmxvY2tlZERvbWFpbnMiLCJocmVmIiwiY3VycmVudFJlZ2V4IiwiYmxvY2tlZERvbWFpbiIsInJlcGxhY2UiLCJSZWdFeHAiLCJzaG91bGRJbmplY3RQcm92aWRlciIsImluamVjdFNjcmlwdCIsImNvbnRlbnQiLCJjb250YWluZXIiLCJoZWFkIiwic2NyaXB0VGFnIiwiY3JlYXRlRWxlbWVudCIsInRleHRDb250ZW50IiwiaW5zZXJ0QmVmb3JlIiwiY2hpbGRyZW4iLCJlcnJvciIsImNvbnNvbGUiLCJpbmplY3RTY3JpcHRGaWxlIiwiZmlsZSIsInNyYyIsImJyb3dzZXIiLCJydW50aW1lIiwiZ2V0VVJMIiwiZGlzcGF0Y2hFdmVudCIsIkN1c3RvbUV2ZW50IiwiZGV0YWlsIiwiU3lzY29pbkluc3RhbGxlZCIsIkNvbm5lY3Rpb25zQ29udHJvbGxlciIsInNlbmRNZXNzYWdlIiwidHlwZSIsInRhcmdldCIsImFkZEV2ZW50TGlzdGVuZXIiLCJzb3VyY2UiLCJicm93c2VyTWVzc2FnZXMiLCJtYXAiLCJvbk1lc3NhZ2UiLCJhZGRMaXN0ZW5lciIsIm1lc3NhZ2VzIiwicG9zdE1lc3NhZ2UiXSwibWFwcGluZ3MiOiI7UUFBQTtRQUNBOztRQUVBO1FBQ0E7O1FBRUE7UUFDQTtRQUNBO1FBQ0E7UUFDQTtRQUNBO1FBQ0E7UUFDQTtRQUNBO1FBQ0E7O1FBRUE7UUFDQTs7UUFFQTtRQUNBOztRQUVBO1FBQ0E7UUFDQTs7O1FBR0E7UUFDQTs7UUFFQTtRQUNBOztRQUVBO1FBQ0E7UUFDQTtRQUNBLDBDQUEwQyxnQ0FBZ0M7UUFDMUU7UUFDQTs7UUFFQTtRQUNBO1FBQ0E7UUFDQSx3REFBd0Qsa0JBQWtCO1FBQzFFO1FBQ0EsaURBQWlELGNBQWM7UUFDL0Q7O1FBRUE7UUFDQTtRQUNBO1FBQ0E7UUFDQTtRQUNBO1FBQ0E7UUFDQTtRQUNBO1FBQ0E7UUFDQTtRQUNBLHlDQUF5QyxpQ0FBaUM7UUFDMUUsZ0hBQWdILG1CQUFtQixFQUFFO1FBQ3JJO1FBQ0E7O1FBRUE7UUFDQTtRQUNBO1FBQ0EsMkJBQTJCLDBCQUEwQixFQUFFO1FBQ3ZELGlDQUFpQyxlQUFlO1FBQ2hEO1FBQ0E7UUFDQTs7UUFFQTtRQUNBLHNEQUFzRCwrREFBK0Q7O1FBRXJIO1FBQ0E7OztRQUdBO1FBQ0E7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUNsRk8sTUFBTUEscUJBQXFCLEdBQUlDLE9BQUQsSUFBa0I7QUFDckQsUUFDRUMsUUFERixHQWlCSUQsT0FqQkosQ0FDRUMsUUFERjtBQUFBLFFBRUVDLFNBRkYsR0FpQklGLE9BakJKLENBRUVFLFNBRkY7QUFBQSxRQUdFQyxLQUhG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O0FBQ0E7QUFDQTtBQUNBLFdBQVc7QUFDWDtBQUNBO0FBQ0E7QUFDQSxXQUFXO0FBQ1g7QUFDQTtBQUNBO0FBQ0EsV0FBVztBQUNYO0FBQ0E7QUFDQTtBQUNBLFdBQVc7QUFDWDtBQUNBO0FBQ0E7QUFDQSxXQUFXO0FBQ1g7QUFDQTtBQUNBO0FBQ0E7QUFDQSxXQUFXO0FBQ1g7QUFDQTtBQUNBO0FBQ0E7QUFDQSxXQUFXO0FBQ1g7QUFDQTtBQUNBO0FBQ0EsV0FBVztBQUNYO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsV0FBVztBQUNYO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxTQUFTO0FBQ1Q7QUFDQTtBQUNBO0FBQ0E7QUFDQSxXQUFXO0FBQ1g7QUFDQTtBQUNBO0FBQ0EsV0FBVztBQUNYO0FBQ0E7QUFDQTtBQUNBLFdBQVc7QUFDWDtBQUNBO0FBQ0E7QUFDQSxXQUFXO0FBQ1g7QUFDQTtBQUNBO0FBQ0EsV0FBVztBQUNYO0FBQ0E7QUFDQTtBQUNBLFdBQVc7QUFDWDtBQUNBO0FBQ0E7QUFDQSxXQUFXO0FBQ1g7QUFDQTtBQUNBO0FBQ0EsV0FBVztBQUNYO0FBQ0E7QUFDQTtBQUNBLFdBQVc7QUFDWDtBQUNBO0FBQ0E7QUFDQTtBQUNBLFNBQVM7QUFDVDtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsU0FBUztBQUNUO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsV0FBVztBQUNYO0FBQ0E7QUFDQTtBQUNBLFdBQVc7QUFDWDtBQUNBO0FBQ0E7QUFDQTtBQUNBLFNBQVM7QUFDVDtBQUNBO0FBQ0E7QUFDQTtBQUNBLFdBQVc7QUFDWDtBQUNBO0FBQ0E7QUFDQSxXQUFXO0FBQ1g7QUFDQTtBQUNBO0FBQ0EsV0FBVztBQUNYO0FBQ0E7QUFDQTtBQUNBLFdBQVc7QUFDWDtBQUNBO0FBQ0E7QUFDQTtBQUNBLFNBQVM7QUFDVDtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLFdBQVc7QUFDWDtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsYUFBYTtBQUNiO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsU0FBUztBQUNUO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsV0FBVztBQUNYO0FBQ0E7QUFDQTtBQUNBLFdBQVc7QUFDWDtBQUNBO0FBQ0E7QUFDQSxXQUFXO0FBQ1g7QUFDQTtBQUNBO0FBQ0EsV0FBVztBQUNYO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsV0FBVztBQUNYO0FBQ0E7QUFDQTtBQUNBLFdBQVc7QUFDWDtBQUNBO0FBQ0E7QUFDQSxXQUFXO0FBQ1g7QUFDQTtBQUNBO0FBQ0EsV0FBVztBQUNYO0FBQ0E7QUFDQTtBQUNBLFdBQVc7QUFDWDtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsU0FBUztBQUNUO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsV0FBVztBQUNYO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsU0FBUztBQUNUO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsV0FBVztBQUNYO0FBQ0E7QUFDQTtBQUNBLFdBQVc7QUFDWDtBQUNBO0FBQ0E7QUFDQSxXQUFXO0FBQ1g7QUFDQTtBQUNBO0FBQ0EsV0FBVztBQUNYO0FBQ0E7QUFDQTtBQUNBLFdBQVc7QUFDWDtBQUNBO0FBQ0E7QUFDQTtBQUNBLFNBQVM7QUFDVDtBQUNBO0FBQ0E7QUFDQTtBQUNBLFdBQVc7QUFDWDtBQUNBO0FBQ0E7QUFDQTtBQUNBLFNBQVM7QUFDVDtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsU0FBUztBQUNUO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxTQUFTO0FBQ1Q7QUFDQTtBQUNBO0FBQ0E7QUFDQSxXQUFXO0FBQ1g7QUFDQTtBQUNBO0FBQ0EsV0FBVztBQUNYO0FBQ0E7QUFDQTtBQUNBLFdBQVc7QUFDWDtBQUNBO0FBQ0E7QUFDQSxXQUFXO0FBQ1g7QUFDQTtBQUNBO0FBQ0E7QUFDQSxTQUFTO0FBQ1Q7QUFDQTtBQUNBO0FBQ0E7QUFDQSxXQUFXO0FBQ1g7QUFDQTtBQUNBO0FBQ0EsV0FBVztBQUNYO0FBQ0E7QUFDQTtBQUNBLFdBQVc7QUFDWDtBQUNBO0FBQ0E7QUFDQSxXQUFXO0FBQ1g7QUFDQTtBQUNBO0FBQ0E7QUFDQSxTQUFTO0FBQ1Q7QUFDQTtBQUNBO0FBQ0E7QUFDQSxXQUFXO0FBQ1g7QUFDQTtBQUNBO0FBQ0EsV0FBVztBQUNYO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsV0FBVztBQUNYO0FBQ0E7QUFDQTtBQUNBLFdBQVc7QUFDWDtBQUNBO0FBQ0E7QUFDQTtBQUNBLFdBQVc7QUFDWDtBQUNBO0FBQ0E7QUFDQTtBQUNBLFdBQVc7QUFDWDtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsU0FBUztBQUNUO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsV0FBVztBQUNYO0FBQ0E7QUFDQTtBQUNBLFdBQVc7QUFDWDtBQUNBO0FBQ0E7QUFDQSxXQUFXO0FBQ1g7QUFDQTtBQUNBO0FBQ0E7QUFDQSxTQUFTO0FBQ1Q7QUFDQTtBQUNBO0FBQ0E7QUFDQSxXQUFXO0FBQ1g7QUFDQTtBQUNBO0FBQ0EsV0FBVztBQUNYO0FBQ0E7QUFDQTtBQUNBLFdBQVc7QUFDWDtBQUNBO0FBQ0E7QUFDQSxXQUFXO0FBQ1g7QUFDQTtBQUNBO0FBQ0EsV0FBVztBQUNYO0FBQ0E7QUFDQTtBQUNBLFdBQVc7QUFDWDtBQUNBO0FBQ0E7QUFDQTtBQUNBLFNBQVM7QUFDVDtBQUNBO0FBQ0E7QUFDQTtBQUNBLFdBQVc7QUFDWDtBQUNBO0FBQ0E7QUFDQSxXQUFXO0FBQ1g7QUFDQTtBQUNBO0FBQ0E7QUFDQSxTQUFTO0FBQ1Q7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLGFBQWE7QUFDYjtBQUNBO0FBQ0E7QUFDQSxhQUFhO0FBQ2I7QUFDQTtBQUNBO0FBQ0EsYUFBYTtBQUNiO0FBQ0E7QUFDQTtBQUNBLGFBQWE7QUFDYjtBQUNBO0FBQ0E7QUFDQTtBQUNBLFdBQVc7QUFDWDtBQUNBO0FBQ0E7QUFDQTtBQUNBLGFBQWE7QUFDYjtBQUNBO0FBQ0E7QUFDQTtBQUNBLFdBQVc7QUFDWDtBQUNBO0FBQ0E7QUFDQTtBQUNBLGFBQWE7QUFDYjtBQUNBO0FBQ0E7QUFDQSxhQUFhO0FBQ2I7QUFDQTtBQUNBO0FBQ0EsYUFBYTtBQUNiO0FBQ0E7QUFDQTtBQUNBLGFBQWE7QUFDYjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsU0FBUztBQUNUO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsV0FBVztBQUNYO0FBQ0E7QUFDQTtBQUNBLFdBQVc7QUFDWDtBQUNBO0FBQ0E7QUFDQSxXQUFXO0FBQ1g7QUFDQTtBQUNBO0FBQ0EsV0FBVztBQUNYO0FBQ0E7QUFDQTtBQUNBLFdBQVc7QUFDWDtBQUNBO0FBQ0E7QUFDQSxXQUFXO0FBQ1g7QUFDQTtBQUNBO0FBQ0EsV0FBVztBQUNYO0FBQ0E7QUFDQTtBQUNBLFdBQVc7QUFDWDtBQUNBO0FBQ0E7QUFDQSxXQUFXO0FBQ1g7QUFDQTtBQUNBO0FBQ0EsV0FBVztBQUNYO0FBQ0E7QUFDQTtBQUNBLFdBQVc7QUFDWDtBQUNBO0FBQ0E7QUFDQSxXQUFXO0FBQ1g7QUFDQTtBQUNBO0FBQ0EsV0FBVztBQUNYO0FBQ0E7QUFDQTtBQUNBLFdBQVc7QUFDWDtBQUNBO0FBQ0E7QUFDQSxXQUFXO0FBQ1g7QUFDQTtBQUNBO0FBQ0EsV0FBVztBQUNYO0FBQ0E7QUFDQTtBQUNBLFdBQVc7QUFDWDtBQUNBO0FBQ0E7QUFDQSxXQUFXO0FBQ1g7QUFDQTtBQUNBO0FBQ0EsV0FBVztBQUNYO0FBQ0E7QUFDQTtBQUNBLFdBQVc7QUFDWDtBQUNBO0FBQ0E7QUFDQSxXQUFXO0FBQ1g7QUFDQTtBQUNBO0FBQ0EsV0FBVztBQUNYO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsU0FBUztBQUNUO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxTQUFTO0FBQ1Q7QUFDQTtBQUNBO0FBQ0E7QUFDQSxXQUFXO0FBQ1g7QUFDQTtBQUNBO0FBQ0E7QUFDQSxTQUFTO0FBQ1Q7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLFNBQVM7QUFDVDtBQUNBO0FBQ0E7QUFDQTtBQUNBLFdBQVc7QUFDWDtBQUNBO0FBQ0E7QUFDQSxXQUFXO0FBQ1g7QUFDQTtBQUNBO0FBQ0EsV0FBVztBQUNYO0FBQ0E7QUFDQTtBQUNBLFdBQVc7QUFDWDtBQUNBO0FBQ0E7QUFDQSxXQUFXO0FBQ1g7QUFDQTtBQUNBO0FBQ0EsV0FBVztBQUNY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TztBQUNQO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLFdBQVc7QUFDWDtBQUNBO0FBQ0EsU0FBUztBQUNUO0FBQ0E7QUFDQTtBQUNBLFNBQVM7QUFDVDtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBLCtDQUErQyxpQkFBaUIsR0FBRyxxQ0FBcUMsT0FBTyxLQUFLLFVBQVUsWUFBWTtBQUMxSTs7QUFFQTtBQUNBLDhDQUE4QyxpQkFBaUIsR0FBRyxxQ0FBcUMsT0FBTyxLQUFLLFVBQVUsWUFBWTtBQUN6STs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLFdBQVc7QUFDWDtBQUNBO0FBQ0EsU0FBUztBQUNUOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsV0FBVztBQUNYLFNBQVM7QUFDVDtBQUNBO0FBQ0E7QUFDQTtBQUNBLFdBQVc7QUFDWDtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxTQUFTO0FBQ1Q7QUFDQTtBQUNBO0FBQ0EsU0FBUztBQUNUO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxTQUFTO0FBQ1Q7QUFDQTtBQUNBLFNBQVM7QUFDVDtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBLEtBQUs7QUFDTDs7O0FBR0E7QUFDQSxHQUFHO0FBQ0g7QUFDQTtBQUNBLENBQUM7QUFDRDs7Ozs7Ozs7O0FDcnRDYTtBQUNiLDhDQUE4QyxjQUFjOztBQUU1RCxrQkFBa0IsbUJBQU8sQ0FBQyxHQUF1QiIsImZpbGUiOiJqcy9jb250ZW50U2NyaXB0LmJ1bmRsZS5qcyIsInNvdXJjZXNDb250ZW50IjpbIiBcdC8vIFRoZSBtb2R1bGUgY2FjaGVcbiBcdHZhciBpbnN0YWxsZWRNb2R1bGVzID0ge307XG5cbiBcdC8vIFRoZSByZXF1aXJlIGZ1bmN0aW9uXG4gXHRmdW5jdGlvbiBfX3dlYnBhY2tfcmVxdWlyZV9fKG1vZHVsZUlkKSB7XG5cbiBcdFx0Ly8gQ2hlY2sgaWYgbW9kdWxlIGlzIGluIGNhY2hlXG4gXHRcdGlmKGluc3RhbGxlZE1vZHVsZXNbbW9kdWxlSWRdKSB7XG4gXHRcdFx0cmV0dXJuIGluc3RhbGxlZE1vZHVsZXNbbW9kdWxlSWRdLmV4cG9ydHM7XG4gXHRcdH1cbiBcdFx0Ly8gQ3JlYXRlIGEgbmV3IG1vZHVsZSAoYW5kIHB1dCBpdCBpbnRvIHRoZSBjYWNoZSlcbiBcdFx0dmFyIG1vZHVsZSA9IGluc3RhbGxlZE1vZHVsZXNbbW9kdWxlSWRdID0ge1xuIFx0XHRcdGk6IG1vZHVsZUlkLFxuIFx0XHRcdGw6IGZhbHNlLFxuIFx0XHRcdGV4cG9ydHM6IHt9XG4gXHRcdH07XG5cbiBcdFx0Ly8gRXhlY3V0ZSB0aGUgbW9kdWxlIGZ1bmN0aW9uXG4gXHRcdG1vZHVsZXNbbW9kdWxlSWRdLmNhbGwobW9kdWxlLmV4cG9ydHMsIG1vZHVsZSwgbW9kdWxlLmV4cG9ydHMsIF9fd2VicGFja19yZXF1aXJlX18pO1xuXG4gXHRcdC8vIEZsYWcgdGhlIG1vZHVsZSBhcyBsb2FkZWRcbiBcdFx0bW9kdWxlLmwgPSB0cnVlO1xuXG4gXHRcdC8vIFJldHVybiB0aGUgZXhwb3J0cyBvZiB0aGUgbW9kdWxlXG4gXHRcdHJldHVybiBtb2R1bGUuZXhwb3J0cztcbiBcdH1cblxuXG4gXHQvLyBleHBvc2UgdGhlIG1vZHVsZXMgb2JqZWN0IChfX3dlYnBhY2tfbW9kdWxlc19fKVxuIFx0X193ZWJwYWNrX3JlcXVpcmVfXy5tID0gbW9kdWxlcztcblxuIFx0Ly8gZXhwb3NlIHRoZSBtb2R1bGUgY2FjaGVcbiBcdF9fd2VicGFja19yZXF1aXJlX18uYyA9IGluc3RhbGxlZE1vZHVsZXM7XG5cbiBcdC8vIGRlZmluZSBnZXR0ZXIgZnVuY3Rpb24gZm9yIGhhcm1vbnkgZXhwb3J0c1xuIFx0X193ZWJwYWNrX3JlcXVpcmVfXy5kID0gZnVuY3Rpb24oZXhwb3J0cywgbmFtZSwgZ2V0dGVyKSB7XG4gXHRcdGlmKCFfX3dlYnBhY2tfcmVxdWlyZV9fLm8oZXhwb3J0cywgbmFtZSkpIHtcbiBcdFx0XHRPYmplY3QuZGVmaW5lUHJvcGVydHkoZXhwb3J0cywgbmFtZSwgeyBlbnVtZXJhYmxlOiB0cnVlLCBnZXQ6IGdldHRlciB9KTtcbiBcdFx0fVxuIFx0fTtcblxuIFx0Ly8gZGVmaW5lIF9fZXNNb2R1bGUgb24gZXhwb3J0c1xuIFx0X193ZWJwYWNrX3JlcXVpcmVfXy5yID0gZnVuY3Rpb24oZXhwb3J0cykge1xuIFx0XHRpZih0eXBlb2YgU3ltYm9sICE9PSAndW5kZWZpbmVkJyAmJiBTeW1ib2wudG9TdHJpbmdUYWcpIHtcbiBcdFx0XHRPYmplY3QuZGVmaW5lUHJvcGVydHkoZXhwb3J0cywgU3ltYm9sLnRvU3RyaW5nVGFnLCB7IHZhbHVlOiAnTW9kdWxlJyB9KTtcbiBcdFx0fVxuIFx0XHRPYmplY3QuZGVmaW5lUHJvcGVydHkoZXhwb3J0cywgJ19fZXNNb2R1bGUnLCB7IHZhbHVlOiB0cnVlIH0pO1xuIFx0fTtcblxuIFx0Ly8gY3JlYXRlIGEgZmFrZSBuYW1lc3BhY2Ugb2JqZWN0XG4gXHQvLyBtb2RlICYgMTogdmFsdWUgaXMgYSBtb2R1bGUgaWQsIHJlcXVpcmUgaXRcbiBcdC8vIG1vZGUgJiAyOiBtZXJnZSBhbGwgcHJvcGVydGllcyBvZiB2YWx1ZSBpbnRvIHRoZSBuc1xuIFx0Ly8gbW9kZSAmIDQ6IHJldHVybiB2YWx1ZSB3aGVuIGFscmVhZHkgbnMgb2JqZWN0XG4gXHQvLyBtb2RlICYgOHwxOiBiZWhhdmUgbGlrZSByZXF1aXJlXG4gXHRfX3dlYnBhY2tfcmVxdWlyZV9fLnQgPSBmdW5jdGlvbih2YWx1ZSwgbW9kZSkge1xuIFx0XHRpZihtb2RlICYgMSkgdmFsdWUgPSBfX3dlYnBhY2tfcmVxdWlyZV9fKHZhbHVlKTtcbiBcdFx0aWYobW9kZSAmIDgpIHJldHVybiB2YWx1ZTtcbiBcdFx0aWYoKG1vZGUgJiA0KSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIHZhbHVlICYmIHZhbHVlLl9fZXNNb2R1bGUpIHJldHVybiB2YWx1ZTtcbiBcdFx0dmFyIG5zID0gT2JqZWN0LmNyZWF0ZShudWxsKTtcbiBcdFx0X193ZWJwYWNrX3JlcXVpcmVfXy5yKG5zKTtcbiBcdFx0T2JqZWN0LmRlZmluZVByb3BlcnR5KG5zLCAnZGVmYXVsdCcsIHsgZW51bWVyYWJsZTogdHJ1ZSwgdmFsdWU6IHZhbHVlIH0pO1xuIFx0XHRpZihtb2RlICYgMiAmJiB0eXBlb2YgdmFsdWUgIT0gJ3N0cmluZycpIGZvcih2YXIga2V5IGluIHZhbHVlKSBfX3dlYnBhY2tfcmVxdWlyZV9fLmQobnMsIGtleSwgZnVuY3Rpb24oa2V5KSB7IHJldHVybiB2YWx1ZVtrZXldOyB9LmJpbmQobnVsbCwga2V5KSk7XG4gXHRcdHJldHVybiBucztcbiBcdH07XG5cbiBcdC8vIGdldERlZmF1bHRFeHBvcnQgZnVuY3Rpb24gZm9yIGNvbXBhdGliaWxpdHkgd2l0aCBub24taGFybW9ueSBtb2R1bGVzXG4gXHRfX3dlYnBhY2tfcmVxdWlyZV9fLm4gPSBmdW5jdGlvbihtb2R1bGUpIHtcbiBcdFx0dmFyIGdldHRlciA9IG1vZHVsZSAmJiBtb2R1bGUuX19lc01vZHVsZSA/XG4gXHRcdFx0ZnVuY3Rpb24gZ2V0RGVmYXVsdCgpIHsgcmV0dXJuIG1vZHVsZVsnZGVmYXVsdCddOyB9IDpcbiBcdFx0XHRmdW5jdGlvbiBnZXRNb2R1bGVFeHBvcnRzKCkgeyByZXR1cm4gbW9kdWxlOyB9O1xuIFx0XHRfX3dlYnBhY2tfcmVxdWlyZV9fLmQoZ2V0dGVyLCAnYScsIGdldHRlcik7XG4gXHRcdHJldHVybiBnZXR0ZXI7XG4gXHR9O1xuXG4gXHQvLyBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGxcbiBcdF9fd2VicGFja19yZXF1aXJlX18ubyA9IGZ1bmN0aW9uKG9iamVjdCwgcHJvcGVydHkpIHsgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChvYmplY3QsIHByb3BlcnR5KTsgfTtcblxuIFx0Ly8gX193ZWJwYWNrX3B1YmxpY19wYXRoX19cbiBcdF9fd2VicGFja19yZXF1aXJlX18ucCA9IFwiXCI7XG5cblxuIFx0Ly8gTG9hZCBlbnRyeSBtb2R1bGUgYW5kIHJldHVybiBleHBvcnRzXG4gXHRyZXR1cm4gX193ZWJwYWNrX3JlcXVpcmVfXyhfX3dlYnBhY2tfcmVxdWlyZV9fLnMgPSAxMjQ2KTtcbiIsImV4cG9ydCBjb25zdCBnZXRNZXNzYWdlc1RvTGlzdGVuVG8gPSAocmVxdWVzdDogYW55KSA9PiB7XG4gIGNvbnN0IHtcbiAgICBjb21wbGV0ZSxcbiAgICBjb25uZWN0ZWQsXG4gICAgc3RhdGUsXG4gICAgY29weUNvbm5lY3RlZEFjY291bnQsXG4gICAgdXNlclRva2VucyxcbiAgICBjb25uZWN0aW9uQ29uZmlybWVkLFxuICAgIGlzVmFsaWRTWVNBZGRyZXNzLFxuICAgIGhvbGRpbmdzRGF0YSxcbiAgICBhc3NldERhdGEsXG4gICAgbWVzc2FnZSxcbiAgICByZXNwb25zZSxcbiAgICBpc0xvY2tlZCxcbiAgICBzaWduZWRUcmFuc2FjdGlvbixcbiAgICBjb25uZWN0ZWRBY2NvdW50WHB1YixcbiAgICBjb25uZWN0ZWRBY2NvdW50Q2hhbmdlQWRkcmVzcyxcbiAgICBzaWduZWRQU0JULFxuICB9ID0gcmVxdWVzdDtcblxuICBjb25zdCBwb3N0TWVzc2FnZXNBcnJheSA9IFtcbiAgICB7XG4gICAgICBtZXNzYWdlVHlwZTogJ1NFTkRfU1RBVEVfVE9fUEFHRScsXG4gICAgICBtZXNzYWdlVGFyZ2V0OiAnY29udGVudFNjcmlwdCcsXG4gICAgICBtZXNzYWdlTmV3VGFyZ2V0OiAnY29ubmVjdGlvbnNDb250cm9sbGVyJyxcbiAgICAgIHJlc3BvbnNlSXRlbTogJ3N0YXRlJyxcbiAgICAgIG1lc3NhZ2VSZXNwb25zZTogc3RhdGUsXG4gICAgfSxcbiAgICB7XG4gICAgICBtZXNzYWdlVHlwZTogJ0NIRUNLX0lTX0xPQ0tFRCcsXG4gICAgICBtZXNzYWdlVGFyZ2V0OiAnY29udGVudFNjcmlwdCcsXG4gICAgICBtZXNzYWdlTmV3VGFyZ2V0OiAnY29ubmVjdGlvbnNDb250cm9sbGVyJyxcbiAgICAgIHJlc3BvbnNlSXRlbTogJ2lzTG9ja2VkJyxcbiAgICAgIG1lc3NhZ2VSZXNwb25zZTogaXNMb2NrZWQsXG4gICAgfSxcbiAgICB7XG4gICAgICBtZXNzYWdlVHlwZTogJ1NFTkRfQ09OTkVDVEVEX0FDQ09VTlQnLFxuICAgICAgbWVzc2FnZVRhcmdldDogJ2NvbnRlbnRTY3JpcHQnLFxuICAgICAgbWVzc2FnZU5ld1RhcmdldDogJ2Nvbm5lY3Rpb25zQ29udHJvbGxlcicsXG4gICAgICByZXNwb25zZUl0ZW06ICdjb3B5Q29ubmVjdGVkQWNjb3VudCcsXG4gICAgICBtZXNzYWdlUmVzcG9uc2U6IGNvcHlDb25uZWN0ZWRBY2NvdW50LFxuICAgIH0sXG4gICAge1xuICAgICAgbWVzc2FnZVR5cGU6ICdDT05ORUNURURfQUNDT1VOVF9YUFVCJyxcbiAgICAgIG1lc3NhZ2VUYXJnZXQ6ICdjb250ZW50U2NyaXB0JyxcbiAgICAgIG1lc3NhZ2VOZXdUYXJnZXQ6ICdjb25uZWN0aW9uc0NvbnRyb2xsZXInLFxuICAgICAgcmVzcG9uc2VJdGVtOiAnY29ubmVjdGVkQWNjb3VudFhwdWInLFxuICAgICAgbWVzc2FnZVJlc3BvbnNlOiBjb25uZWN0ZWRBY2NvdW50WHB1YixcbiAgICB9LFxuICAgIHtcbiAgICAgIG1lc3NhZ2VUeXBlOiAnQ09OTkVDVEVEX0FDQ09VTlRfQ0hBTkdFX0FERFJFU1MnLFxuICAgICAgbWVzc2FnZVRhcmdldDogJ2NvbnRlbnRTY3JpcHQnLFxuICAgICAgbWVzc2FnZU5ld1RhcmdldDogJ2Nvbm5lY3Rpb25zQ29udHJvbGxlcicsXG4gICAgICByZXNwb25zZUl0ZW06ICdjb25uZWN0ZWRBY2NvdW50Q2hhbmdlQWRkcmVzcycsXG4gICAgICBtZXNzYWdlUmVzcG9uc2U6IGNvbm5lY3RlZEFjY291bnRDaGFuZ2VBZGRyZXNzLFxuICAgIH0sXG4gICAge1xuICAgICAgbWVzc2FnZVR5cGU6ICdDT05ORUNUX1dBTExFVCcsXG4gICAgICBtZXNzYWdlVGFyZ2V0OiAnY29udGVudFNjcmlwdCcsXG4gICAgICBtZXNzYWdlTmV3VGFyZ2V0OiAnY29ubmVjdGlvbnNDb250cm9sbGVyJyxcbiAgICAgIHJlc3BvbnNlSXRlbTogJ2NvbXBsZXRlJyxcbiAgICAgIG1lc3NhZ2VSZXNwb25zZTogY29tcGxldGUsXG4gICAgfSxcbiAgICB7XG4gICAgICBtZXNzYWdlVHlwZTogJ1dBTExFVF9VUERBVEVEJyxcbiAgICAgIG1lc3NhZ2VUYXJnZXQ6ICdjb250ZW50U2NyaXB0JyxcbiAgICAgIG1lc3NhZ2VOZXdUYXJnZXQ6ICdjb25uZWN0aW9uc0NvbnRyb2xsZXInLFxuICAgICAgcmVzcG9uc2VJdGVtOiAnY29ubmVjdGVkJyxcbiAgICAgIG1lc3NhZ2VSZXNwb25zZTogY29ubmVjdGVkLFxuICAgIH0sXG4gICAge1xuICAgICAgbWVzc2FnZVR5cGU6ICdXQUxMRVRfQ09OTkVDVElPTl9DT05GSVJNRUQnLFxuICAgICAgbWVzc2FnZVRhcmdldDogJ2NvbnRlbnRTY3JpcHQnLFxuICAgICAgbWVzc2FnZU5ld1RhcmdldDogJ2Nvbm5lY3Rpb25zQ29udHJvbGxlcicsXG4gICAgICByZXNwb25zZUl0ZW06ICdjb25uZWN0aW9uQ29uZmlybWVkJyxcbiAgICAgIG1lc3NhZ2VSZXNwb25zZTogY29ubmVjdGlvbkNvbmZpcm1lZCxcbiAgICB9LFxuICAgIHtcbiAgICAgIG1lc3NhZ2VUeXBlOiAnQ0hFQ0tfQUREUkVTUycsXG4gICAgICBtZXNzYWdlVGFyZ2V0OiAnY29udGVudFNjcmlwdCcsXG4gICAgICBtZXNzYWdlTmV3VGFyZ2V0OiAnY29ubmVjdGlvbnNDb250cm9sbGVyJyxcbiAgICAgIHJlc3BvbnNlSXRlbTogJ2lzVmFsaWRTWVNBZGRyZXNzJyxcbiAgICAgIG1lc3NhZ2VSZXNwb25zZTogaXNWYWxpZFNZU0FkZHJlc3MsXG4gICAgfSxcbiAgICB7XG4gICAgICBtZXNzYWdlVHlwZTogJ1NJR05fQU5EX1NFTkQnLFxuICAgICAgbWVzc2FnZVRhcmdldDogJ2NvbnRlbnRTY3JpcHQnLFxuICAgICAgbWVzc2FnZU5ld1RhcmdldDogJ2Nvbm5lY3Rpb25zQ29udHJvbGxlcicsXG4gICAgICByZXNwb25zZUl0ZW06ICdzaWduZWRUcmFuc2FjdGlvbicsXG4gICAgICBtZXNzYWdlUmVzcG9uc2U6IHNpZ25lZFRyYW5zYWN0aW9uLFxuICAgIH0sXG4gICAge1xuICAgICAgbWVzc2FnZVR5cGU6ICdTSUdOX1BTQlQnLFxuICAgICAgbWVzc2FnZVRhcmdldDogJ2NvbnRlbnRTY3JpcHQnLFxuICAgICAgbWVzc2FnZU5ld1RhcmdldDogJ2Nvbm5lY3Rpb25zQ29udHJvbGxlcicsXG4gICAgICByZXNwb25zZUl0ZW06ICdzaWduZWRQU0JUJyxcbiAgICAgIG1lc3NhZ2VSZXNwb25zZTogc2lnbmVkUFNCVCxcbiAgICB9LFxuICAgIHtcbiAgICAgIG1lc3NhZ2VUeXBlOiAnR0VUX0hPTERJTkdTX0RBVEEnLFxuICAgICAgbWVzc2FnZVRhcmdldDogJ2NvbnRlbnRTY3JpcHQnLFxuICAgICAgbWVzc2FnZU5ld1RhcmdldDogJ2Nvbm5lY3Rpb25zQ29udHJvbGxlcicsXG4gICAgICByZXNwb25zZUl0ZW06ICdob2xkaW5nc0RhdGEnLFxuICAgICAgbWVzc2FnZVJlc3BvbnNlOiBob2xkaW5nc0RhdGEsXG4gICAgfSxcbiAgICB7XG4gICAgICBtZXNzYWdlVHlwZTogJ0dFVF9VU0VSX01JTlRFRF9UT0tFTlMnLFxuICAgICAgbWVzc2FnZVRhcmdldDogJ2NvbnRlbnRTY3JpcHQnLFxuICAgICAgbWVzc2FnZU5ld1RhcmdldDogJ2Nvbm5lY3Rpb25zQ29udHJvbGxlcicsXG4gICAgICByZXNwb25zZUl0ZW06ICd1c2VyVG9rZW5zJyxcbiAgICAgIG1lc3NhZ2VSZXNwb25zZTogdXNlclRva2VucyxcbiAgICB9LFxuICAgIHtcbiAgICAgIG1lc3NhZ2VUeXBlOiAnV0FMTEVUX0VSUk9SJyxcbiAgICAgIG1lc3NhZ2VUYXJnZXQ6ICdjb250ZW50U2NyaXB0JyxcbiAgICAgIG1lc3NhZ2VOZXdUYXJnZXQ6ICdjb25uZWN0aW9uc0NvbnRyb2xsZXInLFxuICAgICAgcmVzcG9uc2VJdGVtOiAnZXJyb3InLFxuICAgICAgbWVzc2FnZVJlc3BvbnNlOiBtZXNzYWdlLFxuICAgIH0sXG4gICAge1xuICAgICAgbWVzc2FnZVR5cGU6ICdUUkFOU0FDVElPTl9SRVNQT05TRScsXG4gICAgICBtZXNzYWdlVGFyZ2V0OiAnY29udGVudFNjcmlwdCcsXG4gICAgICBtZXNzYWdlTmV3VGFyZ2V0OiAnY29ubmVjdGlvbnNDb250cm9sbGVyJyxcbiAgICAgIHJlc3BvbnNlSXRlbTogJ3Jlc3BvbnNlJyxcbiAgICAgIG1lc3NhZ2VSZXNwb25zZTogcmVzcG9uc2UsXG4gICAgfSxcbiAgICB7XG4gICAgICBtZXNzYWdlVHlwZTogJ1NFTkRfVE9LRU4nLFxuICAgICAgbWVzc2FnZVRhcmdldDogJ2NvbnRlbnRTY3JpcHQnLFxuICAgICAgbWVzc2FnZU5ld1RhcmdldDogJ2Nvbm5lY3Rpb25zQ29udHJvbGxlcicsXG4gICAgICByZXNwb25zZUl0ZW06ICdjb21wbGV0ZScsXG4gICAgICBtZXNzYWdlUmVzcG9uc2U6IGNvbXBsZXRlLFxuICAgIH0sXG4gICAge1xuICAgICAgbWVzc2FnZVR5cGU6ICdHRVRfQVNTRVRfREFUQScsXG4gICAgICBtZXNzYWdlVGFyZ2V0OiAnY29udGVudFNjcmlwdCcsXG4gICAgICBtZXNzYWdlTmV3VGFyZ2V0OiAnY29ubmVjdGlvbnNDb250cm9sbGVyJyxcbiAgICAgIHJlc3BvbnNlSXRlbTogJ2Fzc2V0RGF0YScsXG4gICAgICBtZXNzYWdlUmVzcG9uc2U6IGFzc2V0RGF0YSxcbiAgICB9LFxuICBdO1xuXG4gIHJldHVybiBwb3N0TWVzc2FnZXNBcnJheTtcbn07XG5cbmV4cG9ydCBjb25zdCBsaXN0ZW5BbmRTZW5kTWVzc2FnZUZyb21QYWdlVG9CYWNrZ3JvdW5kID0gKGV2ZW50OiBhbnkpID0+IHtcbiAgY29uc3Qge1xuICAgIGZyb21Db25uZWN0ZWRBY2NvdW50LFxuICAgIHRvQWRkcmVzcyxcbiAgICBhbW91bnQsXG4gICAgZmVlLFxuICAgIHRva2VuLFxuICAgIGlzVG9rZW4sXG4gICAgcmJmLFxuICAgIHByZWNpc2lvbixcbiAgICBtYXhzdXBwbHksXG4gICAgcmVjZWl2ZXIsXG4gICAgaW5pdGlhbFN1cHBseSxcbiAgICBzeW1ib2wsXG4gICAgaXNzdWVyLFxuICAgIGNvbnRyYWN0LFxuICAgIGNhcGFiaWxpdHlmbGFncyxcbiAgICBkZXNjcmlwdGlvbixcbiAgICBub3RhcnlkZXRhaWxzLFxuICAgIGF1eGZlZWRldGFpbHMsXG4gICAgbm90YXJ5QWRkcmVzcyxcbiAgICBwYXlvdXRBZGRyZXNzLFxuICAgIGFzc2V0R3VpZCxcbiAgICBhZGRyZXNzLFxuICAgIG5ld093bmVyLFxuICAgIHBzYnQsXG4gICAgcHNidFRvU2lnbixcbiAgfSA9IGV2ZW50LmRhdGE7XG5cbiAgY29uc3Qgc2VuZFRva2VuID0ge1xuICAgIGZyb21Db25uZWN0ZWRBY2NvdW50LFxuICAgIHRvQWRkcmVzcyxcbiAgICBhbW91bnQsXG4gICAgZmVlLFxuICAgIHRva2VuLFxuICAgIGlzVG9rZW4sXG4gICAgcmJmLFxuICB9O1xuXG4gIGNvbnN0IGRhdGFGcm9tUGFnZVRvQ3JlYXRlVG9rZW4gPSB7XG4gICAgcHJlY2lzaW9uLFxuICAgIHN5bWJvbCxcbiAgICBtYXhzdXBwbHksXG4gICAgZGVzY3JpcHRpb24sXG4gICAgcmVjZWl2ZXIsXG4gICAgaW5pdGlhbFN1cHBseSxcbiAgICBjYXBhYmlsaXR5ZmxhZ3MsXG4gICAgbm90YXJ5ZGV0YWlscyxcbiAgICBhdXhmZWVkZXRhaWxzLFxuICAgIG5vdGFyeUFkZHJlc3MsXG4gICAgcGF5b3V0QWRkcmVzcyxcbiAgfTtcblxuICBjb25zdCBkYXRhRnJvbVBhZ2VUb0lzc3VlVG9rZW4gPSB7XG4gICAgYW1vdW50LFxuICAgIGFzc2V0R3VpZCxcbiAgfTtcblxuICBjb25zdCBkYXRhRnJvbVBhZ2VUb0NyZWF0ZUFuZElzc3VlTkZUID0ge1xuICAgIHN5bWJvbCxcbiAgICBpc3N1ZXIsXG4gICAgcHJlY2lzaW9uLFxuICAgIGRlc2NyaXB0aW9uLFxuICAgIG5vdGFyeWRldGFpbHMsXG4gICAgYXV4ZmVlZGV0YWlscyxcbiAgICBub3RhcnlBZGRyZXNzLFxuICAgIHBheW91dEFkZHJlc3MsXG4gIH07XG5cbiAgY29uc3QgZGF0YUZyb21QYWdlVG9Jc3N1ZU5GVCA9IHtcbiAgICBhbW91bnQsXG4gICAgYXNzZXRHdWlkLFxuICB9O1xuXG4gIGNvbnN0IGRhdGFGcm9tUGFnZVRvVXBkYXRlQXNzZXQgPSB7XG4gICAgYXNzZXRHdWlkLFxuICAgIGNvbnRyYWN0LFxuICAgIGNhcGFiaWxpdHlmbGFncyxcbiAgICBkZXNjcmlwdGlvbixcbiAgICBub3RhcnlkZXRhaWxzLFxuICAgIGF1eGZlZWRldGFpbHMsXG4gICAgbm90YXJ5QWRkcmVzcyxcbiAgICBwYXlvdXRBZGRyZXNzLFxuICB9O1xuXG4gIGNvbnN0IGRhdGFGcm9tUGFnZVRvVHJhbnNmZXJPd25lcnNoaXAgPSB7XG4gICAgYXNzZXRHdWlkLFxuICAgIG5ld093bmVyLFxuICB9O1xuXG4gIGNvbnN0IGJyb3dzZXJNZXNzYWdlc0FycmF5ID0gW1xuICAgIHtcbiAgICAgIG1lc3NhZ2VUeXBlOiAnU0VORF9UT0tFTicsXG4gICAgICBtZXNzYWdlVGFyZ2V0OiAnY29udGVudFNjcmlwdCcsXG4gICAgICBtZXNzYWdlTmV3VGFyZ2V0OiAnYmFja2dyb3VuZCcsXG4gICAgICBtZXNzYWdlRGF0YTogc2VuZFRva2VuLFxuICAgIH0sXG4gICAge1xuICAgICAgbWVzc2FnZVR5cGU6ICdEQVRBX0ZST01fUEFHRV9UT19DUkVBVEVfVE9LRU4nLFxuICAgICAgbWVzc2FnZVRhcmdldDogJ2NvbnRlbnRTY3JpcHQnLFxuICAgICAgbWVzc2FnZU5ld1RhcmdldDogJ2JhY2tncm91bmQnLFxuICAgICAgbWVzc2FnZURhdGE6IGRhdGFGcm9tUGFnZVRvQ3JlYXRlVG9rZW4sXG4gICAgfSxcbiAgICB7XG4gICAgICBtZXNzYWdlVHlwZTogJ0lTU1VFX1NQVCcsXG4gICAgICBtZXNzYWdlVGFyZ2V0OiAnY29udGVudFNjcmlwdCcsXG4gICAgICBtZXNzYWdlTmV3VGFyZ2V0OiAnYmFja2dyb3VuZCcsXG4gICAgICBtZXNzYWdlRGF0YTogZGF0YUZyb21QYWdlVG9Jc3N1ZVRva2VuLFxuICAgIH0sXG4gICAge1xuICAgICAgbWVzc2FnZVR5cGU6ICdDUkVBVEVfQU5EX0lTU1VFX05GVCcsXG4gICAgICBtZXNzYWdlVGFyZ2V0OiAnY29udGVudFNjcmlwdCcsXG4gICAgICBtZXNzYWdlTmV3VGFyZ2V0OiAnYmFja2dyb3VuZCcsXG4gICAgICBtZXNzYWdlRGF0YTogZGF0YUZyb21QYWdlVG9DcmVhdGVBbmRJc3N1ZU5GVCxcbiAgICB9LFxuICAgIHtcbiAgICAgIG1lc3NhZ2VUeXBlOiAnSVNTVUVfTkZUJyxcbiAgICAgIG1lc3NhZ2VUYXJnZXQ6ICdjb250ZW50U2NyaXB0JyxcbiAgICAgIG1lc3NhZ2VOZXdUYXJnZXQ6ICdiYWNrZ3JvdW5kJyxcbiAgICAgIG1lc3NhZ2VEYXRhOiBkYXRhRnJvbVBhZ2VUb0lzc3VlTkZULFxuICAgIH0sXG4gICAge1xuICAgICAgbWVzc2FnZVR5cGU6ICdVUERBVEVfQVNTRVQnLFxuICAgICAgbWVzc2FnZVRhcmdldDogJ2NvbnRlbnRTY3JpcHQnLFxuICAgICAgbWVzc2FnZU5ld1RhcmdldDogJ2JhY2tncm91bmQnLFxuICAgICAgbWVzc2FnZURhdGE6IGRhdGFGcm9tUGFnZVRvVXBkYXRlQXNzZXQsXG4gICAgfSxcbiAgICB7XG4gICAgICBtZXNzYWdlVHlwZTogJ1RSQU5TRkVSX09XTkVSU0hJUCcsXG4gICAgICBtZXNzYWdlVGFyZ2V0OiAnY29udGVudFNjcmlwdCcsXG4gICAgICBtZXNzYWdlTmV3VGFyZ2V0OiAnYmFja2dyb3VuZCcsXG4gICAgICBtZXNzYWdlRGF0YTogZGF0YUZyb21QYWdlVG9UcmFuc2Zlck93bmVyc2hpcCxcbiAgICB9LFxuICAgIHtcbiAgICAgIG1lc3NhZ2VUeXBlOiAnR0VUX0FTU0VUX0RBVEEnLFxuICAgICAgbWVzc2FnZVRhcmdldDogJ2NvbnRlbnRTY3JpcHQnLFxuICAgICAgbWVzc2FnZU5ld1RhcmdldDogJ2JhY2tncm91bmQnLFxuICAgICAgbWVzc2FnZURhdGE6IGFzc2V0R3VpZCxcbiAgICB9LFxuICAgIHtcbiAgICAgIG1lc3NhZ2VUeXBlOiAnR0VUX1VTRVJfTUlOVEVEX1RPS0VOUycsXG4gICAgICBtZXNzYWdlVGFyZ2V0OiAnY29udGVudFNjcmlwdCcsXG4gICAgICBtZXNzYWdlTmV3VGFyZ2V0OiAnYmFja2dyb3VuZCcsXG4gICAgICBtZXNzYWdlRGF0YTogbnVsbCxcbiAgICB9LFxuICAgIHtcbiAgICAgIG1lc3NhZ2VUeXBlOiAnR0VUX0hPTERJTkdTX0RBVEEnLFxuICAgICAgbWVzc2FnZVRhcmdldDogJ2NvbnRlbnRTY3JpcHQnLFxuICAgICAgbWVzc2FnZU5ld1RhcmdldDogJ2JhY2tncm91bmQnLFxuICAgICAgbWVzc2FnZURhdGE6IG51bGwsXG4gICAgfSxcbiAgICB7XG4gICAgICBtZXNzYWdlVHlwZTogJ0NIRUNLX0FERFJFU1MnLFxuICAgICAgbWVzc2FnZVRhcmdldDogJ2NvbnRlbnRTY3JpcHQnLFxuICAgICAgbWVzc2FnZU5ld1RhcmdldDogJ2JhY2tncm91bmQnLFxuICAgICAgbWVzc2FnZURhdGE6IGFkZHJlc3MsXG4gICAgfSxcbiAgICB7XG4gICAgICBtZXNzYWdlVHlwZTogJ1NJR05fQU5EX1NFTkQnLFxuICAgICAgbWVzc2FnZVRhcmdldDogJ2NvbnRlbnRTY3JpcHQnLFxuICAgICAgbWVzc2FnZU5ld1RhcmdldDogJ2JhY2tncm91bmQnLFxuICAgICAgbWVzc2FnZURhdGE6IHBzYnQsXG4gICAgfSxcbiAgICB7XG4gICAgICBtZXNzYWdlVHlwZTogJ1NJR05fUFNCVCcsXG4gICAgICBtZXNzYWdlVGFyZ2V0OiAnY29udGVudFNjcmlwdCcsXG4gICAgICBtZXNzYWdlTmV3VGFyZ2V0OiAnYmFja2dyb3VuZCcsXG4gICAgICBtZXNzYWdlRGF0YTogcHNidFRvU2lnbixcbiAgICB9LFxuICAgIHtcbiAgICAgIG1lc3NhZ2VUeXBlOiAnU0VORF9DT05ORUNURURfQUNDT1VOVCcsXG4gICAgICBtZXNzYWdlVGFyZ2V0OiAnY29udGVudFNjcmlwdCcsXG4gICAgICBtZXNzYWdlTmV3VGFyZ2V0OiAnYmFja2dyb3VuZCcsXG4gICAgICBtZXNzYWdlRGF0YTogbnVsbCxcbiAgICB9LFxuICAgIHtcbiAgICAgIG1lc3NhZ2VUeXBlOiAnQ09OTkVDVEVEX0FDQ09VTlRfWFBVQicsXG4gICAgICBtZXNzYWdlVGFyZ2V0OiAnY29udGVudFNjcmlwdCcsXG4gICAgICBtZXNzYWdlTmV3VGFyZ2V0OiAnYmFja2dyb3VuZCcsXG4gICAgICBtZXNzYWdlRGF0YTogbnVsbCxcbiAgICB9LFxuICAgIHtcbiAgICAgIG1lc3NhZ2VUeXBlOiAnQ09OTkVDVEVEX0FDQ09VTlRfQ0hBTkdFX0FERFJFU1MnLFxuICAgICAgbWVzc2FnZVRhcmdldDogJ2NvbnRlbnRTY3JpcHQnLFxuICAgICAgbWVzc2FnZU5ld1RhcmdldDogJ2JhY2tncm91bmQnLFxuICAgICAgbWVzc2FnZURhdGE6IG51bGwsXG4gICAgfSxcbiAgICB7XG4gICAgICBtZXNzYWdlVHlwZTogJ1NFTkRfU1RBVEVfVE9fUEFHRScsXG4gICAgICBtZXNzYWdlVGFyZ2V0OiAnY29udGVudFNjcmlwdCcsXG4gICAgICBtZXNzYWdlTmV3VGFyZ2V0OiAnYmFja2dyb3VuZCcsXG4gICAgICBtZXNzYWdlRGF0YTogbnVsbCxcbiAgICB9LFxuICAgIHtcbiAgICAgIG1lc3NhZ2VUeXBlOiAnQ0hFQ0tfSVNfTE9DS0VEJyxcbiAgICAgIG1lc3NhZ2VUYXJnZXQ6ICdjb250ZW50U2NyaXB0JyxcbiAgICAgIG1lc3NhZ2VOZXdUYXJnZXQ6ICdiYWNrZ3JvdW5kJyxcbiAgICAgIG1lc3NhZ2VEYXRhOiBudWxsLFxuICAgIH0sXG4gICAge1xuICAgICAgbWVzc2FnZVR5cGU6ICdDT05ORUNUX1dBTExFVCcsXG4gICAgICBtZXNzYWdlVGFyZ2V0OiAnY29udGVudFNjcmlwdCcsXG4gICAgICBtZXNzYWdlTmV3VGFyZ2V0OiAnYmFja2dyb3VuZCcsXG4gICAgICBtZXNzYWdlRGF0YTogbnVsbCxcbiAgICB9LFxuICBdO1xuXG4gIHJldHVybiBicm93c2VyTWVzc2FnZXNBcnJheTtcbn07XG4iLCJpbXBvcnQgeyBicm93c2VyIH0gZnJvbSAnd2ViZXh0ZW5zaW9uLXBvbHlmaWxsLXRzJztcblxuaW1wb3J0IHtcbiAgZ2V0TWVzc2FnZXNUb0xpc3RlblRvLFxuICBsaXN0ZW5BbmRTZW5kTWVzc2FnZUZyb21QYWdlVG9CYWNrZ3JvdW5kLFxufSBmcm9tICcuL2hlbHBlcnMnO1xuXG5kZWNsYXJlIGdsb2JhbCB7XG4gIGludGVyZmFjZSBXaW5kb3cge1xuICAgIFN5c2NvaW5XYWxsZXQ6IGFueTtcbiAgICBjb25uZWN0aW9uQ29uZmlybWVkOiBib29sZWFuO1xuICB9XG59XG5cbmNvbnN0IGRvY3R5cGVDaGVjayA9ICgpID0+IHtcbiAgY29uc3QgeyBkb2N0eXBlIH0gPSB3aW5kb3cuZG9jdW1lbnQ7XG5cbiAgaWYgKGRvY3R5cGUpIHtcbiAgICByZXR1cm4gZG9jdHlwZS5uYW1lID09PSAnaHRtbCc7XG4gIH1cblxuICByZXR1cm4gdHJ1ZTtcbn07XG5cbmNvbnN0IHN1ZmZpeENoZWNrID0gKCkgPT4ge1xuICBjb25zdCBwcm9oaWJpdGVkVHlwZXMgPSBbL1xcLnhtbCQvdSwgL1xcLnBkZiQvdV07XG4gIGNvbnN0IGN1cnJlbnRVcmwgPSB3aW5kb3cubG9jYXRpb24ucGF0aG5hbWU7XG5cbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBwcm9oaWJpdGVkVHlwZXMubGVuZ3RoOyBpKyspIHtcbiAgICBpZiAocHJvaGliaXRlZFR5cGVzW2ldLnRlc3QoY3VycmVudFVybCkpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gdHJ1ZTtcbn07XG5cbmNvbnN0IGRvY3VtZW50RWxlbWVudENoZWNrID0gKCkgPT4ge1xuICBjb25zdCBkb2N1bWVudEVsZW1lbnQgPSBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQubm9kZU5hbWU7XG5cbiAgaWYgKGRvY3VtZW50RWxlbWVudCkge1xuICAgIHJldHVybiBkb2N1bWVudEVsZW1lbnQudG9Mb3dlckNhc2UoKSA9PT0gJ2h0bWwnO1xuICB9XG5cbiAgcmV0dXJuIHRydWU7XG59O1xuXG5jb25zdCBibG9ja2VkRG9tYWluQ2hlY2sgPSAoKSA9PiB7XG4gIGNvbnN0IGJsb2NrZWREb21haW5zID0gWydkcm9wYm94LmNvbScsICdnaXRodWIuY29tJ107XG5cbiAgY29uc3QgY3VycmVudFVybCA9IHdpbmRvdy5sb2NhdGlvbi5ocmVmO1xuICBsZXQgY3VycmVudFJlZ2V4O1xuXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYmxvY2tlZERvbWFpbnMubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBibG9ja2VkRG9tYWluID0gYmxvY2tlZERvbWFpbnNbaV0ucmVwbGFjZSgnLicsICdcXFxcLicpO1xuXG4gICAgY3VycmVudFJlZ2V4ID0gbmV3IFJlZ0V4cChcbiAgICAgIGAoPzpodHRwcz86XFxcXC9cXFxcLykoPzooPyEke2Jsb2NrZWREb21haW59KS4pKiRgLFxuICAgICAgJ3UnXG4gICAgKTtcblxuICAgIGlmICghY3VycmVudFJlZ2V4LnRlc3QoY3VycmVudFVybCkpIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBmYWxzZTtcbn07XG5cbmV4cG9ydCBjb25zdCBzaG91bGRJbmplY3RQcm92aWRlciA9ICgpID0+XG4gIGRvY3R5cGVDaGVjaygpICYmXG4gIHN1ZmZpeENoZWNrKCkgJiZcbiAgZG9jdW1lbnRFbGVtZW50Q2hlY2soKSAmJlxuICAhYmxvY2tlZERvbWFpbkNoZWNrKCk7XG5cbmNvbnN0IGluamVjdFNjcmlwdCA9IChjb250ZW50OiBzdHJpbmcpID0+IHtcbiAgdHJ5IHtcbiAgICBjb25zdCBjb250YWluZXIgPSBkb2N1bWVudC5oZWFkIHx8IGRvY3VtZW50LmRvY3VtZW50RWxlbWVudDtcbiAgICBjb25zdCBzY3JpcHRUYWcgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzY3JpcHQnKTtcbiAgICBzY3JpcHRUYWcudGV4dENvbnRlbnQgPSBjb250ZW50O1xuXG4gICAgY29udGFpbmVyLmluc2VydEJlZm9yZShzY3JpcHRUYWcsIGNvbnRhaW5lci5jaGlsZHJlblswXSk7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgY29uc29sZS5lcnJvcignUGFsaSBXYWxsZXQ6IFByb3ZpZGVyIGluamVjdGlvbiBmYWlsZWQuJywgZXJyb3IpO1xuICB9XG59O1xuXG5jb25zdCBpbmplY3RTY3JpcHRGaWxlID0gKGZpbGU6IHN0cmluZykgPT4ge1xuICB0cnkge1xuICAgIGNvbnN0IGNvbnRhaW5lciA9IGRvY3VtZW50LmhlYWQgfHwgZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50O1xuICAgIGNvbnN0IHNjcmlwdFRhZyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3NjcmlwdCcpO1xuICAgIHNjcmlwdFRhZy5zcmMgPSBicm93c2VyLnJ1bnRpbWUuZ2V0VVJMKGZpbGUpO1xuXG4gICAgY29udGFpbmVyLmluc2VydEJlZm9yZShzY3JpcHRUYWcsIGNvbnRhaW5lci5jaGlsZHJlblswXSk7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgY29uc29sZS5lcnJvcignUGFsaSBXYWxsZXQ6IFByb3ZpZGVyIGluamVjdGlvbiBmYWlsZWQuJywgZXJyb3IpO1xuICB9XG59O1xuXG5pZiAoc2hvdWxkSW5qZWN0UHJvdmlkZXIoKSkge1xuICBpbmplY3RTY3JpcHQoXCJ3aW5kb3cuU3lzY29pbldhbGxldCA9ICdQYWxpIFdhbGxldCBpcyBpbnN0YWxsZWQhIDopJ1wiKTtcblxuICB3aW5kb3cuZGlzcGF0Y2hFdmVudChcbiAgICBuZXcgQ3VzdG9tRXZlbnQoJ1N5c2NvaW5TdGF0dXMnLCB7XG4gICAgICBkZXRhaWw6IHtcbiAgICAgICAgU3lzY29pbkluc3RhbGxlZDogdHJ1ZSxcbiAgICAgICAgQ29ubmVjdGlvbnNDb250cm9sbGVyOiBmYWxzZSxcbiAgICAgIH0sXG4gICAgfSlcbiAgKTtcblxuICBpbmplY3RTY3JpcHRGaWxlKCdqcy9pbnBhZ2UuYnVuZGxlLmpzJyk7XG5cbiAgYnJvd3Nlci5ydW50aW1lLnNlbmRNZXNzYWdlKHtcbiAgICB0eXBlOiAnUkVMT0FEX0RBVEEnLFxuICAgIHRhcmdldDogJ2JhY2tncm91bmQnLFxuICB9KTtcbn1cblxud2luZG93LmFkZEV2ZW50TGlzdGVuZXIoXG4gICdtZXNzYWdlJyxcbiAgKGV2ZW50KSA9PiB7XG4gICAgY29uc3QgeyB0eXBlLCB0YXJnZXQgfSA9IGV2ZW50LmRhdGE7XG5cbiAgICBpZiAoZXZlbnQuc291cmNlICE9PSB3aW5kb3cpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBicm93c2VyTWVzc2FnZXMgPSBsaXN0ZW5BbmRTZW5kTWVzc2FnZUZyb21QYWdlVG9CYWNrZ3JvdW5kKGV2ZW50KTtcblxuICAgIGJyb3dzZXJNZXNzYWdlcy5tYXAoXG4gICAgICAoeyBtZXNzYWdlVHlwZSwgbWVzc2FnZVRhcmdldCwgbWVzc2FnZU5ld1RhcmdldCwgbWVzc2FnZURhdGEgfSkgPT4ge1xuICAgICAgICBpZiAodHlwZSA9PT0gbWVzc2FnZVR5cGUgJiYgdGFyZ2V0ID09PSBtZXNzYWdlVGFyZ2V0KSB7XG4gICAgICAgICAgcmV0dXJuIGJyb3dzZXIucnVudGltZS5zZW5kTWVzc2FnZSh7XG4gICAgICAgICAgICB0eXBlOiBtZXNzYWdlVHlwZSxcbiAgICAgICAgICAgIHRhcmdldDogbWVzc2FnZU5ld1RhcmdldCxcbiAgICAgICAgICAgIG1lc3NhZ2VEYXRhLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgKTtcbiAgfSxcbiAgZmFsc2Vcbik7XG5cbmJyb3dzZXIucnVudGltZS5vbk1lc3NhZ2UuYWRkTGlzdGVuZXIoKHJlcXVlc3QpID0+IHtcbiAgY29uc3QgeyB0eXBlLCB0YXJnZXQgfSA9IHJlcXVlc3Q7XG5cbiAgY29uc3QgbWVzc2FnZXMgPSBnZXRNZXNzYWdlc1RvTGlzdGVuVG8ocmVxdWVzdCk7XG5cbiAgbWVzc2FnZXMubWFwKFxuICAgICh7XG4gICAgICBtZXNzYWdlVHlwZSxcbiAgICAgIG1lc3NhZ2VUYXJnZXQsXG4gICAgICBtZXNzYWdlTmV3VGFyZ2V0LFxuICAgICAgcmVzcG9uc2VJdGVtLFxuICAgICAgbWVzc2FnZVJlc3BvbnNlLFxuICAgIH0pID0+IHtcbiAgICAgIGlmICh0eXBlID09PSBtZXNzYWdlVHlwZSAmJiB0YXJnZXQgPT09IG1lc3NhZ2VUYXJnZXQpIHtcbiAgICAgICAgcmV0dXJuIHdpbmRvdy5wb3N0TWVzc2FnZShcbiAgICAgICAgICB7XG4gICAgICAgICAgICB0eXBlOiBtZXNzYWdlVHlwZSxcbiAgICAgICAgICAgIHRhcmdldDogbWVzc2FnZU5ld1RhcmdldCxcbiAgICAgICAgICAgIFtyZXNwb25zZUl0ZW1dOiBtZXNzYWdlUmVzcG9uc2UsXG4gICAgICAgICAgfSxcbiAgICAgICAgICAnKidcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICB9XG4gICk7XG59KTtcbiIsIihmdW5jdGlvbiAoZ2xvYmFsLCBmYWN0b3J5KSB7XG4gIGlmICh0eXBlb2YgZGVmaW5lID09PSBcImZ1bmN0aW9uXCIgJiYgZGVmaW5lLmFtZCkge1xuICAgIGRlZmluZShcIndlYmV4dGVuc2lvbi1wb2x5ZmlsbFwiLCBbXCJtb2R1bGVcIl0sIGZhY3RvcnkpO1xuICB9IGVsc2UgaWYgKHR5cGVvZiBleHBvcnRzICE9PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgZmFjdG9yeShtb2R1bGUpO1xuICB9IGVsc2Uge1xuICAgIHZhciBtb2QgPSB7XG4gICAgICBleHBvcnRzOiB7fVxuICAgIH07XG4gICAgZmFjdG9yeShtb2QpO1xuICAgIGdsb2JhbC5icm93c2VyID0gbW9kLmV4cG9ydHM7XG4gIH1cbn0pKHR5cGVvZiBnbG9iYWxUaGlzICE9PSBcInVuZGVmaW5lZFwiID8gZ2xvYmFsVGhpcyA6IHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHRoaXMsIGZ1bmN0aW9uIChtb2R1bGUpIHtcbiAgLyogd2ViZXh0ZW5zaW9uLXBvbHlmaWxsIC0gdjAuNy4wIC0gVHVlIE5vdiAxMCAyMDIwIDIwOjI0OjA0ICovXG5cbiAgLyogLSotIE1vZGU6IGluZGVudC10YWJzLW1vZGU6IG5pbDsganMtaW5kZW50LWxldmVsOiAyIC0qLSAqL1xuXG4gIC8qIHZpbTogc2V0IHN0cz0yIHN3PTIgZXQgdHc9ODA6ICovXG5cbiAgLyogVGhpcyBTb3VyY2UgQ29kZSBGb3JtIGlzIHN1YmplY3QgdG8gdGhlIHRlcm1zIG9mIHRoZSBNb3ppbGxhIFB1YmxpY1xuICAgKiBMaWNlbnNlLCB2LiAyLjAuIElmIGEgY29weSBvZiB0aGUgTVBMIHdhcyBub3QgZGlzdHJpYnV0ZWQgd2l0aCB0aGlzXG4gICAqIGZpbGUsIFlvdSBjYW4gb2J0YWluIG9uZSBhdCBodHRwOi8vbW96aWxsYS5vcmcvTVBMLzIuMC8uICovXG4gIFwidXNlIHN0cmljdFwiO1xuXG4gIGlmICh0eXBlb2YgYnJvd3NlciA9PT0gXCJ1bmRlZmluZWRcIiB8fCBPYmplY3QuZ2V0UHJvdG90eXBlT2YoYnJvd3NlcikgIT09IE9iamVjdC5wcm90b3R5cGUpIHtcbiAgICBjb25zdCBDSFJPTUVfU0VORF9NRVNTQUdFX0NBTExCQUNLX05PX1JFU1BPTlNFX01FU1NBR0UgPSBcIlRoZSBtZXNzYWdlIHBvcnQgY2xvc2VkIGJlZm9yZSBhIHJlc3BvbnNlIHdhcyByZWNlaXZlZC5cIjtcbiAgICBjb25zdCBTRU5EX1JFU1BPTlNFX0RFUFJFQ0FUSU9OX1dBUk5JTkcgPSBcIlJldHVybmluZyBhIFByb21pc2UgaXMgdGhlIHByZWZlcnJlZCB3YXkgdG8gc2VuZCBhIHJlcGx5IGZyb20gYW4gb25NZXNzYWdlL29uTWVzc2FnZUV4dGVybmFsIGxpc3RlbmVyLCBhcyB0aGUgc2VuZFJlc3BvbnNlIHdpbGwgYmUgcmVtb3ZlZCBmcm9tIHRoZSBzcGVjcyAoU2VlIGh0dHBzOi8vZGV2ZWxvcGVyLm1vemlsbGEub3JnL2RvY3MvTW96aWxsYS9BZGQtb25zL1dlYkV4dGVuc2lvbnMvQVBJL3J1bnRpbWUvb25NZXNzYWdlKVwiOyAvLyBXcmFwcGluZyB0aGUgYnVsayBvZiB0aGlzIHBvbHlmaWxsIGluIGEgb25lLXRpbWUtdXNlIGZ1bmN0aW9uIGlzIGEgbWlub3JcbiAgICAvLyBvcHRpbWl6YXRpb24gZm9yIEZpcmVmb3guIFNpbmNlIFNwaWRlcm1vbmtleSBkb2VzIG5vdCBmdWxseSBwYXJzZSB0aGVcbiAgICAvLyBjb250ZW50cyBvZiBhIGZ1bmN0aW9uIHVudGlsIHRoZSBmaXJzdCB0aW1lIGl0J3MgY2FsbGVkLCBhbmQgc2luY2UgaXQgd2lsbFxuICAgIC8vIG5ldmVyIGFjdHVhbGx5IG5lZWQgdG8gYmUgY2FsbGVkLCB0aGlzIGFsbG93cyB0aGUgcG9seWZpbGwgdG8gYmUgaW5jbHVkZWRcbiAgICAvLyBpbiBGaXJlZm94IG5lYXJseSBmb3IgZnJlZS5cblxuICAgIGNvbnN0IHdyYXBBUElzID0gZXh0ZW5zaW9uQVBJcyA9PiB7XG4gICAgICAvLyBOT1RFOiBhcGlNZXRhZGF0YSBpcyBhc3NvY2lhdGVkIHRvIHRoZSBjb250ZW50IG9mIHRoZSBhcGktbWV0YWRhdGEuanNvbiBmaWxlXG4gICAgICAvLyBhdCBidWlsZCB0aW1lIGJ5IHJlcGxhY2luZyB0aGUgZm9sbG93aW5nIFwiaW5jbHVkZVwiIHdpdGggdGhlIGNvbnRlbnQgb2YgdGhlXG4gICAgICAvLyBKU09OIGZpbGUuXG4gICAgICBjb25zdCBhcGlNZXRhZGF0YSA9IHtcbiAgICAgICAgXCJhbGFybXNcIjoge1xuICAgICAgICAgIFwiY2xlYXJcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDAsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJjbGVhckFsbFwiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMCxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAwXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcImdldFwiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMCxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAxXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcImdldEFsbFwiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMCxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAwXG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcImJvb2ttYXJrc1wiOiB7XG4gICAgICAgICAgXCJjcmVhdGVcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJnZXRcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJnZXRDaGlsZHJlblwiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMSxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAxXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcImdldFJlY2VudFwiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMSxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAxXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcImdldFN1YlRyZWVcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJnZXRUcmVlXCI6IHtcbiAgICAgICAgICAgIFwibWluQXJnc1wiOiAwLFxuICAgICAgICAgICAgXCJtYXhBcmdzXCI6IDBcbiAgICAgICAgICB9LFxuICAgICAgICAgIFwibW92ZVwiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMixcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAyXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcInJlbW92ZVwiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMSxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAxXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcInJlbW92ZVRyZWVcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJzZWFyY2hcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJ1cGRhdGVcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDIsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMlxuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXCJicm93c2VyQWN0aW9uXCI6IHtcbiAgICAgICAgICBcImRpc2FibGVcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDAsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMSxcbiAgICAgICAgICAgIFwiZmFsbGJhY2tUb05vQ2FsbGJhY2tcIjogdHJ1ZVxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJlbmFibGVcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDAsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMSxcbiAgICAgICAgICAgIFwiZmFsbGJhY2tUb05vQ2FsbGJhY2tcIjogdHJ1ZVxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJnZXRCYWRnZUJhY2tncm91bmRDb2xvclwiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMSxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAxXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcImdldEJhZGdlVGV4dFwiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMSxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAxXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcImdldFBvcHVwXCI6IHtcbiAgICAgICAgICAgIFwibWluQXJnc1wiOiAxLFxuICAgICAgICAgICAgXCJtYXhBcmdzXCI6IDFcbiAgICAgICAgICB9LFxuICAgICAgICAgIFwiZ2V0VGl0bGVcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJvcGVuUG9wdXBcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDAsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMFxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJzZXRCYWRnZUJhY2tncm91bmRDb2xvclwiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMSxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAxLFxuICAgICAgICAgICAgXCJmYWxsYmFja1RvTm9DYWxsYmFja1wiOiB0cnVlXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcInNldEJhZGdlVGV4dFwiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMSxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAxLFxuICAgICAgICAgICAgXCJmYWxsYmFja1RvTm9DYWxsYmFja1wiOiB0cnVlXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcInNldEljb25cIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJzZXRQb3B1cFwiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMSxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAxLFxuICAgICAgICAgICAgXCJmYWxsYmFja1RvTm9DYWxsYmFja1wiOiB0cnVlXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcInNldFRpdGxlXCI6IHtcbiAgICAgICAgICAgIFwibWluQXJnc1wiOiAxLFxuICAgICAgICAgICAgXCJtYXhBcmdzXCI6IDEsXG4gICAgICAgICAgICBcImZhbGxiYWNrVG9Ob0NhbGxiYWNrXCI6IHRydWVcbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIFwiYnJvd3NpbmdEYXRhXCI6IHtcbiAgICAgICAgICBcInJlbW92ZVwiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMixcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAyXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcInJlbW92ZUNhY2hlXCI6IHtcbiAgICAgICAgICAgIFwibWluQXJnc1wiOiAxLFxuICAgICAgICAgICAgXCJtYXhBcmdzXCI6IDFcbiAgICAgICAgICB9LFxuICAgICAgICAgIFwicmVtb3ZlQ29va2llc1wiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMSxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAxXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcInJlbW92ZURvd25sb2Fkc1wiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMSxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAxXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcInJlbW92ZUZvcm1EYXRhXCI6IHtcbiAgICAgICAgICAgIFwibWluQXJnc1wiOiAxLFxuICAgICAgICAgICAgXCJtYXhBcmdzXCI6IDFcbiAgICAgICAgICB9LFxuICAgICAgICAgIFwicmVtb3ZlSGlzdG9yeVwiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMSxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAxXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcInJlbW92ZUxvY2FsU3RvcmFnZVwiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMSxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAxXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcInJlbW92ZVBhc3N3b3Jkc1wiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMSxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAxXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcInJlbW92ZVBsdWdpbkRhdGFcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJzZXR0aW5nc1wiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMCxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAwXG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcImNvbW1hbmRzXCI6IHtcbiAgICAgICAgICBcImdldEFsbFwiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMCxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAwXG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcImNvbnRleHRNZW51c1wiOiB7XG4gICAgICAgICAgXCJyZW1vdmVcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJyZW1vdmVBbGxcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDAsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMFxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJ1cGRhdGVcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDIsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMlxuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXCJjb29raWVzXCI6IHtcbiAgICAgICAgICBcImdldFwiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMSxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAxXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcImdldEFsbFwiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMSxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAxXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcImdldEFsbENvb2tpZVN0b3Jlc1wiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMCxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAwXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcInJlbW92ZVwiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMSxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAxXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcInNldFwiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMSxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAxXG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcImRldnRvb2xzXCI6IHtcbiAgICAgICAgICBcImluc3BlY3RlZFdpbmRvd1wiOiB7XG4gICAgICAgICAgICBcImV2YWxcIjoge1xuICAgICAgICAgICAgICBcIm1pbkFyZ3NcIjogMSxcbiAgICAgICAgICAgICAgXCJtYXhBcmdzXCI6IDIsXG4gICAgICAgICAgICAgIFwic2luZ2xlQ2FsbGJhY2tBcmdcIjogZmFsc2VcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9LFxuICAgICAgICAgIFwicGFuZWxzXCI6IHtcbiAgICAgICAgICAgIFwiY3JlYXRlXCI6IHtcbiAgICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDMsXG4gICAgICAgICAgICAgIFwibWF4QXJnc1wiOiAzLFxuICAgICAgICAgICAgICBcInNpbmdsZUNhbGxiYWNrQXJnXCI6IHRydWVcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImVsZW1lbnRzXCI6IHtcbiAgICAgICAgICAgICAgXCJjcmVhdGVTaWRlYmFyUGFuZVwiOiB7XG4gICAgICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICAgICAgXCJtYXhBcmdzXCI6IDFcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXCJkb3dubG9hZHNcIjoge1xuICAgICAgICAgIFwiY2FuY2VsXCI6IHtcbiAgICAgICAgICAgIFwibWluQXJnc1wiOiAxLFxuICAgICAgICAgICAgXCJtYXhBcmdzXCI6IDFcbiAgICAgICAgICB9LFxuICAgICAgICAgIFwiZG93bmxvYWRcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJlcmFzZVwiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMSxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAxXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcImdldEZpbGVJY29uXCI6IHtcbiAgICAgICAgICAgIFwibWluQXJnc1wiOiAxLFxuICAgICAgICAgICAgXCJtYXhBcmdzXCI6IDJcbiAgICAgICAgICB9LFxuICAgICAgICAgIFwib3BlblwiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMSxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAxLFxuICAgICAgICAgICAgXCJmYWxsYmFja1RvTm9DYWxsYmFja1wiOiB0cnVlXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcInBhdXNlXCI6IHtcbiAgICAgICAgICAgIFwibWluQXJnc1wiOiAxLFxuICAgICAgICAgICAgXCJtYXhBcmdzXCI6IDFcbiAgICAgICAgICB9LFxuICAgICAgICAgIFwicmVtb3ZlRmlsZVwiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMSxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAxXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcInJlc3VtZVwiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMSxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAxXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcInNlYXJjaFwiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMSxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAxXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcInNob3dcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMSxcbiAgICAgICAgICAgIFwiZmFsbGJhY2tUb05vQ2FsbGJhY2tcIjogdHJ1ZVxuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXCJleHRlbnNpb25cIjoge1xuICAgICAgICAgIFwiaXNBbGxvd2VkRmlsZVNjaGVtZUFjY2Vzc1wiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMCxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAwXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcImlzQWxsb3dlZEluY29nbml0b0FjY2Vzc1wiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMCxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAwXG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcImhpc3RvcnlcIjoge1xuICAgICAgICAgIFwiYWRkVXJsXCI6IHtcbiAgICAgICAgICAgIFwibWluQXJnc1wiOiAxLFxuICAgICAgICAgICAgXCJtYXhBcmdzXCI6IDFcbiAgICAgICAgICB9LFxuICAgICAgICAgIFwiZGVsZXRlQWxsXCI6IHtcbiAgICAgICAgICAgIFwibWluQXJnc1wiOiAwLFxuICAgICAgICAgICAgXCJtYXhBcmdzXCI6IDBcbiAgICAgICAgICB9LFxuICAgICAgICAgIFwiZGVsZXRlUmFuZ2VcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJkZWxldGVVcmxcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJnZXRWaXNpdHNcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJzZWFyY2hcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXCJpMThuXCI6IHtcbiAgICAgICAgICBcImRldGVjdExhbmd1YWdlXCI6IHtcbiAgICAgICAgICAgIFwibWluQXJnc1wiOiAxLFxuICAgICAgICAgICAgXCJtYXhBcmdzXCI6IDFcbiAgICAgICAgICB9LFxuICAgICAgICAgIFwiZ2V0QWNjZXB0TGFuZ3VhZ2VzXCI6IHtcbiAgICAgICAgICAgIFwibWluQXJnc1wiOiAwLFxuICAgICAgICAgICAgXCJtYXhBcmdzXCI6IDBcbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIFwiaWRlbnRpdHlcIjoge1xuICAgICAgICAgIFwibGF1bmNoV2ViQXV0aEZsb3dcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXCJpZGxlXCI6IHtcbiAgICAgICAgICBcInF1ZXJ5U3RhdGVcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXCJtYW5hZ2VtZW50XCI6IHtcbiAgICAgICAgICBcImdldFwiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMSxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAxXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcImdldEFsbFwiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMCxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAwXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcImdldFNlbGZcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDAsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMFxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJzZXRFbmFibGVkXCI6IHtcbiAgICAgICAgICAgIFwibWluQXJnc1wiOiAyLFxuICAgICAgICAgICAgXCJtYXhBcmdzXCI6IDJcbiAgICAgICAgICB9LFxuICAgICAgICAgIFwidW5pbnN0YWxsU2VsZlwiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMCxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAxXG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcIm5vdGlmaWNhdGlvbnNcIjoge1xuICAgICAgICAgIFwiY2xlYXJcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJjcmVhdGVcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMlxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJnZXRBbGxcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDAsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMFxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJnZXRQZXJtaXNzaW9uTGV2ZWxcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDAsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMFxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJ1cGRhdGVcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDIsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMlxuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXCJwYWdlQWN0aW9uXCI6IHtcbiAgICAgICAgICBcImdldFBvcHVwXCI6IHtcbiAgICAgICAgICAgIFwibWluQXJnc1wiOiAxLFxuICAgICAgICAgICAgXCJtYXhBcmdzXCI6IDFcbiAgICAgICAgICB9LFxuICAgICAgICAgIFwiZ2V0VGl0bGVcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJoaWRlXCI6IHtcbiAgICAgICAgICAgIFwibWluQXJnc1wiOiAxLFxuICAgICAgICAgICAgXCJtYXhBcmdzXCI6IDEsXG4gICAgICAgICAgICBcImZhbGxiYWNrVG9Ob0NhbGxiYWNrXCI6IHRydWVcbiAgICAgICAgICB9LFxuICAgICAgICAgIFwic2V0SWNvblwiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMSxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAxXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcInNldFBvcHVwXCI6IHtcbiAgICAgICAgICAgIFwibWluQXJnc1wiOiAxLFxuICAgICAgICAgICAgXCJtYXhBcmdzXCI6IDEsXG4gICAgICAgICAgICBcImZhbGxiYWNrVG9Ob0NhbGxiYWNrXCI6IHRydWVcbiAgICAgICAgICB9LFxuICAgICAgICAgIFwic2V0VGl0bGVcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMSxcbiAgICAgICAgICAgIFwiZmFsbGJhY2tUb05vQ2FsbGJhY2tcIjogdHJ1ZVxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJzaG93XCI6IHtcbiAgICAgICAgICAgIFwibWluQXJnc1wiOiAxLFxuICAgICAgICAgICAgXCJtYXhBcmdzXCI6IDEsXG4gICAgICAgICAgICBcImZhbGxiYWNrVG9Ob0NhbGxiYWNrXCI6IHRydWVcbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIFwicGVybWlzc2lvbnNcIjoge1xuICAgICAgICAgIFwiY29udGFpbnNcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJnZXRBbGxcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDAsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMFxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJyZW1vdmVcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJyZXF1ZXN0XCI6IHtcbiAgICAgICAgICAgIFwibWluQXJnc1wiOiAxLFxuICAgICAgICAgICAgXCJtYXhBcmdzXCI6IDFcbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIFwicnVudGltZVwiOiB7XG4gICAgICAgICAgXCJnZXRCYWNrZ3JvdW5kUGFnZVwiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMCxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAwXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcImdldFBsYXRmb3JtSW5mb1wiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMCxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAwXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcIm9wZW5PcHRpb25zUGFnZVwiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMCxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAwXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcInJlcXVlc3RVcGRhdGVDaGVja1wiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMCxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAwXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcInNlbmRNZXNzYWdlXCI6IHtcbiAgICAgICAgICAgIFwibWluQXJnc1wiOiAxLFxuICAgICAgICAgICAgXCJtYXhBcmdzXCI6IDNcbiAgICAgICAgICB9LFxuICAgICAgICAgIFwic2VuZE5hdGl2ZU1lc3NhZ2VcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDIsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMlxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJzZXRVbmluc3RhbGxVUkxcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXCJzZXNzaW9uc1wiOiB7XG4gICAgICAgICAgXCJnZXREZXZpY2VzXCI6IHtcbiAgICAgICAgICAgIFwibWluQXJnc1wiOiAwLFxuICAgICAgICAgICAgXCJtYXhBcmdzXCI6IDFcbiAgICAgICAgICB9LFxuICAgICAgICAgIFwiZ2V0UmVjZW50bHlDbG9zZWRcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDAsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJyZXN0b3JlXCI6IHtcbiAgICAgICAgICAgIFwibWluQXJnc1wiOiAwLFxuICAgICAgICAgICAgXCJtYXhBcmdzXCI6IDFcbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIFwic3RvcmFnZVwiOiB7XG4gICAgICAgICAgXCJsb2NhbFwiOiB7XG4gICAgICAgICAgICBcImNsZWFyXCI6IHtcbiAgICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDAsXG4gICAgICAgICAgICAgIFwibWF4QXJnc1wiOiAwXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJnZXRcIjoge1xuICAgICAgICAgICAgICBcIm1pbkFyZ3NcIjogMCxcbiAgICAgICAgICAgICAgXCJtYXhBcmdzXCI6IDFcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImdldEJ5dGVzSW5Vc2VcIjoge1xuICAgICAgICAgICAgICBcIm1pbkFyZ3NcIjogMCxcbiAgICAgICAgICAgICAgXCJtYXhBcmdzXCI6IDFcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInJlbW92ZVwiOiB7XG4gICAgICAgICAgICAgIFwibWluQXJnc1wiOiAxLFxuICAgICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwic2V0XCI6IHtcbiAgICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICAgIFwibWF4QXJnc1wiOiAxXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSxcbiAgICAgICAgICBcIm1hbmFnZWRcIjoge1xuICAgICAgICAgICAgXCJnZXRcIjoge1xuICAgICAgICAgICAgICBcIm1pbkFyZ3NcIjogMCxcbiAgICAgICAgICAgICAgXCJtYXhBcmdzXCI6IDFcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImdldEJ5dGVzSW5Vc2VcIjoge1xuICAgICAgICAgICAgICBcIm1pbkFyZ3NcIjogMCxcbiAgICAgICAgICAgICAgXCJtYXhBcmdzXCI6IDFcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9LFxuICAgICAgICAgIFwic3luY1wiOiB7XG4gICAgICAgICAgICBcImNsZWFyXCI6IHtcbiAgICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDAsXG4gICAgICAgICAgICAgIFwibWF4QXJnc1wiOiAwXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJnZXRcIjoge1xuICAgICAgICAgICAgICBcIm1pbkFyZ3NcIjogMCxcbiAgICAgICAgICAgICAgXCJtYXhBcmdzXCI6IDFcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImdldEJ5dGVzSW5Vc2VcIjoge1xuICAgICAgICAgICAgICBcIm1pbkFyZ3NcIjogMCxcbiAgICAgICAgICAgICAgXCJtYXhBcmdzXCI6IDFcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInJlbW92ZVwiOiB7XG4gICAgICAgICAgICAgIFwibWluQXJnc1wiOiAxLFxuICAgICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwic2V0XCI6IHtcbiAgICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICAgIFwibWF4QXJnc1wiOiAxXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcInRhYnNcIjoge1xuICAgICAgICAgIFwiY2FwdHVyZVZpc2libGVUYWJcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDAsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMlxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJjcmVhdGVcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJkZXRlY3RMYW5ndWFnZVwiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMCxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAxXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcImRpc2NhcmRcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDAsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJkdXBsaWNhdGVcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJleGVjdXRlU2NyaXB0XCI6IHtcbiAgICAgICAgICAgIFwibWluQXJnc1wiOiAxLFxuICAgICAgICAgICAgXCJtYXhBcmdzXCI6IDJcbiAgICAgICAgICB9LFxuICAgICAgICAgIFwiZ2V0XCI6IHtcbiAgICAgICAgICAgIFwibWluQXJnc1wiOiAxLFxuICAgICAgICAgICAgXCJtYXhBcmdzXCI6IDFcbiAgICAgICAgICB9LFxuICAgICAgICAgIFwiZ2V0Q3VycmVudFwiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMCxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAwXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcImdldFpvb21cIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDAsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJnZXRab29tU2V0dGluZ3NcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDAsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJnb0JhY2tcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDAsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJnb0ZvcndhcmRcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDAsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJoaWdobGlnaHRcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJpbnNlcnRDU1NcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMlxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJtb3ZlXCI6IHtcbiAgICAgICAgICAgIFwibWluQXJnc1wiOiAyLFxuICAgICAgICAgICAgXCJtYXhBcmdzXCI6IDJcbiAgICAgICAgICB9LFxuICAgICAgICAgIFwicXVlcnlcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJyZWxvYWRcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDAsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMlxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJyZW1vdmVcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJyZW1vdmVDU1NcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMlxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJzZW5kTWVzc2FnZVwiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMixcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAzXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcInNldFpvb21cIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMlxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJzZXRab29tU2V0dGluZ3NcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMlxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJ1cGRhdGVcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMlxuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXCJ0b3BTaXRlc1wiOiB7XG4gICAgICAgICAgXCJnZXRcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDAsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMFxuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXCJ3ZWJOYXZpZ2F0aW9uXCI6IHtcbiAgICAgICAgICBcImdldEFsbEZyYW1lc1wiOiB7XG4gICAgICAgICAgICBcIm1pbkFyZ3NcIjogMSxcbiAgICAgICAgICAgIFwibWF4QXJnc1wiOiAxXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcImdldEZyYW1lXCI6IHtcbiAgICAgICAgICAgIFwibWluQXJnc1wiOiAxLFxuICAgICAgICAgICAgXCJtYXhBcmdzXCI6IDFcbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIFwid2ViUmVxdWVzdFwiOiB7XG4gICAgICAgICAgXCJoYW5kbGVyQmVoYXZpb3JDaGFuZ2VkXCI6IHtcbiAgICAgICAgICAgIFwibWluQXJnc1wiOiAwLFxuICAgICAgICAgICAgXCJtYXhBcmdzXCI6IDBcbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIFwid2luZG93c1wiOiB7XG4gICAgICAgICAgXCJjcmVhdGVcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDAsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJnZXRcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMlxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJnZXRBbGxcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDAsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJnZXRDdXJyZW50XCI6IHtcbiAgICAgICAgICAgIFwibWluQXJnc1wiOiAwLFxuICAgICAgICAgICAgXCJtYXhBcmdzXCI6IDFcbiAgICAgICAgICB9LFxuICAgICAgICAgIFwiZ2V0TGFzdEZvY3VzZWRcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDAsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJyZW1vdmVcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDEsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMVxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJ1cGRhdGVcIjoge1xuICAgICAgICAgICAgXCJtaW5BcmdzXCI6IDIsXG4gICAgICAgICAgICBcIm1heEFyZ3NcIjogMlxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgaWYgKE9iamVjdC5rZXlzKGFwaU1ldGFkYXRhKS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiYXBpLW1ldGFkYXRhLmpzb24gaGFzIG5vdCBiZWVuIGluY2x1ZGVkIGluIGJyb3dzZXItcG9seWZpbGxcIik7XG4gICAgICB9XG4gICAgICAvKipcbiAgICAgICAqIEEgV2Vha01hcCBzdWJjbGFzcyB3aGljaCBjcmVhdGVzIGFuZCBzdG9yZXMgYSB2YWx1ZSBmb3IgYW55IGtleSB3aGljaCBkb2VzXG4gICAgICAgKiBub3QgZXhpc3Qgd2hlbiBhY2Nlc3NlZCwgYnV0IGJlaGF2ZXMgZXhhY3RseSBhcyBhbiBvcmRpbmFyeSBXZWFrTWFwXG4gICAgICAgKiBvdGhlcndpc2UuXG4gICAgICAgKlxuICAgICAgICogQHBhcmFtIHtmdW5jdGlvbn0gY3JlYXRlSXRlbVxuICAgICAgICogICAgICAgIEEgZnVuY3Rpb24gd2hpY2ggd2lsbCBiZSBjYWxsZWQgaW4gb3JkZXIgdG8gY3JlYXRlIHRoZSB2YWx1ZSBmb3IgYW55XG4gICAgICAgKiAgICAgICAga2V5IHdoaWNoIGRvZXMgbm90IGV4aXN0LCB0aGUgZmlyc3QgdGltZSBpdCBpcyBhY2Nlc3NlZC4gVGhlXG4gICAgICAgKiAgICAgICAgZnVuY3Rpb24gcmVjZWl2ZXMsIGFzIGl0cyBvbmx5IGFyZ3VtZW50LCB0aGUga2V5IGJlaW5nIGNyZWF0ZWQuXG4gICAgICAgKi9cblxuXG4gICAgICBjbGFzcyBEZWZhdWx0V2Vha01hcCBleHRlbmRzIFdlYWtNYXAge1xuICAgICAgICBjb25zdHJ1Y3RvcihjcmVhdGVJdGVtLCBpdGVtcyA9IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHN1cGVyKGl0ZW1zKTtcbiAgICAgICAgICB0aGlzLmNyZWF0ZUl0ZW0gPSBjcmVhdGVJdGVtO1xuICAgICAgICB9XG5cbiAgICAgICAgZ2V0KGtleSkge1xuICAgICAgICAgIGlmICghdGhpcy5oYXMoa2V5KSkge1xuICAgICAgICAgICAgdGhpcy5zZXQoa2V5LCB0aGlzLmNyZWF0ZUl0ZW0oa2V5KSk7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcmV0dXJuIHN1cGVyLmdldChrZXkpO1xuICAgICAgICB9XG5cbiAgICAgIH1cbiAgICAgIC8qKlxuICAgICAgICogUmV0dXJucyB0cnVlIGlmIHRoZSBnaXZlbiBvYmplY3QgaXMgYW4gb2JqZWN0IHdpdGggYSBgdGhlbmAgbWV0aG9kLCBhbmQgY2FuXG4gICAgICAgKiB0aGVyZWZvcmUgYmUgYXNzdW1lZCB0byBiZWhhdmUgYXMgYSBQcm9taXNlLlxuICAgICAgICpcbiAgICAgICAqIEBwYXJhbSB7Kn0gdmFsdWUgVGhlIHZhbHVlIHRvIHRlc3QuXG4gICAgICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gVHJ1ZSBpZiB0aGUgdmFsdWUgaXMgdGhlbmFibGUuXG4gICAgICAgKi9cblxuXG4gICAgICBjb25zdCBpc1RoZW5hYmxlID0gdmFsdWUgPT4ge1xuICAgICAgICByZXR1cm4gdmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiICYmIHR5cGVvZiB2YWx1ZS50aGVuID09PSBcImZ1bmN0aW9uXCI7XG4gICAgICB9O1xuICAgICAgLyoqXG4gICAgICAgKiBDcmVhdGVzIGFuZCByZXR1cm5zIGEgZnVuY3Rpb24gd2hpY2gsIHdoZW4gY2FsbGVkLCB3aWxsIHJlc29sdmUgb3IgcmVqZWN0XG4gICAgICAgKiB0aGUgZ2l2ZW4gcHJvbWlzZSBiYXNlZCBvbiBob3cgaXQgaXMgY2FsbGVkOlxuICAgICAgICpcbiAgICAgICAqIC0gSWYsIHdoZW4gY2FsbGVkLCBgY2hyb21lLnJ1bnRpbWUubGFzdEVycm9yYCBjb250YWlucyBhIG5vbi1udWxsIG9iamVjdCxcbiAgICAgICAqICAgdGhlIHByb21pc2UgaXMgcmVqZWN0ZWQgd2l0aCB0aGF0IHZhbHVlLlxuICAgICAgICogLSBJZiB0aGUgZnVuY3Rpb24gaXMgY2FsbGVkIHdpdGggZXhhY3RseSBvbmUgYXJndW1lbnQsIHRoZSBwcm9taXNlIGlzXG4gICAgICAgKiAgIHJlc29sdmVkIHRvIHRoYXQgdmFsdWUuXG4gICAgICAgKiAtIE90aGVyd2lzZSwgdGhlIHByb21pc2UgaXMgcmVzb2x2ZWQgdG8gYW4gYXJyYXkgY29udGFpbmluZyBhbGwgb2YgdGhlXG4gICAgICAgKiAgIGZ1bmN0aW9uJ3MgYXJndW1lbnRzLlxuICAgICAgICpcbiAgICAgICAqIEBwYXJhbSB7b2JqZWN0fSBwcm9taXNlXG4gICAgICAgKiAgICAgICAgQW4gb2JqZWN0IGNvbnRhaW5pbmcgdGhlIHJlc29sdXRpb24gYW5kIHJlamVjdGlvbiBmdW5jdGlvbnMgb2YgYVxuICAgICAgICogICAgICAgIHByb21pc2UuXG4gICAgICAgKiBAcGFyYW0ge2Z1bmN0aW9ufSBwcm9taXNlLnJlc29sdmVcbiAgICAgICAqICAgICAgICBUaGUgcHJvbWlzZSdzIHJlc29sdXRpb24gZnVuY3Rpb24uXG4gICAgICAgKiBAcGFyYW0ge2Z1bmN0aW9ufSBwcm9taXNlLnJlamVjdGlvblxuICAgICAgICogICAgICAgIFRoZSBwcm9taXNlJ3MgcmVqZWN0aW9uIGZ1bmN0aW9uLlxuICAgICAgICogQHBhcmFtIHtvYmplY3R9IG1ldGFkYXRhXG4gICAgICAgKiAgICAgICAgTWV0YWRhdGEgYWJvdXQgdGhlIHdyYXBwZWQgbWV0aG9kIHdoaWNoIGhhcyBjcmVhdGVkIHRoZSBjYWxsYmFjay5cbiAgICAgICAqIEBwYXJhbSB7aW50ZWdlcn0gbWV0YWRhdGEubWF4UmVzb2x2ZWRBcmdzXG4gICAgICAgKiAgICAgICAgVGhlIG1heGltdW0gbnVtYmVyIG9mIGFyZ3VtZW50cyB3aGljaCBtYXkgYmUgcGFzc2VkIHRvIHRoZVxuICAgICAgICogICAgICAgIGNhbGxiYWNrIGNyZWF0ZWQgYnkgdGhlIHdyYXBwZWQgYXN5bmMgZnVuY3Rpb24uXG4gICAgICAgKlxuICAgICAgICogQHJldHVybnMge2Z1bmN0aW9ufVxuICAgICAgICogICAgICAgIFRoZSBnZW5lcmF0ZWQgY2FsbGJhY2sgZnVuY3Rpb24uXG4gICAgICAgKi9cblxuXG4gICAgICBjb25zdCBtYWtlQ2FsbGJhY2sgPSAocHJvbWlzZSwgbWV0YWRhdGEpID0+IHtcbiAgICAgICAgcmV0dXJuICguLi5jYWxsYmFja0FyZ3MpID0+IHtcbiAgICAgICAgICBpZiAoZXh0ZW5zaW9uQVBJcy5ydW50aW1lLmxhc3RFcnJvcikge1xuICAgICAgICAgICAgcHJvbWlzZS5yZWplY3QoZXh0ZW5zaW9uQVBJcy5ydW50aW1lLmxhc3RFcnJvcik7XG4gICAgICAgICAgfSBlbHNlIGlmIChtZXRhZGF0YS5zaW5nbGVDYWxsYmFja0FyZyB8fCBjYWxsYmFja0FyZ3MubGVuZ3RoIDw9IDEgJiYgbWV0YWRhdGEuc2luZ2xlQ2FsbGJhY2tBcmcgIT09IGZhbHNlKSB7XG4gICAgICAgICAgICBwcm9taXNlLnJlc29sdmUoY2FsbGJhY2tBcmdzWzBdKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcHJvbWlzZS5yZXNvbHZlKGNhbGxiYWNrQXJncyk7XG4gICAgICAgICAgfVxuICAgICAgICB9O1xuICAgICAgfTtcblxuICAgICAgY29uc3QgcGx1cmFsaXplQXJndW1lbnRzID0gbnVtQXJncyA9PiBudW1BcmdzID09IDEgPyBcImFyZ3VtZW50XCIgOiBcImFyZ3VtZW50c1wiO1xuICAgICAgLyoqXG4gICAgICAgKiBDcmVhdGVzIGEgd3JhcHBlciBmdW5jdGlvbiBmb3IgYSBtZXRob2Qgd2l0aCB0aGUgZ2l2ZW4gbmFtZSBhbmQgbWV0YWRhdGEuXG4gICAgICAgKlxuICAgICAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWVcbiAgICAgICAqICAgICAgICBUaGUgbmFtZSBvZiB0aGUgbWV0aG9kIHdoaWNoIGlzIGJlaW5nIHdyYXBwZWQuXG4gICAgICAgKiBAcGFyYW0ge29iamVjdH0gbWV0YWRhdGFcbiAgICAgICAqICAgICAgICBNZXRhZGF0YSBhYm91dCB0aGUgbWV0aG9kIGJlaW5nIHdyYXBwZWQuXG4gICAgICAgKiBAcGFyYW0ge2ludGVnZXJ9IG1ldGFkYXRhLm1pbkFyZ3NcbiAgICAgICAqICAgICAgICBUaGUgbWluaW11bSBudW1iZXIgb2YgYXJndW1lbnRzIHdoaWNoIG11c3QgYmUgcGFzc2VkIHRvIHRoZVxuICAgICAgICogICAgICAgIGZ1bmN0aW9uLiBJZiBjYWxsZWQgd2l0aCBmZXdlciB0aGFuIHRoaXMgbnVtYmVyIG9mIGFyZ3VtZW50cywgdGhlXG4gICAgICAgKiAgICAgICAgd3JhcHBlciB3aWxsIHJhaXNlIGFuIGV4Y2VwdGlvbi5cbiAgICAgICAqIEBwYXJhbSB7aW50ZWdlcn0gbWV0YWRhdGEubWF4QXJnc1xuICAgICAgICogICAgICAgIFRoZSBtYXhpbXVtIG51bWJlciBvZiBhcmd1bWVudHMgd2hpY2ggbWF5IGJlIHBhc3NlZCB0byB0aGVcbiAgICAgICAqICAgICAgICBmdW5jdGlvbi4gSWYgY2FsbGVkIHdpdGggbW9yZSB0aGFuIHRoaXMgbnVtYmVyIG9mIGFyZ3VtZW50cywgdGhlXG4gICAgICAgKiAgICAgICAgd3JhcHBlciB3aWxsIHJhaXNlIGFuIGV4Y2VwdGlvbi5cbiAgICAgICAqIEBwYXJhbSB7aW50ZWdlcn0gbWV0YWRhdGEubWF4UmVzb2x2ZWRBcmdzXG4gICAgICAgKiAgICAgICAgVGhlIG1heGltdW0gbnVtYmVyIG9mIGFyZ3VtZW50cyB3aGljaCBtYXkgYmUgcGFzc2VkIHRvIHRoZVxuICAgICAgICogICAgICAgIGNhbGxiYWNrIGNyZWF0ZWQgYnkgdGhlIHdyYXBwZWQgYXN5bmMgZnVuY3Rpb24uXG4gICAgICAgKlxuICAgICAgICogQHJldHVybnMge2Z1bmN0aW9uKG9iamVjdCwgLi4uKil9XG4gICAgICAgKiAgICAgICBUaGUgZ2VuZXJhdGVkIHdyYXBwZXIgZnVuY3Rpb24uXG4gICAgICAgKi9cblxuXG4gICAgICBjb25zdCB3cmFwQXN5bmNGdW5jdGlvbiA9IChuYW1lLCBtZXRhZGF0YSkgPT4ge1xuICAgICAgICByZXR1cm4gZnVuY3Rpb24gYXN5bmNGdW5jdGlvbldyYXBwZXIodGFyZ2V0LCAuLi5hcmdzKSB7XG4gICAgICAgICAgaWYgKGFyZ3MubGVuZ3RoIDwgbWV0YWRhdGEubWluQXJncykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBhdCBsZWFzdCAke21ldGFkYXRhLm1pbkFyZ3N9ICR7cGx1cmFsaXplQXJndW1lbnRzKG1ldGFkYXRhLm1pbkFyZ3MpfSBmb3IgJHtuYW1lfSgpLCBnb3QgJHthcmdzLmxlbmd0aH1gKTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAoYXJncy5sZW5ndGggPiBtZXRhZGF0YS5tYXhBcmdzKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGF0IG1vc3QgJHttZXRhZGF0YS5tYXhBcmdzfSAke3BsdXJhbGl6ZUFyZ3VtZW50cyhtZXRhZGF0YS5tYXhBcmdzKX0gZm9yICR7bmFtZX0oKSwgZ290ICR7YXJncy5sZW5ndGh9YCk7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgICAgIGlmIChtZXRhZGF0YS5mYWxsYmFja1RvTm9DYWxsYmFjaykge1xuICAgICAgICAgICAgICAvLyBUaGlzIEFQSSBtZXRob2QgaGFzIGN1cnJlbnRseSBubyBjYWxsYmFjayBvbiBDaHJvbWUsIGJ1dCBpdCByZXR1cm4gYSBwcm9taXNlIG9uIEZpcmVmb3gsXG4gICAgICAgICAgICAgIC8vIGFuZCBzbyB0aGUgcG9seWZpbGwgd2lsbCB0cnkgdG8gY2FsbCBpdCB3aXRoIGEgY2FsbGJhY2sgZmlyc3QsIGFuZCBpdCB3aWxsIGZhbGxiYWNrXG4gICAgICAgICAgICAgIC8vIHRvIG5vdCBwYXNzaW5nIHRoZSBjYWxsYmFjayBpZiB0aGUgZmlyc3QgY2FsbCBmYWlscy5cbiAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICB0YXJnZXRbbmFtZV0oLi4uYXJncywgbWFrZUNhbGxiYWNrKHtcbiAgICAgICAgICAgICAgICAgIHJlc29sdmUsXG4gICAgICAgICAgICAgICAgICByZWplY3RcbiAgICAgICAgICAgICAgICB9LCBtZXRhZGF0YSkpO1xuICAgICAgICAgICAgICB9IGNhdGNoIChjYkVycm9yKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS53YXJuKGAke25hbWV9IEFQSSBtZXRob2QgZG9lc24ndCBzZWVtIHRvIHN1cHBvcnQgdGhlIGNhbGxiYWNrIHBhcmFtZXRlciwgYCArIFwiZmFsbGluZyBiYWNrIHRvIGNhbGwgaXQgd2l0aG91dCBhIGNhbGxiYWNrOiBcIiwgY2JFcnJvcik7XG4gICAgICAgICAgICAgICAgdGFyZ2V0W25hbWVdKC4uLmFyZ3MpOyAvLyBVcGRhdGUgdGhlIEFQSSBtZXRob2QgbWV0YWRhdGEsIHNvIHRoYXQgdGhlIG5leHQgQVBJIGNhbGxzIHdpbGwgbm90IHRyeSB0b1xuICAgICAgICAgICAgICAgIC8vIHVzZSB0aGUgdW5zdXBwb3J0ZWQgY2FsbGJhY2sgYW55bW9yZS5cblxuICAgICAgICAgICAgICAgIG1ldGFkYXRhLmZhbGxiYWNrVG9Ob0NhbGxiYWNrID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgbWV0YWRhdGEubm9DYWxsYmFjayA9IHRydWU7XG4gICAgICAgICAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGVsc2UgaWYgKG1ldGFkYXRhLm5vQ2FsbGJhY2spIHtcbiAgICAgICAgICAgICAgdGFyZ2V0W25hbWVdKC4uLmFyZ3MpO1xuICAgICAgICAgICAgICByZXNvbHZlKCk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICB0YXJnZXRbbmFtZV0oLi4uYXJncywgbWFrZUNhbGxiYWNrKHtcbiAgICAgICAgICAgICAgICByZXNvbHZlLFxuICAgICAgICAgICAgICAgIHJlamVjdFxuICAgICAgICAgICAgICB9LCBtZXRhZGF0YSkpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICB9O1xuICAgICAgfTtcbiAgICAgIC8qKlxuICAgICAgICogV3JhcHMgYW4gZXhpc3RpbmcgbWV0aG9kIG9mIHRoZSB0YXJnZXQgb2JqZWN0LCBzbyB0aGF0IGNhbGxzIHRvIGl0IGFyZVxuICAgICAgICogaW50ZXJjZXB0ZWQgYnkgdGhlIGdpdmVuIHdyYXBwZXIgZnVuY3Rpb24uIFRoZSB3cmFwcGVyIGZ1bmN0aW9uIHJlY2VpdmVzLFxuICAgICAgICogYXMgaXRzIGZpcnN0IGFyZ3VtZW50LCB0aGUgb3JpZ2luYWwgYHRhcmdldGAgb2JqZWN0LCBmb2xsb3dlZCBieSBlYWNoIG9mXG4gICAgICAgKiB0aGUgYXJndW1lbnRzIHBhc3NlZCB0byB0aGUgb3JpZ2luYWwgbWV0aG9kLlxuICAgICAgICpcbiAgICAgICAqIEBwYXJhbSB7b2JqZWN0fSB0YXJnZXRcbiAgICAgICAqICAgICAgICBUaGUgb3JpZ2luYWwgdGFyZ2V0IG9iamVjdCB0aGF0IHRoZSB3cmFwcGVkIG1ldGhvZCBiZWxvbmdzIHRvLlxuICAgICAgICogQHBhcmFtIHtmdW5jdGlvbn0gbWV0aG9kXG4gICAgICAgKiAgICAgICAgVGhlIG1ldGhvZCBiZWluZyB3cmFwcGVkLiBUaGlzIGlzIHVzZWQgYXMgdGhlIHRhcmdldCBvZiB0aGUgUHJveHlcbiAgICAgICAqICAgICAgICBvYmplY3Qgd2hpY2ggaXMgY3JlYXRlZCB0byB3cmFwIHRoZSBtZXRob2QuXG4gICAgICAgKiBAcGFyYW0ge2Z1bmN0aW9ufSB3cmFwcGVyXG4gICAgICAgKiAgICAgICAgVGhlIHdyYXBwZXIgZnVuY3Rpb24gd2hpY2ggaXMgY2FsbGVkIGluIHBsYWNlIG9mIGEgZGlyZWN0IGludm9jYXRpb25cbiAgICAgICAqICAgICAgICBvZiB0aGUgd3JhcHBlZCBtZXRob2QuXG4gICAgICAgKlxuICAgICAgICogQHJldHVybnMge1Byb3h5PGZ1bmN0aW9uPn1cbiAgICAgICAqICAgICAgICBBIFByb3h5IG9iamVjdCBmb3IgdGhlIGdpdmVuIG1ldGhvZCwgd2hpY2ggaW52b2tlcyB0aGUgZ2l2ZW4gd3JhcHBlclxuICAgICAgICogICAgICAgIG1ldGhvZCBpbiBpdHMgcGxhY2UuXG4gICAgICAgKi9cblxuXG4gICAgICBjb25zdCB3cmFwTWV0aG9kID0gKHRhcmdldCwgbWV0aG9kLCB3cmFwcGVyKSA9PiB7XG4gICAgICAgIHJldHVybiBuZXcgUHJveHkobWV0aG9kLCB7XG4gICAgICAgICAgYXBwbHkodGFyZ2V0TWV0aG9kLCB0aGlzT2JqLCBhcmdzKSB7XG4gICAgICAgICAgICByZXR1cm4gd3JhcHBlci5jYWxsKHRoaXNPYmosIHRhcmdldCwgLi4uYXJncyk7XG4gICAgICAgICAgfVxuXG4gICAgICAgIH0pO1xuICAgICAgfTtcblxuICAgICAgbGV0IGhhc093blByb3BlcnR5ID0gRnVuY3Rpb24uY2FsbC5iaW5kKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkpO1xuICAgICAgLyoqXG4gICAgICAgKiBXcmFwcyBhbiBvYmplY3QgaW4gYSBQcm94eSB3aGljaCBpbnRlcmNlcHRzIGFuZCB3cmFwcyBjZXJ0YWluIG1ldGhvZHNcbiAgICAgICAqIGJhc2VkIG9uIHRoZSBnaXZlbiBgd3JhcHBlcnNgIGFuZCBgbWV0YWRhdGFgIG9iamVjdHMuXG4gICAgICAgKlxuICAgICAgICogQHBhcmFtIHtvYmplY3R9IHRhcmdldFxuICAgICAgICogICAgICAgIFRoZSB0YXJnZXQgb2JqZWN0IHRvIHdyYXAuXG4gICAgICAgKlxuICAgICAgICogQHBhcmFtIHtvYmplY3R9IFt3cmFwcGVycyA9IHt9XVxuICAgICAgICogICAgICAgIEFuIG9iamVjdCB0cmVlIGNvbnRhaW5pbmcgd3JhcHBlciBmdW5jdGlvbnMgZm9yIHNwZWNpYWwgY2FzZXMuIEFueVxuICAgICAgICogICAgICAgIGZ1bmN0aW9uIHByZXNlbnQgaW4gdGhpcyBvYmplY3QgdHJlZSBpcyBjYWxsZWQgaW4gcGxhY2Ugb2YgdGhlXG4gICAgICAgKiAgICAgICAgbWV0aG9kIGluIHRoZSBzYW1lIGxvY2F0aW9uIGluIHRoZSBgdGFyZ2V0YCBvYmplY3QgdHJlZS4gVGhlc2VcbiAgICAgICAqICAgICAgICB3cmFwcGVyIG1ldGhvZHMgYXJlIGludm9rZWQgYXMgZGVzY3JpYmVkIGluIHtAc2VlIHdyYXBNZXRob2R9LlxuICAgICAgICpcbiAgICAgICAqIEBwYXJhbSB7b2JqZWN0fSBbbWV0YWRhdGEgPSB7fV1cbiAgICAgICAqICAgICAgICBBbiBvYmplY3QgdHJlZSBjb250YWluaW5nIG1ldGFkYXRhIHVzZWQgdG8gYXV0b21hdGljYWxseSBnZW5lcmF0ZVxuICAgICAgICogICAgICAgIFByb21pc2UtYmFzZWQgd3JhcHBlciBmdW5jdGlvbnMgZm9yIGFzeW5jaHJvbm91cy4gQW55IGZ1bmN0aW9uIGluXG4gICAgICAgKiAgICAgICAgdGhlIGB0YXJnZXRgIG9iamVjdCB0cmVlIHdoaWNoIGhhcyBhIGNvcnJlc3BvbmRpbmcgbWV0YWRhdGEgb2JqZWN0XG4gICAgICAgKiAgICAgICAgaW4gdGhlIHNhbWUgbG9jYXRpb24gaW4gdGhlIGBtZXRhZGF0YWAgdHJlZSBpcyByZXBsYWNlZCB3aXRoIGFuXG4gICAgICAgKiAgICAgICAgYXV0b21hdGljYWxseS1nZW5lcmF0ZWQgd3JhcHBlciBmdW5jdGlvbiwgYXMgZGVzY3JpYmVkIGluXG4gICAgICAgKiAgICAgICAge0BzZWUgd3JhcEFzeW5jRnVuY3Rpb259XG4gICAgICAgKlxuICAgICAgICogQHJldHVybnMge1Byb3h5PG9iamVjdD59XG4gICAgICAgKi9cblxuICAgICAgY29uc3Qgd3JhcE9iamVjdCA9ICh0YXJnZXQsIHdyYXBwZXJzID0ge30sIG1ldGFkYXRhID0ge30pID0+IHtcbiAgICAgICAgbGV0IGNhY2hlID0gT2JqZWN0LmNyZWF0ZShudWxsKTtcbiAgICAgICAgbGV0IGhhbmRsZXJzID0ge1xuICAgICAgICAgIGhhcyhwcm94eVRhcmdldCwgcHJvcCkge1xuICAgICAgICAgICAgcmV0dXJuIHByb3AgaW4gdGFyZ2V0IHx8IHByb3AgaW4gY2FjaGU7XG4gICAgICAgICAgfSxcblxuICAgICAgICAgIGdldChwcm94eVRhcmdldCwgcHJvcCwgcmVjZWl2ZXIpIHtcbiAgICAgICAgICAgIGlmIChwcm9wIGluIGNhY2hlKSB7XG4gICAgICAgICAgICAgIHJldHVybiBjYWNoZVtwcm9wXTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKCEocHJvcCBpbiB0YXJnZXQpKSB7XG4gICAgICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGxldCB2YWx1ZSA9IHRhcmdldFtwcm9wXTtcblxuICAgICAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgICAgIC8vIFRoaXMgaXMgYSBtZXRob2Qgb24gdGhlIHVuZGVybHlpbmcgb2JqZWN0LiBDaGVjayBpZiB3ZSBuZWVkIHRvIGRvXG4gICAgICAgICAgICAgIC8vIGFueSB3cmFwcGluZy5cbiAgICAgICAgICAgICAgaWYgKHR5cGVvZiB3cmFwcGVyc1twcm9wXSA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgICAgICAgLy8gV2UgaGF2ZSBhIHNwZWNpYWwtY2FzZSB3cmFwcGVyIGZvciB0aGlzIG1ldGhvZC5cbiAgICAgICAgICAgICAgICB2YWx1ZSA9IHdyYXBNZXRob2QodGFyZ2V0LCB0YXJnZXRbcHJvcF0sIHdyYXBwZXJzW3Byb3BdKTtcbiAgICAgICAgICAgICAgfSBlbHNlIGlmIChoYXNPd25Qcm9wZXJ0eShtZXRhZGF0YSwgcHJvcCkpIHtcbiAgICAgICAgICAgICAgICAvLyBUaGlzIGlzIGFuIGFzeW5jIG1ldGhvZCB0aGF0IHdlIGhhdmUgbWV0YWRhdGEgZm9yLiBDcmVhdGUgYVxuICAgICAgICAgICAgICAgIC8vIFByb21pc2Ugd3JhcHBlciBmb3IgaXQuXG4gICAgICAgICAgICAgICAgbGV0IHdyYXBwZXIgPSB3cmFwQXN5bmNGdW5jdGlvbihwcm9wLCBtZXRhZGF0YVtwcm9wXSk7XG4gICAgICAgICAgICAgICAgdmFsdWUgPSB3cmFwTWV0aG9kKHRhcmdldCwgdGFyZ2V0W3Byb3BdLCB3cmFwcGVyKTtcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAvLyBUaGlzIGlzIGEgbWV0aG9kIHRoYXQgd2UgZG9uJ3Qga25vdyBvciBjYXJlIGFib3V0LiBSZXR1cm4gdGhlXG4gICAgICAgICAgICAgICAgLy8gb3JpZ2luYWwgbWV0aG9kLCBib3VuZCB0byB0aGUgdW5kZXJseWluZyBvYmplY3QuXG4gICAgICAgICAgICAgICAgdmFsdWUgPSB2YWx1ZS5iaW5kKHRhcmdldCk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSBpZiAodHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiICYmIHZhbHVlICE9PSBudWxsICYmIChoYXNPd25Qcm9wZXJ0eSh3cmFwcGVycywgcHJvcCkgfHwgaGFzT3duUHJvcGVydHkobWV0YWRhdGEsIHByb3ApKSkge1xuICAgICAgICAgICAgICAvLyBUaGlzIGlzIGFuIG9iamVjdCB0aGF0IHdlIG5lZWQgdG8gZG8gc29tZSB3cmFwcGluZyBmb3IgdGhlIGNoaWxkcmVuXG4gICAgICAgICAgICAgIC8vIG9mLiBDcmVhdGUgYSBzdWItb2JqZWN0IHdyYXBwZXIgZm9yIGl0IHdpdGggdGhlIGFwcHJvcHJpYXRlIGNoaWxkXG4gICAgICAgICAgICAgIC8vIG1ldGFkYXRhLlxuICAgICAgICAgICAgICB2YWx1ZSA9IHdyYXBPYmplY3QodmFsdWUsIHdyYXBwZXJzW3Byb3BdLCBtZXRhZGF0YVtwcm9wXSk7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKGhhc093blByb3BlcnR5KG1ldGFkYXRhLCBcIipcIikpIHtcbiAgICAgICAgICAgICAgLy8gV3JhcCBhbGwgcHJvcGVydGllcyBpbiAqIG5hbWVzcGFjZS5cbiAgICAgICAgICAgICAgdmFsdWUgPSB3cmFwT2JqZWN0KHZhbHVlLCB3cmFwcGVyc1twcm9wXSwgbWV0YWRhdGFbXCIqXCJdKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIC8vIFdlIGRvbid0IG5lZWQgdG8gZG8gYW55IHdyYXBwaW5nIGZvciB0aGlzIHByb3BlcnR5LFxuICAgICAgICAgICAgICAvLyBzbyBqdXN0IGZvcndhcmQgYWxsIGFjY2VzcyB0byB0aGUgdW5kZXJseWluZyBvYmplY3QuXG4gICAgICAgICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShjYWNoZSwgcHJvcCwge1xuICAgICAgICAgICAgICAgIGNvbmZpZ3VyYWJsZTogdHJ1ZSxcbiAgICAgICAgICAgICAgICBlbnVtZXJhYmxlOiB0cnVlLFxuXG4gICAgICAgICAgICAgICAgZ2V0KCkge1xuICAgICAgICAgICAgICAgICAgcmV0dXJuIHRhcmdldFtwcm9wXTtcbiAgICAgICAgICAgICAgICB9LFxuXG4gICAgICAgICAgICAgICAgc2V0KHZhbHVlKSB7XG4gICAgICAgICAgICAgICAgICB0YXJnZXRbcHJvcF0gPSB2YWx1ZTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgIHJldHVybiB2YWx1ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY2FjaGVbcHJvcF0gPSB2YWx1ZTtcbiAgICAgICAgICAgIHJldHVybiB2YWx1ZTtcbiAgICAgICAgICB9LFxuXG4gICAgICAgICAgc2V0KHByb3h5VGFyZ2V0LCBwcm9wLCB2YWx1ZSwgcmVjZWl2ZXIpIHtcbiAgICAgICAgICAgIGlmIChwcm9wIGluIGNhY2hlKSB7XG4gICAgICAgICAgICAgIGNhY2hlW3Byb3BdID0gdmFsdWU7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICB0YXJnZXRbcHJvcF0gPSB2YWx1ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgfSxcblxuICAgICAgICAgIGRlZmluZVByb3BlcnR5KHByb3h5VGFyZ2V0LCBwcm9wLCBkZXNjKSB7XG4gICAgICAgICAgICByZXR1cm4gUmVmbGVjdC5kZWZpbmVQcm9wZXJ0eShjYWNoZSwgcHJvcCwgZGVzYyk7XG4gICAgICAgICAgfSxcblxuICAgICAgICAgIGRlbGV0ZVByb3BlcnR5KHByb3h5VGFyZ2V0LCBwcm9wKSB7XG4gICAgICAgICAgICByZXR1cm4gUmVmbGVjdC5kZWxldGVQcm9wZXJ0eShjYWNoZSwgcHJvcCk7XG4gICAgICAgICAgfVxuXG4gICAgICAgIH07IC8vIFBlciBjb250cmFjdCBvZiB0aGUgUHJveHkgQVBJLCB0aGUgXCJnZXRcIiBwcm94eSBoYW5kbGVyIG11c3QgcmV0dXJuIHRoZVxuICAgICAgICAvLyBvcmlnaW5hbCB2YWx1ZSBvZiB0aGUgdGFyZ2V0IGlmIHRoYXQgdmFsdWUgaXMgZGVjbGFyZWQgcmVhZC1vbmx5IGFuZFxuICAgICAgICAvLyBub24tY29uZmlndXJhYmxlLiBGb3IgdGhpcyByZWFzb24sIHdlIGNyZWF0ZSBhbiBvYmplY3Qgd2l0aCB0aGVcbiAgICAgICAgLy8gcHJvdG90eXBlIHNldCB0byBgdGFyZ2V0YCBpbnN0ZWFkIG9mIHVzaW5nIGB0YXJnZXRgIGRpcmVjdGx5LlxuICAgICAgICAvLyBPdGhlcndpc2Ugd2UgY2Fubm90IHJldHVybiBhIGN1c3RvbSBvYmplY3QgZm9yIEFQSXMgdGhhdFxuICAgICAgICAvLyBhcmUgZGVjbGFyZWQgcmVhZC1vbmx5IGFuZCBub24tY29uZmlndXJhYmxlLCBzdWNoIGFzIGBjaHJvbWUuZGV2dG9vbHNgLlxuICAgICAgICAvL1xuICAgICAgICAvLyBUaGUgcHJveHkgaGFuZGxlcnMgdGhlbXNlbHZlcyB3aWxsIHN0aWxsIHVzZSB0aGUgb3JpZ2luYWwgYHRhcmdldGBcbiAgICAgICAgLy8gaW5zdGVhZCBvZiB0aGUgYHByb3h5VGFyZ2V0YCwgc28gdGhhdCB0aGUgbWV0aG9kcyBhbmQgcHJvcGVydGllcyBhcmVcbiAgICAgICAgLy8gZGVyZWZlcmVuY2VkIHZpYSB0aGUgb3JpZ2luYWwgdGFyZ2V0cy5cblxuICAgICAgICBsZXQgcHJveHlUYXJnZXQgPSBPYmplY3QuY3JlYXRlKHRhcmdldCk7XG4gICAgICAgIHJldHVybiBuZXcgUHJveHkocHJveHlUYXJnZXQsIGhhbmRsZXJzKTtcbiAgICAgIH07XG4gICAgICAvKipcbiAgICAgICAqIENyZWF0ZXMgYSBzZXQgb2Ygd3JhcHBlciBmdW5jdGlvbnMgZm9yIGFuIGV2ZW50IG9iamVjdCwgd2hpY2ggaGFuZGxlc1xuICAgICAgICogd3JhcHBpbmcgb2YgbGlzdGVuZXIgZnVuY3Rpb25zIHRoYXQgdGhvc2UgbWVzc2FnZXMgYXJlIHBhc3NlZC5cbiAgICAgICAqXG4gICAgICAgKiBBIHNpbmdsZSB3cmFwcGVyIGlzIGNyZWF0ZWQgZm9yIGVhY2ggbGlzdGVuZXIgZnVuY3Rpb24sIGFuZCBzdG9yZWQgaW4gYVxuICAgICAgICogbWFwLiBTdWJzZXF1ZW50IGNhbGxzIHRvIGBhZGRMaXN0ZW5lcmAsIGBoYXNMaXN0ZW5lcmAsIG9yIGByZW1vdmVMaXN0ZW5lcmBcbiAgICAgICAqIHJldHJpZXZlIHRoZSBvcmlnaW5hbCB3cmFwcGVyLCBzbyB0aGF0ICBhdHRlbXB0cyB0byByZW1vdmUgYVxuICAgICAgICogcHJldmlvdXNseS1hZGRlZCBsaXN0ZW5lciB3b3JrIGFzIGV4cGVjdGVkLlxuICAgICAgICpcbiAgICAgICAqIEBwYXJhbSB7RGVmYXVsdFdlYWtNYXA8ZnVuY3Rpb24sIGZ1bmN0aW9uPn0gd3JhcHBlck1hcFxuICAgICAgICogICAgICAgIEEgRGVmYXVsdFdlYWtNYXAgb2JqZWN0IHdoaWNoIHdpbGwgY3JlYXRlIHRoZSBhcHByb3ByaWF0ZSB3cmFwcGVyXG4gICAgICAgKiAgICAgICAgZm9yIGEgZ2l2ZW4gbGlzdGVuZXIgZnVuY3Rpb24gd2hlbiBvbmUgZG9lcyBub3QgZXhpc3QsIGFuZCByZXRyaWV2ZVxuICAgICAgICogICAgICAgIGFuIGV4aXN0aW5nIG9uZSB3aGVuIGl0IGRvZXMuXG4gICAgICAgKlxuICAgICAgICogQHJldHVybnMge29iamVjdH1cbiAgICAgICAqL1xuXG5cbiAgICAgIGNvbnN0IHdyYXBFdmVudCA9IHdyYXBwZXJNYXAgPT4gKHtcbiAgICAgICAgYWRkTGlzdGVuZXIodGFyZ2V0LCBsaXN0ZW5lciwgLi4uYXJncykge1xuICAgICAgICAgIHRhcmdldC5hZGRMaXN0ZW5lcih3cmFwcGVyTWFwLmdldChsaXN0ZW5lciksIC4uLmFyZ3MpO1xuICAgICAgICB9LFxuXG4gICAgICAgIGhhc0xpc3RlbmVyKHRhcmdldCwgbGlzdGVuZXIpIHtcbiAgICAgICAgICByZXR1cm4gdGFyZ2V0Lmhhc0xpc3RlbmVyKHdyYXBwZXJNYXAuZ2V0KGxpc3RlbmVyKSk7XG4gICAgICAgIH0sXG5cbiAgICAgICAgcmVtb3ZlTGlzdGVuZXIodGFyZ2V0LCBsaXN0ZW5lcikge1xuICAgICAgICAgIHRhcmdldC5yZW1vdmVMaXN0ZW5lcih3cmFwcGVyTWFwLmdldChsaXN0ZW5lcikpO1xuICAgICAgICB9XG5cbiAgICAgIH0pOyAvLyBLZWVwIHRyYWNrIGlmIHRoZSBkZXByZWNhdGlvbiB3YXJuaW5nIGhhcyBiZWVuIGxvZ2dlZCBhdCBsZWFzdCBvbmNlLlxuXG5cbiAgICAgIGxldCBsb2dnZWRTZW5kUmVzcG9uc2VEZXByZWNhdGlvbldhcm5pbmcgPSBmYWxzZTtcbiAgICAgIGNvbnN0IG9uTWVzc2FnZVdyYXBwZXJzID0gbmV3IERlZmF1bHRXZWFrTWFwKGxpc3RlbmVyID0+IHtcbiAgICAgICAgaWYgKHR5cGVvZiBsaXN0ZW5lciAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgcmV0dXJuIGxpc3RlbmVyO1xuICAgICAgICB9XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBXcmFwcyBhIG1lc3NhZ2UgbGlzdGVuZXIgZnVuY3Rpb24gc28gdGhhdCBpdCBtYXkgc2VuZCByZXNwb25zZXMgYmFzZWQgb25cbiAgICAgICAgICogaXRzIHJldHVybiB2YWx1ZSwgcmF0aGVyIHRoYW4gYnkgcmV0dXJuaW5nIGEgc2VudGluZWwgdmFsdWUgYW5kIGNhbGxpbmcgYVxuICAgICAgICAgKiBjYWxsYmFjay4gSWYgdGhlIGxpc3RlbmVyIGZ1bmN0aW9uIHJldHVybnMgYSBQcm9taXNlLCB0aGUgcmVzcG9uc2UgaXNcbiAgICAgICAgICogc2VudCB3aGVuIHRoZSBwcm9taXNlIGVpdGhlciByZXNvbHZlcyBvciByZWplY3RzLlxuICAgICAgICAgKlxuICAgICAgICAgKiBAcGFyYW0geyp9IG1lc3NhZ2VcbiAgICAgICAgICogICAgICAgIFRoZSBtZXNzYWdlIHNlbnQgYnkgdGhlIG90aGVyIGVuZCBvZiB0aGUgY2hhbm5lbC5cbiAgICAgICAgICogQHBhcmFtIHtvYmplY3R9IHNlbmRlclxuICAgICAgICAgKiAgICAgICAgRGV0YWlscyBhYm91dCB0aGUgc2VuZGVyIG9mIHRoZSBtZXNzYWdlLlxuICAgICAgICAgKiBAcGFyYW0ge2Z1bmN0aW9uKCopfSBzZW5kUmVzcG9uc2VcbiAgICAgICAgICogICAgICAgIEEgY2FsbGJhY2sgd2hpY2gsIHdoZW4gY2FsbGVkIHdpdGggYW4gYXJiaXRyYXJ5IGFyZ3VtZW50LCBzZW5kc1xuICAgICAgICAgKiAgICAgICAgdGhhdCB2YWx1ZSBhcyBhIHJlc3BvbnNlLlxuICAgICAgICAgKiBAcmV0dXJucyB7Ym9vbGVhbn1cbiAgICAgICAgICogICAgICAgIFRydWUgaWYgdGhlIHdyYXBwZWQgbGlzdGVuZXIgcmV0dXJuZWQgYSBQcm9taXNlLCB3aGljaCB3aWxsIGxhdGVyXG4gICAgICAgICAqICAgICAgICB5aWVsZCBhIHJlc3BvbnNlLiBGYWxzZSBvdGhlcndpc2UuXG4gICAgICAgICAqL1xuXG5cbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uIG9uTWVzc2FnZShtZXNzYWdlLCBzZW5kZXIsIHNlbmRSZXNwb25zZSkge1xuICAgICAgICAgIGxldCBkaWRDYWxsU2VuZFJlc3BvbnNlID0gZmFsc2U7XG4gICAgICAgICAgbGV0IHdyYXBwZWRTZW5kUmVzcG9uc2U7XG4gICAgICAgICAgbGV0IHNlbmRSZXNwb25zZVByb21pc2UgPSBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHtcbiAgICAgICAgICAgIHdyYXBwZWRTZW5kUmVzcG9uc2UgPSBmdW5jdGlvbiAocmVzcG9uc2UpIHtcbiAgICAgICAgICAgICAgaWYgKCFsb2dnZWRTZW5kUmVzcG9uc2VEZXByZWNhdGlvbldhcm5pbmcpIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oU0VORF9SRVNQT05TRV9ERVBSRUNBVElPTl9XQVJOSU5HLCBuZXcgRXJyb3IoKS5zdGFjayk7XG4gICAgICAgICAgICAgICAgbG9nZ2VkU2VuZFJlc3BvbnNlRGVwcmVjYXRpb25XYXJuaW5nID0gdHJ1ZTtcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIGRpZENhbGxTZW5kUmVzcG9uc2UgPSB0cnVlO1xuICAgICAgICAgICAgICByZXNvbHZlKHJlc3BvbnNlKTtcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgbGV0IHJlc3VsdDtcblxuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICByZXN1bHQgPSBsaXN0ZW5lcihtZXNzYWdlLCBzZW5kZXIsIHdyYXBwZWRTZW5kUmVzcG9uc2UpO1xuICAgICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgICAgcmVzdWx0ID0gUHJvbWlzZS5yZWplY3QoZXJyKTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjb25zdCBpc1Jlc3VsdFRoZW5hYmxlID0gcmVzdWx0ICE9PSB0cnVlICYmIGlzVGhlbmFibGUocmVzdWx0KTsgLy8gSWYgdGhlIGxpc3RlbmVyIGRpZG4ndCByZXR1cm5lZCB0cnVlIG9yIGEgUHJvbWlzZSwgb3IgY2FsbGVkXG4gICAgICAgICAgLy8gd3JhcHBlZFNlbmRSZXNwb25zZSBzeW5jaHJvbm91c2x5LCB3ZSBjYW4gZXhpdCBlYXJsaWVyXG4gICAgICAgICAgLy8gYmVjYXVzZSB0aGVyZSB3aWxsIGJlIG5vIHJlc3BvbnNlIHNlbnQgZnJvbSB0aGlzIGxpc3RlbmVyLlxuXG4gICAgICAgICAgaWYgKHJlc3VsdCAhPT0gdHJ1ZSAmJiAhaXNSZXN1bHRUaGVuYWJsZSAmJiAhZGlkQ2FsbFNlbmRSZXNwb25zZSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgIH0gLy8gQSBzbWFsbCBoZWxwZXIgdG8gc2VuZCB0aGUgbWVzc2FnZSBpZiB0aGUgcHJvbWlzZSByZXNvbHZlc1xuICAgICAgICAgIC8vIGFuZCBhbiBlcnJvciBpZiB0aGUgcHJvbWlzZSByZWplY3RzIChhIHdyYXBwZWQgc2VuZE1lc3NhZ2UgaGFzXG4gICAgICAgICAgLy8gdG8gdHJhbnNsYXRlIHRoZSBtZXNzYWdlIGludG8gYSByZXNvbHZlZCBwcm9taXNlIG9yIGEgcmVqZWN0ZWRcbiAgICAgICAgICAvLyBwcm9taXNlKS5cblxuXG4gICAgICAgICAgY29uc3Qgc2VuZFByb21pc2VkUmVzdWx0ID0gcHJvbWlzZSA9PiB7XG4gICAgICAgICAgICBwcm9taXNlLnRoZW4obXNnID0+IHtcbiAgICAgICAgICAgICAgLy8gc2VuZCB0aGUgbWVzc2FnZSB2YWx1ZS5cbiAgICAgICAgICAgICAgc2VuZFJlc3BvbnNlKG1zZyk7XG4gICAgICAgICAgICB9LCBlcnJvciA9PiB7XG4gICAgICAgICAgICAgIC8vIFNlbmQgYSBKU09OIHJlcHJlc2VudGF0aW9uIG9mIHRoZSBlcnJvciBpZiB0aGUgcmVqZWN0ZWQgdmFsdWVcbiAgICAgICAgICAgICAgLy8gaXMgYW4gaW5zdGFuY2Ugb2YgZXJyb3IsIG9yIHRoZSBvYmplY3QgaXRzZWxmIG90aGVyd2lzZS5cbiAgICAgICAgICAgICAgbGV0IG1lc3NhZ2U7XG5cbiAgICAgICAgICAgICAgaWYgKGVycm9yICYmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yIHx8IHR5cGVvZiBlcnJvci5tZXNzYWdlID09PSBcInN0cmluZ1wiKSkge1xuICAgICAgICAgICAgICAgIG1lc3NhZ2UgPSBlcnJvci5tZXNzYWdlO1xuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIG1lc3NhZ2UgPSBcIkFuIHVuZXhwZWN0ZWQgZXJyb3Igb2NjdXJyZWRcIjtcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIHNlbmRSZXNwb25zZSh7XG4gICAgICAgICAgICAgICAgX19tb3pXZWJFeHRlbnNpb25Qb2x5ZmlsbFJlamVjdF9fOiB0cnVlLFxuICAgICAgICAgICAgICAgIG1lc3NhZ2VcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9KS5jYXRjaChlcnIgPT4ge1xuICAgICAgICAgICAgICAvLyBQcmludCBhbiBlcnJvciBvbiB0aGUgY29uc29sZSBpZiB1bmFibGUgdG8gc2VuZCB0aGUgcmVzcG9uc2UuXG4gICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoXCJGYWlsZWQgdG8gc2VuZCBvbk1lc3NhZ2UgcmVqZWN0ZWQgcmVwbHlcIiwgZXJyKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH07IC8vIElmIHRoZSBsaXN0ZW5lciByZXR1cm5lZCBhIFByb21pc2UsIHNlbmQgdGhlIHJlc29sdmVkIHZhbHVlIGFzIGFcbiAgICAgICAgICAvLyByZXN1bHQsIG90aGVyd2lzZSB3YWl0IHRoZSBwcm9taXNlIHJlbGF0ZWQgdG8gdGhlIHdyYXBwZWRTZW5kUmVzcG9uc2VcbiAgICAgICAgICAvLyBjYWxsYmFjayB0byByZXNvbHZlIGFuZCBzZW5kIGl0IGFzIGEgcmVzcG9uc2UuXG5cblxuICAgICAgICAgIGlmIChpc1Jlc3VsdFRoZW5hYmxlKSB7XG4gICAgICAgICAgICBzZW5kUHJvbWlzZWRSZXN1bHQocmVzdWx0KTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgc2VuZFByb21pc2VkUmVzdWx0KHNlbmRSZXNwb25zZVByb21pc2UpO1xuICAgICAgICAgIH0gLy8gTGV0IENocm9tZSBrbm93IHRoYXQgdGhlIGxpc3RlbmVyIGlzIHJlcGx5aW5nLlxuXG5cbiAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfTtcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCB3cmFwcGVkU2VuZE1lc3NhZ2VDYWxsYmFjayA9ICh7XG4gICAgICAgIHJlamVjdCxcbiAgICAgICAgcmVzb2x2ZVxuICAgICAgfSwgcmVwbHkpID0+IHtcbiAgICAgICAgaWYgKGV4dGVuc2lvbkFQSXMucnVudGltZS5sYXN0RXJyb3IpIHtcbiAgICAgICAgICAvLyBEZXRlY3Qgd2hlbiBub25lIG9mIHRoZSBsaXN0ZW5lcnMgcmVwbGllZCB0byB0aGUgc2VuZE1lc3NhZ2UgY2FsbCBhbmQgcmVzb2x2ZVxuICAgICAgICAgIC8vIHRoZSBwcm9taXNlIHRvIHVuZGVmaW5lZCBhcyBpbiBGaXJlZm94LlxuICAgICAgICAgIC8vIFNlZSBodHRwczovL2dpdGh1Yi5jb20vbW96aWxsYS93ZWJleHRlbnNpb24tcG9seWZpbGwvaXNzdWVzLzEzMFxuICAgICAgICAgIGlmIChleHRlbnNpb25BUElzLnJ1bnRpbWUubGFzdEVycm9yLm1lc3NhZ2UgPT09IENIUk9NRV9TRU5EX01FU1NBR0VfQ0FMTEJBQ0tfTk9fUkVTUE9OU0VfTUVTU0FHRSkge1xuICAgICAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZWplY3QoZXh0ZW5zaW9uQVBJcy5ydW50aW1lLmxhc3RFcnJvcik7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKHJlcGx5ICYmIHJlcGx5Ll9fbW96V2ViRXh0ZW5zaW9uUG9seWZpbGxSZWplY3RfXykge1xuICAgICAgICAgIC8vIENvbnZlcnQgYmFjayB0aGUgSlNPTiByZXByZXNlbnRhdGlvbiBvZiB0aGUgZXJyb3IgaW50b1xuICAgICAgICAgIC8vIGFuIEVycm9yIGluc3RhbmNlLlxuICAgICAgICAgIHJlamVjdChuZXcgRXJyb3IocmVwbHkubWVzc2FnZSkpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJlc29sdmUocmVwbHkpO1xuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCB3cmFwcGVkU2VuZE1lc3NhZ2UgPSAobmFtZSwgbWV0YWRhdGEsIGFwaU5hbWVzcGFjZU9iaiwgLi4uYXJncykgPT4ge1xuICAgICAgICBpZiAoYXJncy5sZW5ndGggPCBtZXRhZGF0YS5taW5BcmdzKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBhdCBsZWFzdCAke21ldGFkYXRhLm1pbkFyZ3N9ICR7cGx1cmFsaXplQXJndW1lbnRzKG1ldGFkYXRhLm1pbkFyZ3MpfSBmb3IgJHtuYW1lfSgpLCBnb3QgJHthcmdzLmxlbmd0aH1gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChhcmdzLmxlbmd0aCA+IG1ldGFkYXRhLm1heEFyZ3MpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGF0IG1vc3QgJHttZXRhZGF0YS5tYXhBcmdzfSAke3BsdXJhbGl6ZUFyZ3VtZW50cyhtZXRhZGF0YS5tYXhBcmdzKX0gZm9yICR7bmFtZX0oKSwgZ290ICR7YXJncy5sZW5ndGh9YCk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICAgIGNvbnN0IHdyYXBwZWRDYiA9IHdyYXBwZWRTZW5kTWVzc2FnZUNhbGxiYWNrLmJpbmQobnVsbCwge1xuICAgICAgICAgICAgcmVzb2x2ZSxcbiAgICAgICAgICAgIHJlamVjdFxuICAgICAgICAgIH0pO1xuICAgICAgICAgIGFyZ3MucHVzaCh3cmFwcGVkQ2IpO1xuICAgICAgICAgIGFwaU5hbWVzcGFjZU9iai5zZW5kTWVzc2FnZSguLi5hcmdzKTtcbiAgICAgICAgfSk7XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBzdGF0aWNXcmFwcGVycyA9IHtcbiAgICAgICAgcnVudGltZToge1xuICAgICAgICAgIG9uTWVzc2FnZTogd3JhcEV2ZW50KG9uTWVzc2FnZVdyYXBwZXJzKSxcbiAgICAgICAgICBvbk1lc3NhZ2VFeHRlcm5hbDogd3JhcEV2ZW50KG9uTWVzc2FnZVdyYXBwZXJzKSxcbiAgICAgICAgICBzZW5kTWVzc2FnZTogd3JhcHBlZFNlbmRNZXNzYWdlLmJpbmQobnVsbCwgXCJzZW5kTWVzc2FnZVwiLCB7XG4gICAgICAgICAgICBtaW5BcmdzOiAxLFxuICAgICAgICAgICAgbWF4QXJnczogM1xuICAgICAgICAgIH0pXG4gICAgICAgIH0sXG4gICAgICAgIHRhYnM6IHtcbiAgICAgICAgICBzZW5kTWVzc2FnZTogd3JhcHBlZFNlbmRNZXNzYWdlLmJpbmQobnVsbCwgXCJzZW5kTWVzc2FnZVwiLCB7XG4gICAgICAgICAgICBtaW5BcmdzOiAyLFxuICAgICAgICAgICAgbWF4QXJnczogM1xuICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICAgIH07XG4gICAgICBjb25zdCBzZXR0aW5nTWV0YWRhdGEgPSB7XG4gICAgICAgIGNsZWFyOiB7XG4gICAgICAgICAgbWluQXJnczogMSxcbiAgICAgICAgICBtYXhBcmdzOiAxXG4gICAgICAgIH0sXG4gICAgICAgIGdldDoge1xuICAgICAgICAgIG1pbkFyZ3M6IDEsXG4gICAgICAgICAgbWF4QXJnczogMVxuICAgICAgICB9LFxuICAgICAgICBzZXQ6IHtcbiAgICAgICAgICBtaW5BcmdzOiAxLFxuICAgICAgICAgIG1heEFyZ3M6IDFcbiAgICAgICAgfVxuICAgICAgfTtcbiAgICAgIGFwaU1ldGFkYXRhLnByaXZhY3kgPSB7XG4gICAgICAgIG5ldHdvcms6IHtcbiAgICAgICAgICBcIipcIjogc2V0dGluZ01ldGFkYXRhXG4gICAgICAgIH0sXG4gICAgICAgIHNlcnZpY2VzOiB7XG4gICAgICAgICAgXCIqXCI6IHNldHRpbmdNZXRhZGF0YVxuICAgICAgICB9LFxuICAgICAgICB3ZWJzaXRlczoge1xuICAgICAgICAgIFwiKlwiOiBzZXR0aW5nTWV0YWRhdGFcbiAgICAgICAgfVxuICAgICAgfTtcbiAgICAgIHJldHVybiB3cmFwT2JqZWN0KGV4dGVuc2lvbkFQSXMsIHN0YXRpY1dyYXBwZXJzLCBhcGlNZXRhZGF0YSk7XG4gICAgfTtcblxuICAgIGlmICh0eXBlb2YgY2hyb21lICE9IFwib2JqZWN0XCIgfHwgIWNocm9tZSB8fCAhY2hyb21lLnJ1bnRpbWUgfHwgIWNocm9tZS5ydW50aW1lLmlkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJUaGlzIHNjcmlwdCBzaG91bGQgb25seSBiZSBsb2FkZWQgaW4gYSBicm93c2VyIGV4dGVuc2lvbi5cIik7XG4gICAgfSAvLyBUaGUgYnVpbGQgcHJvY2VzcyBhZGRzIGEgVU1EIHdyYXBwZXIgYXJvdW5kIHRoaXMgZmlsZSwgd2hpY2ggbWFrZXMgdGhlXG4gICAgLy8gYG1vZHVsZWAgdmFyaWFibGUgYXZhaWxhYmxlLlxuXG5cbiAgICBtb2R1bGUuZXhwb3J0cyA9IHdyYXBBUElzKGNocm9tZSk7XG4gIH0gZWxzZSB7XG4gICAgbW9kdWxlLmV4cG9ydHMgPSBicm93c2VyO1xuICB9XG59KTtcbi8vIyBzb3VyY2VNYXBwaW5nVVJMPWJyb3dzZXItcG9seWZpbGwuanMubWFwXG4iLCJcInVzZSBzdHJpY3RcIjtcbk9iamVjdC5kZWZpbmVQcm9wZXJ0eShleHBvcnRzLCBcIl9fZXNNb2R1bGVcIiwgeyB2YWx1ZTogdHJ1ZSB9KTtcblxuZXhwb3J0cy5icm93c2VyID0gcmVxdWlyZShcIndlYmV4dGVuc2lvbi1wb2x5ZmlsbFwiKTtcbiJdLCJzb3VyY2VSb290IjoiIn0=
