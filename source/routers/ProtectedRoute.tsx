import { useController } from 'hooks/useController';
import React from 'react';
import { Navigate } from 'react-router-dom';

export function ProtectedRoute({ element }: { element: JSX.Element }) {
  const { isLocked } = useController().wallet;

  if (isLocked()) {
    return <Navigate to={{ pathname: '/import' }} />;
  }

  return element;
}
