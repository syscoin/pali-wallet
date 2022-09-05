import React from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Reads the route parameters
 */
export const useQuery = (): {
  [param: string]: any;
} => {
  const { search } = useLocation();

  return React.useMemo(() => {
    const obj = <any>{};
    const params = new URLSearchParams(search);
    params.forEach((value, key) => (obj[key] = value));

    return obj;
  }, [search]);
};

/**
 * Parses `data` field from route parameters
 */
export const useQueryData = () => {
  const params = useQuery();

  return React.useMemo(() => {
    if (!params.data) return {};
    return JSON.parse(params.data);
  }, [params]);
};
