# WakeLink Phase 6 — VNC WebSocket Proxy

## Architecture diagram

```
Mobile App (Expo Go)
  │
  │  WebView → noVNC JavaScript (loaded from CDN)
  │
  │  WebSocket  ws://192.168.1.3:3001/api/sessions/<sessionId>/ws?token=<sessionToken>
  ▼
WakeLink Dev Backend (Node.js, port 3001)
  │
  │  VncProxy.handleUpgrade()
  │    1. Extracts sessionId from URL path
  │    2. Validates session exists, not expired, status READY/CONNECTED
  │    3. Validates sessionToken (timing-safe comparison)
  │    4. Checks vncHost is in WAKELINK_VNC_ALLOWED_HOSTS (SSRF guard)
  │    5. Completes WebSocket handshake
  │    6. Opens TCP connection to vncHost:vncPort
  │    7. Bridges bytes bidirectionally
  │
  │  TCP  127.0.0.1:5900
  ▼
VNC Server (TightVNC / UltraVNC / RealVNC — installed separately)
  │
  ▼
Windows Desktop
```

---

## Connection sequence

```
Phone                       Backend                    Agent              VNC Server
  │                            │                          │                    │
  │  POST /devices/:id/connect │                          │                    │
  │──────────────────────────► │                          │                    │
  │  { sessionId, sessionToken}│                          │                    │
  │◄──────────────────────────│                          │                    │
  │                            │  CONNECT_REQUEST queued  │                    │
  │                            │─────────────────────────►│                    │
  │                            │                          │ startSession()     │
  │                            │                          │ TCP probe :5900    │
  │                            │                          │────────────────────►
  │                            │                          │◄────────────────────
  │                            │  POST /agent-ready       │                    │
  │  GET /sessions/:id (poll)  │◄─────────────────────────│                    │
  │──────────────────────────► │                          │                    │
  │  { status: "READY" }       │                          │                    │
  │◄──────────────────────────│                          │                    │
  │                            │                          │                    │
  │  WS UPGRADE                │                          │                    │
  │  /api/sessions/:id/ws      │                          │                    │
  │  ?token=<sessionToken>     │                          │                    │
  │──────────────────────────► │                          │                    │
  │                            │  validate + TCP connect  │                    │
  │                            │─────────────────────────────────────────────► │
  │                            │◄──────────────────────────────────────────────│
  │  101 Switching Protocols   │                          │                    │
  │◄──────────────────────────│                          │                    │
  │                            │                          │                    │
  │  ◄══ VNC protocol frames ══════════════════════════════════════════════════►
  │         (bidirectional byte relay — no protocol parsing)
  │                            │                          │                    │
  │  Disconnect                │                          │                    │
  │──────────────────────────► │ WS close                 │                    │
  │                            │─────────────────────────────────────────────► │
  │                            │ TCP destroy              │                    │
  │                            │ status → ENDED           │                    │
```

---

## WebSocket lifecycle

| Event | What happens |
|---|---|
| `upgrade` request received | Extract sessionId + token from URL |
| Validation fails | Send HTTP error response, destroy socket |
| Validation passes | Complete WS handshake, open TCP to VNC |
| TCP connected | `session.status = 'CONNECTED'` |
| TCP fails | `session.status = 'FAILED'`, close WS with 1011 |
| `ws.message` | Forward raw bytes → `tcp.write()` |
| `tcp.data` | Forward raw bytes → `ws.send()` |
| `ws.close` | Destroy TCP socket, `session.status = 'ENDED'` |
| `tcp.close` | Close WS, `session.status = 'CONNECTION_LOST'` |
| `tcp.error` | Close WS with 1011, `session.status = 'FAILED'` |
| `ws.error` | Destroy TCP socket |

---

## TCP lifecycle

The proxy is a **transparent byte relay**. It does NOT:
- Parse VNC protocol messages
- Handle VNC authentication
- Inspect or modify the byte stream

noVNC handles the full VNC handshake and authentication directly with
the VNC server through the forwarded byte stream. The VNC password is
exchanged between noVNC and the VNC server — it never passes through
WakeLink application code.

---

## Authentication model

### Session token

```
POST /api/devices/:id/connect
  → backend creates StoredSession
  → generates sessionToken (UUID v4, ~73 chars of entropy)
  → returns { sessionId, sessionToken } to mobile
  → sessionToken stored in StoredSession (server-side)

GET /api/sessions/:id/ws?token=<sessionToken>
  → proxy extracts token from query string
  → crypto.timingSafeEqual(submitted, stored)
  → if mismatch → HTTP 401, socket destroyed

noVNC receives the wsUrl including the token.
The token is embedded in the WS URL and is only transmitted over
the existing LAN connection (development) or TLS (production).
```

**Token scope:** One token per session. Each `/connect` call generates
a fresh token. The token is never returned after the initial response.
The GET `/api/sessions/:id` endpoint deliberately omits `sessionToken`.

### What the token protects

- Prevents unauthenticated WebSocket connections from opening VNC tunnels
- Ties the WS connection to a specific session
- Short-lived: expires with the session (SESSION_TTL_MS, default 1h)

---

## Session state transitions

```
REQUESTED   ← POST /connect creates session
    │
    ▼
(STARTING)  ← reserved for future explicit agent ack
    │
    ▼
READY       ← agent POSTs /agent-ready with connectionInfo
    │
    ▼ WS upgrade accepted + TCP connected
CONNECTED
    │
    ├──► ENDED           (clean disconnect by mobile or agent)
    ├──► CONNECTION_LOST (TCP server closed unexpectedly)
    └──► FAILED          (TCP error)
```

States that block WS upgrade: `REQUESTED`, `STARTING`, `FAILED`, `TIMEOUT`, `ENDED`, `DISCONNECTING`

---

## Security boundaries

### SSRF protection

The VNC host and port are sourced **exclusively** from `session.connectionInfo`
(set by the agent via `POST /api/sessions/:id/agent-ready`).

The WebSocket client **cannot** specify or override the VNC destination.
Any URL parameters for host/port are silently ignored.

Additionally, `WAKELINK_VNC_ALLOWED_HOSTS` restricts which hosts the proxy
will connect to, even if the agent reported an unexpected value:

```
Default: localhost,127.0.0.1,::1
```

Attempts to proxy to disallowed hosts return HTTP 403 and the socket
is destroyed before any TCP connection is opened.

This prevents the endpoint from becoming an open TCP proxy or SSRF vector.

### Security boundaries summary

| Threat | Mitigation |
|---|---|
| Unauthenticated WS | sessionToken required (timing-safe comparison) |
| Expired session | `session.expiresAt` checked before WS accept |
| Replay of sessionToken | Token is session-scoped, expires with session |
| SSRF via arbitrary host/port | Client cannot set destination; ALLOWED_HOSTS enforced |
| VNC exposed to internet | VNC only reachable via authenticated WS proxy on localhost |
| VNC password in logs | noVNC handles auth directly; proxy is transparent |
| Token in logs | Token never logged anywhere in the proxy or session routes |

---

## VNC configuration

### Install a VNC server (one-time, manual)

**TightVNC** (recommended, free):
https://www.tightvnc.com/download.php

**UltraVNC** (free):
https://uvnc.com/downloads/ultravnc.html

After installation:
1. Set a VNC password in the server settings
2. Ensure it listens on `127.0.0.1:5900`
3. Start the VNC server

### Agent configuration (`agent/.env`)

```env
WAKELINK_SESSION_PROVIDER=vnc
WAKELINK_VNC_HOST=localhost
WAKELINK_VNC_PORT=5900
```

### Backend configuration (`backend/.env`)

```env
# Hosts the proxy may connect to (SSRF protection)
WAKELINK_VNC_ALLOWED_HOSTS=localhost,127.0.0.1,::1

# Session TTL
SESSION_TTL_MS=3600000
```

---

## Local testing procedure

### Prerequisites

- Backend running: `cd backend && npm run dev`
- Agent running with VNC provider: set `WAKELINK_SESSION_PROVIDER=vnc` in `agent/.env`, then `cd agent && npm run dev`
- VNC server running on `127.0.0.1:5900`
- Agent is PAIRED (complete pairing first if needed)
- Mobile app running: `npm start` in repo root
- Phone on same Wi-Fi as laptop
- `.env` in repo root: `EXPO_PUBLIC_BACKEND_URL=http://192.168.1.3:3001`

### Steps

1. Open WakeLink on your phone
2. Tap **DESKTOP-FU9G7HS** (your paired PC)
3. Tap **Connect**
4. Watch `connect/[id].tsx` state machine:
   ```
   Checking PC → PC Online → Requesting session → Starting session → Connected
   ```
5. Backend log should show:
   ```
   [SESSION] Created: <id>
   [SESSION] CONNECT_REQUEST queued
   [SESSION] Ready: <id> (vnc)
   [VncProxy] TCP connected → 127.0.0.1:5900
   ```
6. Agent log should show:
   ```
   Command received: CONNECT_REQUEST
   [VncSession] Starting VNC session
   [VncSession] Session ready: <id>
   Command completed: CONNECT_REQUEST
   ```
7. Mobile session screen appears with noVNC WebView
8. noVNC authenticates with VNC password (standard VNC auth dialog may appear)
9. Windows desktop visible on phone
10. Test mouse: tap anywhere on the remote screen
11. Test keyboard: tap keyboard icon → type
12. Tap **Disconnect** → confirm
13. Backend log: `[VncProxy] WS closed → status ENDED`

### Verifying the proxy is active

```powershell
# Backend health check — should show activeSessions: 1 while connected
Invoke-RestMethod http://localhost:3001/health | ConvertTo-Json
```

```powershell
# Debug endpoint — shows full session state
Invoke-RestMethod http://localhost:3001/debug | ConvertTo-Json -Depth 4
```

---

## Wake path vs session path

These are two separate flows. Do NOT mix them.

**Wake path** (Phase 3 + 4):
```
Phone → Backend → Home Relay → UDP broadcast → Sleeping PC boots
```
Used when: PC is OFFLINE and needs to be powered on.

**Session path** (Phase 5 + 6):
```
Phone → Backend WS proxy → VNC server → Windows desktop
```
Used when: PC is ONLINE and needs a remote session.

The session path requires the PC to already be ONLINE (agent registered,
heartbeat active). If the PC is offline, the connection state machine
in `ApiConnectionService` runs the wake flow first.

---

## Known limitations

| Limitation | Details |
|---|---|
| **LAN only** | `ws://` (not `wss://`) works on LAN. Internet access requires the Home Relay to carry the session (Phase 7) or a cloud proxy with TLS. |
| **VNC manual install** | TightVNC/UltraVNC must be installed manually. Auto-install is out of scope. |
| **No clipboard** | VNC clipboard sync is supported by the VNC protocol but noVNC's clipboard integration requires additional mobile browser permissions not available in the current WebView setup. |
| **No audio** | VNC is display + input only. Audio streaming is out of scope. |
| **Touch input basic** | Mobile touch events map to mouse clicks/drag. Multi-touch, pinch-zoom, and optimised mobile input are Phase 8. |
| **Single display** | Multi-monitor is not yet configured. noVNC connects to the primary display. |
| **No TLS in dev** | The proxy runs over `ws://` in the development environment. Production requires `wss://` with a TLS terminator in front of the backend. |

---

## Phase 7 roadmap

1. **TLS / WSS** — add HTTPS/WSS to the backend for production use
2. **Internet session relay** — route WS proxy through the Home Relay so the session works when phone is on cellular
3. **Real authentication** — replace `pending-auth` with JWT/OIDC session token
4. **Windows Service installer** — auto-start agent + VNC on boot
5. **VNC password management** — securely inject VNC password from agent config (avoid manual entry in noVNC dialog)
6. **Touch input optimisation** — virtual trackpad mode for mobile
7. **Clipboard passthrough** — VNC clipboard ↔ mobile clipboard
