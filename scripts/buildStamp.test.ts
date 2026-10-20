import { describe, expect, it } from 'vitest';
import { buildStamp, resolveBuildId, VERSION_FILE } from './buildStamp';

describe('resolveBuildId', () => {
  it("prefers Vercel's commit SHA", () => {
    expect(resolveBuildId({ VERCEL_GIT_COMMIT_SHA: ' abc123 ' }, () => 'head', () => 5)).toBe('abc123');
  });
  it('falls back to the checkout HEAD, then to the build time', () => {
    expect(resolveBuildId({}, () => 'head', () => 5)).toBe('head');
    expect(resolveBuildId({ VERCEL_GIT_COMMIT_SHA: '' }, () => null, () => 5)).toBe('t5');
  });
  it('reads a real checkout without throwing', () => {
    expect(resolveBuildId({}).length).toBeGreaterThan(0);
  });
});

type Hook = (...args: unknown[]) => unknown;

function run(command: 'build' | 'serve') {
  const plugin = buildStamp(() => 'id-1');
  const config = (plugin.config as Hook)({}, { command, mode: 'production' });
  const emitted: { fileName: string; source: string }[] = [];
  (plugin.generateBundle as Hook).call({ emitFile: (f: { fileName: string; source: string }) => emitted.push(f) });
  return { config, emitted };
}

describe('buildStamp', () => {
  it('stamps a build: the id in the bundle and the same id in version.json', () => {
    const { config, emitted } = run('build');
    expect(config).toEqual({ define: { __BUILD_ID__: '"id-1"' } });
    expect(emitted).toHaveLength(1);
    expect(emitted[0].fileName).toBe(VERSION_FILE);
    expect(JSON.parse(emitted[0].source)).toEqual({ id: 'id-1' });
  });
  it('leaves the dev server unstamped', () => {
    const { config, emitted } = run('serve');
    expect(config).toBeUndefined();
    expect(emitted).toHaveLength(0);
  });
});
