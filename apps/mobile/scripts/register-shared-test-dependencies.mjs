import { registerHooks } from 'node:module';

// Shared extension sources are bundled against this app's dependency graph by
// Metro. Node's source tests need the same resolution root, including in CI
// where the extension's separate node_modules is deliberately not installed.
const sharedSource = new URL('../../../source/', import.meta.url).href;
const mobilePackage = new URL('../package.json', import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const bare =
      !specifier.startsWith('.') &&
      !specifier.startsWith('/') &&
      !/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(specifier);
    if (bare && context.parentURL?.startsWith(sharedSource)) {
      return nextResolve(specifier, { ...context, parentURL: mobilePackage });
    }
    return nextResolve(specifier, context);
  },
});
