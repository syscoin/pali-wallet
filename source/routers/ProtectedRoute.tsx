import React from 'react';
import { Navigate } from 'react-router-dom';
import { getController } from 'utils/browser';

export function ProtectedRoute({ element }: { element: JSX.Element }) {
  const { isLocked } = getController().wallet;

  if (isLocked()) {
    return <Navigate to={{ pathname: '/' }} />;
  }

  return element;
}
