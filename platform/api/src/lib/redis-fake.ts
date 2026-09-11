import type { RedisLike } from './redis.js';

/**
 * In-memory stand-in for the ioredis surface the services use. Streams get monotonic ids
 * "<ms>-<seq>" like Redis; MINID trimming is honoured on XADD.
 */
export class FakeRedis implements RedisLike {
  hashes = new Map<string, Record<string, string>>();
  sets = new Map<string, Set<string>>();
  streams = new Map<string, [string, string[]][]>();
  published: { channel: string; message: string }[] = [];
  strings = new Map<string, { value: string; expires: number }>();
  private lastMs = 0;
  private seq = 0;

  constructor(private readonly now: () => number = Date.now) {}

  async hset(key: string, data: Record<string, string>): Promise<number> {
    const h = this.hashes.get(key) ?? {};
    let added = 0;
    for (const [k, v] of Object.entries(data)) {
      if (!(k in h)) added++;
      h[k] = v;
    }
    this.hashes.set(key, h);
    return added;
  }
  async hgetall(key: string): Promise<Record<string, string>> {
    return { ...(this.hashes.get(key) ?? {}) };
  }
  async sadd(key: string, ...members: string[]): Promise<number> {
    const s = this.sets.get(key) ?? new Set<string>();
    let added = 0;
    for (const m of members) {
      if (!s.has(m)) {
        s.add(m);
        added++;
      }
    }
    this.sets.set(key, s);
    return added;
  }
  async smembers(key: string): Promise<string[]> {
    return [...(this.sets.get(key) ?? [])];
  }
  async scard(key: string): Promise<number> {
    return this.sets.get(key)?.size ?? 0;
  }
  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) {
      if (this.hashes.delete(k)) n++;
      if (this.sets.delete(k)) n++;
      if (this.streams.delete(k)) n++;
      if (this.strings.delete(k)) n++;
    }
    return n;
  }
  async get(key: string): Promise<string | null> {
    const hit = this.strings.get(key);
    if (!hit) return null;
    if (hit.expires <= this.now()) {
      this.strings.delete(key);
      return null;
    }
    return hit.value;
  }
  async set(key: string, value: string, mode: 'EX', seconds: number): Promise<'OK'>;
  async set(key: string, value: string, mode: 'PX', ms: number, nx: 'NX'): Promise<'OK' | null>;
  async set(
    key: string,
    value: string,
    mode: 'EX' | 'PX',
    amount: number,
    nx?: 'NX',
  ): Promise<'OK' | null> {
    if (nx === 'NX' && (await this.get(key)) !== null) return null;
    const ttlMs = mode === 'EX' ? amount * 1000 : amount;
    this.strings.set(key, { value, expires: this.now() + ttlMs });
    return 'OK';
  }
  async publish(channel: string, message: string): Promise<number> {
    this.published.push({ channel, message });
    return 1;
  }
  async xadd(key: string, ...args: (string | number)[]): Promise<string | null> {
    const a = args.map(String);
    let i = 0;
    let minId: number | null = null;
    if (a[i] === 'MINID') {
      i++;
      if (a[i] === '~' || a[i] === '=') i++;
      minId = Number(a[i++]);
    } else if (a[i] === 'MAXLEN') {
      i += a[i + 1] === '~' || a[i + 1] === '=' ? 3 : 2;
    }
    const idArg = a[i++];
    const ms = this.now();
    if (ms === this.lastMs) {
      this.seq++;
    } else {
      this.lastMs = ms;
      this.seq = 0;
    }
    const id = idArg === '*' ? `${ms}-${this.seq}` : idArg!;
    const fields = a.slice(i);
    const stream = this.streams.get(key) ?? [];
    stream.push([id, fields]);
    const kept =
      minId === null ? stream : stream.filter(([sid]) => Number(sid.split('-')[0]) >= minId!);
    this.streams.set(key, kept);
    return id;
  }
  async xrange(
    key: string,
    start: string,
    end: string,
    _countToken: 'COUNT',
    count: number,
  ): Promise<[string, string[]][]> {
    const stream = this.streams.get(key) ?? [];
    const exclusive = start.startsWith('(');
    const s = exclusive ? start.slice(1) : start;
    return stream
      .filter(
        ([id]) =>
          (s === '-' ? true : exclusive ? cmp(id, s) > 0 : cmp(id, s) >= 0) &&
          (end === '+' ? true : cmp(id, end) <= 0),
      )
      .slice(0, count);
  }
  async xrevrange(
    key: string,
    _end: string,
    _start: string,
    _countToken: 'COUNT',
    count: number,
  ): Promise<[string, string[]][]> {
    const stream = this.streams.get(key) ?? [];
    return [...stream].reverse().slice(0, count);
  }
  async ping(): Promise<string> {
    return 'PONG';
  }
  async keys(pattern: string): Promise<string[]> {
    const re = new RegExp(
      '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
    );
    return [
      ...this.hashes.keys(),
      ...this.sets.keys(),
      ...this.streams.keys(),
      ...this.strings.keys(),
    ].filter((k) => re.test(k));
  }
}

function cmp(a: string, b: string): number {
  const [am, as] = a.split('-').map(Number);
  const [bm, bs] = b.includes('-') ? b.split('-').map(Number) : [Number(b), 0];
  return am! - bm! || (as ?? 0) - (bs ?? 0);
}
