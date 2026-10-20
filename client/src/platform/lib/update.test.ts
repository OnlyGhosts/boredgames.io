import { beforeEach, describe, expect, it } from 'vitest';
import { installBrowserGlobals, installFakeStorage } from '../../test/env';

installBrowserGlobals();
const { session } = installFakeStorage();

const { BUILD_ID, decideUpdate, fetchLatest, isInGame, parseVersion, VERSION_URL } = await import('./update');
const { loadReloadedFor, saveReloadedFor } = await import('./storage');

type State = Parameters<typeof decideUpdate>[0];
const base: State = { current: 'v1', latest: 'v2', reloadedFor: null, inGame: false, typing: false, hidden: false };
const decide = (patch: Partial<State>) => decideUpdate({ ...base, ...patch });

beforeEach(() => session.clear());

describe('decideUpdate', () => {
  it('does nothing without a new version: same id, failed fetch, or an unstamped dev build', () => {
    expect(decide({ latest: 'v1' })).toBe('none');
    expect(decide({ latest: null })).toBe('none');
    expect(decide({ current: '' })).toBe('none');
  });

  it('reloads at once on the home screen or in a room between games (lobby or results)', () => {
    expect(decide({ inGame: false })).toBe('reload');
    expect(decide({ inGame: false, hidden: true })).toBe('reload');
  });

  it('waits while a field is being typed into, wherever the player is', () => {
    expect(decide({ typing: true })).toBe('wait');
    expect(decide({ typing: true, hidden: true })).toBe('wait');
    expect(decide({ typing: true, inGame: true, hidden: true })).toBe('wait');
  });

  it('waits in a running game while the tab is in view, and reloads once it is hidden', () => {
    expect(decide({ inGame: true })).toBe('wait');
    expect(decide({ inGame: true, hidden: true })).toBe('reload');
  });

  it('reloads for a given version once only: still that id after the reload means leave it', () => {
    expect(decide({ reloadedFor: 'v2' })).toBe('leave');
    expect(decide({ reloadedFor: 'v2', hidden: true })).toBe('leave');
    // A later version is a new one, and gets its own reload.
    expect(decide({ reloadedFor: 'v2', latest: 'v3' })).toBe('reload');
    // Back on the version it runs: nothing to do.
    expect(decide({ reloadedFor: 'v2', latest: 'v1' })).toBe('none');
  });
});

describe('isInGame', () => {
  it('is a room whose game is running, not its lobby or no room', () => {
    expect(isInGame({ phase: 'playing' })).toBe(true);
    expect(isInGame({ phase: 'lobby' })).toBe(false);
    expect(isInGame(null)).toBe(false);
  });
});

describe('parseVersion', () => {
  it('reads the id and nothing else', () => {
    expect(parseVersion({ id: 'abc' })).toBe('abc');
    for (const body of [null, 'abc', 42, [], {}, { id: '' }, { id: 7 }, { id: 'x'.repeat(201) }]) expect(parseVersion(body)).toBeNull();
  });
});

describe('fetchLatest', () => {
  const response = (body: string, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'application/json' } });

  it('asks past every cache and returns the id', async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return response('{"id":"v9"}');
    }) as typeof fetch;
    expect(await fetchLatest(fake, () => 123)).toBe('v9');
    expect(calls).toEqual([[`${VERSION_URL}?t=123`, { cache: 'no-store' }]]);
  });

  it('turns a failed fetch, an error status or bad JSON into null, silently', async () => {
    const failing = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    expect(await fetchLatest(failing)).toBeNull();
    expect(await fetchLatest((async () => response('{"id":"v9"}', 404)) as typeof fetch)).toBeNull();
    expect(await fetchLatest((async () => response('<!doctype html>')) as typeof fetch)).toBeNull();
    expect(await fetchLatest((async () => response('{"version":"v9"}')) as typeof fetch)).toBeNull();
  });
});

describe('the reload memory', () => {
  it('remembers the version the tab reloaded for, for this tab only', () => {
    expect(loadReloadedFor()).toBeNull();
    expect(saveReloadedFor('v2')).toBe(true);
    expect(loadReloadedFor()).toBe('v2');
  });
});

describe('BUILD_ID', () => {
  it('is empty outside a build, so tests and the dev server never check', () => {
    expect(BUILD_ID).toBe('');
  });
});
