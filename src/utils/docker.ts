import { consola } from '../logger.js';

/** Validates that a Docker image tag is safe to interpolate into shell commands. */
export function validateImageTag(tag: string, flagName: string): void {
  if (!/^[a-zA-Z0-9_.\-:/@]+$/.test(tag)) {
    consola.error(
      `Invalid ${flagName} value: "${tag}". ` +
        `Image tags must contain only letters, digits, hyphens, underscores, dots, colons, slashes, and @ signs.`,
    );
    process.exit(1);
  }
}
