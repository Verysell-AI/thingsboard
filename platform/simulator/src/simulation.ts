import type { TelemetryValues } from '@platform/shared/contracts';
import {
  DEFAULT_TIME_ZONE,
  clockSnapshot,
  liveClock,
  virtualNow,
  type ClockSnapshot,
  type ClockState,
} from '@platform/shared/clock';
import type {
  ScenarioName,
  ScenarioParams,
  ScenarioResult,
  SimulatorAddDevice,
  SimulatorState,
} from '@platform/shared/dto';
import type { DeviceType, Persona } from '@platform/shared/dataset';
import { DeviceTypeSchema, PersonaKeySchema } from '@platform/shared/dataset';
import { bookingPeopleInRoom, type BookingsSource } from './bookings.js';
import { DeviceLink, realClientFactory, type ClientFactory, type Logger } from './mqtt.js';
import { Registry } from './registry.js';
import { runScenario } from './scenarios.js';
import type { DeviceSpec, TenantWorld } from './world.js';

export interface SimulationOptions {
  mqttUrl: string;
  tickMs: number;
  clientFactory?: ClientFactory;
  log: Logger;
  /** Delay between successive initial connects, in ms. */
  connectStaggerMs?: number;
  /** Real clock source (tests inject a fake). */
  now?: () => number;
  /** Zone persona schedules are read in; defaults to the platform zone. */
  timeZone?: string;
  /** Longest virtual step fed to a behaviour, in seconds; longer spans are sub-stepped. */
  maxStepSeconds?: number;
  /** Bookings active now per tenant, so meeting rooms are occupied when a meeting is on. */
  bookings?: BookingsSource;
}

interface TenantRuntime {
  registry: Registry;
  links: Map<string, DeviceLink>;
  /** Behaviour profiles of the dataset, for laptops added at runtime with a persona. */
  personas: Persona[];
  /** Business clock pushed by the API; live until told otherwise. */
  clock: ClockState;
  /** Virtual time of the previous tick, 0 before the first one. */
  lastVirtualTick: number;
}

/** Sub-steps per tick are capped so an eight-hour jump costs milliseconds, not a stall. */
const MAX_SUBSTEPS = 120;
/** A paused or rewound clock still steps behaviours by a hair so telemetry keeps flowing. */
const IDLE_DT_SECONDS = 0.001;

/**
 * Owns every tenant's registry, MQTT links and business clock. The tick loop runs on the real
 * clock; each tenant's behaviours advance by the *virtual* time elapsed, so a fast or jumped clock
 * moves personas, temperatures and energy counters accordingly. Telemetry is always published with
 * the real timestamp: ThingsBoard history, inactivity detection and dashboards stay on real time.
 */
export class Simulation {
  private readonly tenants = new Map<string, TenantRuntime>();
  private timer: NodeJS.Timeout | null = null;
  private readonly factory: ClientFactory;
  private readonly realNow: () => number;
  readonly timeZone: string;
  private readonly maxStepSeconds: number;

  constructor(private readonly opts: SimulationOptions) {
    this.factory = opts.clientFactory ?? realClientFactory;
    this.realNow = opts.now ?? (() => Date.now());
    this.timeZone = opts.timeZone ?? DEFAULT_TIME_ZONE;
    this.maxStepSeconds = opts.maxStepSeconds ?? 60;
  }

  get tickMs(): number {
    return this.opts.tickMs;
  }

  tenantKeys(): string[] {
    return [...this.tenants.keys()];
  }

  registry(tenant: string): Registry | undefined {
    return this.tenants.get(tenant)?.registry;
  }

  /* ------------------------------------------------------------------ clock */

  /** Business time of a tenant right now (virtual when the time machine is active). */
  now(tenant: string): number {
    const runtime = this.tenants.get(tenant);
    const real = this.realNow();
    return runtime ? virtualNow(runtime.clock, real) : real;
  }

  clock(tenant: string): ClockSnapshot | undefined {
    const runtime = this.tenants.get(tenant);
    if (!runtime) return undefined;
    return clockSnapshot(tenant, runtime.clock, this.realNow(), this.timeZone);
  }

  clocks(): Record<string, ClockState> {
    const out: Record<string, ClockState> = {};
    for (const [tenant, runtime] of this.tenants) out[tenant] = runtime.clock;
    return out;
  }

  /**
   * Replaces a tenant's business clock. The next tick catches up: presence is re-evaluated at the
   * new time and behaviours are stepped through the gap (sub-stepped, capped), so a jump to 20:00
   * disconnects the laptops of everyone who has left and lets AC temperatures settle.
   */
  setClock(tenant: string, state: ClockState): ClockSnapshot {
    const runtime = this.tenants.get(tenant);
    if (!runtime) throw new Error(`unknown tenant ${tenant}`);
    runtime.clock = state;
    const snapshot = clockSnapshot(tenant, state, this.realNow(), this.timeZone);
    this.opts.log.info(
      { tenant, speed: state.speed, virtualNow: new Date(snapshot.virtualNow).toISOString() },
      'business clock set',
    );
    return snapshot;
  }

  /* ------------------------------------------------------------------ setup */

  addTenant(world: TenantWorld): Registry {
    const registry = new Registry(world.tenant.key, world.world, this.timeZone);
    const runtime: TenantRuntime = {
      registry,
      links: new Map(),
      personas: world.personas.personas,
      clock: liveClock(),
      lastVirtualTick: 0,
    };
    // a meeting room holds the laptops seen there plus the people its active booking brings
    const bookings = this.opts.bookings;
    registry.occupancySource = {
      presentCount: (room, now) =>
        registry.laptopsInRoom(room, now) +
        (bookings ? bookingPeopleInRoom(bookings.activeBookings(world.tenant.key), room, now) : 0),
    };
    this.tenants.set(world.tenant.key, runtime);
    for (const spec of world.devices) this.addDevice(spec);
    return registry;
  }

  addDevice(spec: DeviceSpec): DeviceLink {
    const runtime = this.tenants.get(spec.tenant);
    if (!runtime) throw new Error(`unknown tenant ${spec.tenant}`);
    const device = runtime.registry.add(spec);
    const link = new DeviceLink(
      device,
      this.opts.mqttUrl,
      this.factory,
      this.opts.log,
      (d, connected) => runtime.registry.setOnline(d.code, connected),
    );
    runtime.links.set(spec.code, link);
    return link;
  }

  /** Adds a device at runtime (new employee flow). Laptops stay offline until a scenario says otherwise. */
  addRuntimeDevice(body: SimulatorAddDevice): DeviceLink {
    const type: DeviceType = DeviceTypeSchema.parse(body.type);
    const runtime = this.tenants.get(body.tenant);
    if (!runtime) throw new Error(`unknown tenant ${body.tenant}`);
    const attrs = body.attrs;
    const room = typeof attrs.room === 'string' ? attrs.room : null;
    const zone = typeof attrs.zone === 'string' ? attrs.zone : null;
    const world = runtime.registry.world;
    const roomDef = room ? world.rooms.find((r) => r.code === room) : undefined;
    const zoneDef = world.zones.find((z) => z.code === (zone ?? roomDef?.zone));
    const spec: DeviceSpec = {
      tenant: body.tenant,
      code: body.code,
      type,
      name: typeof attrs.name === 'string' ? attrs.name : body.code,
      accessToken: body.accessToken,
      room,
      zone: zoneDef?.code ?? null,
      floor: roomDef?.floor ?? null,
    };
    if (type === 'laptop') {
      const personaKey = PersonaKeySchema.safeParse(attrs.persona);
      const persona = personaKey.success
        ? (runtime.personas.find((p) => p.key === personaKey.data) ?? null)
        : null;
      spec.laptop = {
        employeeCode: typeof attrs.employee_id === 'string' ? attrs.employee_id : body.code,
        user: typeof attrs.user === 'string' ? attrs.user : body.code.toLowerCase(),
        homeAccessPoint: zoneDef?.accessPoint ?? 'AP-UNKNOWN',
        persona,
        deskRoom: room,
      };
    }
    const link = this.addDevice(spec);
    if (type !== 'laptop' && this.timer) link.connect();
    return link;
  }

  removeDevice(tenant: string, code: string): boolean {
    const runtime = this.tenants.get(tenant);
    if (!runtime) return false;
    const link = runtime.links.get(code);
    if (!link) return false;
    link.disconnect();
    runtime.links.delete(code);
    runtime.registry.remove(code);
    return true;
  }

  link(tenant: string, code: string): DeviceLink | undefined {
    return this.tenants.get(tenant)?.links.get(code);
  }

  /* ------------------------------------------------------------------ lifecycle */

  /** Connects devices staggered, then starts the tick loop. */
  async start(): Promise<void> {
    const stagger = this.opts.connectStaggerMs ?? 50;
    let i = 0;
    for (const [tenant, runtime] of this.tenants) {
      const now = this.now(tenant);
      for (const link of runtime.links.values()) {
        if (!link.device.shouldBeOnline(now)) continue;
        if (stagger > 0 && i > 0) await sleep(stagger);
        link.connect();
        i++;
      }
      runtime.lastVirtualTick = now;
    }
    this.opts.log.info({ connecting: i }, 'simulator connected initial devices');
    this.timer = setInterval(() => this.tick(), this.opts.tickMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const runtime of this.tenants.values()) {
      for (const link of runtime.links.values()) link.disconnect();
    }
  }

  /** One simulation step for every tenant; exported for tests and scenarios. */
  tick(): Map<string, TelemetryValues> {
    const real = this.realNow();
    const published = new Map<string, TelemetryValues>();
    for (const runtime of this.tenants.values()) {
      const now = virtualNow(runtime.clock, real);
      const previous = runtime.lastVirtualTick || now - this.opts.tickMs;
      runtime.lastVirtualTick = now;

      // presence first, so meters and occupancy see the set of laptops online at the new time
      for (const link of runtime.links.values()) {
        const wanted = link.device.shouldBeOnline(now);
        if (wanted && !link.active) link.connect();
        else if (!wanted && link.active) link.disconnect();
      }

      // behaviours: integrate through the elapsed virtual span, sub-stepping long gaps
      const span = (now - previous) / 1000;
      let results = runtime.registry.tick(now, IDLE_DT_SECONDS);
      if (span > 0) {
        const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(span / this.maxStepSeconds)));
        const dt = span / steps;
        for (let i = 1; i <= steps; i++) {
          results = runtime.registry.tick(previous + dt * i * 1000, dt);
        }
      }

      for (const { device, telemetry } of results) {
        const link = runtime.links.get(device.code);
        if (link?.publishTelemetry(real, telemetry))
          published.set(`${device.tenant}:${device.code}`, telemetry);
      }
    }
    return published;
  }

  /* ------------------------------------------------------------------ scenarios and state */

  scenario(tenant: string, name: ScenarioName, params: ScenarioParams): ScenarioResult {
    const runtime = this.tenants.get(tenant);
    if (!runtime) return { scenario: name, accepted: false, message: `unknown tenant ${tenant}` };
    return runScenario(this, runtime.registry, name, params, this.now(tenant));
  }

  state(): SimulatorState {
    const devices: SimulatorState['devices'] = [];
    for (const [tenant, runtime] of this.tenants) {
      const now = this.now(tenant);
      for (const device of runtime.registry.all()) {
        const link = runtime.links.get(device.code);
        devices.push({
          tenant,
          code: device.code,
          type: device.type,
          connected: link?.connected ?? false,
          room: device.type === 'laptop' ? device.laptopLocation(now).room : device.room,
          values: device.values,
        });
      }
    }
    return {
      clocks: this.clocks(),
      timeZone: this.timeZone,
      tickMs: this.opts.tickMs,
      devices,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
