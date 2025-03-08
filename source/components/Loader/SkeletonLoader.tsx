import React from 'react';
import './SkeletonLoader.css';

const SkeletonLoader: React.FC<{
  height?: string;
  margin?: string;
  width?: string;
}> = ({ width = '100%', height = '100%', margin = '' }) => (
  <div className="skeleton-loader" style={{ width, height, margin }}></div>
);

export default SkeletonLoader;
