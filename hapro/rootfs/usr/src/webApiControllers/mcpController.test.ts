import { afterAll, describe, expect, test } from 'bun:test';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { handleMcp, signatureFor, validLocalUrl, discoverLocalMcpUrl, type McpSettings } from './mcpController';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';

const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: async (request) => {
  const body = await request.json() as any;
  return Response.json({ jsonrpc: '2.0', id: body.id, result: body.method === 'initialize'
    ? { protocolVersion: '2025-11-25', serverInfo: { name: 'test-mcp', version: '1' }, capabilities: {} }
    : body.method === 'tools/list'
      ? { tools: [{ name: 'ha_read_file', annotations: { readOnlyHint: true }, inputSchema: { type: 'object' } }, { name: 'ha_delete_file', annotations: { readOnlyHint: false }, inputSchema: { type: 'object' } }] }
      : { authorization: request.headers.get('authorization'), bridgeSignature: request.headers.get('x-hapro-mcp-signature'), method: body.method, name: body.params?.name } });
} });
afterAll(() => upstream.stop(true));
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const settings: McpSettings = { url: `http://127.0.0.1:${upstream.port}/private_test`, uuid: 'ef5dbe37145f4ccf985ae328151bf8cb', publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'), apiUrl: 'https://api.example.test' };

function signed(route = '/mcp', body = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}', time = Math.floor(Date.now() / 1000)) {
  const headers = new Headers({ accept: 'application/json, text/event-stream', 'content-type': 'application/json', authorization: 'Bearer must-not-forward' });
  const method = route.endsWith('/status') ? 'GET' : 'POST';
  const timestamp = String(time);
  const nonce = randomUUID().replaceAll('-', '');
  const request = new Request(`http://hapro-api${route}`, { method, headers, ...(method === 'POST' ? { body } : {}) });
  request.headers.set('x-hapro-mcp-device', settings.uuid);
  request.headers.set('x-hapro-mcp-time', timestamp);
  request.headers.set('x-hapro-mcp-nonce', nonce);
  request.headers.set('x-hapro-mcp-key-id', 'test-key');
  request.headers.set('x-hapro-mcp-signature', signatureFor(request, new TextEncoder().encode(method === 'POST' ? body : ''), settings.uuid, privateKey, timestamp, nonce, 'test-key'));
  return request;
}

describe('authenticated MCP bridge', () => {
  test('rejects unsigned requests', async () => expect((await handleMcp(new Request('http://hapro-api/mcp'), settings)).status).toBe(401));
  test('rejects expired signatures', async () => expect((await handleMcp(signed('/mcp', '{}', 1_700_000_000), settings)).status).toBe(401));
  test('rejects a different device', async () => {
    const request = signed(); request.headers.set('x-hapro-mcp-device', 'another-device');
    expect((await handleMcp(request, settings)).status).toBe(401);
  });
  test('rejects tampering with the body', async () => {
    const request = signed();
    expect((await handleMcp(new Request(request.url, { method: 'POST', headers: request.headers, body: '{"method":"tools/call"}' }), settings)).status).toBe(401);
  });
  test('forwards JSON-RPC without caller credentials and rejects replay', async () => {
    const request = signed(); const replay = request.clone();
    const response = await handleMcp(request, settings);
    expect(response.status).toBe(200);
    expect((await response.json() as any).result.tools.map((tool: any) => tool.name)).toEqual(['ha_read_file', 'ha_delete_file']);
    expect((await handleMcp(replay, settings)).status).toBe(401);
  });
  test('forwards native HA-MCP file calls', async () => {
    const response = await handleMcp(signed('/mcp', JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'ha_read_file', arguments: { path: 'www/theme.css' } } })), settings);
    expect(response.status).toBe(200);
    expect((await response.json() as any).result).toEqual({ authorization: null, bridgeSignature: null, method: 'tools/call', name: 'ha_read_file' });
  });
  test('reports readiness without revealing the connection secret', async () => {
    const response = await handleMcp(signed('/mcp/status'), settings);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('ready'); expect(text).not.toContain('private_test');
    expect(JSON.parse(text).tools).toEqual([{ name: 'ha_read_file', readOnlyHint: true }, { name: 'ha_delete_file', readOnlyHint: false }]);
  });
  test('reports missing configuration', async () => expect((await handleMcp(signed(), { ...settings, url: '' })).status).toBe(503));
  test('restricts configured destinations', () => {
    expect(validLocalUrl(settings.url)).toBe(true);
    expect(validLocalUrl('https://example.com/private_test')).toBe(false);
    expect(validLocalUrl('file:///etc/passwd')).toBe(false);
    expect(validLocalUrl('http://localhost:9584/')).toBe(false);
  });
  test('discovers the configured server path and ignores the administrator token', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'hapro-mcp-discovery-'));
    try {
      await mkdir(join(folder, '.storage'));
      await writeFile(join(folder, '.storage/core.config_entries'), JSON.stringify({ data: { entries: [
        { domain: 'ha_mcp_tools', data: { entry_type: 'tools', secret_path: '/private_wrong' } },
        { domain: 'ha_mcp_tools', data: { entry_type: 'server', secret_path: '/private_expected', admin_token: 'do-not-export' }, options: { server_port: 9584, bind_host: '0.0.0.0' } },
      ] } }));
      expect(await discoverLocalMcpUrl(folder)).toBe('http://127.0.0.1:9584/private_expected');
    } finally { if (dirname(resolve(folder)) === resolve(tmpdir()) && basename(folder).startsWith('hapro-mcp-discovery-')) await rm(folder, { recursive: true, force: true }); }
  });
});
