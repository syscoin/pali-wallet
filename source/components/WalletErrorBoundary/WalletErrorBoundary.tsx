import React, { Component, ErrorInfo, ReactNode } from 'react';
import { NavigateFunction } from 'react-router-dom';

interface IProps {
  children: ReactNode;
  navigate: NavigateFunction;
}

interface IState {
  error: Error | null;
  hasError: boolean;
}

class WalletErrorBoundary extends Component<IProps, IState> {
  constructor(props: IProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): IState {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('WalletErrorBoundary caught an error:', error, errorInfo);

    // Check if this is a wallet locked error
    const errorMessage = error?.message || '';
    const isWalletLockedError =
      (errorMessage.includes('Target keyring') &&
        errorMessage.includes('locked')) ||
      errorMessage.includes('Wallet must be unlocked') ||
      errorMessage.includes('Wallet is locked') ||
      errorMessage.includes('Please unlock the wallet first') ||
      errorMessage.includes('No unlocked keyring found');

    if (isWalletLockedError) {
      console.log(
        '[WalletErrorBoundary] Wallet locked error detected, redirecting:',
        errorMessage
      );
      // Navigate to unlock screen
      this.props.navigate('/', { replace: true });
    }
  }

  render() {
    if (this.state.hasError) {
      const errorMessage = this.state.error?.message || '';
      const isWalletLockedError =
        (errorMessage.includes('Target keyring') &&
          errorMessage.includes('locked')) ||
        errorMessage.includes('Wallet must be unlocked') ||
        errorMessage.includes('Wallet is locked') ||
        errorMessage.includes('Please unlock the wallet first') ||
        errorMessage.includes('No unlocked keyring found');

      if (isWalletLockedError) {
        // For wallet locked errors, don't show error UI - just redirect
        // The redirect happens in componentDidCatch
        return null;
      }

      // For other errors, show a generic error message
      return (
        <div className="min-h-screen flex items-center justify-center bg-bkg-1">
          <div className="text-center p-6">
            <h2 className="text-xl font-semibold text-white mb-4">
              Something went wrong
            </h2>
            <p className="text-gray-300 mb-4">
              An unexpected error occurred. Please try refreshing the page.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="bg-brand-deepPink100 text-white px-4 py-2 rounded-lg hover:bg-brand-deepPink200 transition-colors"
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default WalletErrorBoundary;
