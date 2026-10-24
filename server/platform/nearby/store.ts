import type { Redis } from 'ioredis';
import { NEARBY_WINDOW_MS } from '../../../shared/platform/nearby.js';
import { newSalt } from './network.js';

/** A room listed to a network: its code and when it was created. */
export interface NearbyEntry {
  code: string;
  createdAt: number;
}

/**
 * Which rooms were created on which network (a salted hash, never an address). An entry lives
 * NEARBY_WINDOW_MS at most and goes as soon as its room starts or ends.
 */
export interface NearbyStore {
  /** The salt every instance hashes addresses with. */
  salt(): Promise<string>;
  add(network: string, code: string, createdAt: number): Promise<void>;
  remove(network: string, code: string): Promise<void>;
  /** Entries younger than the window, newest first. */
  list(network: string, now: number): Promise<NearbyEntry[]>;
}

export class MemoryNearbyStore implements NearbyStore {
  private readonly saltValue: string;
  private readonly byNetwork = new Map<string, Map<string, number>>();

  constructor(salt: string = process.env.NEARBY_SALT || newSalt()) {
    this.saltValue = salt;
  }

  async salt(): Promise<string> {
    return this.saltValue;
  }

  async add(network: string, code: string, createdAt: number): Promise<void> {
    const rooms = this.byNetwork.get(network) ?? new Map<string, number>();
    rooms.set(code, createdAt);
    this.byNetwork.set(network, rooms);
  }

  async remove(network: string, code: string): Promise<void> {
    const rooms = this.byNetwork.get(network);
    rooms?.delete(code);
    if (rooms?.size === 0) this.byNetwork.delete(network);
  }

  async list(network: string, now: number): Promise<NearbyEntry[]> {
    const rooms = this.byNetwork.get(network);
    if (!rooms) return [];
    // Expired entries go here, so a network's hash is held no longer than its rooms are listed.
    for (const [code, at] of rooms) if (now - at >= NEARBY_WINDOW_MS) rooms.delete(code);
    if (rooms.size === 0) this.byNetwork.delete(network);
    return [...rooms].map(([code, createdAt]) => ({ code, createdAt })).sort((a, b) => b.createdAt - a.createdAt);
  }
}

export const NEARBY_SALT_KEY = 'nearby:salt';
export const nearbyKey = (network: string): string => `nearby:${network}`;

/** Shared by every instance through Redis: one sorted set per network, expiring with its newest room. */
export class RedisNearbyStore implements NearbyStore {
  private saltValue: Promise<string> | null = null;

  constructor(private readonly redis: Redis) {}

  salt(): Promise<string> {
    if (process.env.NEARBY_SALT) return Promise.resolve(process.env.NEARBY_SALT);
    this.saltValue ??= (async () => {
      await this.redis.set(NEARBY_SALT_KEY, newSalt(), 'NX');
      const salt = await this.redis.get(NEARBY_SALT_KEY);
      if (!salt) throw new Error('nearby salt missing');
      return salt;
    })();
    this.saltValue.catch(() => (this.saltValue = null));
    return this.saltValue;
  }

  async add(network: string, code: string, createdAt: number): Promise<void> {
    await this.redis.multi().zadd(nearbyKey(network), createdAt, code).pexpire(nearbyKey(network), NEARBY_WINDOW_MS).exec();
  }

  async remove(network: string, code: string): Promise<void> {
    await this.redis.zrem(nearbyKey(network), code);
  }

  async list(network: string, now: number): Promise<NearbyEntry[]> {
    const key = nearbyKey(network);
    const [, raw] = await Promise.all([this.redis.zremrangebyscore(key, '-inf', `(${now - NEARBY_WINDOW_MS + 1}`), this.redis.zrevrangebyscore(key, '+inf', now - NEARBY_WINDOW_MS + 1, 'WITHSCORES')]);
    const out: NearbyEntry[] = [];
    for (let i = 0; i + 1 < raw.length; i += 2) out.push({ code: raw[i]!, createdAt: Number(raw[i + 1]) });
    return out;
  }
}
