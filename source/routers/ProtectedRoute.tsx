import React, { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { getController } from 'utils/browser';

export const ProtectedRoute = ({ element }: { element: JSX.Element }) => {
  const { isLocked } = getController().wallet;

  useEffect(() => {
    console.log('protected route is unlocked:', !isLocked());
  }, [isLocked()]);

  if (isLocked()) {
    return <Navigate to={{ pathname: '/' }} />;
  }

  return element;
};
