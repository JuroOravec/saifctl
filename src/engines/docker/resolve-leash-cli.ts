/**
 * We call Leash via its NPM binary. For better user experience, we don't require
 * Leash to be installed globally. Installing `safe-ai-factory` should be enough.
 *
 * However, the problem is that we call Leash in the sandbox dir, which is NOT the same
 * as the project dir where `node_modules` were installed.
 *
 * To resolve this, we search for the Leash CLI binary in the project that had `safe-ai-factory` installed.
 */
import { createRequire } from 'node:module';

// This will point to where this file is defined within the `node_modules`
// of the project that has `safe-ai-factory` installed.
const require = createRequire(import.meta.url);

export function resolveLeashCliPath(): string {
  // Optionally override path to `@strongdm/leash`'s `bin/leash.js`
  const override = process.env.SAIFAC_LEASH_BIN?.trim();
  if (override) {
    return override;
  }
  try {
    return require.resolve('@strongdm/leash/bin/leash.js');
  } catch {
    throw new Error(
      'Cannot find @strongdm/leash. Run install in the project that depends on safe-ai-factory, ' +
        `or set SAIFAC_LEASH_BIN to the absolute path of leash.js.`,
    );
  }
}
