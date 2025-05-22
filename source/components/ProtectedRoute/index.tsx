import React from 'react';
import { Navigate } from 'react-router-dom';

import { useController } from 'hooks/useController';

interface IProtectedRouteProps {
  element: React.ReactElement;
}

export const ProtectedRoute: React.FC<IProtectedRouteProps> = ({ element }) => {
  const { isUnlocked } = useController();

  if (!isUnlocked) {
    return <Navigate to="/auth/start" replace />;
  }

  return element;
};
