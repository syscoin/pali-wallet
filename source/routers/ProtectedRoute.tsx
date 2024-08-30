import React from 'react';
import { Navigate } from 'react-router-dom';

import { Loading } from 'components/Loading';
import { useController } from 'hooks/useController';

export function ProtectedRoute({ element }: { element: JSX.Element }) {
  const { isUnlocked, isLoading } = useController();

  if (isLoading) {
    return <Loading />;
  }

  if (!isUnlocked) {
    return <Navigate to={{ pathname: '/' }} />;
  }

  return element;
}
