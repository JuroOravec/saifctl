import type { SaifctlConfig } from '@safe-ai-factory/saifctl';

/**
 * SaifCTL configuration.
 * See docs/config.md and docs/services.md
 */
const config: SaifctlConfig = {
  defaults: {
    globalModel: 'anthropic/claude-sonnet-4-6',
    agentProfile: 'claude',
    agentOptions: {
      claude: {
        max: true,
      },
    },
    agent: {
      reviewer: false,
    },
    resolveAmbiguity: 'off',
  },
  environments: {
    coding: {
      engine: 'docker',
      agentEnvironment: {},
    },
    staging: {
      engine: 'docker',
      app: {
        sidecarPort: 8080,
        sidecarPath: '/exec',
      },
      appEnvironment: {},
    },
  },
};

export default config;
