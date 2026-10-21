import { createHash, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const signedHeaders = ['accept', 'content-type', 'mcp-protocol-version', 'mcp-session-id', 'last-event-id'];
const responseHeaders = ['content-type', 'mcp-session-id', 'mcp-protocol-version', 'cache-control', 'last-event-id'];
const usedNonces = new Map<string, number>();
const maxBody = 256_000;

export type McpSettings = { url: string; uuid: string; publicKey: string; apiUrl: string };
const publicKeys = new Map<string, { expires: number; keys: Map<string, KeyObject> }>();

export async function discoverLocalMcpUrl(configDirectory = process.env.HAPRO_HA_CONFIG_DIR ?? '/homeassistant'): Promise<string> {
  try {
    const storage = JSON.parse(await readFile(`${configDirectory}/.storage/core.config_entries`, 'utf8'));
    const entries = (storage?.data?.entries ?? []).filter((entry: any) => entry.domain === 'ha_mcp_tools' && entry.data?.entry_type === 'server' && !entry.disabled_by);
    if (entries.length !== 1) return '';
    const entry = entries[0];
    const path = entry.data.secret_path;
    const port = Number(entry.options?.server_port ?? 9584);
    const bind = entry.options?.bind_host;
    const host = !bind || bind === '0.0.0.0' || bind === '::' ? '127.0.0.1' : bind;
    if (typeof path !== 'string' || !/^\/[a-zA-Z0-9_/-]+$/.test(path) || path.includes('..') || !Number.isInteger(port) || port < 1 || port > 65535) return '';
    const url = `http://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${port}${path}`;
    return validLocalUrl(url) ? url : '';
  } catch { return ''; }
}

export async function settingsFromEnvironment(): Promise<McpSettings> {
  const url = process.env.HAPRO_MCP_URL || await discoverLocalMcpUrl();
  return { url, uuid: process.env.HAPRO_UUID ?? '', publicKey: process.env.HAPRO_MCP_PUBLIC_KEY ?? '', apiUrl: process.env.HAPRO_API_URL ?? '' };
}

export function validLocalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const local = host === 'localhost' || host === '[::1]' || host.endsWith('.local') || host.endsWith('.internal') ||
      /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
    return local && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.hash && url.pathname !== '/';
  } catch { return false; }
}

export function canonicalRequest(request: Request, body: Uint8Array, uuid: string, timestamp: string, nonce: string, keyId: string): string {
  return ['hapro-mcp-v2', uuid, request.method, new URL(request.url).pathname,
    ...signedHeaders.map((name) => request.headers.get(name) ?? ''),
    createHash('sha256').update(body).digest('hex'), timestamp, nonce, keyId].join('\n');
}

export function signatureFor(request: Request, body: Uint8Array, uuid: string, privateKey: string | KeyObject, timestamp: string, nonce: string, keyId: string): string {
  return sign('RSA-SHA256', Buffer.from(canonicalRequest(request, body, uuid, timestamp, nonce, keyId)), privateKey).toString('base64url');
}

async function verificationKey(config: McpSettings, keyId: string): Promise<KeyObject | undefined> {
  if (config.publicKey) return config.publicKey.includes('BEGIN') ? createPublicKey(config.publicKey.replaceAll('\\n', '\n'))
    : createPublicKey({ key: Buffer.from(config.publicKey, 'base64'), format: 'der', type: 'spki' });
  const api = new URL(config.apiUrl);
  if (api.protocol !== 'https:') return undefined;
  const cached = publicKeys.get(api.origin);
  if (cached && cached.expires > Date.now()) return cached.keys.get(keyId);
  const discovery = await fetch(new URL('/.well-known/openid-configuration', api), { redirect: 'error', signal: AbortSignal.timeout(5_000) });
  if (!discovery.ok) return undefined;
  const metadata: any = await discovery.json();
  const jwksUrl = new URL(metadata.jwks_uri);
  if (jwksUrl.origin !== api.origin) return undefined;
  const response = await fetch(jwksUrl, { redirect: 'error', signal: AbortSignal.timeout(5_000) });
  if (!response.ok) return undefined;
  const jwks: any = await response.json();
  const keys = new Map<string, KeyObject>();
  for (const key of (jwks.keys ?? []).slice(0, 10)) if (key.kty === 'RSA' && typeof key.kid === 'string' && !key.d) keys.set(key.kid, createPublicKey({ key, format: 'jwk' }));
  publicKeys.set(api.origin, { keys, expires: Date.now() + 300_000 });
  return keys.get(keyId);
}

function json(status: number, state: string, message: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({ state, message, ...extra }, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function readBody(request: Request): Promise<Uint8Array> {
  if (Number(request.headers.get('content-length') ?? 0) > maxBody) throw new Error('body_limit');
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maxBody) { await reader.cancel(); throw new Error('body_limit'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

export async function handleMcp(request: Request, settings?: McpSettings): Promise<Response> {
  const config = settings ?? await settingsFromEnvironment();
  const route = new URL(request.url).pathname;
  if (!['/mcp', '/mcp/status'].includes(route)) return json(404, 'not_found', 'Unknown MCP route.');
  if (!['GET', 'POST', 'DELETE'].includes(request.method) || (route === '/mcp/status' && request.method !== 'GET'))
    return json(405, 'method_not_allowed', 'Method not allowed.');
  if (!config.uuid || (!config.publicKey && !config.apiUrl)) return json(503, 'bridge_not_configured', 'The Hapro device registration is not ready.');
  let body: Uint8Array;
  try { body = await readBody(request); } catch { return json(413, 'body_limit', 'MCP request is too large.'); }
  const timestamp = request.headers.get('x-hapro-mcp-time') ?? '';
  const nonce = request.headers.get('x-hapro-mcp-nonce') ?? '';
  const provided = request.headers.get('x-hapro-mcp-signature') ?? '';
  const keyId = request.headers.get('x-hapro-mcp-key-id') ?? '';
  const now = Math.floor(Date.now() / 1000);
  if (request.headers.get('x-hapro-mcp-device') !== config.uuid || !/^\d{10}$/.test(timestamp) ||
      Math.abs(now - Number(timestamp)) > 60 || !/^[a-f0-9]{32}$/.test(nonce) || !/^[A-Za-z0-9_-]{340,1400}$/.test(provided) || !/^[A-Za-z0-9_-]{1,128}$/.test(keyId))
    return json(401, 'unauthorized', 'Invalid Hapro MCP authentication.');
  try {
    const key = await verificationKey(config, keyId);
    if (!key || !verify('RSA-SHA256', Buffer.from(canonicalRequest(request, body, config.uuid, timestamp, nonce, keyId)), key, Buffer.from(provided, 'base64url')))
      return json(401, 'unauthorized', 'Invalid Hapro MCP authentication.');
  } catch { return json(401, 'unauthorized', 'The Hapro MCP signing key could not be verified. Check the API URL and its OpenID discovery endpoints.'); }
  for (const [key, expiry] of usedNonces) if (expiry < now) usedNonces.delete(key);
  if (usedNonces.has(nonce)) return json(401, 'replayed_request', 'The Hapro MCP request was already used.');
  if (usedNonces.size >= 10_000) return json(429, 'busy', 'The MCP bridge is busy.');
  usedNonces.set(nonce, now + 120);
  if (!config.url) return json(503, 'mcp_not_configured', 'Configure exactly one enabled HA-MCP Server integration entry and restart the Hapro add-on.');
  if (!validLocalUrl(config.url)) return json(503, 'invalid_mcp_url', 'The configured MCP URL must use an approved local host and its complete connection path.');

  try {
    if (route === '/mcp/status') return await probeLocalMcp(config, request.signal);
    const headers = new Headers();
    for (const name of signedHeaders) { const value = request.headers.get(name); if (value) headers.set(name, value); }
    for (const name of ['mcp-method', 'mcp-name']) { const value = request.headers.get(name); if (value) headers.set(name, value); }
    const upstream = await fetch(config.url, {
      method: request.method, headers, body: request.method === 'POST' ? body as BodyInit : undefined,
      redirect: 'error', signal: AbortSignal.any([request.signal, AbortSignal.timeout(request.method === 'GET' ? 120_000 : 40_000)]),
    });
    if (!upstream.ok && ![404, 405].includes(upstream.status)) {
      await upstream.body?.cancel();
      return json(upstream.status === 401 || upstream.status === 403 ? 502 : upstream.status, 'mcp_error', 'The local MCP server rejected the request. Check its connection and authentication settings.');
    }
    const outgoing = new Headers({ 'Cache-Control': 'no-store' });
    for (const name of responseHeaders) { const value = upstream.headers.get(name); if (value) outgoing.set(name, value); }
    return new Response(upstream.body, { status: upstream.status, headers: outgoing });
  } catch {
    return json(502, 'mcp_unavailable', 'The local HA-MCP server could not be reached. Check that the server is running and local network access is enabled.');
  }
}

export async function probeLocalMcp(config: McpSettings, signal: AbortSignal): Promise<Response> {
  const response = await fetch(config.url, {
    method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'hapro-health', method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'hapro-health', version: '1.0.0' } } }),
  });
  if (!response.ok) { await response.body?.cancel(); return json(503, response.status === 401 || response.status === 403 ? 'mcp_auth_failed' : 'mcp_unavailable', 'The HA-MCP connection check failed. Check the configured local URL and server settings.'); }
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let text = '';
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        if (text.length > maxBody) throw new Error('response_limit');
        if (response.headers.get('content-type')?.includes('event-stream') && /data:.*"(?:result|error)".*\r?\n\r?\n/.test(text)) break;
      }
    } finally { await reader.cancel(); }
  }
  let payload: any;
  try { payload = response.headers.get('content-type')?.includes('event-stream') ? text.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => { try { return JSON.parse(line.slice(5)); } catch { return {}; } }).find((item) => item.result || item.error) : JSON.parse(text); } catch { /* Invalid MCP endpoint. */ }
  if (!payload?.result?.serverInfo || payload.error) return json(503, 'invalid_mcp_response', 'The configured local URL did not return a valid MCP initialization.');
  const session = response.headers.get('mcp-session-id');
  const headers = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'mcp-protocol-version': payload.result.protocolVersion ?? '2025-11-25' });
  if (session) headers.set('mcp-session-id', session);
  try {
    const initialized = await fetch(config.url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]) });
    await initialized.body?.cancel();
    if (!initialized.ok) throw new Error('initialization_failed');
    const tools: { name: string; readOnlyHint: boolean }[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const listed = await fetch(config.url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: `hapro-tools-${page}`, method: 'tools/list', params: cursor ? { cursor } : {} }), redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]) });
      if (!listed.ok) { await listed.body?.cancel(); throw new Error('tool_discovery_failed'); }
      const result = await readMcpResult(listed);
      if (!Array.isArray(result?.tools)) throw new Error('invalid_tool_list');
      for (const tool of result.tools) {
        if (typeof tool?.name !== 'string' || tool.name.length > 128 || tools.length >= 500) throw new Error('invalid_tool_list');
        tools.push({ name: tool.name, readOnlyHint: tool.annotations?.readOnlyHint === true });
      }
      cursor = result.nextCursor;
      if (!cursor) return json(200, 'ready', 'Connected to the local HA-MCP server.', { protocolVersion: payload.result.protocolVersion, serverName: String(payload.result.serverInfo.name ?? 'HA-MCP'), serverVersion: String(payload.result.serverInfo.version ?? ''), tools });
      if (typeof cursor !== 'string' || cursor.length > 1000) throw new Error('invalid_tool_list');
    }
  } catch { /* Discovery failure is reported below. */ }
  finally {
    if (session) {
      try { const closed = await fetch(config.url, { method: 'DELETE', headers, redirect: 'error', signal: AbortSignal.timeout(3_000) }); await closed.body?.cancel(); } catch { /* Session will expire upstream. */ }
    }
  }
  return json(503, 'tool_discovery_failed', 'The HA-MCP tool list could not be read.');
}

async function readMcpResult(response: Response): Promise<any> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('empty_tool_list');
  const decoder = new TextDecoder();
  let body = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      body += decoder.decode(value, { stream: true });
      if (body.length > 2_000_000) throw new Error('response_limit');
      if (response.headers.get('content-type')?.includes('event-stream') && /data:.*"(?:result|error)".*\r?\n\r?\n/.test(body)) break;
    }
  } finally { await reader.cancel(); }
  const payload = response.headers.get('content-type')?.includes('event-stream')
    ? body.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => { try { return JSON.parse(line.slice(5)); } catch { return {}; } }).find((item) => item.result || item.error)
    : JSON.parse(body);
  if (payload?.error || !payload?.result) throw new Error('invalid_tool_list');
  return payload.result;
}
