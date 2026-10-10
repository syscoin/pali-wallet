/* eslint-disable import/no-extraneous-dependencies */

import React, { PropsWithChildren, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

import { AntdProvider } from 'components/AntdProvider';
import { WalletBootstrap } from 'components/WalletBootstrap/WalletBootstrap';
import store from 'state/store';
import { connectApprovalClient } from 'utils/approvalClient';
import { startupFeedbackDelay } from 'utils/requestWalletState';
import 'assets/styles/index.css';
import 'assets/styles/antd-overrides.css';
import 'assets/styles/custom-checkbox.css';
import 'assets/fonts/index.css';

// Initialize i18n for external pages
import 'utils/i18n';

import External from './External';

const externalRootElement = document.getElementById('external-root');

// Complete the document binding while the URL is still external.html. Routing
// may then change its path without making legitimate approval replies stale.
const ApprovalClientBootstrap = ({ children }: PropsWithChildren) => {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'connecting' | 'ready' | 'error'>(
    'connecting'
  );
  const [error, setError] = useState('');
  const [isSlow, setIsSlow] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    let active = true;
    setStatus('connecting');
    setIsSlow(false);
    window.dispatchEvent(new CustomEvent('pali-app-ready'));
    const feedback = setTimeout(
      () => setIsSlow(true),
      attempt === 0 ? startupFeedbackDelay() : 1800
    );
    connectApprovalClient(abort.signal, 10000).then(
      () => {
        if (active) {
          clearTimeout(feedback);
          setStatus('ready');
        }
      },
      (reason) => {
        if (active) {
          setError(reason.message);
          setStatus('error');
        }
      }
    );
    return () => {
      active = false;
      clearTimeout(feedback);
      abort.abort();
    };
  }, [attempt]);
  if (status === 'ready') return <>{children}</>;
  return (
    <div className="flex h-full flex-col items-center justify-center bg-[#061120] p-6 text-center text-white">
      <h1 className="mb-5 font-poppins text-3xl text-[#4DA2CF]">Pali Wallet</h1>
      <p role="status" aria-live="polite" className="mb-4 text-sm">
        {status === 'error'
          ? error
          : isSlow
          ? 'Your approval is taking longer to connect. You can retry or close this window.'
          : 'Connecting your approval…'}
      </p>
      {(status === 'error' || isSlow) && (
        <div className="flex gap-4">
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
            className="rounded-lg bg-[#4DA2CF] px-5 py-3 font-medium text-[#061120]"
          >
            Retry connection
          </button>
          <button
            type="button"
            onClick={() => window.close()}
            className="rounded-lg border border-white px-5 py-3"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
};

const toastOptions = {
  position: 'bottom-center' as const,
  autoClose: 2 * 1000,
  hideProgressBar: false,
  closeOnClick: true,
  pauseOnHover: false,
  draggable: false,
  newestOnTop: false,
  limit: 3,
  closeButton: false,
  className: 'pali-toast',
  toastClassName: 'pali-toast-content',
  progressClassName: 'pali-toast-progress',
};

if (externalRootElement) {
  // Approval documents never serialize a main-wallet navigation snapshot.
  // Leave that separate document's browsing position untouched during bootstrap.
  const root = ReactDOM.createRoot(externalRootElement);
  root.render(
    <React.StrictMode>
      <Provider store={store}>
        <AntdProvider>
          <ApprovalClientBootstrap>
            <WalletBootstrap>
              <External />
              <ToastContainer {...toastOptions} />
            </WalletBootstrap>
          </ApprovalClientBootstrap>
        </AntdProvider>
      </Provider>
    </React.StrictMode>
  );
} else {
  console.error("Failed to find the root element with ID 'external-root'.");
}

export { default as External } from './External';
