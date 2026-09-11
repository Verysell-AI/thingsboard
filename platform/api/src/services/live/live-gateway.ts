import type { Server as HttpServer } from 'node:http';
import type { createAdapter } from '@socket.io/redis-adapter';
import { Server, type Socket } from 'socket.io';
import type { LiveEvent, LiveSubscription } from '@platform/shared/contracts';
import { LIVE_SOCKET, LiveSubscriptionSchema } from '@platform/shared/contracts';
import type { LiveSnapshot } from '@platform/shared/dto';
import type { AuthService } from '../auth/auth.service.js';
import type { LiveStateService } from './live-state.service.js';
import type { ReplayService } from './replay.service.js';

interface SocketData {
  tenantKey: string;
  userId: string;
  filter: LiveSubscription;
}

interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
}

/** Decides whether an event passes a client's subscription filter. */
export function matchesSubscription(event: LiveEvent, filter: LiveSubscription): boolean {
  if (filter.kinds?.length && !filter.kinds.includes(event.kind)) return false;
  const deviceCode = 'deviceCode' in event ? event.deviceCode : undefined;
  const room = 'room' in event ? event.room : undefined;
  if (filter.devices?.length && (!deviceCode || !filter.devices.includes(deviceCode))) return false;
  if (filter.rooms?.length && (!room || !filter.rooms.includes(room))) return false;
  return true;
}

/**
 * Socket.IO gateway: authenticates with the access token, joins the tenant room, sends a snapshot,
 * replays missed events, then forwards live events that this replica receives from Redis pub/sub.
 */
export class LiveGateway {
  readonly io: Server;
  private readonly sockets = new Map<string, Socket & { data: SocketData }>();

  constructor(
    httpServer: HttpServer,
    private readonly auth: () => AuthService | null,
    private readonly liveState: LiveStateService,
    private readonly replay: ReplayService,
    private readonly log: Logger,
    opts: { adapter?: ReturnType<typeof createAdapter> } = {},
  ) {
    this.io = new Server(httpServer, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      cors: { origin: true, credentials: true },
    });
    if (opts.adapter) this.io.adapter(opts.adapter);

    this.io.use((socket, next) => {
      const auth = this.auth();
      const token = socket.handshake.auth?.[LIVE_SOCKET.authToken];
      if (!auth || typeof token !== 'string') return next(new Error('unauthorized'));
      try {
        const claims = auth.verifyAccess(token);
        const data: SocketData = { tenantKey: claims.tenantKey, userId: claims.sub, filter: {} };
        Object.assign(socket.data, data);
        next();
      } catch {
        next(new Error('unauthorized'));
      }
    });

    this.io.on(
      'connection',
      (socket) => void this.onConnection(socket as Socket & { data: SocketData }),
    );
  }

  private async onConnection(socket: Socket & { data: SocketData }): Promise<void> {
    const { tenantKey } = socket.data;
    await socket.join(`tenant:${tenantKey}`);
    this.sockets.set(socket.id, socket);
    socket.on('disconnect', () => this.sockets.delete(socket.id));
    socket.on(LIVE_SOCKET.subscribe, (raw: unknown) => {
      const parsed = LiveSubscriptionSchema.safeParse(raw ?? {});
      if (parsed.success) socket.data.filter = parsed.data;
    });

    const lastEventIdRaw = socket.handshake.auth?.[LIVE_SOCKET.authLastEventId];
    const lastEventId =
      typeof lastEventIdRaw === 'string' && lastEventIdRaw ? lastEventIdRaw : null;

    try {
      const [devices, lastId] = await Promise.all([
        this.liveState.snapshot(tenantKey),
        this.replay.lastId(tenantKey),
      ]);
      const snapshot: LiveSnapshot = { tenantKey, lastEventId: lastId, devices };
      socket.emit(LIVE_SOCKET.snapshot, snapshot);
      if (lastEventId) {
        const missed = await this.replay.since(tenantKey, lastEventId);
        for (const ev of missed) socket.emit(LIVE_SOCKET.event, ev);
      }
    } catch (err) {
      this.log.warn({ err, tenantKey }, 'live snapshot failed');
    }
  }

  /** Called for every message on events:<tenant>; delivers to this replica's matching sockets. */
  deliver(tenantKey: string, event: LiveEvent): void {
    for (const socket of this.sockets.values()) {
      if (socket.data.tenantKey !== tenantKey) continue;
      if (!matchesSubscription(event, socket.data.filter)) continue;
      socket.emit(LIVE_SOCKET.event, event);
    }
  }

  connectedCount(tenantKey?: string): number {
    if (!tenantKey) return this.sockets.size;
    let n = 0;
    for (const s of this.sockets.values()) if (s.data.tenantKey === tenantKey) n++;
    return n;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.io.close(() => resolve()));
  }
}
