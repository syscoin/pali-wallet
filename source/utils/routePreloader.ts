// Preload critical routes to avoid blank screens during navigation
export const preloadCriticalRoutes = () => {
  // These are the most commonly used routes that should be preloaded
  const criticalRoutes = [
    () => import('pages').then((m) => ({ default: m.Home })),
    () => import('pages').then((m) => ({ default: m.SendSys })),
    () => import('pages').then((m) => ({ default: m.SendEth })),
    () => import('pages').then((m) => ({ default: m.SendConfirm })),
    () => import('pages').then((m) => ({ default: m.Receive })),
  ];

  // Preload after a short delay to not block initial render
  setTimeout(() => {
    criticalRoutes.forEach((loadRoute) => {
      loadRoute().catch(() => {
        // Ignore errors, these are just preloads
      });
    });
  }, 1000);
};

// Preload a route when hovering over navigation elements
export const preloadRoute = (routeLoader: () => Promise<any>) => {
  routeLoader().catch(() => {
    // Ignore errors
  });
};
