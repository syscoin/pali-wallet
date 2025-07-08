import React from 'react';
import { Navigate } from 'react-router-dom';

import { useAppReady } from 'hooks/useAppReady';
import { useController } from 'hooks/useController';

export function ProtectedRoute({ element }: { element: JSX.Element }) {
  const { isUnlocked, isLoading } = useController();

  // Check if we're in external context (external.html instead of app.html)
  const isExternal = window.location.pathname.includes('external.html');

  // Check if this is the hardware wallet page that handles its own authentication
  // Use hash instead of pathname since React Router uses hash routing
  const isHardwareWalletPage = window.location.hash.includes(
    '/settings/account/hardware'
  );

  // Signal app ready for external authenticated routes
  // For non-external routes, AppLayout handles this
  useAppReady(!isLoading && isUnlocked && isExternal);

  // Wait for authentication check to complete before deciding what to render
  if (isLoading) {
    // Return minimal loading without blue screen - just prevent premature redirect
    return <div style={{ opacity: 0 }}>Loading...</div>;
  }

  // Special handling for hardware wallet page - don't redirect on logout
  if (isHardwareWalletPage) {
    return element; // Always render the element, let it handle its own auth state
  }

  if (!isUnlocked) {
    return <Navigate to={{ pathname: '/' }} />;
  }

  // Return element immediately once auth is confirmed
  return element;
}
