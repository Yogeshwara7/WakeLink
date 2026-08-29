# WakeLink

Access your Windows PC from anywhere — even when it's sleeping.

WakeLink lets you remotely wake and connect to your personal Windows computer from your phone. Pair your PC once and from that point forward you just tap Connect. No IP addresses. No router configuration. No VPN setup.

---

## Current state — Phase 4 complete

The following is **real and working**:

| Capability | Status |
|---|---|
| Mobile app (Expo / React Native) | ✅ Running |
| PC Agent — stable UUID identity | ✅ Real |
| PC Agent — pairing code generation | ✅ Real |
| PC Agent — pairing session lifecycle (UNPAIRED/PAIRING/PAIRED) | ✅ Real |
| PC Agent — heartbeat + command polling | ✅ Real |
| PC Agent — MAC address reporting | ✅ Real |
| Backend — device registration + heartbeat | ✅ Real |
| Backend — pairing API | ✅ Real |
| Backend — command queue | ✅ Real |
| Backend — relay registry | ✅ Real |
| Wake-on-LAN — 102-byte magic packet | ✅ Real |
| Wake-on-LAN — WAKING → ONLINE via heartbeat | ✅ Real |
| Home Relay — outbound HTTP polling | ✅ Real |
| Home Relay — NAT/CGNAT compatible | ✅ Real |
| Home Relay — relay wake execution | ✅ Real |
| Mobile → backend → relay → PC wake flow | ✅ End-to-end verified |
| Real pairing from phone to PC | ✅ End-to-end verified |
| Remote session | 🔶 Placeholder (Phase 5) |
| Remote desktop streaming | ❌ Not built yet |
| Internet wake (phone on cellular) | 🔶 Architecture built, requires cloud deployment |

---

## The problem it solves

Most remote desktop solutions assume your PC is already on and reachable. WakeLink handles the full lifecycle — including waking a powered-off machine — through a single mobile interface that anyone can use. No port forwarding. No static IP. No VPN.

---

## Stack

| Layer | Technology |
|---|---|
| Mobile app | React Native, Expo SDK 51, expo-router v3 |
| Language | TypeScript 5.3 across all projects |
| PC Agent | Node.js, ts-node |
| Home Relay | Node.js, ts-node |
| Dev Backend | Express 4, TypeScript |
| Wake-on-LAN | UDP broadcast, standard 102-byte magic packet |
| State | React hooks + service subscriptions |
| Auth | Pairing token (hashed), device UUID — real OIDC in Phase 6 |

---

## Repository structure

```
WakeLink/
├── app/                    Mobile screens (Expo Router, file-based)
│   ├── index.tsx           Onboarding
│   ├── (tabs)/index.tsx    Home — device list
│   ├── device/[id].tsx     Device detail
│   ├── pair/index.tsx      Pair new PC flow
│   ├── connect/[id].tsx    Connection state machine
│   └── session/[id].tsx    Remote session (placeholder → Phase 5)
│
├── src/
│   ├── models/             Device, ConnectionSession, PairingSession
│   ├── services/           Service interfaces + real API adapters
│   ├── services/mock/      Mock implementations (EXPO_PUBLIC_USE_MOCK=true)
│   ├── services/api/       Real API adapters (active by default)
│   ├── services/index.ts   ← Service registry / swap point
│   ├── components/         Shared UI components
│   ├── store/              React hooks for device state
│   ├── theme/              Design tokens
│   └── utils/              Status helpers, relative time
│
├── agent/                  Windows PC Agent
│   ├── src/agent/          Orchestrator + state machine
│   ├── src/identity/       Stable UUID identity, pairing status
│   ├── src/pairing/        Pairing session lifecycle
│   ├── src/network/        ConnectionManager, HeartbeatManager, CommandPoller
│   ├── src/commands/       CommandHandler (PING, STATUS, PAIR_CONFIRM)
│   ├── src/storage/        SecureStorage (file-based MVP, keychain-ready)
│   └── tests/unit/         61 unit tests
│
├── relay/                  WakeLink Home Relay
│   ├── src/relay/          Orchestrator, WolExecutor, RelayIdentity
│   ├── src/network/        HttpWakeRelay (long-poll transport)
│   ├── src/interfaces/     WakeRelay interface (WebSocket upgrade path)
│   └── tests/              13 unit tests
│
├── backend/                Development backend (local, NOT production)
│   ├── src/routes/         devices, pairing, commands, wake, relay
│   ├── src/services/       WakeOnLanService
│   ├── src/store/          In-memory DeviceStore + RelayStore
│   └── tests/              59 integration tests
│
└── docs/
    ├── PHASE_2_ARCHITECTURE.md
    ├── PHASE_2_SETUP.md
    ├── PHASE_3_WAKE_ON_LAN.md
    └── PHASE_4_ARCHITECTURE.md
```

---

## Getting started

### Prerequisites

- Node.js ≥ 18
- npm ≥ 9
- Expo Go on your Android or iOS device

### 1. Install dependencies

```powershell
# Mobile app
cd WakeLink
npm install --legacy-peer-deps

# Backend
cd backend
npm install

# PC Agent
cd agent
npm install

# Home Relay
cd relay
npm install
```

### 2. Configure environment

**Mobile app** — create `.env` in the repo root:
```env
EXPO_PUBLIC_BACKEND_URL=http://<your-laptop-ip>:3001
EXPO_PUBLIC_USE_MOCK=false
```

**PC Agent** — copy `agent/.env.example` to `agent/.env`:
```env
WAKELINK_BACKEND_URL=http://localhost:3001
WAKELINK_WAKE_SUPPORTED=false   # true after BIOS + NIC config
WAKELINK_RELAY_ID=              # fill in after relay is running
```

**Home Relay** — copy `relay/.env.example` to `relay/.env`:
```env
WAKELINK_BACKEND_URL=http://localhost:3001
WAKELINK_RELAY_NAME=Home Relay
# WAKELINK_RELAY_ID and WAKELINK_RELAY_TOKEN are populated automatically on first run
```

**Backend** — copy `backend/.env.example` to `backend/.env`:
```env
PORT=3001
WOL_BROADCAST_ADDRESS=255.255.255.255
WOL_PORT=9
WOL_WAKE_TIMEOUT_MS=120000
```

### 3. Run everything

Open four terminals, run in order:

```powershell
# Terminal 1 — backend first
cd backend && npm run dev

# Terminal 2 — relay second
cd relay && npm run dev

# Terminal 3 — agent third
cd agent && npm run dev

# Terminal 4 — mobile app
npm start
```

Scan the QR code with Expo Go on your phone (same Wi-Fi as your laptop).

---

## Pairing your PC

On first agent startup you will see:
```
─────────────────────────────────────────
PAIRING CODE: XXXXXX
QR PAYLOAD:   {"type":"wakelink-pair",...}
Expires:      <5 minutes from now>
─────────────────────────────────────────
```

In the mobile app:
1. Tap **+ Add PC**
2. Tap **Enter code manually**
3. Enter the 6-character code
4. Give your PC a name
5. Tap **Add PC**

The agent terminal will confirm:
```
Command received: PAIR_CONFIRM
Pairing complete.
```

On subsequent restarts the agent shows `Pairing: PAIRED` and skips straight to connecting.

---

## Architecture

### Service registry pattern

Every screen imports services from `src/services/index.ts`. The registry selects real or mock services based on environment variables:

```
EXPO_PUBLIC_USE_MOCK=false  →  real API services (backed by dev backend)
EXPO_PUBLIC_USE_MOCK=true   →  mock services (no network, UI dev only)
```

To swap to a real cloud backend: change `EXPO_PUBLIC_BACKEND_URL` — nothing in the UI changes.

### Remote wake flow

```
Phone taps "Wake & Connect"
  │
  ▼
POST /api/devices/:id/wake
  │
  ├─ relay online? ──► queue RELAY_WAKE command
  │                        │
  │                    Home Relay polls backend
  │                    receives RELAY_WAKE
  │                    sends UDP magic packet (LAN broadcast)
  │                        │
  └─ no relay ──────► direct UDP broadcast (same LAN only)
                           │
                     Sleeping PC receives packet
                     PC boots
                     Agent starts → registers → heartbeat
                           │
                     Backend: WAKING → ONLINE
                           │
                     Mobile polls → sees ONLINE
                     Proceeds to session
```

### Home Relay architecture

The relay is a lightweight Node.js process that runs on any always-on device in the home network (a Raspberry Pi, NAS, or the PC itself while awake). It:

- Makes **outbound** HTTP connections only — no inbound ports required
- Works through NAT and CGNAT
- Authenticates with a hashed relay token
- Polls the backend for `RELAY_WAKE` commands every 5 seconds
- Sends the UDP magic packet locally (same LAN as the sleeping PC)

The `WakeRelay` interface allows a future WebSocket upgrade (zero latency vs 5-second poll) without changing any other code.

---

## Running tests

```powershell
# Agent — 61 tests
cd agent && npm test

# Backend — 59 tests
cd backend && npm test

# Relay — 13 tests
cd relay && npm test

# TypeScript checks
cd agent   && npx tsc --noEmit
cd backend && npx tsc --noEmit
cd relay   && npx tsc --noEmit
cd ..      && npx tsc --noEmit
```

Total: **133 tests passing**.

---

## Roadmap

### Phase 5 — Remote session layer ← next
- Implement `CONNECT_REQUEST` in PC Agent CommandHandler
- `RemoteSessionProvider` abstraction (RDP / WebRTC / Sunshine backend)
- Session lifecycle: REQUESTED → STARTING → READY → CONNECTED → ENDED
- Replace session placeholder screen with real session UI
- Session token + expiry + disconnect

### Phase 6 — Production infrastructure
- Real user authentication (OIDC / OAuth2 PKCE)
- Cloud backend (replacing dev backend)
- WebSocket relay transport (replacing long-poll)
- Windows Service installer for agent + relay
- Auto-start on boot

### Phase 7 — Hardware wake controller
- USB out-of-band power control
- Wakes PCs with WoL disabled or completely unpowered
- `HardwareWakeService` implementing existing `WakeService` interface

---

## Security notes

- **No port forwarding required** — all connections are outbound from agent and relay
- **No public RDP** — remote desktop is not yet exposed; when implemented it will be tunnelled
- **Relay tokens** are SHA-256 hashed in storage; raw tokens are never logged
- **Device identity** is a random UUID, never derived from hostname, IP, or username
- **Pairing codes** are 6-char alphanumeric, short-lived (5 min), single-use
- **Secrets** — never commit `.env` files; `.gitignore` excludes them

---

## Contributing

- New service: implement the interface in `src/services/`, register in `src/services/index.ts`
- New screen: add a file under `app/`, follow existing patterns
- New agent command: add to `CommandType` in `CommandHandler.ts`, implement the handler
- Design changes: all tokens are in `src/theme/index.ts`

---

## License

MIT
