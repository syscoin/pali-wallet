import React, { useState } from 'react';
import { useSelector } from 'react-redux';

import { useController } from 'hooks/useController';
import { RootState } from 'state/store';

/**
 * Test component to verify wallet lock detection and automatic redirect functionality.
 * Also includes auto-lock testing features.
 * This component can be temporarily added to any page to test the error handling.
 *
 * To use this component:
 * 1. Import it in any page component
 * 2. Add <WalletLockTestComponent /> to the JSX
 * 3. Click the test buttons to simulate wallet locked errors
 * 4. Verify that the app automatically redirects to the unlock screen
 * 5. Test auto-lock functionality
 *
 * Remove this component after testing.
 */
export const WalletLockTestComponent: React.FC = () => {
  const { controllerEmitter, handleWalletLockedError, resetAutoLockTimer } =
    useController();
  const { advancedSettings } = useSelector(
    (state: RootState) => state.vaultGlobal
  );
  const autoLockSettings = advancedSettings.autolock;
  const [testResult, setTestResult] = useState<string>('');

  const testWalletLockedError = () => {
    const testError = new Error(
      'Target keyring for slip44 57 is locked. Please unlock the wallet first.'
    );

    try {
      const wasHandled = handleWalletLockedError(testError);
      setTestResult(
        wasHandled
          ? 'Wallet locked error handled successfully! Should redirect to unlock.'
          : 'Error was not recognized as wallet locked error.'
      );
    } catch (error) {
      setTestResult(`Test failed: ${error.message}`);
    }
  };

  const testCreateAccountError = async () => {
    try {
      // This should fail with a wallet locked error if wallet is actually locked
      await controllerEmitter(['wallet', 'createAccount'], []);
      setTestResult('Create account succeeded - wallet is unlocked');
    } catch (error) {
      const wasHandled = handleWalletLockedError(error);
      setTestResult(
        wasHandled
          ? 'Create account error handled! Should redirect to unlock.'
          : `Unhandled error: ${error.message}`
      );
    }
  };

  const testAutoLockSettings = async () => {
    try {
      // Test setting auto-lock timer to 10 minutes
      await controllerEmitter(
        ['wallet', 'setAdvancedSettings'],
        ['autolock', 10]
      );
      setTestResult('Auto-lock timer set to 10 minutes successfully');
    } catch (error) {
      const wasHandled = handleWalletLockedError(error);
      setTestResult(
        wasHandled
          ? 'Auto-lock setting error handled! Should redirect to unlock.'
          : `Unhandled error: ${error.message}`
      );
    }
  };

  const testResetTimer = () => {
    try {
      resetAutoLockTimer();
      setTestResult('Auto-lock timer reset! Timer should restart.');
    } catch (error) {
      setTestResult(`Reset timer failed: ${error.message}`);
    }
  };

  return (
    <div className="p-4 bg-gray-800 rounded-lg m-4">
      <h3 className="text-white text-lg font-bold mb-4">
        🧪 Wallet Lock Test Component
      </h3>

      <div className="mb-4 p-3 bg-gray-700 rounded">
        <h4 className="text-white font-semibold mb-2">Auto-lock Status:</h4>
        <p className="text-white text-sm">Timer: {autoLockSettings} minutes</p>
        <p className="text-white text-xs text-gray-300 mt-2">
          Activity Detection: Mouse, keyboard, touch, scroll, click events +
          route changes
        </p>
      </div>

      <div className="space-y-2 mb-4">
        <button
          onClick={testWalletLockedError}
          className="block w-full px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
        >
          Test Wallet Locked Error Handler
        </button>

        <button
          onClick={testCreateAccountError}
          className="block w-full px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700"
        >
          Test Create Account (triggers real lock error if locked)
        </button>

        <button
          onClick={testAutoLockSettings}
          className="block w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Test Enable Auto-lock (10 min)
        </button>

        <button
          onClick={testResetTimer}
          className="block w-full px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
        >
          Test Reset Auto-lock Timer
        </button>
      </div>

      {testResult && (
        <div className="p-3 bg-gray-900 rounded text-white text-sm">
          <strong>Result:</strong> {testResult}
        </div>
      )}

      <p className="text-gray-400 text-xs mt-4">
        Remove this component from production builds
      </p>
    </div>
  );
};

export default WalletLockTestComponent;
