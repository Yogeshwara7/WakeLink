# WakeLink Phase 2 — Setup Guide

> ⚠️ The dev backend is for **local development only**.
> It has no authentication, no TLS, and no persistent storage.
> Never expose port 3001 to the internet.

---

## Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js | ≥ 18 | `node --version` |
| npm | ≥ 9 | `npm --version` |
| Git | any | `git --version` |

---

## Repository layout

```
Changes/Hobby/
├── WakeLink/              Mobile app (existing)
├── wakelink-agent/        PC Agent  (Phase 2)
└── wakelink-dev-backend/  Dev backend (Phase 2)
```

---

## 1. Install dependencies

Open three terminal windows — one per project.

**Terminal 1 — Dev backend**
```powershell
cd C:\Changes\Hobby\wakelink-dev-backend
npm install
```

**Terminal 2 — PC Agent**
```powershell
cd C:\Changes\Hobby\wakelink-agent
npm install
```

**Terminal 3 — Mobile app** (already installed, just for reference)
```powershell
cd C:\Changes\Hobby\WakeLink
npm install --legacy-peer-deps
```

---

## 2. Configure the PC Agent

Copy the example config:
```powershell
cd C:\Changes\Hobby\wakelink-agent
Copy-Item .env.example .env
```

The defaults work for local development — no changes needed:
```
WAKELINK_BACKEND_URL=http://localhost:3001
WAKELINK_HEARTBEAT_INTERVAL_MS=30000
WAKELINK_PAIRING_EXPIRY_MS=300000
```

---

## 3. Start the dev backend

**Terminal 1:**
```powershell
cd C:\Changes\Hobby\wakelink-dev-backend
npm run dev
```

Expected output:
```
╔════════════════════════════════════════╗
║   WakeLink Dev Backend                 ║
║   ⚠️  DEVELOPMENT ONLY — not for prod  ║
║   Listening on http://127.0.0.1:3001   ║
╚════════════════════════════════════════╝
```

---

## 4. Start the PC Agent

**Terminal 2:**
```powershell
cd C:\Changes\Hobby\wakelink-agent
npm run dev
```

Expected output (first run — device is UNPAIRED):
```
[...] [INFO ] WakeLink Agent starting...
[...] [INFO ] Agent version: 0.1.0
[...] [INFO ] Device ID:   xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
[...] [INFO ] Device Name: YOUR-PC-NAME
[...] [INFO ] Pairing:     UNPAIRED
[...] [INFO ] ─────────────────────────────────────────
[...] [INFO ] PAIRING CODE: ABC123
[...] [INFO ] QR PAYLOAD:   {"type":"wakelink-pair","version":1,...}
[...] [INFO ] Expires:      2026-XX-XXTXX:XX:XXZ
[...] [INFO ] ─────────────────────────────────────────
[...] [INFO ] Open WakeLink on your phone and pair this device.
[...] [INFO ] Agent state: INITIALISING → UNPAIRED
[...] [INFO ] Agent state: UNPAIRED → PAIRING
[...] [INFO ] Pairing session registered with backend
[...] [INFO ] Agent state: PAIRING → CONNECTING
[...] [INFO ] Connected to development backend
[...] [INFO ] Agent state: CONNECTING → ONLINE
[...] [INFO ] Heartbeat started (interval: 30s)
[...] [INFO ] Heartbeat sent
```

Expected output (subsequent runs — device already PAIRED):
```
[...] [INFO ] WakeLink Agent starting...
[...] [INFO ] Device ID:   xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx  ← same ID
[...] [INFO ] Pairing:     PAIRED
[...] [INFO ] Connected to development backend
[...] [INFO ] Heartbeat started (interval: 30s)
[...] [INFO ] Heartbeat sent
```

The device ID is **stable** — it never changes between restarts.

---

## 5. Verify the backend sees the agent

```powershell
# Health check
Invoke-WebRequest -Uri http://localhost:3001/health | Select-Object -ExpandProperty Content

# Device list
Invoke-WebRequest -Uri http://localhost:3001/api/devices | Select-Object -ExpandProperty Content

# Full debug state
Invoke-WebRequest -Uri http://localhost:3001/debug | Select-Object -ExpandProperty Content
```

Or with curl:
```bash
curl http://localhost:3001/health
curl http://localhost:3001/api/devices
curl http://localhost:3001/debug
```

---

## 6. Test pairing

### Step 1 — Get the pairing code from the agent terminal
Note the `PAIRING CODE` shown in the agent output (e.g. `ABC123`).

### Step 2 — Simulate the mobile app submitting the code

```powershell
$body = '{"pairingCode":"ABC123"}'
Invoke-WebRequest -Method POST -Uri http://localhost:3001/api/pairing/start `
  -ContentType "application/json" -Body $body | Select-Object -ExpandProperty Content
```

Note the `sessionId` in the response.

### Step 3 — Complete pairing (simulates user naming the PC)

```powershell
$body = '{"sessionId":"<sessionId-from-step-2>","userId":"test-user-001","deviceName":"My Home PC"}'
Invoke-WebRequest -Method POST -Uri http://localhost:3001/api/pairing/complete `
  -ContentType "application/json" -Body $body | Select-Object -ExpandProperty Content
```

### Step 4 — Agent picks up the PAIR_CONFIRM command

The agent polls `GET /api/devices/:deviceId/commands/pending` and will process
the `PAIR_CONFIRM` command automatically. Check agent terminal for:
```
[...] [INFO ] Command received: PAIR_CONFIRM (...)
[...] [INFO ] Pairing complete. Paired with user: [userId redacted from logs]
[...] [INFO ] Command completed: PAIR_CONFIRM (...)
```

---

## 7. Test PING command

```powershell
# Replace <deviceId> with the Device ID shown in the agent terminal
$deviceId = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
$body = '{"type":"PING","payload":{}}'
Invoke-WebRequest -Method POST `
  -Uri "http://localhost:3001/api/devices/$deviceId/commands" `
  -ContentType "application/json" -Body $body | Select-Object -ExpandProperty Content
```

Check agent terminal for:
```
[...] [INFO ] Command received: PING (...)
[...] [INFO ] Command completed: PING (...)
```

---

## 8. Test STATUS_REQUEST command

```powershell
$body = '{"type":"STATUS_REQUEST","payload":{}}'
Invoke-WebRequest -Method POST `
  -Uri "http://localhost:3001/api/devices/$deviceId/commands" `
  -ContentType "application/json" -Body $body | Select-Object -ExpandProperty Content
```

---

## 9. Test heartbeat

The agent sends a heartbeat every 30 seconds by default. Watch the agent terminal:
```
[...] [INFO ] Heartbeat sent
[...] [INFO ] Heartbeat sent    ← 30 seconds later
```

Check the backend recorded it:
```powershell
Invoke-WebRequest -Uri "http://localhost:3001/api/devices/$deviceId" | Select-Object -ExpandProperty Content
```

Look for `"status": "ONLINE"` and a recent `"lastHeartbeatAt"`.

---

## 10. Run unit tests

```powershell
cd C:\Changes\Hobby\wakelink-agent
npm test
```

Expected: **45 tests passing** across 4 suites:
- `identity.test.ts` — 8 tests
- `pairing.test.ts` — 12 tests
- `commands.test.ts` — 14 tests
- `heartbeat.test.ts` — 11 tests

---

## 11. Build for production

```powershell
# Agent
cd C:\Changes\Hobby\wakelink-agent
npm run build
# Output: dist/index.js — run with: node dist/index.js

# Backend
cd C:\Changes\Hobby\wakelink-dev-backend
npm run build
# Output: dist/index.js — run with: node dist/index.js
```

---

## 12. Stop everything

- **Agent:** `Ctrl+C` in Terminal 2 (graceful shutdown via SIGINT)
- **Backend:** `Ctrl+C` in Terminal 1

The agent logs `Agent stopped.` on clean shutdown.

---

## 13. Reset the agent (re-pair from scratch)

Delete the identity file:
```powershell
Remove-Item "$env:LOCALAPPDATA\WakeLink\wakelink-data.json"
```

Or on non-Windows:
```bash
rm ~/.wakelink/wakelink-data.json
```

The agent will generate a new device ID on next start.

---

## Troubleshooting

| Issue | Cause | Fix |
|---|---|---|
| `ECONNREFUSED` in agent | Backend not running | Start dev backend first |
| Agent shows OFFLINE | Backend not reachable | Check Terminal 1 is running |
| Same PAIRING CODE shown again | Unexpired session reused | Wait 5 min or delete wakelink-data.json |
| Heartbeat warnings | Backend stopped | Restart backend; agent auto-reconnects |
| `tsc` errors | Node type mismatch | Run `npm install` again |
