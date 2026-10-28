/**
 * The home page notice as the public sees it (GET /api/notice): the text while it is on and
 * unexpired, nothing otherwise. The store is read at most every 30 seconds; an expired notice is
 * never served, cached or not.
 */
import type { Notice } from '../../../shared/platform/admin.js';
import type { AnalyticsStore } from './store.js';

export const NOTICE_PATH = '/api/notice';
export const NOTICE_CACHE_MS = 30_000;

export type PublicNotice = { text: string } | Record<string, never>;

export function publicNotice(n: Notice | null, now: number): PublicNotice {
  if (!n || !n.on || (n.expiresAt !== null && n.expiresAt <= now)) return {};
  return { text: n.text };
}

export class NoticeCache {
  private cached: { notice: Notice | null; at: number } | null = null;

  constructor(
    private readonly store: Pick<AnalyticsStore, 'getNotice'>,
    private readonly now: () => number,
    private readonly ttlMs = NOTICE_CACHE_MS,
  ) {}

  async current(): Promise<PublicNotice> {
    const now = this.now();
    if (!this.cached || now - this.cached.at >= this.ttlMs) this.cached = { notice: await this.store.getNotice(), at: now };
    return publicNotice(this.cached.notice, now);
  }

  /** The admin saved a new notice: the next request reads it. */
  invalidate(): void {
    this.cached = null;
  }
}
