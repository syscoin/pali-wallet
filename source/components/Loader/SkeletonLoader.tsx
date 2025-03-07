import React from 'react';
import './SkeletonLoader.css'; // Create a CSS file for styling

const SkeletonLoader: React.FC<{ height?: string; width?: string }> = ({
  width = '100%',
  height = '100%',
}) => <div className="skeleton-loader" style={{ width, height }}></div>;

export default SkeletonLoader;
