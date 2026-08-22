# WakeLink Phase 3 — Wake-on-LAN

> **Scope:** Wake-on-LAN only wakes the PC.
> Remote desktop streaming is **not** implemented in Phase 3.

---

## Architecture

```
Mobile App
   │
   │  Tap "Wake & Connect"
   │
   ▼
ApiWakeService.sendWakeRequest(deviceId)
   │
   │  POST /api/devices/:id/wake
   ▼
Backend — WakeOnLanService
   │
   │  UDP broadcast: magic packet (102 bytes)
   │  to WOL_BROADCAST_ADDRESS:WOL_PORT
   ▼
Network (LAN broadcast)
   │
   ▼
Sleeping / powered-off PC
   │  (NIC receives magic packet while on standby power)
   │
   ▼
PC boots → Windows starts → WakeLink Agent starts
   │
   │  POST /api/devices/:id/heartbeat
   ▼
Backend — heartbeat handler
   │  Cancels wake timeout
   │  device.status     = 'ONLINE'
   │  device.wakeStatus = 'ONLINE'
   ▼
Mobile app polls GET /api/devices/:id
   │  sees status === 'ONLINE'
   ▼
Connection state machine continues:
   PC Online → Connecting → Connected (placeholder)
```

---

## Wake sequence (step by step)

| Step | Actor | Action |
|------|-------|--------|
| 1 | Mobile app | User taps "Wake & Connect" |
| 2 | `ApiWakeService` | `POST /api/devices/:id/wake` |
| 3 | Backend `/wake` route | Validates device, MAC, `wakeSupported` |
| 4 | `WakeOnLanService` | Builds 102-byte magic packet, sends via UDP broadcast |
| 5 | Backend | Sets `device.status = 'WAKING'`, starts timeout timer |
| 6 | Backend | Returns `{ wakeStatus: 'WAKING' }` immediately |
| 7 | Mobile app | `ApiWakeService.waitForOnline()` polls `GET /api/devices/:id` every 5 s |
| 8 | PC | Receives magic packet, boots, Windows starts |
| 9 | PC Agent | Starts automatically, calls `POST /api/devices/:id/heartbeat` |
| 10 | Backend heartbeat | Cancels wake timeout, sets `status = 'ONLINE'`, `wakeStatus = 'ONLINE'` |
| 11 | Mobile app | Poll sees `status === 'ONLINE'`, continues to connection flow |

If no heartbeat arrives within `WOL_WAKE_TIMEOUT_MS` (default: 120 s):
- `device.status` → `'OFFLINE'`
- `device.wakeStatus` → `'FAILED'`
- `ApiWakeService.waitForOnline()` throws a descriptive error shown in the app

---

## BIOS/UEFI setup checklist

Complete all steps on the target Windows PC before enabling WoL.

- [ ] **Enter BIOS/UEFI** (typically Del, F2, or F12 on boot)
- [ ] Find the power or network section — look for:
  - "Wake on LAN"
  - "Power On By PCIe/PCI"
  - "Resume By LAN"
  - "Wake on PCI-E"
- [ ] **Enable** the relevant setting
- [ ] Save and exit

> Different manufacturers label this differently. Check your motherboard manual if the exact setting is not obvious.

---

## Windows network adapter settings

1. Open **Device Manager** (Win + X → Device Manager)
2. Expand **Network Adapters**
3. Right-click your Ethernet adapter → **Properties**
4. Click the **Power Management** tab
5. Check:
   - **Allow this device to wake the computer**
   - **Only allow a magic packet to wake the computer** (recommended)
6. Click **OK**

Also check the **Advanced** tab for:
- **Wake on Magic Packet** → **Enabled**
- **Wake on Pattern Match** → as needed

> **Laptops:** Most laptop Wi-Fi adapters do NOT support Wake-on-LAN.
> Use a wired Ethernet connection for reliable WoL.
> The laptop may also need to be plugged in to mains power.

---

## Agent configuration

In `agent/.env` (copied from `agent/.env.example`):

```env
# Set to true ONLY after completing BIOS and Windows NIC setup above
WAKELINK_WAKE_SUPPORTED=true
```

When `WAKELINK_WAKE_SUPPORTED=true`, the agent includes:
- `wakeSupported: true` in the registration payload
- The primary adapter's MAC address

The backend will refuse wake requests for devices with `wakeSupported: false`.

---

## Backend environment variables

In `backend/.env` (copied from `backend/.env.example`):

```env
# UDP broadcast address
# 255.255.255.255 = local network broadcast (works for most setups)
# Use subnet broadcast (e.g. 192.168.1.255) for routed networks
WOL_BROADCAST_ADDRESS=255.255.255.255

# UDP port (standard: 9)
WOL_PORT=9

# How long to wait for a heartbeat after wake packet (milliseconds)
WOL_WAKE_TIMEOUT_MS=120000
```

---

## Local testing instructions

### Prerequisites
- Backend running (`npm run dev` in `backend/`)
- Agent running (`npm run dev` in `agent/`) on the target PC
- Agent `.env` has `WAKELINK_WAKE_SUPPORTED=true`
- BIOS and NIC configured as above

### Step 1 — Confirm the agent registered its MAC

```powershell
Invoke-RestMethod -Uri http://localhost:3001/api/devices -Method GET |
  ConvertTo-Json -Depth 4
```

Look for:
```json
"macAddress": "AA:BB:CC:DD:EE:FF",
"wakeSupported": true
```

### Step 2 — Put the PC to sleep or shut it down

```powershell
# Sleep:
rundll32.exe powrprof.dll,SetSuspendState 0,1,0

# Or shut down:
Stop-Computer -Force
```

### Step 3 — Send a wake request

Replace `<deviceId>` with the Device ID shown when the agent started.

```powershell
$deviceId = "<deviceId>"
Invoke-RestMethod -Uri "http://localhost:3001/api/devices/$deviceId/wake" `
  -Method POST -ContentType "application/json" -Body '{}' |
  ConvertTo-Json
```

Expected response:
```json
{
  "success": true,
  "wakeStatus": "WAKING",
  "deviceId": "...",
  "lastWakeRequestedAt": "...",
  "message": "Wake packet sent. Polling /api/devices/:id until status is ONLINE."
}
```

### Step 4 — Watch the backend

```powershell
# Poll device status every 5 seconds
while ($true) {
  $r = Invoke-RestMethod "http://localhost:3001/api/devices/$deviceId"
  Write-Host "$([datetime]::Now.ToString('HH:mm:ss'))  status=$($r.device.status)  wakeStatus=$($r.device.wakeStatus)"
  Start-Sleep 5
}
```

Expected sequence:
```
10:00:01  status=WAKING   wakeStatus=WAKING
10:00:06  status=WAKING   wakeStatus=WAKING
...
10:01:23  status=ONLINE   wakeStatus=ONLINE    ← agent heartbeat arrived
```

### Step 5 — Verify from the health endpoint

```powershell
Invoke-RestMethod http://localhost:3001/health | ConvertTo-Json
```

`devicesOnline` should be `1`.

---

## Running the tests

```powershell
# Backend tests (33 tests: WakeOnLanService + route integration)
cd backend
npm test

# Agent tests (45 tests: identity, pairing, commands, heartbeat)
cd agent
npm test

# TypeScript checks
cd backend && npx tsc --noEmit
cd agent   && npx tsc --noEmit
cd ..      && npx tsc --noEmit   # mobile app
```

---

## Files created / modified in Phase 3

### Created
| File | Purpose |
|------|---------|
| `backend/src/services/WakeOnLanService.ts` | Magic packet builder + UDP sender |
| `backend/src/routes/wake.ts` | `POST /api/devices/:id/wake` route |
| `backend/tests/wakeOnLanService.test.ts` | 21 unit tests for WakeOnLanService |
| `backend/tests/wakeRoute.test.ts` | 12 integration tests for wake + heartbeat routes |
| `backend/jest.config.js` | Jest configuration for backend |
| `backend/.env.example` | WOL environment variable documentation |
| `docs/PHASE_3_WAKE_ON_LAN.md` | This document |

### Modified
| File | Change |
|------|--------|
| `src/models/Device.ts` | Added `macAddress?`, `wakeSupported?`, `wakeStatus?`, `lastWakeRequestedAt?` |
| `backend/src/store/DeviceStore.ts` | Added `WAKING`/`FAILED` to status enum; `startWakeTimeout()`, `cancelWakeTimeout()` |
| `backend/src/routes/devices.ts` | Registration accepts `macAddress`/`wakeSupported`; heartbeat handles `WAKING→ONLINE` transition |
| `backend/src/index.ts` | Added wake route; `listen()` guarded by `require.main===module` |
| `backend/package.json` | Added `test` script, `jest`/`supertest` dev dependencies |
| `agent/src/network/ConnectionManager.ts` | Registration payload includes `macAddress` and `wakeSupported` |
| `agent/.env.example` | Added `WAKELINK_WAKE_SUPPORTED` |
| `src/services/api/ApiWakeService.ts` | `sendWakeRequest` → `POST /wake`; `waitForOnline` checks `wakeStatus` |
| `tsconfig.json` (root) | Excluded `agent/` and `backend/` from mobile compilation scope |

---

## Known limitations

### Hardware constraints

| Limitation | Detail |
|-----------|--------|
| **LAN only (Phase 3)** | Magic packets are UDP broadcast — they do not cross routers by default. Both the sending backend and the target PC must be on the same subnet, OR the router must support directed broadcast. |
| **Wi-Fi unreliable** | Most Wi-Fi adapters do not support Wake-on-LAN. Use wired Ethernet. |
| **Completely powered off** | Some PCs disable WoL when fully powered off (not just sleeping). This is a BIOS setting. |
| **Laptop + battery** | Most laptops disable WoL on battery power. Connect to mains. |
| **Fast Startup** | Windows "Fast Startup" / Hybrid Sleep may interfere. Disable in Power Options if WoL is unreliable. |
| **Windows Defender Firewall** | Can block the agent from registering heartbeats after boot. Add an inbound rule if needed. |

### Software constraints

| Limitation | Detail |
|-----------|--------|
| **Internet WoL not implemented** | Phase 3 works on local networks only. Internet WoL requires a cloud relay (Phase 4). |
| **Single MAC address** | The agent reports the first active NIC. Multi-NIC machines may need manual configuration in a future version. |
| **Agent auto-start not configured** | The WakeLink Agent does not automatically start with Windows yet. Set it up manually via Task Scheduler or as a Windows Service (Phase 4). |
| **wakeSupported manual opt-in** | `WAKELINK_WAKE_SUPPORTED` must be set manually in `.env` after hardware validation. |

---

## Future work (Phase 4+)

- **Cloud WoL relay** — for waking PCs over the internet without local network access
- **Always-on home relay** — Raspberry Pi or router plugin that remains powered and can broadcast magic packets
- **Agent auto-start** — Windows Service or Task Scheduler registration
- **Multi-NIC support** — let the user choose which adapter to use for WoL
- **USB hardware wake controller** — out-of-band power control for completely powered-off machines
