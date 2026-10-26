# Home Assistant MCP bridge

The MCP bridge forwards Hapro API requests through the existing trusted device connection to the HA-MCP Custom Component running on the same Home Assistant host. This source version is `v1.6.19`. The production `hapro` add-on uses its published image.

## Local installation

`hapro-dev` is for local development only. The current pilot was installed manually on the Home Assistant device. It is not the production add-on, and this repository does not maintain an automated package-generation workflow for it.

## Configuration

Complete the **HA-MCP Server** integration entry after installing [the HA-MCP Custom Component](https://github.com/homeassistant-ai/ha-mcp-integration). The integration manages its own Home Assistant administrator credential. No additional Home Assistant token is configured in Hapro.

The add-on starts the MCP bridge automatically. No MCP-specific Hapro add-on options or public keys are required.

The bridge reads the single enabled HA-MCP Server entry from the mounted Home Assistant configuration and discovers its local secret URL. It does not modify Home Assistant storage. Keep exactly one enabled HA-MCP Server entry; if discovery fails, check that integration's configuration and storage format.

The add-on uses host networking and can reach the server over loopback. Redirects and public upstream destinations are rejected. The current bridge supports local secret URL authentication, without an interactive Home Assistant sign-in flow.

MCP uses the same trusted Hapro API-to-add-on connection as the other device API operations. There is no separate MCP signature validation, public key option or OpenID/JWKS discovery. Hapro API authenticates callers and enforces user/device access, session ownership and tool permissions before forwarding requests. The bridge relies on that existing infrastructure trust boundary.

The add-on discovers the HA-MCP server URL at runtime. Restart Hapro after changing its registration or network settings. Keep `uuid`, `apiUrl`, `caddy_port`, and existing tunnel settings appropriate for the environment. If upgrading from the signing-key implementation, remove any `mcp_public_key` option and rebuild/install this add-on plus the matching Hapro API transport.

## Routes and permissions

`GET /mcp/status` initializes the local server and returns safe readiness and version information. `POST`, `GET`, and `DELETE /mcp` forward MCP traffic. These routes use the existing Hapro connection without an additional signature or key exchange. Only required MCP protocol headers are forwarded to HA-MCP; browser credentials are not forwarded.

The add-on authenticates its Supervisor WebSocket connection by sending `SUPERVISOR_TOKEN` in the Home Assistant WebSocket authentication message after the connection opens.

Device visibility, session ownership, and tool permissions are enforced by the Hapro API. The initial API policy permits reads; control requires an explicit action tool list and a central Hapro administrator.


## Filesystem tools

The bridge forwards HA-MCP's native tool catalog and calls without adding filesystem tools. For file access, enable the HA-MCP File & YAML Tools integration entry and its filesystem beta feature. HA-MCP exposes `ha_list_files`, `ha_read_file`, `ha_write_file` and `ha_delete_file` only for paths its own allowlist permits. The Hapro API separately permits the read tools and requires administrator permission and an exact, single-use approval grant for each write or delete. The Onboarding chat collects that approval. Local add-ons are not exposed as a filesystem root by this bridge.

Rebuild and install this add-on image and rebuild/restart Hapro API plus Onboarding API after applying the matching changes. Production Hapro must explicitly permit `ha_write_file` and `ha_delete_file` in its action tool policy.
