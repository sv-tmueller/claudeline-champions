import * as nodeModule from 'node:module';
import '../balance/register.ts';

// Loaded with `node --experimental-strip-types --import ./tools/fixtures/register.ts`. The balance
// loader (imported first, so its Node 22.15 check and its completion of the extensionless relative
// imports of the sim and bots sources apply) is not enough here: the fixture search runs the sim's
// own test support modules, which import each other and the sim source without an extension, and
// import a JSON file with no import attributes (`helpers.ts` takes `arena01.json`), which Node
// refuses without `with { type: 'json' }`. This resolve hook completes the first and adds the
// attribute to the second, for importers under packages/sim/test only. It needs no dependency.

/** The one tree whose extensionless relative imports and plain JSON imports the hook fixes. */
const TEST_TREE = '/packages/sim/test/';

/** True for `./x` and `../x` with no extension on the last segment. */
function isExtensionless(specifier: string): boolean {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return false;
  const last = specifier.slice(specifier.lastIndexOf('/') + 1);
  return !last.includes('.');
}

nodeModule.registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL;
    if (parent === undefined || !parent.includes(TEST_TREE)) return nextResolve(specifier, context);
    if (specifier.endsWith('.json')) {
      const resolved = nextResolve(specifier, context);
      return { ...resolved, importAttributes: { ...resolved.importAttributes, type: 'json' } };
    }
    if (!isExtensionless(specifier)) return nextResolve(specifier, context);
    return nextResolve(`${specifier}.ts`, context);
  },
});
