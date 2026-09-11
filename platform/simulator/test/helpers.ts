import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import { zonedTimeToEpoch } from '@platform/shared/clock';
import type { BookingsSource } from '../src/bookings.js';
import type { ClientFactory, MqttClientLike } from '../src/mqtt.js';
import { Simulation } from '../src/simulation.js';
import { loadTenantWorld } from '../src/world.js';

export const datasetsDir = resolve(import.meta.dirname, '../../datasets');

/** In-memory MQTT client: connects on the next tick, records publishes, delivers injected RPCs. */
export class FakeMqttClient extends EventEmitter implements MqttClientLike {
  connected = false;
  published: { topic: string; payload: string }[] = [];
  subscriptions: string[] = [];
  constructor(readonly clientId: string) {
    super();
    process.nextTick(() => {
      this.connected = true;
      this.emit('connect');
    });
  }
  publish(topic: string, payload: string): void {
    this.published.push({ topic, payload });
  }
  subscribe(topic: string): void {
    this.subscriptions.push(topic);
  }
  end(): void {
    this.connected = false;
    this.emit('close');
  }
  /** Simulates an RPC request arriving from the broker. */
  deliverRpc(requestId: string, body: unknown): void {
    this.emit(
      'message',
      `v1/devices/me/rpc/request/${requestId}`,
      Buffer.from(JSON.stringify(body)),
    );
  }
}

export function fakeFactory(): { factory: ClientFactory; clients: Map<string, FakeMqttClient> } {
  const clients = new Map<string, FakeMqttClient>();
  const factory: ClientFactory = ({ clientId }) => {
    const c = new FakeMqttClient(clientId);
    clients.set(clientId, c);
    return c;
  };
  return { factory, clients };
}

export const silentLog = { info() {}, warn() {}, debug() {} };

export const TZ = 'Asia/Dubai';

export function buildSimulation(
  nowRef: { value: number },
  tenant = 'alpha',
  bookings?: BookingsSource,
) {
  const { factory, clients } = fakeFactory();
  const sim = new Simulation({
    mqttUrl: 'mqtt://fake',
    tickMs: 10_000,
    clientFactory: factory,
    log: silentLog,
    connectStaggerMs: 0,
    now: () => nowRef.value,
    timeZone: TZ,
    bookings,
  });
  const registry = sim.addTenant(loadTenantWorld(datasetsDir, 'office-demo', tenant));
  return { sim, registry, clients };
}

export const flush = () => new Promise<void>((r) => setImmediate(r));

/** 2026-09-07 is a Monday; wall-clock time in Dubai, whatever zone the test machine runs in. */
export const monday = (hour: number, minute = 0) =>
  zonedTimeToEpoch({ year: 2026, month: 9, day: 7, hour, minute }, TZ);
