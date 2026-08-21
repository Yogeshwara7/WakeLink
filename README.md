# WakeLink

Access your Windows PC from anywhere — even when it's sleeping.

WakeLink lets you remotely wake and connect to your personal Windows computer from your phone. Pair your PC once, and from that point forward you just tap Connect. No IP addresses. No router configuration. No VPN setup.

---

## The problem it solves

Most remote desktop solutions assume your PC is already on and reachable. WakeLink handles the full lifecycle — including waking a powered-off machine — through a single mobile interface that anyone can use.

---

## Current state

This repository contains the **mobile app MVP** built with mocked services.

The full user-facing flow works end to end:

- Onboarding
- View registered PCs with live status (Online / Offline / Waking / Connecting)
- Pair a new PC via QR code or manual entry code
- Tap Connect — watch the state machine run (wake request → waiting → online → connecting → connected)
- Placeholder remote session screen

**What is mocked:**
All backend calls, device status, wake requests, and connection sessions are simulated locally. There is no real PC Agent, no cloud backend, and no actual remote desktop yet.

**What is real:**
The complete UI, navigation, service interfaces, and architecture — designed so real implementations slot in without touching the screens.

---

## Stack

| Layer | Technology |
|---|---|
| Mobile | React Native (Expo SDK 51) |
| Navigation | expo-router v3 (file-based) |
| Language | TypeScript 5.3 |
| Styling | React Native StyleSheet (dark theme, design tokens) |
| State | React hooks + service subscriptions |
| Services | Interface-based with mock implementations |

---

## Getting started

```bash
git clone https://github.com/Yogeshwara7/WakeLink.git
cd WakeLink
npm install --legacy-peer-deps
npm start
```

Scan the QR code with **Expo Go** on your Android or iOS device.

> Your phone and laptop must be on the same Wi-Fi network for local development.

---

## Project structure

```
app/                        Expo Router screens (file-based routing)
  index.tsx                 Onboarding
  (tabs)/index.tsx          Home — device list
  device/[id].tsx           Device detail
  pair/index.tsx            Pair new PC flow
  connect/[id].tsx          Connection state machine
  session/[id].tsx          Remote session placeholder

src/
  models/                   TypeScript types — Device, ConnectionSession, PairingSession
  services/                 Service interfaces (DeviceService, WakeService, etc.)
  services/mock/            Mock implementations used today
  services/index.ts         ← Service registry. Swap implementations here.
  components/               Shared UI components
  store/                    React hooks for device state
  theme/                    Design tokens (colours, spacing, typography)
  utils/                    Status helpers, relative time
```

---

## Architecture

WakeLink uses a **service registry pattern**. Every screen imports from `src/services/index.ts` — never directly from mock files.

```ts
// src/services/index.ts
export const deviceService: DeviceService = new MockDeviceService();
export const wakeService: WakeService     = new MockWakeService();
export const connectionService: ConnectionService = new MockConnectionService(...);
export const pairingService: PairingService       = new MockPairingService(...);
```

To connect a real backend, replace the class on the right-hand side. Nothing in the UI changes.

---

## Planned architecture

```
                    WakeLink Cloud
                         |
           +-------------+-------------+
           |                           |
       Phone App                   PC Agent
           |                       (Windows)
           |
      Wake Controller
           |
    WoL / USB hardware controller
```

The **PC Agent** runs on Windows, maintains device identity, and connects to the cloud. The **Wake Controller** handles bringing the machine online — initially via Wake-on-LAN, with a future USB out-of-band hardware controller for machines that are fully powered off.

---

## Roadmap

### Phase 2 — PC Agent
- Windows background service (Node or .NET)
- Generates device identity and pairing token
- Connects to WakeLink Cloud via WebSocket
- Reports online/offline heartbeat

### Phase 3 — Cloud backend
- User accounts and authentication
- Device registration and pairing API
- Real-time device status (WebSocket / SSE)
- Wake request relay

### Phase 4 — Wake-on-LAN
- Cloud relays WoL magic packet via the local network agent
- `waitForOnline` polls real heartbeat endpoint

### Phase 5 — Remote session
- Replace placeholder session screen with real RDP or streaming stack
- Keyboard / mouse / clipboard passthrough

### Phase 6 — Hardware wake controller
- USB device providing out-of-band power control
- Handles machines with WoL disabled or completely unpowered

---

## Contributing

The codebase is intentionally modular. If you want to work on a specific layer:

- **New service implementation** — implement the interface in `src/services/`, register it in `src/services/index.ts`
- **New screen** — add a file under `app/`, follow existing patterns
- **Design changes** — all tokens are in `src/theme/index.ts`

---

## License

MIT
