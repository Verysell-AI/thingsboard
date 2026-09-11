# ThingsBoard artefacts

Everything the IoT core needs per tenant, imported by `make provision` through the API's `TbClient`. The
core runs the unmodified upstream image pinned in `.env` (`TB_IMAGE`, currently `thingsboard/tb-node:4.2.1.1`)
against its own PostgreSQL + TimescaleDB database (`TB_DB_IMAGE`, compose service `tb-db`, timeseries in the
`ts_kv` hypertable); these files were validated by importing them into that exact core version.

| Path                          | Format                                                                                                                       | Import                                                                                                                                                                                                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `device-profiles/<type>.json` | one `DeviceProfile` body (no `id`/`tenantId`/`createdTime`); `name` is the device type used by the dataset and the simulator | `POST /api/deviceProfile`                                                                                                                                                                                                                          |
| `asset-profiles/<Name>.json`  | one `AssetProfile` body for `Site`, `Building`, `Floor`, `Room`, `Zone`                                                      | `POST /api/assetProfile`                                                                                                                                                                                                                           |
| `rule-chain.json`             | `{ ruleChain, metadata }` as exported by the rule-chain editor                                                               | `POST /api/ruleChain` with `ruleChain` (it has `root: false`; creating a second _root_ chain is rejected with 400), then `POST /api/ruleChain/metadata` with `metadata` plus `ruleChainId` set to the new id, then `POST /api/ruleChain/{id}/root` |
| `dashboards/*.json`           | dashboard exports (added in a later phase)                                                                                   | `POST /api/dashboard`                                                                                                                                                                                                                              |

## Placeholders in `rule-chain.json`

The REST node `platform events` contains two literal placeholders that `provision` replaces before import:

- `${API_URL}` → the API base URL as seen from the core container (`http://api:4000` under compose)
- `${INTERNAL_API_TOKEN}` → the shared secret sent in the `X-Internal-Token` header

## Rule chain topology

```
Input → Originator fields (metadata: originatorId, originatorName, originatorType) → Message type switch
  Post telemetry            → Is backfill? (metadata.backfill == "true")
                                True  → Save backfill timeseries               (no alarms, no events)
                                False → Save timeseries → Device profile → Alarm Created/Updated/Cleared → Event: alarm_*
                                                        → Event: telemetry
  Post attributes           → Save attributes (CLIENT_SCOPE) → Event: attributes
  Activity / Inactivity / Connect / Disconnect Event → Event: activity | inactivity | connect | disconnect
  RPC Request from Device   → RPC reply
  RPC Request to Device     → RPC to device (server-side RPC from the platform; without this node REST RPC times out with 504)
  Event: *                  → platform events (REST POST ${API_URL}/internal/tb/events)
```

Each `Event: <kind>` node is a TBEL transform producing the body of `TbEventPayloadSchema`
(`platform/shared/src/contracts/events.ts`):

```json
{
  "type": "telemetry",
  "originator": { "id": "<device uuid>", "entityType": "DEVICE", "name": "AC-1.1", "type": "ac" },
  "ts": 1788864724090,
  "data": { "state": 1, "power_w": 820.5 },
  "metadata": { "deviceName": "AC-1.1", "ts": "1788864724090", "...": "..." }
}
```

`ts` is `metadata.ts` (the device timestamp for telemetry) or the current time when the message has none
(attributes, activity events). `originator.type` is the device profile name.

Alarm messages carry the alarm object in `data` (`type`, `severity`, `status`, `id`, `originator`, ...).
Activity events carry `{ active, lastConnectTime, lastActivityTime, lastDisconnectTime, inactivityTimeout }`.

## Alarm rules (device profiles)

| Profile                                | Create                                                                                            | Clear                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------- |
| `ac`                                   | `current_a > ac_current_alarm_a` for 10 min, MAJOR `AC current high`                              | `current_a < ac_current_clear_a` |
| `floor_meter`                          | `power_w > 75000` for 2 min, WARNING `Peak load` (the value the presenter changes live)           | `power_w <= 75000`               |
| `room_meter`                           | `power_w > night_anomaly_w` for 5 min between 22:00 and 06:00 Asia/Dubai, WARNING `Night anomaly` | `power_w <= night_anomaly_w`     |
| `laptop`, `light`, `occupancy`, `plug` | no rules; laptop "Asset unreachable" is raised by the API from `inactivity` events                |                                  |

Dynamic values in device-profile alarm rules compare a key with a server attribute **as is** (no arithmetic),
so the thresholds are stored as their own attributes next to the descriptive ones. The dataset loader (and the
API when registering real devices) writes, per device:

| Device       | Descriptive attributes | Threshold attributes for the rules                                                               |
| ------------ | ---------------------- | ------------------------------------------------------------------------------------------------ |
| `ac`         | `nominal_current_a`    | `ac_current_alarm_a = 1.25 × nominal_current_a`, `ac_current_clear_a = 1.10 × nominal_current_a` |
| `room_meter` | `night_baseline_w`     | `night_anomaly_w = 2 × night_baseline_w`                                                         |

Fallback defaults inside the profiles (5.25 A, 4.62 A, 500 W) apply when the attribute is missing.

## Verified on 4.2.1.1

- `GET /api/auth/login` answers **302** (redirect to the UI) once the web layer is up; the compose healthcheck and `make up` accept 200/302/401/405.
- User activation without SMTP: `POST /api/user?sendActivationMail=false` → `GET /api/user/{id}/activationLink` (plain text URL; the token may contain `-` and `_`) → `POST /api/noauth/activate?sendActivationMail=false` with `{ "activateToken", "password" }` returns a JWT pair.
- Server attribute `inactivityTimeout` (ms) on a device overrides the global timeout; with 30000 the `inactivity` event reaches the API about 30 s after the last message.
