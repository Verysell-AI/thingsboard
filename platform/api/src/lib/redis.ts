/** Minimal ioredis surface the services use, so tests can pass an in-memory fake. */
export interface RedisLike {
  hset(key: string, data: Record<string, string>): Promise<number>;
  hgetall(key: string): Promise<Record<string, string>>;
  sadd(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  scard(key: string): Promise<number>;
  del(...keys: string[]): Promise<number>;
  publish(channel: string, message: string): Promise<number>;
  xadd(key: string, ...args: (string | number)[]): Promise<string | null>;
  xrange(
    key: string,
    start: string,
    end: string,
    countToken: 'COUNT',
    count: number,
  ): Promise<[string, string[]][]>;
  xrevrange(
    key: string,
    end: string,
    start: string,
    countToken: 'COUNT',
    count: number,
  ): Promise<[string, string[]][]>;
  ping(): Promise<string>;
  keys(pattern: string): Promise<string[]>;
  get(key: string): Promise<string | null>;
  /** `set key value EX seconds`, and `set key value PX ms NX` for locks. */
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
  set(key: string, value: string, mode: 'PX', ms: number, nx: 'NX'): Promise<'OK' | null>;
}
