import * as nodeModule from 'node:module';

// Loaded with `node --experimental-strip-types --import ./tools/balance/register.ts`. Node strips
// the types of a .ts file, but the sim and bots sources import each other without an extension
// (`./constants`), which Node's resolver does not complete. This resolve hook adds `.ts` to such a
// relative import when it comes from one of the two source trees, and leaves every other
// specifier alone. It needs no dependency, but `module.registerHooks` came in Node 22.15.

const MIN_NODE = '22.15';

/** The source trees whose extensionless relative imports the hook completes. */
const SOURCE_TREES = ['/packages/sim/src/', '/packages/bots/src/'];

/** True for `./x` and `../x` with no extension on the last segment. */
function isExtensionless(specifier: string): boolean {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return false;
  const last = specifier.slice(specifier.lastIndexOf('/') + 1);
  return !last.includes('.');
}

if (typeof nodeModule.registerHooks !== 'function') {
  throw new Error(
    `npm run balance needs Node ${MIN_NODE} or later (module.registerHooks); this is Node ${process.versions.node}.`,
  );
}

nodeModule.registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL;
    if (
      parent === undefined ||
      !isExtensionless(specifier) ||
      !SOURCE_TREES.some((tree) => parent.includes(tree))
    ) {
      return nextResolve(specifier, context);
    }
    try {
      return nextResolve(`${specifier}.ts`, context);
    } catch (error) {
      if ((error as { code?: string }).code !== 'ERR_MODULE_NOT_FOUND') throw error;
      return nextResolve(`${specifier}/index.ts`, context);
    }
  },
});
