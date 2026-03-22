import { describe, expect, it } from 'vitest';

import { detectRunnerError } from './test-parser.js';

describe('detectRunnerError', () => {
  it('returns infra error when staging hostname does not resolve (ENOTFOUND)', () => {
    const stderr = `TypeError: fetch failed
Caused by: Error: getaddrinfo ENOTFOUND staging`;

    expect(
      detectRunnerError({
        exitCode: 1,
        stdout: '[test-runner] SAIFAC_TARGET_URL:   http://staging:8080/exec\n',
        stderr,
      }),
    ).toBe(
      'Staging container not found on Docker network (ENOTFOUND staging) — check network attach / container alias',
    );
  });

  it('does not treat ENOTFOUND as runner error when exit code is 0', () => {
    expect(
      detectRunnerError({
        exitCode: 0,
        stdout: '',
        stderr: 'getaddrinfo ENOTFOUND staging',
      }),
    ).toBeUndefined();
  });

  it('still detects ECONNREFUSED to staging as infra error', () => {
    expect(
      detectRunnerError({
        exitCode: 1,
        stdout: '',
        stderr: 'fetch failed\nCaused by: Error: connect ECONNREFUSED 172.18.0.2:8080',
      }),
    ).toBe('Staging container unreachable (ECONNREFUSED) — sidecar/server never started');
  });
});
