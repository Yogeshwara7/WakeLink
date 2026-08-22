# WakeLink Phase 4 — Remote Wake Architecture

## 1. Current Phase 3 architecture (baseline)

```
Phone
  │  POST /api/devices/:id/wake
  ▼
Dev Backend (localhost:3001)
  │  WakeOnLanService.sendMagicPacket(mac)
  ▼
UDP broadcast → same LAN → sleeping PC
  │
  ▼
PC boots → Agent registers → Heartbeat → WAKING→ONLINE
```

**What Phase 3 can do:**
- Send a real WoL magic packet
- Track WAKING / ONLINE / FAILED states
- Agent reports MAC address and wakeSupported flag

**What Phase 3 cannot do:**
- Work when phone is outside the home network
- Send UDP packets across the internet or through NAT
- Reach a PC on a network with CGNAT (double NAT)

---

## 2. The Phase 4 problem

### Why direct cloud→PC WoL fails

```
Internet
  │
  ▼
WakeLink Cloud
  │
  │  send UDP packet to 203.0.113.42:9 (home router public IP)
  ▼
Home Router  ← BLOCKED by NAT
  │
  │  Router has no mapping for UDP port 9
  │  Packet is silently dropped
  ▼
Sleeping PC  ← never receives packet
```

NAT (Network Address Translation) allows outbound connections but blocks
unsolicited inbound packets. UDP magic packets are unsolicited — they have
no prior connection the router can map.

CGNAT (Carrier-Grade NAT) makes this worse: the ISP itself applies NAT,
so the home router's "public" IP is itself behind another NAT layer.
Port forwarding at the home router doesn't help because the ISP's NAT
blocks it first.

**The fundamental constraint:**
> Something inside the home network must remain powered on and
> maintain an OUTBOUND connection to the cloud.
> That device bridges the gap when the home PC is off.

---

## 3. Candidate architectures evaluated

### Option A — Router-based WoL relay

Some routers (DD-WRT, OpenWrt, ASUS with custom firmware) support WoL
forwarding via a web interface.

| Criterion | Rating |
|---|---|
| User setup complexity | High — requires custom firmware, SSH, config files |
| Cost | Low (uses existing hardware) |
| CGNAT compatibility | ❌ Still needs port forwarding |
| Non-technical user friendly | ❌ No |
| Always-on | ✅ Router is always on |
| WakeLink control | ❌ Cannot authenticate requests |

**Verdict: Rejected.** Requires technical users, no auth, CGNAT-incompatible.

### Option B — WakeLink Home Relay (SELECTED)

A small Node.js process (`wakelink-relay`) runs on any always-on device
in the home network (the PC itself while awake, a Raspberry Pi, NAS,
or any device that stays on 24/7).

The relay:
- Makes OUTBOUND HTTP/WebSocket connections only (no inbound ports)
- Polls the WakeLink backend for wake commands
- Executes `WakeOnLanService.sendMagicPacket()` locally
- Works through any NAT, including CGNAT
- Authenticates with a relay token (no raw credentials)

| Criterion | Rating |
|---|---|
| User setup complexity | Low — `npm install && npm start` |
| Cost | Free (existing hardware) |
| CGNAT compatibility | ✅ Outbound only |
| Non-technical user friendly | ✅ With a proper installer |
| Always-on | ✅ Designed for always-on device |
| WakeLink control | ✅ Full authentication |
| Reliability | High — reconnects automatically |
| Security | Relay token, command ownership verified |

**Verdict: Selected for Phase 4.**

### Option C — Cloudflare Tunnel / similar

Cloudflare Tunnel creates an outbound tunnel from the home network to
Cloudflare's edge, making localhost services reachable on the internet.

| Criterion | Rating |
|---|---|
| User setup complexity | Medium — Cloudflare account + cloudflared install |
| Cost | Free tier available |
| CGNAT compatibility | ✅ |
| Third-party dependency | ❌ Requires Cloudflare account |
| Suitable for non-technical users | ❌ For current dev stage |

**Verdict: Useful for future production — not for MVP.**

### Option D — MQTT broker

A message broker (Mosquitto) mediates between cloud and relay.

**Verdict: Adds infrastructure dependency. Overkill for single-device dev.**

---

## 4. Selected architecture — WakeLink Home Relay

```
┌─────────────────────────────────────────────────────────────────┐
│                         INTERNET                                │
│                                                                 │
│    Phone App                   WakeLink Cloud / Dev Backend     │
│        │                              │                         │
│        │  POST /api/devices/:id/wake  │                         │
│        │─────────────────────────────►│                         │
│        │                              │                         │
│        │                              │  find relay for device  │
│        │                              │  POST /relay/commands   │
│        │                              │  (wake command queued)  │
│        │                              │                         │
│        │◄────────────────────────────│                         │
│        │  { wakeStatus: "WAKING" }    │                         │
│                                       │                         │
└───────────────────────────────────────┼─────────────────────────┘
                                        │
                          ┌─────────────▼─────────────┐
                          │       HOME NETWORK         │
                          │                           │
                          │  WakeLink Home Relay       │
                          │  (always-on device)        │
                          │                           │
                          │  polls backend outbound:   │
                          │  GET /relay/:id/commands   │
                          │                           │
                          │  receives WAKE command     │
                          │                           │
                          │  WakeOnLanService          │
                          │  .sendMagicPacket(mac)     │
                          │         │                 │
                          └─────────┼─────────────────┘
                                    │ UDP broadcast (LAN)
                                    ▼
                          ┌─────────────────────┐
                          │    Sleeping PC       │
                          │                     │
                          │  Receives magic     │
                          │  packet, boots      │
                          │         │           │
                          └─────────┼───────────┘
                                    │ outbound HTTP
                                    ▼
                          WakeLink Backend
                          POST /heartbeat
                          WAKING → ONLINE
```

---

## 5. Component responsibilities

### WakeLink Cloud / Dev Backend
- Receives authenticated wake requests from the mobile app
- Validates device ownership (user → device association)
- Looks up the relay registered for the target device's network
- Queues a `RELAY_WAKE` command for the relay
- Tracks relay presence (last heartbeat)
- Transitions device: OFFLINE → WAKING on wake dispatch
- Transitions device: WAKING → ONLINE on agent heartbeat
- Times out WAKING → FAILED if no heartbeat within WOL_WAKE_TIMEOUT_MS

### WakeLink Home Relay (`relay/`)
- Runs on any always-on home network device
- Authenticates with a relay token (generated at pairing time)
- Polls backend for pending commands (long-polling → WebSocket in production)
- Executes `WakeOnLanService.sendMagicPacket()` on RELAY_WAKE command
- Sends heartbeat to backend every 60 seconds
- Reports: relayId, deviceIds it can wake, network info, version

### WakeLink PC Agent (`agent/`)
- Unchanged from Phase 3 functionally
- Phase 4 addition: reports `relayId` in registration payload when a relay
  on the same network has been paired with the device
- The relay and agent discover each other via the backend during pairing

### Mobile App
- Sends `POST /api/devices/:id/wake` — unchanged
- Backend now routes through relay transparently
- ApiWakeService polls device status — unchanged
- Shows relay-specific error messages when relay is offline

---

## 6. Relay authentication model

```
RELAY PAIRING (one-time setup):

1. User installs WakeLink Relay on always-on device
2. Relay generates a unique relayId (UUID) and relayToken (secret)
3. Relay calls POST /api/relay/register
   { relayId, relayToken (hashed), networkId, version }
4. Backend stores relay record, returns confirmation
5. Relay is now associated with devices on its network

WAKE REQUEST AUTHENTICATION:

Phone → Backend: POST /api/devices/:id/wake
  Backend checks: does caller own this device?  (Phase 5: real auth)
  Backend checks: does device have a relay?
  Backend checks: is relay online (recent heartbeat)?
  Backend queues RELAY_WAKE command for relay
  Returns { wakeStatus: WAKING }

Relay → Backend: GET /api/relay/:relayId/commands/pending
  (Authenticated with relay token in Authorization header)
  Receives RELAY_WAKE command
  Validates: command has not expired, not already processed
  Sends UDP magic packet
  Posts result back to backend
```

---

## 7. Wake request lifecycle

```
State machine for a wake request:

  OFFLINE
     │
     │ POST /api/devices/:id/wake (mobile)
     ▼
  [Backend validates ownership + relay]
     │
     ├─── no relay / relay offline ──► 422 RELAY_UNAVAILABLE
     │                                  (show actionable message in app)
     │
     └─── relay online ──────────────► queue RELAY_WAKE command
                                        set device.status = WAKING
                                        start timeout timer
                                        return { wakeStatus: WAKING }
                                               │
                              ┌────────────────┘
                              │
                        relay polls backend
                        receives RELAY_WAKE
                              │
                        sends UDP magic packet
                              │
                        posts result { success: true }
                              │
                        PC receives packet, boots
                              │
                        agent starts, registers
                              │
                        agent sends heartbeat
                              │
                  [Backend: cancel timeout, WAKING→ONLINE]
                              │
                   mobile poll sees ONLINE
                              │
                   connection flow continues
                              │
                           CONNECTED (Phase 5 placeholder)

  FAILURE PATHS:
  - Relay sends result { success: false } ──► FAILED immediately
  - Timeout expires (default 120s)        ──► OFFLINE + FAILED
  - Duplicate wake request               ──► 409 CONFLICT (already WAKING)
  - Device already ONLINE                ──► 200 + skip wake, proceed to connect
```

---

## 8. Failure handling matrix

| Scenario | Backend response | Mobile UX |
|---|---|---|
| Device already ONLINE | 200 `{ wakeStatus: ONLINE, alreadyOnline: true }` | Skip wake, proceed to connect |
| No relay registered | 422 `RELAY_NOT_CONFIGURED` | "Set up WakeLink Relay on an always-on device at home" |
| Relay registered but offline | 422 `RELAY_OFFLINE` | "Your home relay is offline. Make sure it's running." |
| wakeSupported = false | 422 `WAKE_NOT_SUPPORTED` | "WoL not enabled. Check BIOS and NIC settings." |
| No MAC address | 422 `MAC_NOT_REGISTERED` | "PC Agent hasn't reported its MAC address yet." |
| Duplicate wake (already WAKING) | 409 | Poll continues — no new packet sent |
| Relay sends packet, PC doesn't boot | Timeout after 120s → FAILED | "PC didn't respond. Check it's powered and WoL is enabled." |
| Backend unreachable | Network error | "Cannot reach WakeLink server." |

---

## 9. Development simulation

Phase 4 can be fully tested on a single laptop with three processes:

```
Terminal 1: backend/    npm run dev       (port 3001)
Terminal 2: relay/      npm run dev       (connects outbound to backend)
Terminal 3: agent/      npm run dev       (connects outbound to backend)
Terminal 4: (root)      npm start         (mobile app via Expo Go)
```

The relay process:
- Runs on the same machine as the backend
- Polls `GET /api/relay/:relayId/commands/pending` on localhost
- On RELAY_WAKE command: calls `WakeOnLanService.sendMagicPacket(mac)`
- This sends a real UDP broadcast on the local network
- If a sleeping PC is on the same LAN, it will wake up
- Without a real sleeping PC, the packet is sent but nothing boots
  (backend timeout eventually transitions WAKING → FAILED)

The MockWakeRelay simulates the relay registering, receiving commands,
and reporting success — all in memory — for automated testing.

---

## 10. Security model

| Concern | Implementation |
|---|---|
| Relay authentication | Relay token (SHA-256 hashed in storage, sent as Bearer token) |
| Command ownership | Backend verifies deviceId matches relay's registered devices |
| Command replay | commandId idempotency (same as Phase 2 CommandHandler) |
| Command expiry | expiresAt on every queued command (default 2 min) |
| No public ports | Relay uses outbound polling only |
| No RDP exposure | Remote desktop not implemented (Phase 5) |
| Secrets in git | Relay token in .env, never committed |

---

## 11. Future production architecture

```
                        INTERNET (TLS)
                              │
                    ┌─────────▼─────────┐
                    │  WakeLink Cloud   │
                    │  (real backend)   │
                    └──────┬────────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
              ▼                         ▼
       PC Agent                  Home Relay
       (outbound WS)             (outbound WS)
              │                         │
         Windows PC             LAN broadcast
                                        │
                                  Sleeping PC

WebSocket upgrade path:
- Relay opens persistent WS to cloud (replaces polling)
- Cloud pushes RELAY_WAKE instantly (0 latency vs 5s poll)
- Same RelayCommandHandler interface, different transport
```

---

## 12. Files created / modified in Phase 4

### Created
| File | Purpose |
|---|---|
| `relay/` | New project — WakeLink Home Relay |
| `relay/src/index.ts` | Entry point |
| `relay/src/relay/Relay.ts` | Orchestrator |
| `relay/src/relay/RelayIdentity.ts` | Persistent relay ID + token |
| `relay/src/network/RelayPoller.ts` | Polls backend for commands |
| `relay/src/network/RelayHeartbeat.ts` | Reports relay presence |
| `relay/src/interfaces/WakeRelay.ts` | Interface (swap point for WS upgrade) |
| `relay/src/mock/MockWakeRelay.ts` | In-memory mock for tests |
| `backend/src/store/RelayStore.ts` | Relay registry in DeviceStore |
| `backend/src/routes/relay.ts` | Relay registration + command endpoints |
| `backend/tests/relayRoute.test.ts` | Relay route tests |
| `docs/PHASE_4_ARCHITECTURE.md` | This document |

### Modified
| File | Change |
|---|---|
| `backend/src/store/DeviceStore.ts` | Add relay association to StoredDevice |
| `backend/src/routes/wake.ts` | Route through relay when available |
| `backend/src/index.ts` | Mount relay routes |
| `agent/src/network/ConnectionManager.ts` | Report relayId in registration |
| `src/services/api/ApiWakeService.ts` | Relay-aware error messages |
| `backend/.env.example` | RELAY_* env vars |
