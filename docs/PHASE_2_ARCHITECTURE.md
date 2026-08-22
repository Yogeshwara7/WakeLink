# WakeLink Phase 2 — Architecture

## 1. Current Architecture (Phase 2)

```
┌─────────────────────────────────────────────────────┐
│                   Developer Machine                  │
│                                                      │
│  ┌──────────────────┐      ┌──────────────────────┐  │
│  │  Mobile App      │      │  Dev Backend         │  │
│  │  (Expo / RN)     │◄────►│  (Express :3001)     │  │
│  │                  │      │  ⚠️ DEV ONLY         │  │
│  │  Mock services   │      │  In-memory store     │  │
│  │  still active    │      └──────────┬───────────┘  │
│  └──────────────────┘                 │               │
│                                       │               │
│                         ┌─────────────▼─────────────┐ │
│                         │  PC Agent                 │ │
│                         │  (Node.js / TypeScript)   │ │
│                         │  wakelink-agent/          │ │
│                         └───────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

**What is real today:**
- PC Agent generates a stable device identity (UUID, never changes)
- PC Agent generates short-lived pairing codes
- PC Agent registers and sends heartbeats to the dev backend
- PC Agent receives and processes PING and STATUS_REQUEST commands
- Dev backend tracks device presence and pairing sessions in memory

**What is still mocked:**
- Mobile app still uses MockDeviceService / MockPairingService etc.
- Real API adapters exist in `src/services/api/` but are not wired
- No real authentication
- No remote desktop
- No Wake-on-LAN
- No persistent storage on the backend

---

## 2. PC Agent Architecture

```
wakelink-agent/src/
│
├── index.ts                  Entry point
│
├── agent/
│   ├── Agent.ts              Orchestrator — wires all modules
│   └── AgentState.ts         State machine (9 states, validated transitions)
│
├── identity/
│   └── IdentityManager.ts    Stable UUID identity, pairing status, persistence
│
├── pairing/
│   └── PairingManager.ts     Short-lived code generation and validation
│
├── network/
│   ├── ConnectionManager.ts  Register with backend, outbound-only
│   └── HeartbeatManager.ts   Periodic presence reporting (30s default)
│
├── commands/
│   └── CommandHandler.ts     Receive, validate, dispatch commands
│
├── system/
│   ├── SystemInfo.ts         OS/memory/uptime (read-only, no PII)
│   └── NetworkInfo.ts        Network interfaces and MAC addresses
│
├── storage/
│   ├── StorageProvider.ts    Interface (swap file ↔ Windows Credential Manager)
│   ├── FileStorageProvider.ts JSON file implementation (MVP)
│   └── SecureStorage.ts      Thin wrapper — consuming code never sees provider
│
├── config/
│   └── Config.ts             Environment-based configuration, safe defaults
│
└── utils/
    ├── Logger.ts             Timestamped, no secrets in output
    └── httpPost.ts           Minimal HTTP/HTTPS POST, no axios
```

### Agent State Machine

```
INITIALISING
     │
     ├──► UNPAIRED ──► PAIRING ──► CONNECTING ──► ONLINE
     │                                │                │
     └──────────────────────────────► │                │
                                      │          RECONNECTING
                                      │                │
                                      └──► OFFLINE ◄───┘
                                               │
                                          STOPPING / ERROR
```

---

## 3. Pairing Sequence

```
PC Agent                Dev Backend              Mobile App
    │                        │                        │
    │──── POST /register ────►│                        │
    │                        │                        │
    │  generatePairingSession()                        │
    │──── POST /pairing/agent-register ──────────────► │
    │                        │                        │
    │  [displays PAIRING CODE in terminal]             │
    │                        │                        │
    │                        │◄── POST /pairing/start ─┤
    │                        │    { pairingCode }      │
    │                        │                        │
    │                        │──── { sessionId } ─────►│
    │                        │                        │
    │                        │◄── POST /pairing/complete
    │                        │    { sessionId, userId, deviceName }
    │                        │                        │
    │                        │  queues PAIR_CONFIRM    │
    │                        │  command                │
    │                        │                        │
    │◄─── GET /commands/pending ──────────────────────│
    │     receives PAIR_CONFIRM                        │
    │                        │                        │
    │  validatePairingRequest()                        │
    │  completePairing()                              │
    │                        │                        │
    │──── POST /commands/:id/result ─────────────────►│
    │                        │                        │
    │  starts heartbeat       │                        │
    │──── POST /heartbeat ──► │                        │
    │                        │──── device ONLINE ─────►│
```

---

## 4. Heartbeat Sequence

```
PC Agent                    Dev Backend
    │                            │
    │  every 30 seconds:         │
    │──── POST /heartbeat ──────►│
    │     { deviceId,            │  device.status = ONLINE
    │       agentVersion,        │  device.lastHeartbeatAt = now
    │       timestamp,           │
    │       status: ONLINE,      │
    │       networkAvailable,    │
    │       os, osVersion,       │
    │       uptimeSeconds }      │
    │◄──── { acknowledged: true }│
    │                            │
    │  after 3 failures:         │
    │  state → RECONNECTING      │
    │  backend marks OFFLINE     │
    │  (after 2 min stale)       │
```

---

## 5. Command Architecture

### Wire format
```json
{
  "commandId":  "uuid-v4",
  "deviceId":   "device-uuid",
  "type":       "PING",
  "timestamp":  "2026-01-01T00:00:00.000Z",
  "expiresAt":  "2026-01-01T00:02:00.000Z",
  "payload":    {}
}
```

### Validation chain (all must pass)
1. `deviceId` matches this agent's identity
2. `expiresAt` is in the future (default TTL: 2 minutes)
3. `commandId` not in the processed-IDs set (replay protection)

### Implemented commands
| Command | Description |
|---|---|
| `PING` | Returns `{ pong: true, timestamp }` |
| `STATUS_REQUEST` | Returns device identity and current state |
| `PAIR_CONFIRM` | Validates pairing code, marks device as paired |

### Defined, not yet implemented
| Command | Future purpose |
|---|---|
| `WAKE_REQUEST` | Wake PC from sleep (Phase 4) |
| `CONNECT_REQUEST` | Initiate remote session (Phase 5) |
| `SHUTDOWN_REQUEST` | Graceful shutdown (Phase 5, auth-gated) |
| `SLEEP_REQUEST` | Put PC to sleep (Phase 5, auth-gated) |

---

## 6. Mobile ↔ Backend ↔ Agent Relationship

```
Mobile App (src/services/)
    │
    ├── CURRENTLY: Mock services (no network)
    │
    └── FUTURE: API services (src/services/api/)
               │
               ▼
         Dev Backend / WakeLink Cloud (:3001 / https://api.wakelink.app)
               │
               ├── Device registry
               ├── Pairing sessions
               ├── Command queue
               └── Heartbeat tracking
                        │
                        ▼ (outbound from agent, no inbound ports needed)
                  PC Agent (wakelink-agent/)
                        │
                        └── Windows PC
```

### How to activate the real API services (one step)

In `src/services/index.ts`, replace the mock imports with:

```typescript
import { createApiServices } from './api';

const { deviceService, wakeService, connectionService, pairingService }
  = createApiServices({
      baseUrl:  'http://localhost:3001',   // or real cloud URL
      getToken: () => authService.getSession()
                        .then(s => s?.accessToken ?? null),
    });
```

---

## 7. What is Mocked vs Real

| Capability | Status | Location |
|---|---|---|
| Device identity (UUID) | ✅ Real | `wakelink-agent/src/identity/` |
| Pairing code generation | ✅ Real | `wakelink-agent/src/pairing/` |
| Pairing code validation | ✅ Real | `wakelink-agent/src/pairing/` |
| Heartbeat (to dev backend) | ✅ Real | `wakelink-agent/src/network/` |
| Device registration | ✅ Real | `wakelink-agent/src/network/` |
| PING / STATUS command | ✅ Real | `wakelink-agent/src/commands/` |
| Dev backend API | ✅ Real | `wakelink-dev-backend/src/` |
| Mobile device list | 🔶 Mocked | `src/services/mock/MockDeviceService` |
| Mobile pairing flow | 🔶 Mocked | `src/services/mock/MockPairingService` |
| Mobile wake flow | 🔶 Mocked | `src/services/mock/MockWakeService` |
| Mobile connection flow | 🔶 Mocked | `src/services/mock/MockConnectionService` |
| Authentication | 🔶 Mocked | `src/services/mock/MockAuthService` |
| Wake-on-LAN | ❌ Not built | Phase 4 |
| Remote desktop | ❌ Not built | Phase 5 |
| Cloud backend | ❌ Not built | Phase 3 |
| Windows Service installer | ❌ Not built | Phase 3 |

---

## 8. Security Considerations

### Implemented
- Pairing codes are short-lived (5 minutes) and single-use
- Device ID is a random UUID — not based on IP, hostname, or username
- Commands require deviceId match, expiry check, and replay protection
- Agent uses outbound-only connections — no inbound ports required
- Secrets are never logged (userIds redacted, no tokens in output)
- Storage interface is separated so sensitive values can move to Windows Credential Manager

### Not yet implemented (required before production)
- TLS (HTTPS) — dev backend is HTTP localhost only
- JWT authentication for all API calls
- Command signing (HMAC or JWT payload verification)
- Windows Credential Manager for token storage
- Rate limiting on pairing attempts
- User account scoping (any request can access any device in dev backend)

---

## 9. Future Cloud Architecture (Phase 3)

```
                     INTERNET (TLS)
                          │
                          ▼
               ┌─────────────────────┐
               │   WakeLink Cloud    │  ← Phase 3
               │   (real backend)    │
               └────────┬────────────┘
                        │
           ┌────────────┴────────────┐
           │                         │
           ▼                         ▼
    Phone App                 PC Agent (outbound WS)
           │                         │
           │                    Windows PC
           │
     (Remote Session UI)
```

The PC Agent will maintain a persistent WebSocket connection to the cloud.
Commands are pushed down the open socket — no polling required.
The cloud acts as the relay; the mobile app never communicates directly with the PC.

---

## 10. Future Wake-on-LAN Relay Architecture (Phase 4)

```
Phone → Cloud → PC Agent (if PC is sleeping/online)
                    │
                    └──► WoL magic packet → PC wakes

Phone → Cloud → Always-on home relay device
                    │
                    └──► WoL magic packet → PC wakes (if completely off)
```

For a **sleeping** PC: the agent can send its own WoL packet or use OS APIs.
For a **completely powered-off** PC: an always-on relay (Raspberry Pi, router plugin,
or future WakeLink hardware) is required. This is Phase 4+.

---

## 11. Future Remote Desktop Integration (Phase 5)

The session screen placeholder in `app/session/[id].tsx` is where the real
rendering surface will be mounted. Options under evaluation:

- WebRTC data/video channel (lowest latency, most complex)
- RDP over WebSocket proxy (leverages existing Windows RDP server)
- Custom streaming protocol via the PC Agent

The `CONNECT_REQUEST` command is already defined in `CommandHandler.ts`
and `ApiConnectionService.ts` to prepare the agent for this step.
