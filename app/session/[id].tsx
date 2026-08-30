/**
 * SessionScreen — Phase 5 remote session screen.
 *
 * When a real session is available (sessionId + wsProxyPath in params):
 *   Renders a WebView loading the noVNC HTML page which connects to the
 *   WakeLink backend WebSocket proxy → VNC server on the remote PC.
 *
 * When session params are missing (mock/dev without VNC):
 *   Renders the development placeholder with session metadata.
 *
 * URL params (passed from connect/[id].tsx):
 *   sessionId    — backend session UUID
 *   sessionToken — short-lived auth token (used in WS URL, never logged)
 *   wsProxyPath  — /api/sessions/:id/ws
 *   sessionType  — vnc | webrtc | rdp | mock
 *
 * SECURITY:
 *   sessionToken is embedded in the WebSocket URL (query param).
 *   It is transmitted only over the existing backend connection.
 *   The backend validates it before allowing the proxy to open.
 *   The token is never logged or displayed to the user.
 */

import React, { useEffect, useRef, useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Alert,
  StatusBar,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { WebView } from 'react-native-webview';
import { connectionService } from '../../src/services';
import { useDevice } from '../../src/store/useDevice';
import { Colors, Spacing, FontSize, FontWeight, Radius } from '../../src/theme';

// ── noVNC HTML page ───────────────────────────────────────────────────────
/**
 * Generates an inline HTML page that loads noVNC from a CDN and connects
 * to the WakeLink WebSocket proxy.
 *
 * The wsUrl is constructed from:
 *   ws://<backendHost>:<backendPort>/api/sessions/<sessionId>/ws?token=<sessionToken>
 *
 * In production this should be wss:// over TLS.
 */
function buildNoVncHtml(wsUrl: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>WakeLink Remote</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; background: #0d0d0d; overflow: hidden; }
    #status {
      position: fixed; top: 0; left: 0; right: 0;
      background: rgba(13,13,13,0.9); color: #9ca3af;
      font-family: -apple-system, sans-serif; font-size: 13px;
      padding: 8px 16px; text-align: center; z-index: 100;
    }
    #novnc-canvas { width: 100% !important; height: 100% !important; }
  </style>
</head>
<body>
  <div id="status">Connecting to remote desktop…</div>
  <script src="https://cdn.jsdelivr.net/npm/@novnc/novnc@1.4.0/core/rfb.js" type="module"></script>
  <script type="module">
    import RFB from 'https://cdn.jsdelivr.net/npm/@novnc/novnc@1.4.0/core/rfb.js';

    const statusEl = document.getElementById('status');

    function updateStatus(msg, color) {
      statusEl.textContent = msg;
      statusEl.style.color = color || '#9ca3af';
    }

    try {
      const rfb = new RFB(document.body, '${wsUrl}', {
        credentials: { password: '' },
      });

      rfb.scaleViewport = true;
      rfb.resizeSession = true;

      rfb.addEventListener('connect', () => {
        updateStatus('Connected', '#22c55e');
        setTimeout(() => { statusEl.style.display = 'none'; }, 2000);
        window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'CONNECTED' }));
      });

      rfb.addEventListener('disconnect', (e) => {
        const clean = e.detail?.clean;
        updateStatus(clean ? 'Disconnected' : 'Connection lost', '#ef4444');
        statusEl.style.display = 'block';
        window.ReactNativeWebView?.postMessage(JSON.stringify({
          type: clean ? 'DISCONNECTED' : 'CONNECTION_LOST',
        }));
      });

      rfb.addEventListener('credentialsrequired', () => {
        updateStatus('VNC password required', '#f59e0b');
        window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'CREDENTIALS_REQUIRED' }));
      });

    } catch (err) {
      updateStatus('Failed: ' + err.message, '#ef4444');
      window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'ERROR', message: err.message }));
    }
  </script>
</body>
</html>`;
}

// ── Component ────────────────────────────────────────────────────────────

type SessionState = 'connecting' | 'connected' | 'lost' | 'disconnected' | 'error';

export default function SessionScreen() {
  const { id, sessionId, sessionToken, wsProxyPath, sessionType } =
    useLocalSearchParams<{
      id: string;
      sessionId?: string;
      sessionToken?: string;
      wsProxyPath?: string;
      sessionType?: string;
    }>();

  const { device }  = useDevice(id);
  const hasSession  = !!(sessionId && wsProxyPath);

  const [sessionState,   setSessionState]   = useState<SessionState>('connecting');
  const [controlsVisible, setControlsVisible] = useState(true);
  const [sessionDuration, setSessionDuration] = useState(0);
  const [errorMessage,    setErrorMessage]    = useState<string | null>(null);

  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const entryOpacity   = useRef(new Animated.Value(0)).current;
  const entryScale     = useRef(new Animated.Value(0.97)).current;

  // Build WS URL for noVNC
  const backendUrl = process.env['EXPO_PUBLIC_BACKEND_URL'] ?? 'http://localhost:3001';
  const wsBase     = backendUrl.replace(/^http/, 'ws');
  const wsUrl      = hasSession
    ? `${wsBase}${wsProxyPath}?token=${sessionToken}`
    : '';

  // Entry animation
  useEffect(() => {
    Animated.parallel([
      Animated.timing(entryOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.spring(entryScale,   { toValue: 1, tension: 80, friction: 10, useNativeDriver: true }),
    ]).start();
  }, []);

  // Session timer
  useEffect(() => {
    if (sessionState !== 'connected') return;
    const t = setInterval(() => setSessionDuration((d) => d + 1), 1000);
    return () => clearInterval(t);
  }, [sessionState]);

  // Auto-hide controls after 4 s (only when connected)
  useEffect(() => {
    if (!controlsVisible || sessionState !== 'connected') return;
    const t = setTimeout(hideControls, 4000);
    return () => clearTimeout(t);
  }, [controlsVisible, sessionState]);

  const hideControls = useCallback(() => {
    Animated.timing(overlayOpacity, { toValue: 0, duration: 300, useNativeDriver: true })
      .start(() => setControlsVisible(false));
  }, [overlayOpacity]);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    overlayOpacity.setValue(1);
  }, [overlayOpacity]);

  // Handle messages from the noVNC WebView
  const handleWebViewMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data) as { type: string; message?: string };
      switch (msg.type) {
        case 'CONNECTED':       setSessionState('connected'); break;
        case 'DISCONNECTED':    setSessionState('disconnected'); break;
        case 'CONNECTION_LOST': setSessionState('lost'); break;
        case 'ERROR':
          setSessionState('error');
          setErrorMessage(msg.message ?? 'Unknown error');
          break;
      }
    } catch { /* ignore non-JSON messages */ }
  }, []);

  const handleDisconnect = useCallback(() => {
    Alert.alert('Disconnect?', 'This will end your remote session.', [
      { text: 'Stay connected', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: async () => {
          if (sessionId) {
            await fetch(`${backendUrl}/api/sessions/${sessionId}/disconnect`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({}),
            }).catch(() => {});
          }
          await connectionService.disconnect(id).catch(() => {});
          router.replace('/(tabs)');
        },
      },
    ]);
  }, [id, sessionId, backendUrl]);

  const handleRetry = useCallback(() => {
    router.replace(`/connect/${id}`);
  }, [id]);

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      <StatusBar hidden />

      <Animated.View
        style={[styles.canvasWrap, { opacity: entryOpacity, transform: [{ scale: entryScale }] }]}
      >
        {/* ── Real session: noVNC WebView ─────────────────────────────── */}
        {hasSession && sessionType !== 'mock' ? (
          <TouchableOpacity
            activeOpacity={1}
            onPress={showControls}
            style={styles.fill}
            accessibilityLabel="Remote desktop. Tap to show controls."
          >
            <WebView
              source={{ html: buildNoVncHtml(wsUrl) }}
              style={styles.fill}
              originWhitelist={['*']}
              javaScriptEnabled
              onMessage={handleWebViewMessage}
              mediaPlaybackRequiresUserAction={false}
              allowsInlineMediaPlayback
              // Silence SSL errors in dev — remove in production
              onSslError={(handler: { proceed?: () => void }) => handler.proceed?.()}
            />
          </TouchableOpacity>

        ) : (
          /* ── Mock / placeholder session ──────────────────────────────── */
          <TouchableOpacity
            activeOpacity={1}
            onPress={showControls}
            style={styles.placeholder}
            accessibilityLabel="Session placeholder. Tap to show controls."
          >
            {/* Simulated Windows desktop chrome */}
            <View style={styles.desktopChrome}>
              <View style={styles.taskbar}>
                <View style={styles.taskbarStart}>
                  <View style={styles.taskbarBtn} />
                  <View style={styles.taskbarSearch} />
                </View>
                <Text style={styles.taskbarClock}>
                  {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
              <View style={styles.desktopArea}>
                {sessionState === 'connecting' ? (
                  <>
                    <ActivityIndicator color={Colors.brand} size="large" />
                    <Text style={styles.placeholderLabel}>Starting Session…</Text>
                    <Text style={styles.placeholderSub}>{device?.name ?? 'PC'}</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.placeholderLabel}>Remote Desktop</Text>
                    <Text style={styles.placeholderSub}>{device?.name ?? 'PC'}</Text>
                    <View style={styles.placeholderDivider} />
                    <Text style={styles.placeholderNote}>
                      {sessionType === 'mock'
                        ? 'Mock session active.\nSet WAKELINK_SESSION_PROVIDER=vnc in agent/.env\nand install TightVNC to enable real remote desktop.'
                        : 'Remote rendering will appear here once the\nWakeLink PC Agent and streaming stack are connected.'}
                    </Text>
                    {sessionId && (
                      <Text style={styles.sessionIdText} numberOfLines={1}>
                        Session: {sessionId.slice(0, 8)}…
                      </Text>
                    )}
                  </>
                )}
              </View>
            </View>
          </TouchableOpacity>
        )}
      </Animated.View>

      {/* ── Connection-lost / error overlay ──────────────────────────── */}
      {(sessionState === 'lost' || sessionState === 'error') && (
        <View style={styles.lostOverlay}>
          <Text style={styles.lostIcon}>⚠️</Text>
          <Text style={styles.lostTitle}>
            {sessionState === 'lost' ? 'Connection Lost' : 'Session Error'}
          </Text>
          <Text style={styles.lostBody}>
            {sessionState === 'error' && errorMessage
              ? errorMessage
              : 'The remote session was interrupted.'}
          </Text>
          <View style={styles.lostActions}>
            <TouchableOpacity onPress={handleRetry} style={styles.retryBtn}>
              <Text style={styles.retryText}>Reconnect</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.replace('/(tabs)')} style={styles.backBtn}>
              <Text style={styles.backText}>Go home</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Control overlay ────────────────────────────────────────────── */}
      {controlsVisible && sessionState !== 'lost' && sessionState !== 'error' && (
        <Animated.View
          style={[styles.overlay, { opacity: overlayOpacity }]}
          pointerEvents="box-none"
        >
          {/* Top bar */}
          <View style={styles.topBar}>
            <View style={styles.topBarLeft}>
              {sessionState === 'connecting' ? (
                <ActivityIndicator color={Colors.brand} size="small" />
              ) : (
                <View style={[styles.liveDot,
                  sessionState === 'connected' && { backgroundColor: Colors.online }]} />
              )}
              <Text style={styles.liveBadge}>
                {sessionState === 'connecting' ? 'CONNECTING' : 'LIVE'}
              </Text>
              {sessionState === 'connected' && (
                <Text style={styles.sessionTimer}>{formatDuration(sessionDuration)}</Text>
              )}
            </View>

            <Text style={styles.deviceNameLabel} numberOfLines={1}>
              {device?.name ?? 'PC'}
            </Text>

            <TouchableOpacity
              onPress={handleDisconnect}
              activeOpacity={0.8}
              style={styles.disconnectBtn}
              accessibilityRole="button"
              accessibilityLabel="Disconnect from remote session"
            >
              <Text style={styles.disconnectText}>Disconnect</Text>
            </TouchableOpacity>
          </View>

          {/* Bottom toolbar */}
          <View style={styles.bottomBar}>
            <ToolbarButton icon="⌨️" label="Keyboard" onPress={() => {}} />
            <ToolbarButton icon="🖱️" label="Mouse"    onPress={() => {}} />
            <ToolbarButton icon="📋" label="Clipboard" onPress={() => {}} />
            <ToolbarButton icon="⚙️" label="Settings"  onPress={() => {}} />
          </View>
        </Animated.View>
      )}
    </View>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

function ToolbarButton({
  icon, label, onPress,
}: {
  icon: string; label: string; onPress: () => void;
}) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}
      style={toolbar.btn} accessibilityRole="button" accessibilityLabel={label}>
      <Text style={toolbar.icon}>{icon}</Text>
      <Text style={toolbar.label}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:        { flex: 1, backgroundColor: '#000' },
  fill:        { flex: 1 },
  canvasWrap:  { flex: 1 },
  placeholder: { flex: 1, backgroundColor: '#1a1a2e' },

  desktopChrome: {
    flex: 1, backgroundColor: '#0f3460', flexDirection: 'column-reverse',
  },
  taskbar: {
    height: 40, backgroundColor: '#16213e',
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: Spacing.sm,
  },
  taskbarStart: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  taskbarBtn:   { width: 24, height: 24, borderRadius: 4, backgroundColor: Colors.brand },
  taskbarSearch:{ width: 120, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)' },
  taskbarClock: { fontSize: FontSize.xs, color: 'rgba(255,255,255,0.7)' },
  desktopArea:  {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: Spacing.sm, padding: Spacing.lg,
  },
  placeholderLabel: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: 'rgba(255,255,255,0.9)', textAlign: 'center' },
  placeholderSub:   { fontSize: FontSize.lg,  color: 'rgba(255,255,255,0.55)', textAlign: 'center' },
  placeholderDivider: { width: 40, height: 1, backgroundColor: 'rgba(255,255,255,0.15)', marginVertical: Spacing.sm },
  placeholderNote: { fontSize: FontSize.sm, color: 'rgba(255,255,255,0.35)', textAlign: 'center', lineHeight: FontSize.sm * 1.6 },
  sessionIdText:   { fontSize: FontSize.xs, color: 'rgba(255,255,255,0.25)', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginTop: Spacing.sm },

  // Connection-lost overlay
  lostOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center', justifyContent: 'center',
    padding: Spacing.xl, gap: Spacing.md,
  },
  lostIcon:  { fontSize: 48 },
  lostTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.textPrimary, textAlign: 'center' },
  lostBody:  { fontSize: FontSize.md, color: Colors.textSecondary, textAlign: 'center', lineHeight: FontSize.md * 1.6 },
  lostActions:{ alignSelf: 'stretch', gap: Spacing.sm, marginTop: Spacing.sm },
  retryBtn:  { backgroundColor: Colors.brand, paddingVertical: Spacing.md, borderRadius: Radius.md, alignItems: 'center', minHeight: 48, justifyContent: 'center' },
  retryText: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.textInverse },
  backBtn:   { paddingVertical: Spacing.sm, alignItems: 'center' },
  backText:  { fontSize: FontSize.md, color: Colors.textSecondary },

  // Control overlay
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'space-between', pointerEvents: 'box-none' as any },
  topBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: Spacing.md,
    paddingTop: Platform.OS === 'ios' ? 50 : Spacing.md,
    paddingBottom: Spacing.sm, gap: Spacing.sm,
  },
  topBarLeft:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  liveDot:     { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.danger },
  liveBadge:   { fontSize: FontSize.xs, fontWeight: FontWeight.bold, color: Colors.danger, letterSpacing: 0.8 },
  sessionTimer:{ fontSize: FontSize.sm, color: Colors.textSecondary, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginLeft: 4 },
  deviceNameLabel: { flex: 1, fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textPrimary, textAlign: 'center' },
  disconnectBtn:   { backgroundColor: Colors.danger, paddingVertical: 6, paddingHorizontal: Spacing.md, borderRadius: Radius.full },
  disconnectText:  { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textInverse },
  bottomBar: {
    flexDirection: 'row', justifyContent: 'space-around',
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingVertical: Spacing.sm,
    paddingBottom: Platform.OS === 'ios' ? 28 : Spacing.sm,
  },
});

const toolbar = StyleSheet.create({
  btn:   { alignItems: 'center', gap: 3, paddingHorizontal: Spacing.md },
  icon:  { fontSize: 22 },
  label: { fontSize: FontSize.xs, color: Colors.textSecondary },
});
