import React from 'react';
import { Navigate } from 'react-router-dom';

import { getController } from 'scripts/Background';

export function ProtectedRoute({ element }: { element: JSX.Element }) {
  // const { isUnlocked } = getController().wallet;

  // if (!isUnlocked()) {
  //   return <Navigate to={{ pathname: '/' }} />;
  // }

  return element;
}
