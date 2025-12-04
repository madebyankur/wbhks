/**
 * Idempotency adapter interface
 */
export interface IdempotencyAdapter {
  check(eventId: string): Promise<boolean>;
  mark(eventId: string, ttl?: number): Promise<void>;
  clear?(): Promise<void>;
}

/**
 * In-memory adapter (development only)
 */
export class InMemoryIdempotencyAdapter implements IdempotencyAdapter {
  private processedEvents = new Set<string>();

  async check(eventId: string): Promise<boolean> {
    return this.processedEvents.has(eventId);
  }

  async mark(eventId: string, ttl?: number): Promise<void> {
    this.processedEvents.add(eventId);

    if (ttl && ttl > 0) {
      setTimeout(() => {
        this.processedEvents.delete(eventId);
      }, ttl * 1000);
    }
  }

  async clear(): Promise<void> {
    this.processedEvents.clear();
  }
}

/**
 * Redis adapter for production idempotency
 * Works with any Redis-compatible client (ioredis, node-redis, etc.)
 */
export class RedisIdempotencyAdapter implements IdempotencyAdapter {
  private redis: any;
  private keyPrefix: string;

  constructor(redisInstance: any, keyPrefix = "webhook:idempotency") {
    this.redis = redisInstance;
    this.keyPrefix = keyPrefix;
  }

  private getKey(eventId: string): string {
    return `${this.keyPrefix}:${eventId}`;
  }

  async check(eventId: string): Promise<boolean> {
    const key = this.getKey(eventId);

    if (this.redis.exists) {
      const exists = await this.redis.exists(key);
      return exists === 1 || exists === true;
    } else if (this.redis.get) {
      const value = await this.redis.get(key);
      return value !== null;
    }

    throw new Error("Redis client does not support exists() or get() methods");
  }

  async mark(eventId: string, ttl: number = 86400): Promise<void> {
    const key = this.getKey(eventId);

    if (this.redis.setex) {
      await this.redis.setex(key, ttl, "processed");
    } else if (this.redis.set) {
      await this.redis.set(key, "processed", { EX: ttl });
    } else {
      throw new Error(
        "Redis client does not support setex() or set() with expiration"
      );
    }
  }

  async clear(): Promise<void> {
    let keys: string[] = [];

    if (this.redis.keys) {
      keys = await this.redis.keys(`${this.keyPrefix}:*`);
    } else if (this.redis.scan) {
      let cursor = 0;
      do {
        const result = await this.redis.scan(
          cursor,
          "MATCH",
          `${this.keyPrefix}:*`
        );
        cursor = result[0];
        keys.push(...result[1]);
      } while (cursor !== 0);
    }

    if (keys.length > 0) {
      if (this.redis.del) {
        await this.redis.del(...keys);
      } else if (this.redis.unlink) {
        await this.redis.unlink(...keys);
      }
    }
  }
}

/**
 * Upstash Redis adapter optimized for Edge Runtime
 * Works with @upstash/redis
 */
export class UpstashIdempotencyAdapter implements IdempotencyAdapter {
  private redis: any;
  private keyPrefix: string;

  constructor(redisInstance: any, keyPrefix = "webhook:idempotency") {
    this.redis = redisInstance;
    this.keyPrefix = keyPrefix;
  }

  private getKey(eventId: string): string {
    return `${this.keyPrefix}:${eventId}`;
  }

  async check(eventId: string): Promise<boolean> {
    const key = this.getKey(eventId);
    const exists = await this.redis.exists(key);
    return exists === 1;
  }

  async mark(eventId: string, ttl: number = 86400): Promise<void> {
    const key = this.getKey(eventId);
    await this.redis.setex(key, ttl, "processed");
  }

  async clear(): Promise<void> {
    const keys: string[] = [];
    let cursor = 0;

    do {
      const result = await this.redis.scan(cursor, {
        match: `${this.keyPrefix}:*`,
        count: 100,
      });
      cursor = result[0];
      keys.push(...result[1]);
    } while (cursor !== 0);

    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }
}

/**
 * Vercel KV adapter for serverless environments
 * Works with @vercel/kv
 */
export class VercelKVIdempotencyAdapter implements IdempotencyAdapter {
  private kv: any;
  private keyPrefix: string;

  constructor(kvInstance: any, keyPrefix = "webhook:idempotency") {
    this.kv = kvInstance;
    this.keyPrefix = keyPrefix;
  }

  private getKey(eventId: string): string {
    return `${this.keyPrefix}:${eventId}`;
  }

  async check(eventId: string): Promise<boolean> {
    const key = this.getKey(eventId);
    const value = await this.kv.get(key);
    return value !== null;
  }

  async mark(eventId: string, ttl: number = 86400): Promise<void> {
    const key = this.getKey(eventId);
    await this.kv.set(key, "processed", { ex: ttl });
  }

  async clear(): Promise<void> {
    console.warn(
      "VercelKVIdempotencyAdapter: clear() is not supported efficiently"
    );
  }
}

let idempotencyAdapter: IdempotencyAdapter = new InMemoryIdempotencyAdapter();

/**
 * Set the idempotency adapter
 * Call this once at application startup
 */
export const setIdempotencyAdapter = (adapter: IdempotencyAdapter): void => {
  idempotencyAdapter = adapter;
};

/**
 * Get the current idempotency adapter
 */
export const getIdempotencyAdapter = (): IdempotencyAdapter => {
  return idempotencyAdapter;
};

export const checkIdempotency = async (eventId: string): Promise<boolean> => {
  return await idempotencyAdapter.check(eventId);
};

export const markEventProcessed = async (
  eventId: string,
  ttl?: number
): Promise<void> => {
  await idempotencyAdapter.mark(eventId, ttl);
};

export const clearProcessedEvents = async (): Promise<void> => {
  if (idempotencyAdapter.clear) {
    await idempotencyAdapter.clear();
  }
};

export const setupUpstashIdempotency = (
  redisInstance: any,
  keyPrefix?: string
) => {
  const adapter = new UpstashIdempotencyAdapter(redisInstance, keyPrefix);
  setIdempotencyAdapter(adapter);
  return adapter;
};

export const setupRedisIdempotency = (
  redisInstance: any,
  keyPrefix?: string
) => {
  const adapter = new RedisIdempotencyAdapter(redisInstance, keyPrefix);
  setIdempotencyAdapter(adapter);
  return adapter;
};

export const setupVercelKVIdempotency = (
  kvInstance: any,
  keyPrefix?: string
) => {
  const adapter = new VercelKVIdempotencyAdapter(kvInstance, keyPrefix);
  setIdempotencyAdapter(adapter);
  return adapter;
};
