import type {
  WakeRelay,
  RelayCommand,
  RelayCommandResult,
} from '../interfaces/WakeRelay';
import { httpGet, httpPost } from '../utils/httpClient';

/**
 * HttpWakeRelay — long-polling implementation of WakeRelay.
 *
 * Communicates with the backend using plain HTTP.
 * All connections are OUTBOUND — no inbound ports required.
 * Works through NAT and CGNAT.
 *
 * Upgrade path:
 *   Replace with WebSocketWakeRelay when the backend supports WS.
 *   Interface stays identical; only this file changes.
 */
export class HttpWakeRelay implements WakeRelay {
  constructor(private readonly backendUrl: string) {}

  async register(
    relayName: string,
    deviceIds: string[],
  ): Promise<{ relayId: string; relayToken: string }> {
    const res = await httpPost<{
      relayId: string;
      relayToken: string;
      success: boolean;
    }>(`${this.backendUrl}/api/relay/register`, {
      relayName,
      deviceIds,
    });

    if (!res.relayId || !res.relayToken) {
      throw new Error('Backend did not return relayId/relayToken');
    }
    return { relayId: res.relayId, relayToken: res.relayToken };
  }

  async heartbeat(
    relayId: string,
    relayToken: string,
    deviceIds: string[],
  ): Promise<void> {
    await httpPost(
      `${this.backendUrl}/api/relay/${relayId}/heartbeat`,
      { deviceIds },
      relayToken,
    );
  }

  async fetchPendingCommands(
    relayId: string,
    relayToken: string,
  ): Promise<RelayCommand[]> {
    const res = await httpGet<{ commands: RelayCommand[] }>(
      `${this.backendUrl}/api/relay/${relayId}/commands/pending`,
      relayToken,
    );
    return res.commands ?? [];
  }

  async reportResult(
    relayId: string,
    relayToken: string,
    result: RelayCommandResult,
  ): Promise<void> {
    await httpPost(
      `${this.backendUrl}/api/relay/${relayId}/commands/${result.commandId}/result`,
      { success: result.success, error: result.error },
      relayToken,
    );
  }
}
