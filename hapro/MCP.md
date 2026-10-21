# Home Assistant MCP bridge

The MCP bridge forwards signed Hapro API requests to the HA-MCP Custom Component running on the same Home Assistant host. This source version is `v1.6.19`. The production `hapro` add-on uses its published image.

## Local installation

`hapro-dev` is for local development only. The current pilot was installed manually on the Home Assistant device. It is not the production add-on, and this repository does not maintain an automated package-generation workflow for it.

## Configuration

Complete the **HA-MCP Server** integration entry after installing [the HA-MCP Custom Component](https://github.com/homeassistant-ai/ha-mcp-integration). The integration manages its own Home Assistant administrator credential. No additional Home Assistant token is configured in Hapro.

The add-on starts the MCP bridge automatically. No MCP-specific Hapro add-on options are required.

The bridge reads the single enabled HA-MCP Server entry from the mounted Home Assistant configuration and discovers its local secret URL. It does not modify Home Assistant storage. Keep exactly one enabled HA-MCP Server entry; if discovery fails, check that integration's configuration and storage format.

The add-on uses host networking and can reach the server over loopback. Redirects and public upstream destinations are rejected. The current bridge supports local secret URL authentication, without an interactive Home Assistant sign-in flow.

The bridge obtains the API verification key through the configured `apiUrl` HTTPS OpenID discovery and same-origin JWKS endpoints. The Hapro API signs requests with its corresponding OpenIddict signing certificate. Synchronize clocks; signatures expire after 60 seconds.

The add-on discovers the HA-MCP server URL and API signing key at runtime. Restart Hapro after changing its registration or network settings. Keep `uuid`, `apiUrl`, `caddy_port`, and existing tunnel settings appropriate for the environment.

## Development pilot

The Onboarding development setup generates `C:\Repositories\hapro-addon\mcp-development-options.yaml` with registration values for manual configuration. For the current local pilot, it uses the confirmed installed UUID `6bedbb5f2d6e41ed8cda3d57a01a683e`, `apiUrl: https://10.116.15.113:7061`, and port `8099`. The add-on starts the MCP bridge with automatic server and signing-key discovery. Hapro must listen on that LAN address. Its `RatHole__Url` must point to the PC's TCP endpoint `10.116.15.113:1010`, rather than localhost. The API reaches this pilot through the local rathole service port `127.0.0.1:4081`; the direct LAN override is available for troubleshooting only.

If setup cannot retrieve `client.toml`, Caddy and the Web API wait for registration and MCP will not listen yet. A blank UUID generates a new device identity. The API's device record, bridge settings, and installed add-on must all use the same confirmed UUID. Preserve unrelated add-on options when merging configuration.

The complete API, portal, environment, permissions, and deployment instructions are in `C:\Repositories\onboarding-tools\documentation\device-assistant-mcp-plan.md`.

The live pilot has confirmed add-on `v1.6.16` on aarch64, HA-MCP `8.7.0`, and MCP protocol `2025-11-25`. A signed readiness request through rathole succeeds. The complete authenticated Onboarding chat path also executed `ha_get_overview` successfully and returned an AI answer. The Onboarding .NET MCP client explicitly selects that verified protocol version.

## Routes and permissions

`GET /mcp/status` initializes the local server and returns safe readiness and version information. `POST`, `GET`, and `DELETE /mcp` forward MCP traffic. Every route requires an API signature bound to the device, request body, protocol headers, timestamp, and nonce; unsigned requests and replays are rejected. Browser tokens and signing headers are not forwarded to HA-MCP.

The add-on authenticates its Supervisor WebSocket connection by sending `SUPERVISOR_TOKEN` in the Home Assistant WebSocket authentication message after the connection opens.

Device visibility, session ownership, and tool permissions are enforced by the Hapro API. The initial API policy permits reads; control requires an explicit action tool list and a central Hapro administrator.


## Filesystem tools

The signed bridge forwards HA-MCP's native tool catalog and calls without adding filesystem tools. For file access, enable the HA-MCP File & YAML Tools integration entry and its filesystem beta feature. HA-MCP exposes `ha_list_files`, `ha_read_file`, `ha_write_file` and `ha_delete_file` only for paths its own allowlist permits. The Hapro API separately permits the read tools and requires administrator permission and an exact, single-use approval grant for each write or delete. The Onboarding chat collects that approval. Local add-ons are not exposed as a filesystem root by this bridge.

Rebuild and install this add-on image and rebuild/restart Hapro API plus Onboarding API after applying the matching changes. Production Hapro must explicitly permit `ha_write_file` and `ha_delete_file` in its action tool policy.
