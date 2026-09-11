import mqtt from 'mqtt';
import {
  CLIENT_ATTRIBUTES,
  MQTT_TOPICS,
  rpcRequestIdFromTopic,
  rpcResponseTopic,
  type TelemetryValues,
} from '@platform/shared/contracts';
import type { VirtualDevice } from './device.js';

/** The subset of an MQTT client the simulator relies on, so tests can inject a fake. */
export interface MqttClientLike {
  readonly connected: boolean;
  on(event: 'connect', cb: () => void): unknown;
  on(event: 'message', cb: (topic: string, payload: Buffer) => void): unknown;
  on(event: 'error', cb: (err: Error) => void): unknown;
  on(event: 'offline' | 'close', cb: () => void): unknown;
  publish(topic: string, payload: string): unknown;
  subscribe(topic: string): unknown;
  end(force?: boolean, opts?: object, cb?: () => void): unknown;
}

export type ClientFactory = (opts: {
  url: string;
  clientId: string;
  username: string;
}) => MqttClientLike;

export interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
}

export const realClientFactory: ClientFactory = ({ url, clientId, username }) =>
  mqtt.connect(url, {
    clientId,
    username,
    clean: true,
    connectTimeout: 10_000,
    reconnectPeriod: 5_000,
    keepalive: 30,
  }) as unknown as MqttClientLike;

/**
 * One MQTT session per virtual device. Non-laptops stay connected; laptops connect and disconnect
 * with their persona. Broker outages are logged once and retried by the client.
 */
export class DeviceLink {
  private client: MqttClientLike | null = null;
  private warned = false;
  private attributesSent = false;

  constructor(
    readonly device: VirtualDevice,
    private readonly url: string,
    private readonly factory: ClientFactory,
    private readonly log: Logger,
    private readonly onStatus: (device: VirtualDevice, connected: boolean) => void,
  ) {}

  get connected(): boolean {
    return this.client?.connected ?? false;
  }

  /** True when a session exists (connecting or connected). */
  get active(): boolean {
    return this.client !== null;
  }

  connect(): void {
    if (this.client) return;
    const token = this.device.accessToken;
    const client = this.factory({ url: this.url, clientId: token, username: token });
    this.client = client;
    client.on('connect', () => {
      this.warned = false;
      this.log.debug({ device: this.device.code }, 'mqtt connected');
      client.subscribe(MQTT_TOPICS.rpcRequestSubscribe);
      if (!this.attributesSent) {
        client.publish(MQTT_TOPICS.attributes, JSON.stringify(CLIENT_ATTRIBUTES));
        this.attributesSent = true;
      }
      this.onStatus(this.device, true);
    });
    client.on('message', (topic, payload) => this.onMessage(topic, payload));
    client.on('error', (err) => {
      if (!this.warned) {
        this.warned = true;
        this.log.warn({ device: this.device.code, err: err.message }, 'mqtt error, will retry');
      }
    });
    client.on('close', () => this.onStatus(this.device, false));
  }

  disconnect(): void {
    const client = this.client;
    if (!client) return;
    this.client = null;
    this.attributesSent = false;
    client.end(true);
    this.onStatus(this.device, false);
  }

  publishTelemetry(ts: number, values: TelemetryValues): boolean {
    if (!this.client || !this.client.connected) return false;
    this.client.publish(MQTT_TOPICS.telemetry, JSON.stringify({ ts, values }));
    return true;
  }

  private onMessage(topic: string, payload: Buffer): void {
    const requestId = rpcRequestIdFromTopic(topic);
    if (requestId === undefined || !this.client) return;
    let body: unknown;
    try {
      body = JSON.parse(payload.toString('utf8'));
    } catch {
      body = null;
    }
    const response = this.device.applyRpc(body);
    this.log.info({ device: this.device.code, request: body, response }, 'rpc');
    this.client.publish(rpcResponseTopic(requestId), JSON.stringify(response));
  }
}
