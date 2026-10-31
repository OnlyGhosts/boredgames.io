import type { LiveRoomsResponse, Notice, Range, Summary } from '@shared/platform/admin';

/** The session is missing or expired: the app shows the sign-in again. */
export class SignedOut extends Error {}

export type LoginError = { kind: 'wrong' } | { kind: 'wait'; seconds: number } | { kind: 'setup' } | { kind: 'network' };

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(path, { credentials: 'same-origin', ...init, headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) } });
  if (res.status === 401) throw new SignedOut('signed out');
  return res;
}

async function json<T>(path: string): Promise<T> {
  const res = await call(path);
  if (!res.ok) throw new Error(`The server answered ${res.status}.`);
  return (await res.json()) as T;
}

/** A range ending today, or one UK day (YYYY-MM-DD). */
export const fetchSummary = (of: Range | { day: string }) => json<Summary>(`/api/admin/summary?${typeof of === 'string' ? `range=${of}` : `day=${of.day}`}`);
export const fetchRooms = () => json<LiveRoomsResponse>('/api/admin/rooms');
export const fetchNotice = () => json<{ notice: Notice | null }>('/api/admin/notice').then((r) => r.notice);

export async function saveNotice(input: { text: string; on: boolean; expiresAt: number | null }): Promise<void> {
  const res = await call('/api/admin/notice', { method: 'PUT', body: JSON.stringify(input) });
  if (res.status === 400) throw new Error('The notice is 1 to 140 characters of text.');
  if (!res.ok) throw new Error(`The server answered ${res.status}.`);
}

export async function login(password: string): Promise<LoginError | null> {
  let res: Response;
  try {
    res = await fetch('/api/admin/login', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
  } catch {
    return { kind: 'network' };
  }
  if (res.ok) return null;
  if (res.status === 401) return { kind: 'wrong' };
  if (res.status === 429) return { kind: 'wait', seconds: Number(res.headers.get('retry-after')) || 1 };
  if (res.status === 503) return { kind: 'setup' };
  return { kind: 'network' };
}

export async function logout(): Promise<void> {
  await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
}
