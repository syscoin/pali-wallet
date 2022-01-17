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
  /******/ return __webpack_require__((__webpack_require__.s = 1244));
  /******/
})(
  /************************************************************************/
  /******/ {
    /***/ 1244: /***/ function (module, exports) {
      const VERSION = '8.1.27';
      const versionN = VERSION.split('.').map((s) => parseInt(s, 10));
      const DIRECTORY = `${versionN[0]}/`;
      const url = `*://connect.trezor.io/${DIRECTORY}`; // const url = `https://localhost:8088/`

      /* Handling messages from usb permissions iframe */

      function switchToPopupTab(event) {
        window.removeEventListener('beforeunload', switchToPopupTab);

        if (!event) {
          // triggered from 'usb-permissions-close' message
          // close current tab
          chrome.tabs.query(
            {
              currentWindow: true,
              active: true,
            },
            (current) => {
              if (current.length < 0) return;
              chrome.tabs.remove(current[0].id);
            }
          );
        } // find tab by popup pattern and switch to it

        chrome.tabs.query(
          {
            url: `${url}popup.html`,
          },
          (tabs) => {
            if (tabs.length < 0) return;
            chrome.tabs.update(tabs[0].id, {
              active: true,
            });
          }
        );
      }

      window.addEventListener('message', (event) => {
        if (event.data === 'usb-permissions-init') {
          const iframe = document.getElementById('trezor-usb-permissions');

          if (!iframe || !(iframe instanceof HTMLIFrameElement)) {
            throw new Error(
              'trezor-usb-permissions missing or incorrect dom type'
            );
          }

          iframe.contentWindow.postMessage(
            {
              type: 'usb-permissions-init',
              extension: chrome.runtime.id,
            },
            '*'
          );
        } else if (event.data === 'usb-permissions-close') {
          switchToPopupTab();
        }
      });
      window.addEventListener('beforeunload', switchToPopupTab);
      window.addEventListener('load', () => {
        const instance = document.createElement('iframe');
        instance.id = 'trezor-usb-permissions';
        instance.frameBorder = '0';
        instance.width = '100%';
        instance.height = '100%';
        instance.style.border = '0px';
        instance.style.width = '100%';
        instance.style.height = '100%';
        instance.setAttribute('src', `${url}extension-permissions.html`);
        instance.setAttribute('allow', 'usb');

        if (document.body) {
          document.body.appendChild(instance);
        }
      }); // const switchToPopupTab = (event) => {
      //     window.removeEventListener('beforeunload', switchToPopupTab);
      //     console.log("adding usb permission in popup switch")
      //     if (!event) {
      //         // triggered from 'usb-permissions-close' message
      //         // switch tab to previous index and close current
      //         chrome.tabs.query({
      //             currentWindow: true,
      //             active: true,
      //         }, (current) => {
      //             if (current.length < 0) return;
      //             chrome.tabs.query({
      //                 index: current[0].index - 1
      //             }, popup => {
      //                 if (popup.length < 0) return;
      //                 chrome.tabs.update(popup[0].id, { active: true });
      //             })
      //             chrome.tabs.remove(current[0].id);
      //         });
      //         return;
      //     }
      //     // TODO: remove this query, or add `tabs` permission. This does not work.
      //     // triggered from 'beforeunload' event
      //     // find tab by popup pattern and switch to it
      //     chrome.tabs.query({
      //         url: "*://connect.trezor.io/*/popup.html"
      //     }, (tabs) => {
      //         if (tabs.length < 0) return;
      //         chrome.tabs.update(tabs[0].id, { active: true });
      //     });
      // }
      // window.addEventListener('message', event => {
      //     if (event.data === 'usb-permissions-init') {
      //         console.log("adding usb permission")
      //         const iframe = document.getElementById('trezor-usb-permissions');
      //         iframe.contentWindow.postMessage({
      //             type: 'usb-permissions-init',
      //             extension: chrome.runtime.id,
      //         }, '*');
      //     } else if (event.data === 'usb-permissions-close') {
      //         switchToPopupTab();
      //     }
      // });
      // window.addEventListener('beforeunload', switchToPopupTab);

      /***/
    },

    /******/
  }
);
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIndlYnBhY2s6Ly8vd2VicGFjay9ib290c3RyYXAiLCJ3ZWJwYWNrOi8vLy4vc291cmNlL3ZlbmRvci90cmV6b3ItdXNiLXBlcm1pc3Npb25zLmpzIl0sIm5hbWVzIjpbIlZFUlNJT04iLCJ2ZXJzaW9uTiIsInNwbGl0IiwibWFwIiwicyIsInBhcnNlSW50IiwiRElSRUNUT1JZIiwidXJsIiwic3dpdGNoVG9Qb3B1cFRhYiIsImV2ZW50Iiwid2luZG93IiwicmVtb3ZlRXZlbnRMaXN0ZW5lciIsImNocm9tZSIsInRhYnMiLCJxdWVyeSIsImN1cnJlbnRXaW5kb3ciLCJhY3RpdmUiLCJjdXJyZW50IiwibGVuZ3RoIiwicmVtb3ZlIiwiaWQiLCJ1cGRhdGUiLCJhZGRFdmVudExpc3RlbmVyIiwiZGF0YSIsImlmcmFtZSIsImRvY3VtZW50IiwiZ2V0RWxlbWVudEJ5SWQiLCJIVE1MSUZyYW1lRWxlbWVudCIsIkVycm9yIiwiY29udGVudFdpbmRvdyIsInBvc3RNZXNzYWdlIiwidHlwZSIsImV4dGVuc2lvbiIsInJ1bnRpbWUiLCJpbnN0YW5jZSIsImNyZWF0ZUVsZW1lbnQiLCJmcmFtZUJvcmRlciIsIndpZHRoIiwiaGVpZ2h0Iiwic3R5bGUiLCJib3JkZXIiLCJzZXRBdHRyaWJ1dGUiLCJib2R5IiwiYXBwZW5kQ2hpbGQiXSwibWFwcGluZ3MiOiI7UUFBQTtRQUNBOztRQUVBO1FBQ0E7O1FBRUE7UUFDQTtRQUNBO1FBQ0E7UUFDQTtRQUNBO1FBQ0E7UUFDQTtRQUNBO1FBQ0E7O1FBRUE7UUFDQTs7UUFFQTtRQUNBOztRQUVBO1FBQ0E7UUFDQTs7O1FBR0E7UUFDQTs7UUFFQTtRQUNBOztRQUVBO1FBQ0E7UUFDQTtRQUNBLDBDQUEwQyxnQ0FBZ0M7UUFDMUU7UUFDQTs7UUFFQTtRQUNBO1FBQ0E7UUFDQSx3REFBd0Qsa0JBQWtCO1FBQzFFO1FBQ0EsaURBQWlELGNBQWM7UUFDL0Q7O1FBRUE7UUFDQTtRQUNBO1FBQ0E7UUFDQTtRQUNBO1FBQ0E7UUFDQTtRQUNB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QUFqQjtBQUNBSCxVQUFRLENBQUNJLE1BQVQsR0FBa0IsTUFBbEI7QUFDQUosVUFBUSxDQUFDSyxLQUFULENBQWVDLE1BQWYsR0FBd0IsS0FBeEI7QUFDQU4sVUFBUSxDQUFDSyxLQUFULENBQWVGLEtBQWYsR0FBdUIsTUFBdkI7QUFDQUgsVUFBUSxDQUFDSyxLQUFULENBQWVELE1BQWYsR0FBd0IsTUFBeEI7QUFDQUosVUFBUSxDQUFDTyxZQUFULENBQXNCLEtBQXRCLEVBQThCLEdBQUVsQyxHQUFJLDRCQUFwQztBQUNBMkIsVUFBUSxDQUFDTyxZQUFULENBQXNCLE9BQXRCLEVBQStCLEtBQS9COztBQUVBLE1BQUloQixRQUFRLENBQUNpQixJQUFiLEVBQW1CO0FBQ2pCakIsWUFBUSxDQUFDaUIsSUFBVCxDQUFjQyxXQUFkLENBQTBCVCxRQUExQjtBQUNEO0FBQ0YsQ0FmRCxFLENBZ0JBO0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBRUEsNkQiLCJmaWxlIjoianMvdHJlem9yVVNCLmJ1bmRsZS5qcyIsInNvdXJjZXNDb250ZW50IjpbIiBcdC8vIFRoZSBtb2R1bGUgY2FjaGVcbiBcdHZhciBpbnN0YWxsZWRNb2R1bGVzID0ge307XG5cbiBcdC8vIFRoZSByZXF1aXJlIGZ1bmN0aW9uXG4gXHRmdW5jdGlvbiBfX3dlYnBhY2tfcmVxdWlyZV9fKG1vZHVsZUlkKSB7XG5cbiBcdFx0Ly8gQ2hlY2sgaWYgbW9kdWxlIGlzIGluIGNhY2hlXG4gXHRcdGlmKGluc3RhbGxlZE1vZHVsZXNbbW9kdWxlSWRdKSB7XG4gXHRcdFx0cmV0dXJuIGluc3RhbGxlZE1vZHVsZXNbbW9kdWxlSWRdLmV4cG9ydHM7XG4gXHRcdH1cbiBcdFx0Ly8gQ3JlYXRlIGEgbmV3IG1vZHVsZSAoYW5kIHB1dCBpdCBpbnRvIHRoZSBjYWNoZSlcbiBcdFx0dmFyIG1vZHVsZSA9IGluc3RhbGxlZE1vZHVsZXNbbW9kdWxlSWRdID0ge1xuIFx0XHRcdGk6IG1vZHVsZUlkLFxuIFx0XHRcdGw6IGZhbHNlLFxuIFx0XHRcdGV4cG9ydHM6IHt9XG4gXHRcdH07XG5cbiBcdFx0Ly8gRXhlY3V0ZSB0aGUgbW9kdWxlIGZ1bmN0aW9uXG4gXHRcdG1vZHVsZXNbbW9kdWxlSWRdLmNhbGwobW9kdWxlLmV4cG9ydHMsIG1vZHVsZSwgbW9kdWxlLmV4cG9ydHMsIF9fd2VicGFja19yZXF1aXJlX18pO1xuXG4gXHRcdC8vIEZsYWcgdGhlIG1vZHVsZSBhcyBsb2FkZWRcbiBcdFx0bW9kdWxlLmwgPSB0cnVlO1xuXG4gXHRcdC8vIFJldHVybiB0aGUgZXhwb3J0cyBvZiB0aGUgbW9kdWxlXG4gXHRcdHJldHVybiBtb2R1bGUuZXhwb3J0cztcbiBcdH1cblxuXG4gXHQvLyBleHBvc2UgdGhlIG1vZHVsZXMgb2JqZWN0IChfX3dlYnBhY2tfbW9kdWxlc19fKVxuIFx0X193ZWJwYWNrX3JlcXVpcmVfXy5tID0gbW9kdWxlcztcblxuIFx0Ly8gZXhwb3NlIHRoZSBtb2R1bGUgY2FjaGVcbiBcdF9fd2VicGFja19yZXF1aXJlX18uYyA9IGluc3RhbGxlZE1vZHVsZXM7XG5cbiBcdC8vIGRlZmluZSBnZXR0ZXIgZnVuY3Rpb24gZm9yIGhhcm1vbnkgZXhwb3J0c1xuIFx0X193ZWJwYWNrX3JlcXVpcmVfXy5kID0gZnVuY3Rpb24oZXhwb3J0cywgbmFtZSwgZ2V0dGVyKSB7XG4gXHRcdGlmKCFfX3dlYnBhY2tfcmVxdWlyZV9fLm8oZXhwb3J0cywgbmFtZSkpIHtcbiBcdFx0XHRPYmplY3QuZGVmaW5lUHJvcGVydHkoZXhwb3J0cywgbmFtZSwgeyBlbnVtZXJhYmxlOiB0cnVlLCBnZXQ6IGdldHRlciB9KTtcbiBcdFx0fVxuIFx0fTtcblxuIFx0Ly8gZGVmaW5lIF9fZXNNb2R1bGUgb24gZXhwb3J0c1xuIFx0X193ZWJwYWNrX3JlcXVpcmVfXy5yID0gZnVuY3Rpb24oZXhwb3J0cykge1xuIFx0XHRpZih0eXBlb2YgU3ltYm9sICE9PSAndW5kZWZpbmVkJyAmJiBTeW1ib2wudG9TdHJpbmdUYWcpIHtcbiBcdFx0XHRPYmplY3QuZGVmaW5lUHJvcGVydHkoZXhwb3J0cywgU3ltYm9sLnRvU3RyaW5nVGFnLCB7IHZhbHVlOiAnTW9kdWxlJyB9KTtcbiBcdFx0fVxuIFx0XHRPYmplY3QuZGVmaW5lUHJvcGVydHkoZXhwb3J0cywgJ19fZXNNb2R1bGUnLCB7IHZhbHVlOiB0cnVlIH0pO1xuIFx0fTtcblxuIFx0Ly8gY3JlYXRlIGEgZmFrZSBuYW1lc3BhY2Ugb2JqZWN0XG4gXHQvLyBtb2RlICYgMTogdmFsdWUgaXMgYSBtb2R1bGUgaWQsIHJlcXVpcmUgaXRcbiBcdC8vIG1vZGUgJiAyOiBtZXJnZSBhbGwgcHJvcGVydGllcyBvZiB2YWx1ZSBpbnRvIHRoZSBuc1xuIFx0Ly8gbW9kZSAmIDQ6IHJldHVybiB2YWx1ZSB3aGVuIGFscmVhZHkgbnMgb2JqZWN0XG4gXHQvLyBtb2RlICYgOHwxOiBiZWhhdmUgbGlrZSByZXF1aXJlXG4gXHRfX3dlYnBhY2tfcmVxdWlyZV9fLnQgPSBmdW5jdGlvbih2YWx1ZSwgbW9kZSkge1xuIFx0XHRpZihtb2RlICYgMSkgdmFsdWUgPSBfX3dlYnBhY2tfcmVxdWlyZV9fKHZhbHVlKTtcbiBcdFx0aWYobW9kZSAmIDgpIHJldHVybiB2YWx1ZTtcbiBcdFx0aWYoKG1vZGUgJiA0KSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIHZhbHVlICYmIHZhbHVlLl9fZXNNb2R1bGUpIHJldHVybiB2YWx1ZTtcbiBcdFx0dmFyIG5zID0gT2JqZWN0LmNyZWF0ZShudWxsKTtcbiBcdFx0X193ZWJwYWNrX3JlcXVpcmVfXy5yKG5zKTtcbiBcdFx0T2JqZWN0LmRlZmluZVByb3BlcnR5KG5zLCAnZGVmYXVsdCcsIHsgZW51bWVyYWJsZTogdHJ1ZSwgdmFsdWU6IHZhbHVlIH0pO1xuIFx0XHRpZihtb2RlICYgMiAmJiB0eXBlb2YgdmFsdWUgIT0gJ3N0cmluZycpIGZvcih2YXIga2V5IGluIHZhbHVlKSBfX3dlYnBhY2tfcmVxdWlyZV9fLmQobnMsIGtleSwgZnVuY3Rpb24oa2V5KSB7IHJldHVybiB2YWx1ZVtrZXldOyB9LmJpbmQobnVsbCwga2V5KSk7XG4gXHRcdHJldHVybiBucztcbiBcdH07XG5cbiBcdC8vIGdldERlZmF1bHRFeHBvcnQgZnVuY3Rpb24gZm9yIGNvbXBhdGliaWxpdHkgd2l0aCBub24taGFybW9ueSBtb2R1bGVzXG4gXHRfX3dlYnBhY2tfcmVxdWlyZV9fLm4gPSBmdW5jdGlvbihtb2R1bGUpIHtcbiBcdFx0dmFyIGdldHRlciA9IG1vZHVsZSAmJiBtb2R1bGUuX19lc01vZHVsZSA/XG4gXHRcdFx0ZnVuY3Rpb24gZ2V0RGVmYXVsdCgpIHsgcmV0dXJuIG1vZHVsZVsnZGVmYXVsdCddOyB9IDpcbiBcdFx0XHRmdW5jdGlvbiBnZXRNb2R1bGVFeHBvcnRzKCkgeyByZXR1cm4gbW9kdWxlOyB9O1xuIFx0XHRfX3dlYnBhY2tfcmVxdWlyZV9fLmQoZ2V0dGVyLCAnYScsIGdldHRlcik7XG4gXHRcdHJldHVybiBnZXR0ZXI7XG4gXHR9O1xuXG4gXHQvLyBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGxcbiBcdF9fd2VicGFja19yZXF1aXJlX18ubyA9IGZ1bmN0aW9uKG9iamVjdCwgcHJvcGVydHkpIHsgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChvYmplY3QsIHByb3BlcnR5KTsgfTtcblxuIFx0Ly8gX193ZWJwYWNrX3B1YmxpY19wYXRoX19cbiBcdF9fd2VicGFja19yZXF1aXJlX18ucCA9IFwiXCI7XG5cblxuIFx0Ly8gTG9hZCBlbnRyeSBtb2R1bGUgYW5kIHJldHVybiBleHBvcnRzXG4gXHRyZXR1cm4gX193ZWJwYWNrX3JlcXVpcmVfXyhfX3dlYnBhY2tfcmVxdWlyZV9fLnMgPSAxMjQ0KTtcbiIsImNvbnN0IFZFUlNJT04gPSAnOC4xLjI3JztcbmNvbnN0IHZlcnNpb25OID0gVkVSU0lPTi5zcGxpdCgnLicpLm1hcCgocykgPT4gcGFyc2VJbnQocywgMTApKTtcbmNvbnN0IERJUkVDVE9SWSA9IGAke3ZlcnNpb25OWzBdfS9gO1xuY29uc3QgdXJsID0gYCo6Ly9jb25uZWN0LnRyZXpvci5pby8ke0RJUkVDVE9SWX1gO1xuLy8gY29uc3QgdXJsID0gYGh0dHBzOi8vbG9jYWxob3N0OjgwODgvYFxuLyogSGFuZGxpbmcgbWVzc2FnZXMgZnJvbSB1c2IgcGVybWlzc2lvbnMgaWZyYW1lICovXG5mdW5jdGlvbiBzd2l0Y2hUb1BvcHVwVGFiKGV2ZW50KSB7XG4gIHdpbmRvdy5yZW1vdmVFdmVudExpc3RlbmVyKCdiZWZvcmV1bmxvYWQnLCBzd2l0Y2hUb1BvcHVwVGFiKTtcblxuICBpZiAoIWV2ZW50KSB7XG4gICAgLy8gdHJpZ2dlcmVkIGZyb20gJ3VzYi1wZXJtaXNzaW9ucy1jbG9zZScgbWVzc2FnZVxuICAgIC8vIGNsb3NlIGN1cnJlbnQgdGFiXG4gICAgY2hyb21lLnRhYnMucXVlcnkoXG4gICAgICB7XG4gICAgICAgIGN1cnJlbnRXaW5kb3c6IHRydWUsXG4gICAgICAgIGFjdGl2ZTogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICAoY3VycmVudCkgPT4ge1xuICAgICAgICBpZiAoY3VycmVudC5sZW5ndGggPCAwKSByZXR1cm47XG4gICAgICAgIGNocm9tZS50YWJzLnJlbW92ZShjdXJyZW50WzBdLmlkKTtcbiAgICAgIH1cbiAgICApO1xuICB9XG5cbiAgLy8gZmluZCB0YWIgYnkgcG9wdXAgcGF0dGVybiBhbmQgc3dpdGNoIHRvIGl0XG4gIGNocm9tZS50YWJzLnF1ZXJ5KFxuICAgIHtcbiAgICAgIHVybDogYCR7dXJsfXBvcHVwLmh0bWxgLFxuICAgIH0sXG4gICAgKHRhYnMpID0+IHtcbiAgICAgIGlmICh0YWJzLmxlbmd0aCA8IDApIHJldHVybjtcbiAgICAgIGNocm9tZS50YWJzLnVwZGF0ZSh0YWJzWzBdLmlkLCB7IGFjdGl2ZTogdHJ1ZSB9KTtcbiAgICB9XG4gICk7XG59XG5cbndpbmRvdy5hZGRFdmVudExpc3RlbmVyKCdtZXNzYWdlJywgKGV2ZW50KSA9PiB7XG4gIGlmIChldmVudC5kYXRhID09PSAndXNiLXBlcm1pc3Npb25zLWluaXQnKSB7XG4gICAgY29uc3QgaWZyYW1lID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RyZXpvci11c2ItcGVybWlzc2lvbnMnKTtcbiAgICBpZiAoIWlmcmFtZSB8fCAhKGlmcmFtZSBpbnN0YW5jZW9mIEhUTUxJRnJhbWVFbGVtZW50KSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCd0cmV6b3ItdXNiLXBlcm1pc3Npb25zIG1pc3Npbmcgb3IgaW5jb3JyZWN0IGRvbSB0eXBlJyk7XG4gICAgfVxuICAgIGlmcmFtZS5jb250ZW50V2luZG93LnBvc3RNZXNzYWdlKFxuICAgICAge1xuICAgICAgICB0eXBlOiAndXNiLXBlcm1pc3Npb25zLWluaXQnLFxuICAgICAgICBleHRlbnNpb246IGNocm9tZS5ydW50aW1lLmlkLFxuICAgICAgfSxcbiAgICAgICcqJ1xuICAgICk7XG4gIH0gZWxzZSBpZiAoZXZlbnQuZGF0YSA9PT0gJ3VzYi1wZXJtaXNzaW9ucy1jbG9zZScpIHtcbiAgICBzd2l0Y2hUb1BvcHVwVGFiKCk7XG4gIH1cbn0pO1xuXG53aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignYmVmb3JldW5sb2FkJywgc3dpdGNoVG9Qb3B1cFRhYik7XG53aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignbG9hZCcsICgpID0+IHtcbiAgY29uc3QgaW5zdGFuY2UgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdpZnJhbWUnKTtcbiAgaW5zdGFuY2UuaWQgPSAndHJlem9yLXVzYi1wZXJtaXNzaW9ucyc7XG4gIGluc3RhbmNlLmZyYW1lQm9yZGVyID0gJzAnO1xuICBpbnN0YW5jZS53aWR0aCA9ICcxMDAlJztcbiAgaW5zdGFuY2UuaGVpZ2h0ID0gJzEwMCUnO1xuICBpbnN0YW5jZS5zdHlsZS5ib3JkZXIgPSAnMHB4JztcbiAgaW5zdGFuY2Uuc3R5bGUud2lkdGggPSAnMTAwJSc7XG4gIGluc3RhbmNlLnN0eWxlLmhlaWdodCA9ICcxMDAlJztcbiAgaW5zdGFuY2Uuc2V0QXR0cmlidXRlKCdzcmMnLCBgJHt1cmx9ZXh0ZW5zaW9uLXBlcm1pc3Npb25zLmh0bWxgKTtcbiAgaW5zdGFuY2Uuc2V0QXR0cmlidXRlKCdhbGxvdycsICd1c2InKTtcblxuICBpZiAoZG9jdW1lbnQuYm9keSkge1xuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoaW5zdGFuY2UpO1xuICB9XG59KTtcbi8vIGNvbnN0IHN3aXRjaFRvUG9wdXBUYWIgPSAoZXZlbnQpID0+IHtcblxuLy8gICAgIHdpbmRvdy5yZW1vdmVFdmVudExpc3RlbmVyKCdiZWZvcmV1bmxvYWQnLCBzd2l0Y2hUb1BvcHVwVGFiKTtcbi8vICAgICBjb25zb2xlLmxvZyhcImFkZGluZyB1c2IgcGVybWlzc2lvbiBpbiBwb3B1cCBzd2l0Y2hcIilcbi8vICAgICBpZiAoIWV2ZW50KSB7XG4vLyAgICAgICAgIC8vIHRyaWdnZXJlZCBmcm9tICd1c2ItcGVybWlzc2lvbnMtY2xvc2UnIG1lc3NhZ2Vcbi8vICAgICAgICAgLy8gc3dpdGNoIHRhYiB0byBwcmV2aW91cyBpbmRleCBhbmQgY2xvc2UgY3VycmVudFxuLy8gICAgICAgICBjaHJvbWUudGFicy5xdWVyeSh7XG4vLyAgICAgICAgICAgICBjdXJyZW50V2luZG93OiB0cnVlLFxuLy8gICAgICAgICAgICAgYWN0aXZlOiB0cnVlLFxuLy8gICAgICAgICB9LCAoY3VycmVudCkgPT4ge1xuLy8gICAgICAgICAgICAgaWYgKGN1cnJlbnQubGVuZ3RoIDwgMCkgcmV0dXJuO1xuLy8gICAgICAgICAgICAgY2hyb21lLnRhYnMucXVlcnkoe1xuLy8gICAgICAgICAgICAgICAgIGluZGV4OiBjdXJyZW50WzBdLmluZGV4IC0gMVxuLy8gICAgICAgICAgICAgfSwgcG9wdXAgPT4ge1xuLy8gICAgICAgICAgICAgICAgIGlmIChwb3B1cC5sZW5ndGggPCAwKSByZXR1cm47XG4vLyAgICAgICAgICAgICAgICAgY2hyb21lLnRhYnMudXBkYXRlKHBvcHVwWzBdLmlkLCB7IGFjdGl2ZTogdHJ1ZSB9KTtcbi8vICAgICAgICAgICAgIH0pXG4vLyAgICAgICAgICAgICBjaHJvbWUudGFicy5yZW1vdmUoY3VycmVudFswXS5pZCk7XG4vLyAgICAgICAgIH0pO1xuLy8gICAgICAgICByZXR1cm47XG4vLyAgICAgfVxuXG4vLyAgICAgLy8gVE9ETzogcmVtb3ZlIHRoaXMgcXVlcnksIG9yIGFkZCBgdGFic2AgcGVybWlzc2lvbi4gVGhpcyBkb2VzIG5vdCB3b3JrLlxuLy8gICAgIC8vIHRyaWdnZXJlZCBmcm9tICdiZWZvcmV1bmxvYWQnIGV2ZW50XG4vLyAgICAgLy8gZmluZCB0YWIgYnkgcG9wdXAgcGF0dGVybiBhbmQgc3dpdGNoIHRvIGl0XG4vLyAgICAgY2hyb21lLnRhYnMucXVlcnkoe1xuLy8gICAgICAgICB1cmw6IFwiKjovL2Nvbm5lY3QudHJlem9yLmlvLyovcG9wdXAuaHRtbFwiXG4vLyAgICAgfSwgKHRhYnMpID0+IHtcbi8vICAgICAgICAgaWYgKHRhYnMubGVuZ3RoIDwgMCkgcmV0dXJuO1xuLy8gICAgICAgICBjaHJvbWUudGFicy51cGRhdGUodGFic1swXS5pZCwgeyBhY3RpdmU6IHRydWUgfSk7XG4vLyAgICAgfSk7XG4vLyB9XG5cbi8vIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCdtZXNzYWdlJywgZXZlbnQgPT4ge1xuLy8gICAgIGlmIChldmVudC5kYXRhID09PSAndXNiLXBlcm1pc3Npb25zLWluaXQnKSB7XG4vLyAgICAgICAgIGNvbnNvbGUubG9nKFwiYWRkaW5nIHVzYiBwZXJtaXNzaW9uXCIpXG4vLyAgICAgICAgIGNvbnN0IGlmcmFtZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0cmV6b3ItdXNiLXBlcm1pc3Npb25zJyk7XG4vLyAgICAgICAgIGlmcmFtZS5jb250ZW50V2luZG93LnBvc3RNZXNzYWdlKHtcbi8vICAgICAgICAgICAgIHR5cGU6ICd1c2ItcGVybWlzc2lvbnMtaW5pdCcsXG4vLyAgICAgICAgICAgICBleHRlbnNpb246IGNocm9tZS5ydW50aW1lLmlkLFxuLy8gICAgICAgICB9LCAnKicpO1xuLy8gICAgIH0gZWxzZSBpZiAoZXZlbnQuZGF0YSA9PT0gJ3VzYi1wZXJtaXNzaW9ucy1jbG9zZScpIHtcbi8vICAgICAgICAgc3dpdGNoVG9Qb3B1cFRhYigpO1xuLy8gICAgIH1cbi8vIH0pO1xuXG4vLyB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignYmVmb3JldW5sb2FkJywgc3dpdGNoVG9Qb3B1cFRhYik7XG4iXSwic291cmNlUm9vdCI6IiJ9
