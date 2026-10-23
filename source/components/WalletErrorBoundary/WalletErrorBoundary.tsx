import React, { Component, ErrorInfo, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavigateFunction } from 'react-router-dom';

interface IProps {
  children: ReactNode;
  navigate: NavigateFunction;
  pathname: string;
}

interface IState {
  error: Error | null;
  hasError: boolean;
}

const isWalletLockedError = (error: Error | null): boolean => {
  const message = error?.message || '';
  return (
    (message.includes('Target keyring') && message.includes('locked')) ||
    message.includes('Wallet must be unlocked') ||
    message.includes('Wallet is locked') ||
    message.includes('Please unlock the wallet first') ||
    message.includes('No unlocked keyring found')
  );
};

const WalletErrorFallback = () => {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen flex items-center justify-center bg-bkg-1">
      <div className="text-center p-6">
        <h2 className="text-xl font-semibold text-white mb-4">
          {t('components.unexpectedErrorTitle')}
        </h2>
        <p className="text-gray-300 mb-4">
          {t('components.unexpectedErrorDescription')}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="bg-brand-deepPink100 text-white px-4 py-2 rounded-lg hover:bg-brand-deepPink200 transition-colors"
        >
          {t('components.refreshPage')}
        </button>
      </div>
    </div>
  );
};

class WalletErrorBoundary extends Component<IProps, IState> {
  constructor(props: IProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): IState {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  componentDidUpdate(previous: IProps) {
    // Only the actual locked-error redirect may release this latch. Generic
    // failures and a failing Unlock route remain visible, without retry loops.
    if (
      this.state.hasError &&
      isWalletLockedError(this.state.error) &&
      previous.pathname !== '/' &&
      this.props.pathname === '/'
    ) {
      this.setState({ hasError: false, error: null });
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('WalletErrorBoundary caught an error:', error, errorInfo);

    // Check if this is a wallet locked error
    if (isWalletLockedError(error)) {
      console.log(
        '[WalletErrorBoundary] Wallet locked error detected, redirecting:',
        error.message
      );
      // Navigate to unlock screen
      this.props.navigate('/', { replace: true });
    }
  }

  render() {
    if (this.state.hasError) {
      // Retain visible recovery while the redirect has not committed, or if
      // the root route itself fails. Never replace an error with a blank view.
      return <WalletErrorFallback />;
    }

    return this.props.children;
  }
}

export default WalletErrorBoundary;
