#!/usr/bin/env node
import { defineCommand, runMain } from 'citty';

import cacheCommand from './commands/cache.js';
import featCommand from './commands/feat.js';
import initCommand from './commands/init.js';

const main = defineCommand({
  meta: {
    name: 'saif',
    description:
      'safe-ai-factory: Spec-driven AI factory. Use with any agentic CLI. Language-agnostic. Safe by design.',
  },
  subCommands: {
    cache: cacheCommand,
    feat: featCommand,
    feature: featCommand,
    init: initCommand,
  },
});

export const cli = () => {
  void runMain(main);
};
