<!-- https://developers.home-assistant.io/docs/add-ons/presentation#keeping-a-changelog -->

## v1.2.2 04/02/2026
### Added
- Support for configurable Caddy port to resolve conflicts

### Fixed
- Revert support for non-AVX/AVX2 since that wasn't the issue, it's a tailscale conflict

## v1.2.1 04/02/2026
### Fixed
- Support for older non-AVX/AVX2 CPU support (some celeron devices had caddy issues)

## v1.2 04/02/2026
### Added
- Added option to enable debug logging for all services
- Added option to change api endpoint

### Fixed
- Fixed an issue where caddy wasn't using the env vars as intended

## v1.1 21/01/2026
### Ownership Transfer
- The ownership of the HaPro addon has been transferred to Ludero

### Fixes
- Fixed an issue where homeassistant would get corrupted on enabling systemmonitor statistics


## v1.0 17/01/2025
# File Distribution
- Added the system for file distribution

## v1.0-alpha13.2 - 09/01/2025
### Fixed
- Fixed blueprint
- Fixed restarting on OOM and reattaching to notifications on ha reboot

## v1.0-alpha13.1 - 08/01/2025
### Fixed
- Fixed multi language support voor statisttics
- Changed rathole ip to prevent connection refused

## v1.0-alpha13 - 07/01/2025
Notification system

### Added
- There now is an automation blueprint for ha notifications
- On the start of the addon, the addon will update the available automations based on the blueprint
- The internal api now starts a WS connection to the HA WebSocket API to listen for notifications and send them to the hapro server

## v1.0-alpha12 - 19/12/2024
HA User management

### Added
- The internal api now has endpoints to gather the existing auth accounts on the device

### Changed
- The auth-header has been updated

## v1.0-alpha11.5 - 16/12/2024

### Changed
- Improved the route handling in the internal api

## v1.0-alpha11.2 - 28/11/2024

### Changed
- The logs are improved and now use bashio for logging
- The rathole image is now maintained by bitfox-git to ensure the latest rathole version is always used

## v1.0-alpha11 - 26/11/2024

### Added
- There is now a development version of the addon available for testing against the development server

## v1.0-alpha10 - 19/11/2024

### Added
- Added backup restore endpoint
- Added backup restore status endpoint
- Added backup upload endpoint
- Improved rathole security

### Changed
- Renamed all device and update slugs to identifier

### Fixed
- The backup notifier now only starts tracking on .tar files
- Error on system monitor check (json parse)

## v1.0-alpha9.2 - 13/11/2024

### Fixed
- The addon now properly handles existing http configurations in the configuration.yaml

## v1.0-alpha9.1 - 12/11/2024

### Added
- Backup delete endpoint

### Changed
- The internal api has now been restructured to be more modular and easier to maintain

## v1.0-alpha9 - 12/11/2024

### Added
- Backup system, the internal api has endpoints to list and download backups
- The addon notifies the server when a backup is created and the server will manage the external storage of the backups
- The logs now provide insight over the current addon version and the newest available version if applicable

### Fixed
- The updates now dont list unavailable updates anymore

## v1.0-alpha8 - 07/11/2024

### Fixed
- CRLF line endings have been replaced with LF line endings

## v1.0-alpha7 - 07/11/2024

### Added
- Readded the github flows

### Changed
- README has been updated and the naming is now HaPro everywhere
- The addon now uses the deployed image from the github registry

## v1.0-alpha6 - 06/11/2024

### Added
- The internal api now supports getting history of a specific statistic
- The internal api also supports enabling statistics

### Changed
- The info endpoint now returns the system monitor stats if available, otherwise it tries to use a fallback value from the supervisor

## v1.0-alpha5 - 04/11/2024

### Added
- The internal api now has the following endpoints for updates:
    - GET: updates: returns all available updates
    - POST: updates/{updateSlug}: installs the update with the given slug
    - POST: updates/{updateSlug}/skip: skips the update with the given slug
    - POST: updates/{updateSlug}/clear: clears the skipped update with the given slug

## v1.0-alpha4 - 28/10/2024

### Added
- The auth headers from the Traefik middleware are now used to skip the HA login page
- All traffic to the ha is now validated by the Traefik middleware
- Ip endpoint to internal api

## v1.0-alpha3 - 15/10/2024

### Added
- Bun has been added to the list of installed packages for the internal api
- Bun is now serving an internal api and Caddy is now reverse proxying to it
- The following endpoints have been implemented in the internal api:
    - ping: simple check to see if the api is reachable
    - info: returns general info about the ha

### Changed
- The used images are once again debian based, this is due to the fact that the alpine images are not compatible with bun (or deno)

## v1.0-alpha2 - 14/10/2024

### Added
- S6-overlay is now using v3 architecture for better dependency and service management
- Some functionalities have been readded from the previous state:
    - The http in configuration.yaml is now added automatically again
    - Some hardcoded vars have been replaced with requested vars from the hapro api or the supervisor (subdomain, internal ip, internal port, etc)
- The used addon images are no longer debian but alpine based (officially recommended by home assistant)

## v1.0-alpha1 - 26/09/2024

*A lot of functionality has been removed for this alpha from the previous state, most will be readded in the near future but in a better/cleaner format.*

### Added
- Rathole has been added including:
    - Automatically getting toml
    - Registering device (as pending) when device does not exist yet
    - Opening tunnel with HaPro server
- Caddy has been added including:
    - Dynamic Caddyfile via env vars
    - A reverse proxy to capture hapro api requests and pass the rest to home assistant