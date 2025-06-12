import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';

import { LoadingComponent } from 'components/Loading';
import { useController } from 'hooks/useController';

export function ProtectedRoute({ element }: { element: JSX.Element }) {
  const { isUnlocked, isLoading } = useController();
  const [showContent, setShowContent] = useState(false);

  useEffect(() => {
    // Add a small delay before showing content to ensure smooth transition
    if (!isLoading && isUnlocked) {
      const timer = setTimeout(() => {
        setShowContent(true);
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isLoading, isUnlocked]);

  // Show loading component instead of blank screen
  if (isLoading || !showContent) {
    return <LoadingComponent />;
  }

  if (!isUnlocked) {
    return <Navigate to={{ pathname: '/' }} />;
  }

  return <div className="animate-fadeIn">{element}</div>;
}
