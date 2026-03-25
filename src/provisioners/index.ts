/**
 * Provisioners — infrastructure adaptors for SAIFAC environments.
 *
 * A Provisioner manages the full lifecycle of an isolated SAIFAC run:
 *   setup()        → create isolated network + start background services
 *   startStaging() → build & boot the application under test
 *   runTests()     → run the black-box test suite and return results
 *   runAgent()     → spawn the AI coding agent
 *   startInspect() → idle coder container for `run inspect`
 *   teardown()     → stop and remove all resources
 *
 * Usage:
 *   const provisioner = createProvisioner(config.environments.staging);
 *   await provisioner.setup({ runId, projectName, featureName, projectDir });
 *   const staging = await provisioner.startStaging({ ... });
 *   const result  = await provisioner.runTests({ ..., stagingHandle: staging });
 *   await provisioner.runAgent({ ... });
 *   await provisioner.teardown({ runId });
 */

import type {
  DockerEnvironment,
  NormalizedCodingEnvironment,
  NormalizedStagingEnvironment,
} from '../config/schema.js';
import { DockerProvisioner } from './docker/index.js';
import type { Provisioner } from './types.js';

/**
 * Factory: returns the correct Provisioner for the given environment config.
 *
 * `docker` (the default) creates a DockerProvisioner. When the config includes
 * a `file`, the Compose stack is started as part of setup(); otherwise only
 * the isolated bridge network and core containers are managed.
 */
export function createProvisioner(
  env: NormalizedStagingEnvironment | NormalizedCodingEnvironment,
): Provisioner {
  switch (env.provisioner) {
    case 'docker':
      return new DockerProvisioner(env as DockerEnvironment);
    case 'helm':
      throw new Error(
        `[provisioner] Helm provisioner is not yet implemented. ` +
          `Remove environments.*.provisioner = "helm" from saifac/config.ts or implement HelmProvisioner.`,
      );
    default: {
      const exhaustive: never = env;
      throw new Error(`[provisioner] Unknown provisioner: ${JSON.stringify(exhaustive)}`);
    }
  }
}
