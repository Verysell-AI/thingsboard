import type { TbClient } from '../../services/tb/tb.client.js';

export const BATCH_SIZE = 1000;
/** A batch is retried this many times (with growing pauses) before the backfill gives up. */
export const WRITE_ATTEMPTS = 4;

export interface Point {
  ts: number;
  values: Record<string, unknown>;
}

/**
 * Buffers historical points per device and writes them to the IoT core in batches of at most
 * 1000, never more than `concurrency` requests in flight (every device fills its buffer in the
 * same slot, so an unthrottled flush would fire a hundred requests at once and stall the core).
 * REST-written telemetry does not pass through the rule chain, so the backfill raises no alarms
 * and posts no events to the platform.
 */
export class TelemetryWriter {
  private readonly buffers = new Map<string, Point[]>();
  private readonly inFlight = new Set<Promise<void>>();
  written = 0;
  requests = 0;
  retries = 0;

  constructor(
    private readonly tb: Pick<TbClient, 'postTelemetry'>,
    private readonly concurrency = 3,
    private readonly retryDelayMs = 2_000,
  ) {}

  /** Buffers a point; when the device's buffer is full the batch is sent (waiting for a free slot). */
  async push(tbDeviceId: string, point: Point): Promise<void> {
    const buf = this.buffers.get(tbDeviceId) ?? [];
    buf.push(point);
    this.buffers.set(tbDeviceId, buf);
    if (buf.length >= BATCH_SIZE) await this.flushDevice(tbDeviceId);
  }

  private async flushDevice(tbDeviceId: string): Promise<void> {
    const buf = this.buffers.get(tbDeviceId);
    if (!buf?.length) return;
    this.buffers.set(tbDeviceId, []);
    while (this.inFlight.size >= this.concurrency) await Promise.race(this.inFlight);
    const job: Promise<void> = this.send(tbDeviceId, buf).finally(() => this.inFlight.delete(job));
    this.inFlight.add(job);
  }

  private async send(tbDeviceId: string, points: Point[]): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await this.tb.postTelemetry(tbDeviceId, points);
        this.written += points.length;
        this.requests += 1;
        return;
      } catch (err) {
        if (attempt >= WRITE_ATTEMPTS) throw err;
        this.retries += 1;
        await new Promise((r) => setTimeout(r, attempt * this.retryDelayMs));
      }
    }
  }

  /** Sends every remaining buffer and waits for all writes to finish. */
  async flushAll(): Promise<void> {
    for (const id of [...this.buffers.keys()]) await this.flushDevice(id);
    await Promise.all(this.inFlight);
  }
}
