import React from 'react';
import { Navigate } from 'react-router-dom';

import { useController } from 'hooks/useController';

export function ProtectedRoute({ element }: { element: JSX.Element }) {
  const { isUnlocked, isLoading } = useController();

  // Don't render anything while loading - the HTML loader is showing
  if (isLoading) {
    return null;
  }

  if (!isUnlocked) {
    return <Navigate to={{ pathname: '/' }} />;
  }

  return element;
}
