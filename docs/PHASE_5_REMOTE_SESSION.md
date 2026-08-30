# WakeLink Phase 5 — Remote Session Layer

> **Scope:** This phase implements the full session lifecycle including
> CONNECT_REQUEST handling in the agent and a real WebView-based session
> screen. Remote desktop streaming requires VNC to be installed separately.
> Phase 5 does NOT implement a custom video codec or audio.

---

## Architecture selected: noVNC over WebSocket proxy

### Why this was chosen

| Option | Reason rejected / accepted |
|---|---|
| Custom streaming protocol | Too complex for MVP; no reuse of existing tech |
| WebRTC | Requires STUN/TURN infrastructure and native RN module |
| RDP directly | Exposes RDP to internet — security risk |
| Moonlight/Sunshine | Excellent but requires a separate app on mobile |
| **noVNC + WS proxy** | **✅ Runs in WebView (no native module), VNC is free + battle-tested, WS proxy fits existing backend pattern** |

### How it works

```
Mobile (Expo Go / WebView)
  │
  │  ws://backend/api/sessions/:id/ws?token=<sessionToken>
  ▼
WakeLink Backend (WebSocket proxy — Phase 6 implementation)
  │
  │  TCP to localhost:5900
  ▼
VNC Server (TightVNC / UltraVNC / RealVNC on Windows PC)
  │
  ▼
Windows Desktop
```

The noVNC HTML page is served as an inline string within the WebView.
It loads the noVNC JavaScript library from a CDN and connects to the
backend WebSocket proxy. The proxy bridges the WebSocket connection to
the local VNC server TCP port.

**The VNC server is never exposed to the public internet.**
All access goes through the WakeLink backend WebSocket proxy which
validates the short-lived `sessionToken` before allowing the connection.

---

## Session lifecycle

```
Mobile taps Connect
  │
  ▼
POST /api/devices/:id/connect
  │  Creates StoredSession (status: REQUESTED)
  │  Queues CONNECT_REQUEST command for agent
  │  Returns { sessionId, sessionToken }
  ▼
Agent CommandPoller picks up CONNECT_REQUEST
  │
  ▼
CommandHandler.handleConnectRequest()
  │  Validates device is PAIRED
  │  Calls RemoteSessionProvider.startSession()
  │
  ├─ MockSessionProvider: instant, returns synthetic info
  └─ VncSessionProvider:  probes localhost:5900, returns VNC info
  │
  ▼
POST /api/sessions/:id/agent-ready
  │  { connectionInfo: { wsProxyPath, vncHost, vncPort, sessionType } }
  ▼
Backend: session status → READY
  │
  ▼
Mobile polls GET /api/sessions/:id
  │  status === READY
  ▼
connect/[id].tsx navigates to session/[id].tsx
  │  passes sessionId, sessionToken, wsProxyPath, sessionType as URL params
  ▼
session/[id].tsx renders WebView
  │  loads noVNC HTML → connects ws://backend/...?token=<sessionToken>
  ▼
User sees remote desktop

DISCONNECT:
  Mobile taps Disconnect
  │
  POST /api/sessions/:id/disconnect
  │  Status → DISCONNECTING
  │  Queues DISCONNECT_REQUEST for agent
  ▼
  Agent: stops VNC session, POST /api/sessions/:id/ended
  ▼
  Status → ENDED, mobile navigates home
```

---

## Session state model

```
REQUESTED   → session created, CONNECT_REQUEST queued
STARTING    → (reserved for future explicit agent acknowledgement)
READY       → agent reported VNC ready, mobile can connect
CONNECTED   → WebView connected (tracked client-side)
DISCONNECTING → disconnect requested
ENDED       → cleanly terminated
FAILED      → agent reported error starting session
TIMEOUT     → session expired (SESSION_TTL_MS exceeded)
```

---

## Components

### Backend (`backend/src/routes/sessions.ts`)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/devices/:id/connect` | POST | Create session, queue CONNECT_REQUEST |
| `/api/sessions/:id` | GET | Poll session status |
| `/api/sessions/:id/agent-ready` | POST | Agent reports READY or FAILED |
| `/api/sessions/:id/disconnect` | POST | Request disconnect, queue DISCONNECT_REQUEST |
| `/api/sessions/:id/ended` | POST | Agent confirms session ended |

### Agent (`agent/src/session/`)

| File | Purpose |
|---|---|
| `RemoteSessionProvider.ts` | Interface — transport-agnostic session abstraction |
| `MockSessionProvider.ts` | Default — no VNC needed, returns synthetic info |
| `VncSessionProvider.ts` | Production — probes local VNC server on port 5900 |
| `createSessionProvider.ts` | Factory — selects provider from `WAKELINK_SESSION_PROVIDER` env |

`CommandHandler` now implements:
- `CONNECT_REQUEST` — validates PAIRED, calls provider, reports to backend
- `DISCONNECT_REQUEST` — calls provider.stopSession(), notifies backend

### Mobile (`app/session/[id].tsx`)

When `sessionType !== 'mock'` and `wsProxyPath` is present:
- Renders a `WebView` with inline noVNC HTML
- noVNC connects to `ws://backend/api/sessions/:id/ws?token=<sessionToken>`
- WebView messages: `CONNECTED`, `DISCONNECTED`, `CONNECTION_LOST`, `ERROR`
- Controls: LIVE badge, timer, Disconnect button, toolbar

When `sessionType === 'mock'` or no session params:
- Renders the development placeholder with session metadata

---

## Security model

| Concern | Implementation |
|---|---|
| VNC not exposed | Only accessible via WS proxy authenticated with sessionToken |
| sessionToken lifecycle | Created once at `/connect`, never returned in GET, expires with session |
| sessionToken logging | Never logged in agent, backend, or mobile |
| Device ownership | Only PAIRED devices accept CONNECT_REQUEST |
| Session ownership | userId stored on session (real auth in Phase 6) |
| Duplicate sessions | Backend rejects with 409 SESSION_ALREADY_ACTIVE |
| Session expiry | Sessions auto-expire after SESSION_TTL_MS (default 1h) |
| Command replay | Existing commandId idempotency protects CONNECT_REQUEST |
| DISCONNECT_REQUEST | Always safe to call — idempotent if no session active |

---

## Environment variables

### Agent (`agent/.env`)

```env
# Session provider: mock (default, no VNC needed) or vnc
WAKELINK_SESSION_PROVIDER=mock

# VNC server address (used only when WAKELINK_SESSION_PROVIDER=vnc)
WAKELINK_VNC_HOST=localhost
WAKELINK_VNC_PORT=5900
```

### Backend (`backend/.env`)

```env
# Session TTL in milliseconds (default: 1 hour = 3600000)
SESSION_TTL_MS=3600000
```

---

## Setting up real remote desktop (VNC)

### Step 1 — Install a VNC server

Free options for Windows:
- **TightVNC** (recommended): https://www.tightvnc.com/download.php
- **UltraVNC**: https://uvnc.com/downloads/ultravnc.html
- **RealVNC Free**: https://www.realvnc.com/en/connect/download/viewer/

### Step 2 — Configure the VNC server

1. Open TightVNC Server from the system tray
2. Set a VNC password (required)
3. Note the port (default: 5900)
4. Ensure the firewall allows connections on port 5900 from localhost

### Step 3 — Configure the agent

In `agent/.env`:
```env
WAKELINK_SESSION_PROVIDER=vnc
WAKELINK_VNC_HOST=localhost
WAKELINK_VNC_PORT=5900
```

### Step 4 — Test

1. Start backend, relay, agent
2. Ensure VNC server is running
3. On phone: tap Connect
4. Session screen should show the remote Windows desktop

---

## WebSocket proxy (Phase 6 implementation required)

Phase 5 defines the `/api/sessions/:id/ws` endpoint path but does NOT
yet implement the WebSocket proxy in the backend. This means:

- The session/[id].tsx screen opens the WebView with the noVNC URL
- The noVNC client will fail to connect with "WebSocket connection refused"
- This is expected in Phase 5 — the proxy is a Phase 6 deliverable

The WebSocket proxy will:
1. Accept WS connections at `/api/sessions/:id/ws?token=<sessionToken>`
2. Validate the sessionToken against the stored session
3. Open a TCP connection to `vncHost:vncPort` (reported by agent)
4. Relay data bidirectionally (WS frame ↔ TCP stream)

This is approximately 60–80 lines of Node.js using the built-in `net`
module and the `ws` package (already available in the backend).

---

## Known limitations

| Limitation | Details |
|---|---|
| **WebSocket proxy not yet implemented** | noVNC will show connection error until Phase 6 adds the WS↔TCP proxy |
| **Mock session only** | `WAKELINK_SESSION_PROVIDER=mock` is the safe default; VNC requires separate install |
| **Same-LAN only** | VNC host is `localhost` — works when backend runs on the same machine as the agent. Internet session requires the relay to forward the VNC connection (Phase 6) |
| **No audio** | VNC is video/input only; audio is out of scope |
| **No clipboard passthrough** | Toolbar clipboard button is a placeholder |
| **No multi-monitor** | Single display only |
| **No touch input optimization** | WebView touch events map to mouse but are not optimized for mobile |

---

## Phase 6 — What comes next

1. **WebSocket proxy** in backend: `GET /api/sessions/:id/ws` → TCP relay to VNC
2. **VNC password flow**: relay sessionToken + VNC password securely
3. **Internet session routing**: relay carries VNC tunnel (not just WoL)
4. **Real authentication**: replace `userId: 'pending-auth'` with JWT
5. **Windows Service installer**: auto-start agent + VNC server on boot
6. **Touch input layer**: translate mobile gestures to mouse/keyboard events
