import { useState, useEffect, useCallback } from "react";

import { getAllLogo } from "../services/logoService";

export default function useFetch(assetsArray, page) {
  const [isLoading, setIsLoading] = useState(true);
  const [assets, setAssets] = useState([]);
  const [hasMore, setHasMore] = useState(true);

  const TOTAL_ITEMS = assetsArray.length;
  const MAX_ITEMS = 15;
  const REST_ITEMS = TOTAL_ITEMS % MAX_ITEMS;
  const TOTAL_PAGES = Math.ceil(TOTAL_ITEMS / MAX_ITEMS);

  const requestAssetsWithImages = useCallback(async () => {
    if (!assetsArray.length) return;

    const initialIndex = page === 1 ? 0 : (page - 1) * MAX_ITEMS;
    const lastIndex =
      initialIndex + MAX_ITEMS > TOTAL_ITEMS
        ? initialIndex + REST_ITEMS
        : initialIndex + MAX_ITEMS - 1;

    const assetsToRender = assetsArray.filter(
      (a, i) => i >= initialIndex && i <= lastIndex && a
    );

    setIsLoading(true);

    const images = await getAllLogo(assetsToRender) || { urls: [] };
    // const images = 
    
    const newAssets = assetsToRender.reduce((acc, cur) => {
      const logo = images.urls.find((i) => i[0] === cur.assetGuid);
      return logo
        ? (acc = [...acc, { ...cur, logoUrl: logo[1] }])
        : (acc = [...acc, cur]);
    }, []);

    setIsLoading(false);

    TOTAL_PAGES === page && setHasMore(false);

    setAssets((prev) => [...prev, ...newAssets]);
  }, [assetsArray, page, assets]);

  useEffect(() => {
    requestAssetsWithImages();
  }, [assetsArray, page]);

  return { isLoading, assets, hasMore };
}
