/******/ (function(modules) { // webpackBootstrap
/******/ 	// The module cache
/******/ 	var installedModules = {};
/******/
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/
/******/ 		// Check if module is in cache
/******/ 		if(installedModules[moduleId]) {
/******/ 			return installedModules[moduleId].exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = installedModules[moduleId] = {
/******/ 			i: moduleId,
/******/ 			l: false,
/******/ 			exports: {}
/******/ 		};
/******/
/******/ 		// Execute the module function
/******/ 		modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/
/******/ 		// Flag the module as loaded
/******/ 		module.l = true;
/******/
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/
/******/
/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = modules;
/******/
/******/ 	// expose the module cache
/******/ 	__webpack_require__.c = installedModules;
/******/
/******/ 	// define getter function for harmony exports
/******/ 	__webpack_require__.d = function(exports, name, getter) {
/******/ 		if(!__webpack_require__.o(exports, name)) {
/******/ 			Object.defineProperty(exports, name, { enumerable: true, get: getter });
/******/ 		}
/******/ 	};
/******/
/******/ 	// define __esModule on exports
/******/ 	__webpack_require__.r = function(exports) {
/******/ 		if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 			Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 		}
/******/ 		Object.defineProperty(exports, '__esModule', { value: true });
/******/ 	};
/******/
/******/ 	// create a fake namespace object
/******/ 	// mode & 1: value is a module id, require it
/******/ 	// mode & 2: merge all properties of value into the ns
/******/ 	// mode & 4: return value when already ns object
/******/ 	// mode & 8|1: behave like require
/******/ 	__webpack_require__.t = function(value, mode) {
/******/ 		if(mode & 1) value = __webpack_require__(value);
/******/ 		if(mode & 8) return value;
/******/ 		if((mode & 4) && typeof value === 'object' && value && value.__esModule) return value;
/******/ 		var ns = Object.create(null);
/******/ 		__webpack_require__.r(ns);
/******/ 		Object.defineProperty(ns, 'default', { enumerable: true, value: value });
/******/ 		if(mode & 2 && typeof value != 'string') for(var key in value) __webpack_require__.d(ns, key, function(key) { return value[key]; }.bind(null, key));
/******/ 		return ns;
/******/ 	};
/******/
/******/ 	// getDefaultExport function for compatibility with non-harmony modules
/******/ 	__webpack_require__.n = function(module) {
/******/ 		var getter = module && module.__esModule ?
/******/ 			function getDefault() { return module['default']; } :
/******/ 			function getModuleExports() { return module; };
/******/ 		__webpack_require__.d(getter, 'a', getter);
/******/ 		return getter;
/******/ 	};
/******/
/******/ 	// Object.prototype.hasOwnProperty.call
/******/ 	__webpack_require__.o = function(object, property) { return Object.prototype.hasOwnProperty.call(object, property); };
/******/
/******/ 	// __webpack_public_path__
/******/ 	__webpack_require__.p = "";
/******/
/******/
/******/ 	// Load entry module and return exports
/******/ 	return __webpack_require__(__webpack_require__.s = "../vendor/trezor-usb-permissions.js");
/******/ })
/************************************************************************/
/******/ ({

/***/ "../vendor/trezor-usb-permissions.js":
/*!*******************************************!*\
  !*** ../vendor/trezor-usb-permissions.js ***!
  \*******************************************/
/*! no static exports found */
/***/ (function(module, exports) {

const VERSION = '8.1.27';
const versionN = VERSION.split('.').map(s => parseInt(s, 10));
const DIRECTORY = `${versionN[0]}/`;
const url = `*://connect.trezor.io/${DIRECTORY}`; // const url = `https://localhost:8088/`

/* Handling messages from usb permissions iframe */

function switchToPopupTab(event) {
  window.removeEventListener('beforeunload', switchToPopupTab);

  if (!event) {
    // triggered from 'usb-permissions-close' message
    // close current tab
    chrome.tabs.query({
      currentWindow: true,
      active: true
    }, current => {
      if (current.length < 0) return;
      chrome.tabs.remove(current[0].id);
    });
  } // find tab by popup pattern and switch to it


  chrome.tabs.query({
    url: `${url}popup.html`
  }, tabs => {
    if (tabs.length < 0) return;
    chrome.tabs.update(tabs[0].id, {
      active: true
    });
  });
}

window.addEventListener('message', event => {
  if (event.data === 'usb-permissions-init') {
    const iframe = document.getElementById('trezor-usb-permissions');

    if (!iframe || !(iframe instanceof HTMLIFrameElement)) {
      throw new Error('trezor-usb-permissions missing or incorrect dom type');
    }

    iframe.contentWindow.postMessage({
      type: 'usb-permissions-init',
      extension: chrome.runtime.id
    }, '*');
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

/***/ })

/******/ });
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIndlYnBhY2s6Ly8vd2VicGFjay9ib290c3RyYXAiLCJ3ZWJwYWNrOi8vLy4uL3ZlbmRvci90cmV6b3ItdXNiLXBlcm1pc3Npb25zLmpzIl0sIm5hbWVzIjpbIlZFUlNJT04iLCJ2ZXJzaW9uTiIsInNwbGl0IiwibWFwIiwicyIsInBhcnNlSW50IiwiRElSRUNUT1JZIiwidXJsIiwic3dpdGNoVG9Qb3B1cFRhYiIsImV2ZW50Iiwid2luZG93IiwicmVtb3ZlRXZlbnRMaXN0ZW5lciIsImNocm9tZSIsInRhYnMiLCJxdWVyeSIsImN1cnJlbnRXaW5kb3ciLCJhY3RpdmUiLCJjdXJyZW50IiwibGVuZ3RoIiwicmVtb3ZlIiwiaWQiLCJ1cGRhdGUiLCJhZGRFdmVudExpc3RlbmVyIiwiZGF0YSIsImlmcmFtZSIsImRvY3VtZW50IiwiZ2V0RWxlbWVudEJ5SWQiLCJIVE1MSUZyYW1lRWxlbWVudCIsIkVycm9yIiwiY29udGVudFdpbmRvdyIsInBvc3RNZXNzYWdlIiwidHlwZSIsImV4dGVuc2lvbiIsInJ1bnRpbWUiLCJpbnN0YW5jZSIsImNyZWF0ZUVsZW1lbnQiLCJmcmFtZUJvcmRlciIsIndpZHRoIiwiaGVpZ2h0Iiwic3R5bGUiLCJib3JkZXIiLCJzZXRBdHRyaWJ1dGUiLCJib2R5IiwiYXBwZW5kQ2hpbGQiXSwibWFwcGluZ3MiOiI7UUFBQTtRQUNBOztRQUVBO1FBQ0E7O1FBRUE7UUFDQTtRQUNBO1FBQ0E7UUFDQTtRQUNBO1FBQ0E7UUFDQTtRQUNBO1FBQ0E7O1FBRUE7UUFDQTs7UUFFQTtRQUNBOztRQUVBO1FBQ0E7UUFDQTs7O1FBR0E7UUFDQTs7UUFFQTtRQUNBOztRQUVBO1FBQ0E7UUFDQTtRQUNBLDBDQUEwQyxnQ0FBZ0M7UUFDMUU7UUFDQTs7UUFFQTtRQUNBO1FBQ0E7UUFDQSx3REFBd0Qsa0JBQWtCO1FBQzFFO1FBQ0EsaURBQWlELGNBQWM7UUFDL0Q7O1FBRUE7UUFDQTtRQUNBO1FBQ0E7UUFDQTtRQUNBO1FBQ0E7UUFDQTtRQUNBO1FBQ0E7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QWpCO0FBQ0FILFVBQVEsQ0FBQ0ksTUFBVCxHQUFrQixNQUFsQjtBQUNBSixVQUFRLENBQUNLLEtBQVQsQ0FBZUMsTUFBZixHQUF3QixLQUF4QjtBQUNBTixVQUFRLENBQUNLLEtBQVQsQ0FBZUYsS0FBZixHQUF1QixNQUF2QjtBQUNBSCxVQUFRLENBQUNLLEtBQVQsQ0FBZUQsTUFBZixHQUF3QixNQUF4QjtBQUNBSixVQUFRLENBQUNPLFlBQVQsQ0FBc0IsS0FBdEIsRUFBOEIsR0FBRWxDLEdBQUksNEJBQXBDO0FBQ0EyQixVQUFRLENBQUNPLFlBQVQsQ0FBc0IsT0FBdEIsRUFBK0IsS0FBL0I7O0FBRUEsTUFBSWhCLFFBQVEsQ0FBQ2lCLElBQWIsRUFBbUI7QUFDZmpCLFlBQVEsQ0FBQ2lCLElBQVQsQ0FBY0MsV0FBZCxDQUEwQlQsUUFBMUI7QUFDSDtBQUNKLENBZkQsRSxDQWdCQTtBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUVBLDZEIiwiZmlsZSI6ImpzL3RyZXpvclVTQi5idW5kbGUuanMiLCJzb3VyY2VzQ29udGVudCI6WyIgXHQvLyBUaGUgbW9kdWxlIGNhY2hlXG4gXHR2YXIgaW5zdGFsbGVkTW9kdWxlcyA9IHt9O1xuXG4gXHQvLyBUaGUgcmVxdWlyZSBmdW5jdGlvblxuIFx0ZnVuY3Rpb24gX193ZWJwYWNrX3JlcXVpcmVfXyhtb2R1bGVJZCkge1xuXG4gXHRcdC8vIENoZWNrIGlmIG1vZHVsZSBpcyBpbiBjYWNoZVxuIFx0XHRpZihpbnN0YWxsZWRNb2R1bGVzW21vZHVsZUlkXSkge1xuIFx0XHRcdHJldHVybiBpbnN0YWxsZWRNb2R1bGVzW21vZHVsZUlkXS5leHBvcnRzO1xuIFx0XHR9XG4gXHRcdC8vIENyZWF0ZSBhIG5ldyBtb2R1bGUgKGFuZCBwdXQgaXQgaW50byB0aGUgY2FjaGUpXG4gXHRcdHZhciBtb2R1bGUgPSBpbnN0YWxsZWRNb2R1bGVzW21vZHVsZUlkXSA9IHtcbiBcdFx0XHRpOiBtb2R1bGVJZCxcbiBcdFx0XHRsOiBmYWxzZSxcbiBcdFx0XHRleHBvcnRzOiB7fVxuIFx0XHR9O1xuXG4gXHRcdC8vIEV4ZWN1dGUgdGhlIG1vZHVsZSBmdW5jdGlvblxuIFx0XHRtb2R1bGVzW21vZHVsZUlkXS5jYWxsKG1vZHVsZS5leHBvcnRzLCBtb2R1bGUsIG1vZHVsZS5leHBvcnRzLCBfX3dlYnBhY2tfcmVxdWlyZV9fKTtcblxuIFx0XHQvLyBGbGFnIHRoZSBtb2R1bGUgYXMgbG9hZGVkXG4gXHRcdG1vZHVsZS5sID0gdHJ1ZTtcblxuIFx0XHQvLyBSZXR1cm4gdGhlIGV4cG9ydHMgb2YgdGhlIG1vZHVsZVxuIFx0XHRyZXR1cm4gbW9kdWxlLmV4cG9ydHM7XG4gXHR9XG5cblxuIFx0Ly8gZXhwb3NlIHRoZSBtb2R1bGVzIG9iamVjdCAoX193ZWJwYWNrX21vZHVsZXNfXylcbiBcdF9fd2VicGFja19yZXF1aXJlX18ubSA9IG1vZHVsZXM7XG5cbiBcdC8vIGV4cG9zZSB0aGUgbW9kdWxlIGNhY2hlXG4gXHRfX3dlYnBhY2tfcmVxdWlyZV9fLmMgPSBpbnN0YWxsZWRNb2R1bGVzO1xuXG4gXHQvLyBkZWZpbmUgZ2V0dGVyIGZ1bmN0aW9uIGZvciBoYXJtb255IGV4cG9ydHNcbiBcdF9fd2VicGFja19yZXF1aXJlX18uZCA9IGZ1bmN0aW9uKGV4cG9ydHMsIG5hbWUsIGdldHRlcikge1xuIFx0XHRpZighX193ZWJwYWNrX3JlcXVpcmVfXy5vKGV4cG9ydHMsIG5hbWUpKSB7XG4gXHRcdFx0T2JqZWN0LmRlZmluZVByb3BlcnR5KGV4cG9ydHMsIG5hbWUsIHsgZW51bWVyYWJsZTogdHJ1ZSwgZ2V0OiBnZXR0ZXIgfSk7XG4gXHRcdH1cbiBcdH07XG5cbiBcdC8vIGRlZmluZSBfX2VzTW9kdWxlIG9uIGV4cG9ydHNcbiBcdF9fd2VicGFja19yZXF1aXJlX18uciA9IGZ1bmN0aW9uKGV4cG9ydHMpIHtcbiBcdFx0aWYodHlwZW9mIFN5bWJvbCAhPT0gJ3VuZGVmaW5lZCcgJiYgU3ltYm9sLnRvU3RyaW5nVGFnKSB7XG4gXHRcdFx0T2JqZWN0LmRlZmluZVByb3BlcnR5KGV4cG9ydHMsIFN5bWJvbC50b1N0cmluZ1RhZywgeyB2YWx1ZTogJ01vZHVsZScgfSk7XG4gXHRcdH1cbiBcdFx0T2JqZWN0LmRlZmluZVByb3BlcnR5KGV4cG9ydHMsICdfX2VzTW9kdWxlJywgeyB2YWx1ZTogdHJ1ZSB9KTtcbiBcdH07XG5cbiBcdC8vIGNyZWF0ZSBhIGZha2UgbmFtZXNwYWNlIG9iamVjdFxuIFx0Ly8gbW9kZSAmIDE6IHZhbHVlIGlzIGEgbW9kdWxlIGlkLCByZXF1aXJlIGl0XG4gXHQvLyBtb2RlICYgMjogbWVyZ2UgYWxsIHByb3BlcnRpZXMgb2YgdmFsdWUgaW50byB0aGUgbnNcbiBcdC8vIG1vZGUgJiA0OiByZXR1cm4gdmFsdWUgd2hlbiBhbHJlYWR5IG5zIG9iamVjdFxuIFx0Ly8gbW9kZSAmIDh8MTogYmVoYXZlIGxpa2UgcmVxdWlyZVxuIFx0X193ZWJwYWNrX3JlcXVpcmVfXy50ID0gZnVuY3Rpb24odmFsdWUsIG1vZGUpIHtcbiBcdFx0aWYobW9kZSAmIDEpIHZhbHVlID0gX193ZWJwYWNrX3JlcXVpcmVfXyh2YWx1ZSk7XG4gXHRcdGlmKG1vZGUgJiA4KSByZXR1cm4gdmFsdWU7XG4gXHRcdGlmKChtb2RlICYgNCkgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiB2YWx1ZSAmJiB2YWx1ZS5fX2VzTW9kdWxlKSByZXR1cm4gdmFsdWU7XG4gXHRcdHZhciBucyA9IE9iamVjdC5jcmVhdGUobnVsbCk7XG4gXHRcdF9fd2VicGFja19yZXF1aXJlX18ucihucyk7XG4gXHRcdE9iamVjdC5kZWZpbmVQcm9wZXJ0eShucywgJ2RlZmF1bHQnLCB7IGVudW1lcmFibGU6IHRydWUsIHZhbHVlOiB2YWx1ZSB9KTtcbiBcdFx0aWYobW9kZSAmIDIgJiYgdHlwZW9mIHZhbHVlICE9ICdzdHJpbmcnKSBmb3IodmFyIGtleSBpbiB2YWx1ZSkgX193ZWJwYWNrX3JlcXVpcmVfXy5kKG5zLCBrZXksIGZ1bmN0aW9uKGtleSkgeyByZXR1cm4gdmFsdWVba2V5XTsgfS5iaW5kKG51bGwsIGtleSkpO1xuIFx0XHRyZXR1cm4gbnM7XG4gXHR9O1xuXG4gXHQvLyBnZXREZWZhdWx0RXhwb3J0IGZ1bmN0aW9uIGZvciBjb21wYXRpYmlsaXR5IHdpdGggbm9uLWhhcm1vbnkgbW9kdWxlc1xuIFx0X193ZWJwYWNrX3JlcXVpcmVfXy5uID0gZnVuY3Rpb24obW9kdWxlKSB7XG4gXHRcdHZhciBnZXR0ZXIgPSBtb2R1bGUgJiYgbW9kdWxlLl9fZXNNb2R1bGUgP1xuIFx0XHRcdGZ1bmN0aW9uIGdldERlZmF1bHQoKSB7IHJldHVybiBtb2R1bGVbJ2RlZmF1bHQnXTsgfSA6XG4gXHRcdFx0ZnVuY3Rpb24gZ2V0TW9kdWxlRXhwb3J0cygpIHsgcmV0dXJuIG1vZHVsZTsgfTtcbiBcdFx0X193ZWJwYWNrX3JlcXVpcmVfXy5kKGdldHRlciwgJ2EnLCBnZXR0ZXIpO1xuIFx0XHRyZXR1cm4gZ2V0dGVyO1xuIFx0fTtcblxuIFx0Ly8gT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsXG4gXHRfX3dlYnBhY2tfcmVxdWlyZV9fLm8gPSBmdW5jdGlvbihvYmplY3QsIHByb3BlcnR5KSB7IHJldHVybiBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwob2JqZWN0LCBwcm9wZXJ0eSk7IH07XG5cbiBcdC8vIF9fd2VicGFja19wdWJsaWNfcGF0aF9fXG4gXHRfX3dlYnBhY2tfcmVxdWlyZV9fLnAgPSBcIlwiO1xuXG5cbiBcdC8vIExvYWQgZW50cnkgbW9kdWxlIGFuZCByZXR1cm4gZXhwb3J0c1xuIFx0cmV0dXJuIF9fd2VicGFja19yZXF1aXJlX18oX193ZWJwYWNrX3JlcXVpcmVfXy5zID0gXCIuLi92ZW5kb3IvdHJlem9yLXVzYi1wZXJtaXNzaW9ucy5qc1wiKTtcbiIsImNvbnN0IFZFUlNJT04gPSAnOC4xLjI3JztcbmNvbnN0IHZlcnNpb25OID0gVkVSU0lPTi5zcGxpdCgnLicpLm1hcChzID0+IHBhcnNlSW50KHMsIDEwKSk7XG5jb25zdCBESVJFQ1RPUlkgPSBgJHt2ZXJzaW9uTlswXX0vYDtcbmNvbnN0IHVybCA9IGAqOi8vY29ubmVjdC50cmV6b3IuaW8vJHtESVJFQ1RPUll9YDtcbi8vIGNvbnN0IHVybCA9IGBodHRwczovL2xvY2FsaG9zdDo4MDg4L2Bcbi8qIEhhbmRsaW5nIG1lc3NhZ2VzIGZyb20gdXNiIHBlcm1pc3Npb25zIGlmcmFtZSAqL1xuZnVuY3Rpb24gc3dpdGNoVG9Qb3B1cFRhYihldmVudCkge1xuICAgIHdpbmRvdy5yZW1vdmVFdmVudExpc3RlbmVyKCdiZWZvcmV1bmxvYWQnLCBzd2l0Y2hUb1BvcHVwVGFiKTtcblxuICAgIGlmICghZXZlbnQpIHtcbiAgICAgICAgLy8gdHJpZ2dlcmVkIGZyb20gJ3VzYi1wZXJtaXNzaW9ucy1jbG9zZScgbWVzc2FnZVxuICAgICAgICAvLyBjbG9zZSBjdXJyZW50IHRhYlxuICAgICAgICBjaHJvbWUudGFicy5xdWVyeShcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBjdXJyZW50V2luZG93OiB0cnVlLFxuICAgICAgICAgICAgICAgIGFjdGl2ZTogdHJ1ZSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBjdXJyZW50ID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoY3VycmVudC5sZW5ndGggPCAwKSByZXR1cm47XG4gICAgICAgICAgICAgICAgY2hyb21lLnRhYnMucmVtb3ZlKGN1cnJlbnRbMF0uaWQpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyBmaW5kIHRhYiBieSBwb3B1cCBwYXR0ZXJuIGFuZCBzd2l0Y2ggdG8gaXRcbiAgICBjaHJvbWUudGFicy5xdWVyeShcbiAgICAgICAge1xuICAgICAgICAgICAgdXJsOiBgJHt1cmx9cG9wdXAuaHRtbGAsXG4gICAgICAgIH0sXG4gICAgICAgIHRhYnMgPT4ge1xuICAgICAgICAgICAgaWYgKHRhYnMubGVuZ3RoIDwgMCkgcmV0dXJuO1xuICAgICAgICAgICAgY2hyb21lLnRhYnMudXBkYXRlKHRhYnNbMF0uaWQsIHsgYWN0aXZlOiB0cnVlIH0pO1xuICAgICAgICB9LFxuICAgICk7XG59XG5cbndpbmRvdy5hZGRFdmVudExpc3RlbmVyKCdtZXNzYWdlJywgZXZlbnQgPT4ge1xuICAgIGlmIChldmVudC5kYXRhID09PSAndXNiLXBlcm1pc3Npb25zLWluaXQnKSB7XG4gICAgICAgIGNvbnN0IGlmcmFtZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0cmV6b3ItdXNiLXBlcm1pc3Npb25zJyk7XG4gICAgICAgIGlmICghaWZyYW1lIHx8ICEoaWZyYW1lIGluc3RhbmNlb2YgSFRNTElGcmFtZUVsZW1lbnQpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ3RyZXpvci11c2ItcGVybWlzc2lvbnMgbWlzc2luZyBvciBpbmNvcnJlY3QgZG9tIHR5cGUnKTtcbiAgICAgICAgfVxuICAgICAgICBpZnJhbWUuY29udGVudFdpbmRvdy5wb3N0TWVzc2FnZShcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICB0eXBlOiAndXNiLXBlcm1pc3Npb25zLWluaXQnLFxuICAgICAgICAgICAgICAgIGV4dGVuc2lvbjogY2hyb21lLnJ1bnRpbWUuaWQsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgJyonLFxuICAgICAgICApO1xuICAgIH0gZWxzZSBpZiAoZXZlbnQuZGF0YSA9PT0gJ3VzYi1wZXJtaXNzaW9ucy1jbG9zZScpIHtcbiAgICAgICAgc3dpdGNoVG9Qb3B1cFRhYigpO1xuICAgIH1cbn0pO1xuXG53aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignYmVmb3JldW5sb2FkJywgc3dpdGNoVG9Qb3B1cFRhYik7XG53aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignbG9hZCcsICgpID0+IHtcbiAgICBjb25zdCBpbnN0YW5jZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2lmcmFtZScpO1xuICAgIGluc3RhbmNlLmlkID0gJ3RyZXpvci11c2ItcGVybWlzc2lvbnMnO1xuICAgIGluc3RhbmNlLmZyYW1lQm9yZGVyID0gJzAnO1xuICAgIGluc3RhbmNlLndpZHRoID0gJzEwMCUnO1xuICAgIGluc3RhbmNlLmhlaWdodCA9ICcxMDAlJztcbiAgICBpbnN0YW5jZS5zdHlsZS5ib3JkZXIgPSAnMHB4JztcbiAgICBpbnN0YW5jZS5zdHlsZS53aWR0aCA9ICcxMDAlJztcbiAgICBpbnN0YW5jZS5zdHlsZS5oZWlnaHQgPSAnMTAwJSc7XG4gICAgaW5zdGFuY2Uuc2V0QXR0cmlidXRlKCdzcmMnLCBgJHt1cmx9ZXh0ZW5zaW9uLXBlcm1pc3Npb25zLmh0bWxgKTtcbiAgICBpbnN0YW5jZS5zZXRBdHRyaWJ1dGUoJ2FsbG93JywgJ3VzYicpO1xuXG4gICAgaWYgKGRvY3VtZW50LmJvZHkpIHtcbiAgICAgICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChpbnN0YW5jZSk7XG4gICAgfVxufSk7XG4vLyBjb25zdCBzd2l0Y2hUb1BvcHVwVGFiID0gKGV2ZW50KSA9PiB7XG5cbi8vICAgICB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcignYmVmb3JldW5sb2FkJywgc3dpdGNoVG9Qb3B1cFRhYik7XG4vLyAgICAgY29uc29sZS5sb2coXCJhZGRpbmcgdXNiIHBlcm1pc3Npb24gaW4gcG9wdXAgc3dpdGNoXCIpXG4vLyAgICAgaWYgKCFldmVudCkge1xuLy8gICAgICAgICAvLyB0cmlnZ2VyZWQgZnJvbSAndXNiLXBlcm1pc3Npb25zLWNsb3NlJyBtZXNzYWdlXG4vLyAgICAgICAgIC8vIHN3aXRjaCB0YWIgdG8gcHJldmlvdXMgaW5kZXggYW5kIGNsb3NlIGN1cnJlbnRcbi8vICAgICAgICAgY2hyb21lLnRhYnMucXVlcnkoe1xuLy8gICAgICAgICAgICAgY3VycmVudFdpbmRvdzogdHJ1ZSxcbi8vICAgICAgICAgICAgIGFjdGl2ZTogdHJ1ZSxcbi8vICAgICAgICAgfSwgKGN1cnJlbnQpID0+IHtcbi8vICAgICAgICAgICAgIGlmIChjdXJyZW50Lmxlbmd0aCA8IDApIHJldHVybjtcbi8vICAgICAgICAgICAgIGNocm9tZS50YWJzLnF1ZXJ5KHtcbi8vICAgICAgICAgICAgICAgICBpbmRleDogY3VycmVudFswXS5pbmRleCAtIDFcbi8vICAgICAgICAgICAgIH0sIHBvcHVwID0+IHtcbi8vICAgICAgICAgICAgICAgICBpZiAocG9wdXAubGVuZ3RoIDwgMCkgcmV0dXJuO1xuLy8gICAgICAgICAgICAgICAgIGNocm9tZS50YWJzLnVwZGF0ZShwb3B1cFswXS5pZCwgeyBhY3RpdmU6IHRydWUgfSk7XG4vLyAgICAgICAgICAgICB9KVxuLy8gICAgICAgICAgICAgY2hyb21lLnRhYnMucmVtb3ZlKGN1cnJlbnRbMF0uaWQpO1xuLy8gICAgICAgICB9KTtcbi8vICAgICAgICAgcmV0dXJuO1xuLy8gICAgIH1cblxuLy8gICAgIC8vIFRPRE86IHJlbW92ZSB0aGlzIHF1ZXJ5LCBvciBhZGQgYHRhYnNgIHBlcm1pc3Npb24uIFRoaXMgZG9lcyBub3Qgd29yay5cbi8vICAgICAvLyB0cmlnZ2VyZWQgZnJvbSAnYmVmb3JldW5sb2FkJyBldmVudFxuLy8gICAgIC8vIGZpbmQgdGFiIGJ5IHBvcHVwIHBhdHRlcm4gYW5kIHN3aXRjaCB0byBpdFxuLy8gICAgIGNocm9tZS50YWJzLnF1ZXJ5KHtcbi8vICAgICAgICAgdXJsOiBcIio6Ly9jb25uZWN0LnRyZXpvci5pby8qL3BvcHVwLmh0bWxcIlxuLy8gICAgIH0sICh0YWJzKSA9PiB7XG4vLyAgICAgICAgIGlmICh0YWJzLmxlbmd0aCA8IDApIHJldHVybjtcbi8vICAgICAgICAgY2hyb21lLnRhYnMudXBkYXRlKHRhYnNbMF0uaWQsIHsgYWN0aXZlOiB0cnVlIH0pO1xuLy8gICAgIH0pO1xuLy8gfVxuXG4vLyB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIGV2ZW50ID0+IHtcbi8vICAgICBpZiAoZXZlbnQuZGF0YSA9PT0gJ3VzYi1wZXJtaXNzaW9ucy1pbml0Jykge1xuLy8gICAgICAgICBjb25zb2xlLmxvZyhcImFkZGluZyB1c2IgcGVybWlzc2lvblwiKVxuLy8gICAgICAgICBjb25zdCBpZnJhbWUgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndHJlem9yLXVzYi1wZXJtaXNzaW9ucycpO1xuLy8gICAgICAgICBpZnJhbWUuY29udGVudFdpbmRvdy5wb3N0TWVzc2FnZSh7XG4vLyAgICAgICAgICAgICB0eXBlOiAndXNiLXBlcm1pc3Npb25zLWluaXQnLFxuLy8gICAgICAgICAgICAgZXh0ZW5zaW9uOiBjaHJvbWUucnVudGltZS5pZCxcbi8vICAgICAgICAgfSwgJyonKTtcbi8vICAgICB9IGVsc2UgaWYgKGV2ZW50LmRhdGEgPT09ICd1c2ItcGVybWlzc2lvbnMtY2xvc2UnKSB7XG4vLyAgICAgICAgIHN3aXRjaFRvUG9wdXBUYWIoKTtcbi8vICAgICB9XG4vLyB9KTtcblxuLy8gd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ2JlZm9yZXVubG9hZCcsIHN3aXRjaFRvUG9wdXBUYWIpOyJdLCJzb3VyY2VSb290IjoiIn0=