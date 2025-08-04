import React from 'react';

const SkeletonLoader: React.FC<{
  className?: string;
  height?: string;
  margin?: string;
  rounded?: boolean;
  width?: string;
}> = ({
  width = '100%',
  height = '100%',
  margin = '',
  rounded = false,
  className = '',
}) => (
  <div
    className={`relative overflow-hidden bg-gray-700/50 ${
      rounded ? 'rounded-full' : 'rounded-md'
    } ${className}`}
    style={{ width, height, margin }}
  >
    <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-gray-600/30 to-transparent" />
  </div>
);

export default SkeletonLoader;
