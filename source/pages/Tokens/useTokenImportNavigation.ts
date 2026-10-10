import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/** Preserve public import identifiers; validation is rerun after reopening. */
export const useTokenImportNavigation = (
  tokenImportScope: string,
  fields: {
    customAssetGuid?: string;
    customContractAddress?: string;
    customTokenId?: string;
  }
) => {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const expected = { tokenImportScope, ...fields };
    const current = Object.fromEntries(
      Object.keys(expected).map((key) => [key, location.state?.[key]])
    );
    if (JSON.stringify(current) === JSON.stringify(expected)) return;
    const state = { ...location.state };
    delete state.customTokenDetails;
    navigate(`${location.pathname}${location.search}${location.hash}`, {
      replace: true,
      state: { ...state, ...expected },
    });
  }, [tokenImportScope, fields, location, navigate]);
};
