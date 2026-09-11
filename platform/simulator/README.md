# @platform/simulator

Virtual devices for the office-demo dataset. One MQTT session per device (client id and username = the
device access token), telemetry every `SIM_TICK_MS`, RPC answered on the response topic. Laptops follow
their employee's persona; everything else stays connected. Behaviours come from `@platform/shared/behaviours`.

## Control API (port `SIMULATOR_PORT`, header `x-internal-token: $INTERNAL_API_TOKEN`)

| Route                   | Body / query                                                                                        | Effect                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `GET /health`           | —                                                                                                   | no token needed                                                              |
| `GET /state`            | —                                                                                                   | every device with `connected`, `room`, last values, and every tenant's clock |
| `POST /devices`         | `SimulatorAddDevice` (`tenant`, `code`, `type`, `accessToken`, `attrs{room,zone,employee_id,user}`) | adds a device at runtime; laptops start offline                              |
| `DELETE /devices/:code` | `?tenant=`                                                                                          | removes it                                                                   |
| `POST /scenario/:name`  | `ScenarioParams` + optional `tenant`; or `?tenant=`                                                 | see the scenario table below                                                 |
| `PUT /clock`            | `{tenant, state: {anchorRealMs, anchorVirtualMs, speed}}`                                           | sets the tenant business clock (pushed by the API's time machine)            |
| `GET /clock`            | `?tenant=`                                                                                          | current clock snapshot                                                       |

When `tenant` is omitted the first entry of `SIM_TENANTS` is used.

## Scenarios (`POST /scenario/:name`, all timed by the tenant business clock)

| Scenario                | Params                                                       | Effect                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `new-laptop-first-boot` | `code`                                                       | laptop online for 60 s, then offline for the rest of the day                                                                                                            |
| `everyone-leaves`       | —                                                            | every laptop offline until tomorrow, meeting rooms empty; a laptop kept online by `late-worker-stays` stays                                                             |
| `late-worker-stays`     | `employeeId` (E009, LAPTOP-E009 or the platform employee id) | that laptop stays online at its desk until 23:30 whatever its persona says                                                                                              |
| `lunch-peak`            | —                                                            | all AC at full output, appliances in use, for 10 min                                                                                                                    |
| `move-laptop`           | `code`, `room`                                               | the laptop reports from that room (its zone's access point, undocked) until moved back to its desk room                                                                 |
| `heater-left-on`        | `room`                                                       | toggles an extra 1500 W behind a plug of the room (prefers a heater/other plug); meters include it                                                                      |
| `ac-filter-degrade`     | `code`                                                       | toggles accelerated filter clogging: the unit runs at full output and its current rises 3 %/min, crossing the alarm threshold in a few minutes; calling again resets it |
| `ghost-meeting`         | `room`                                                       | no-op (accepted): ghost meetings are bookings, created by the platform API                                                                                              |

## Bookings

Each tick the simulator asks the API for the bookings active right now (`GET /internal/bookings/now?tenant=`,
internal token; the API answers by the tenant's business clock). A meeting room's occupancy sensor then
counts the laptops seen in the room plus the people its booking brings: a `FULL` meeting from its start, a
`LATE` one twelve minutes after the start, a `GHOST` one never. Projector plugs draw power while someone is
counted. When the API is unreachable the last answer is kept and a warning is logged once.

Laptops added at runtime (`POST /devices` with `attrs.persona`) follow that persona's schedule; without a
known persona they stay offline until the `new-laptop-first-boot` scenario.

## Business clock

Each tenant has a business clock (`@platform/shared/clock`). Personas, appliance habits and scenario timers
follow it; behaviours are stepped by the _virtual_ time elapsed since the previous tick (long jumps are
sub-stepped), and presence is re-evaluated at the new time. **Telemetry is always published with the real
timestamp** so ThingsBoard history and inactivity detection stay on real time. Wall-clock rules are read in
`SIM_TIME_ZONE` (defaults to `TZ`, then `Asia/Dubai`). At startup the simulator pulls the current clock of
every tenant from the API (`GET /internal/clock/:tenant`) so a restart mid-demo keeps the virtual time.
