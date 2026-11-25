// ─────────────────────────────────────────────────────────────
//  Minimal client for the Cousin Server Manager public API (v1).
//  Only the calls needed by the character restore feature.
//
//  Required API key scopes: `read` + `restore`.
// ─────────────────────────────────────────────────────────────

import config from './config';

export interface CsmServer {
  id:   string;
  name: string;
  map:  string;
  status?: { state: string; online: boolean; playerCount: number };
}

export interface CsmPlayerBackup {
  eosId:      string;
  playerName: string;
  timestamp:  string;   // yyyyMMddHHmmss, manager PC local time
  filename:   string;
  size:       number;
  createdAt:  string;
}

export interface CsmRestoreResult {
  message:    string;
  eosId:      string;
  playerName: string;
  timestamp:  string;
  filename:   string;
}

export interface CsmMe {
  apiVersion:     string;
  managerVersion: string;
  key: { id: string; name: string; scopes: string[]; serverIds: string[] | null; expiresAt: string | null };
  user: { username: string; role: string };
}

/**
 * Error returned by the manager (`code` = the API error code, e.g.
 * `player_online`) or raised locally (`unreachable`, `timeout`, `bad_response`).
 */
export class CsmApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
    this.name = 'CsmApiError';
  }
}

interface ApiEnvelope {
  ok?:    boolean;
  data?:  unknown;
  error?: { code?: string; message?: string };
}

const DEFAULT_TIMEOUT_MS = 20_000;
const RESTORE_TIMEOUT_MS = 90_000;

function baseUrl(): string {
  const url = (config.characterRestore?.managerUrl || '').trim().replace(/\/+$/, '');
  return `${url}/api/v1`;
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.characterRestore?.apiKey ?? ''}`,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(baseUrl() + path, {
      method,
      headers,
      body:   body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new CsmApiError('timeout', `Server Manager did not answer within ${timeoutMs / 1000}s (${method} ${path})`, 0);
    }
    const detail = err instanceof Error ? ((err as { cause?: { message?: string } }).cause?.message || err.message) : String(err);
    throw new CsmApiError('unreachable', `Cannot reach Server Manager at ${baseUrl()}: ${detail}`, 0);
  }

  let json = null as ApiEnvelope | null;
  try {
    json = await res.json() as ApiEnvelope;
  } catch {
    json = null;
  }

  if (!json || typeof json !== 'object' || typeof json.ok !== 'boolean') {
    throw new CsmApiError('bad_response', `Unexpected response from Server Manager (HTTP ${res.status}) — is managerUrl correct?`, res.status);
  }
  if (!json.ok) {
    throw new CsmApiError(json.error?.code || 'unknown_error', json.error?.message || `HTTP ${res.status}`, res.status);
  }
  return json.data as T;
}

const enc = encodeURIComponent;

export function getMe(): Promise<CsmMe> {
  return request<CsmMe>('GET', '/me');
}

export function listServers(): Promise<CsmServer[]> {
  return request<CsmServer[]>('GET', '/servers');
}

export function listPlayerBackups(serverId: string, eosId: string): Promise<CsmPlayerBackup[]> {
  return request<CsmPlayerBackup[]>('GET', `/servers/${enc(serverId)}/backups/players?eosId=${enc(eosId)}`);
}

/** Restores the exact backup identified by `timestamp` (the one the player confirmed). */
export function restorePlayer(serverId: string, eosId: string, timestamp: string): Promise<CsmRestoreResult> {
  return request<CsmRestoreResult>(
    'POST',
    `/servers/${enc(serverId)}/players/${enc(eosId)}/restore`,
    { timestamp },
    RESTORE_TIMEOUT_MS,
  );
}
