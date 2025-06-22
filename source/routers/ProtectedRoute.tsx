import React from 'react';
import { Navigate } from 'react-router-dom';

import { useController } from 'hooks/useController';

export function ProtectedRoute({ element }: { element: JSX.Element }) {
  const { isUnlocked, isLoading } = useController();

  // Wait for authentication check to complete before deciding what to render
  if (isLoading) {
    // Return minimal loading without blue screen - just prevent premature redirect
    return <div style={{ opacity: 0 }}>Loading...</div>;
  }

  if (!isUnlocked) {
    return <Navigate to={{ pathname: '/' }} />;
  }

  // Return element immediately once auth is confirmed
  return element;
}
