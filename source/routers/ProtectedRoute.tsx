import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { AppLoadingSkeleton } from 'components/Loader/AppLoadingSkeleton';
import { useAppReady } from 'hooks/useAppReady';
import { useController } from 'hooks/useController';

export function ProtectedRoute({ element }: { element: JSX.Element }) {
  const { isUnlocked, isLoading } = useController();
  const location = useLocation();
  const navigate = useNavigate();

  // Check if we're in external context (external.html instead of app.html)
  const isExternal = window.location.pathname.includes('external');

  // Signal app ready for external authenticated routes
  // For non-external routes, AppLayout handles this
  useAppReady(!isLoading && isUnlocked && isExternal);

  useEffect(() => {
    if (!isLoading && !isUnlocked && !isExternal) {
      navigate('/', { replace: true });
    }
    // A lazy auth route can suspend without unmounting this guard. Returning
    // to the same protected path must redirect again, even when a native hash
    // entry reuses its pathname and key. Track the full location identity.
  }, [isLoading, isUnlocked, isExternal, location, navigate]);

  // Wait for authentication check to complete before deciding what to render
  if (isLoading) {
    // Branded skeleton keeps the popup from flashing a blank dark screen
    return <AppLoadingSkeleton />;
  }

  // Special handling for hardware wallet page - don't redirect on logout
  if (isExternal) {
    return element; // Always render the element, let it handle its own auth state
  }

  if (!isUnlocked) {
    return <AppLoadingSkeleton />;
  }

  // Return element immediately once auth is confirmed
  return element;
}
