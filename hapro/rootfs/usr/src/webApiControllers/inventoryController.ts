import * as helpers from "./apiHelperService";
import { getUuid } from "./apiHelperService";
import { initWebsocketService, sendSocket } from "./websocketService";

type StoredConfigEntry = {
  entry_id?: string;
  domain?: string;
  title?: string;
  source?: string;
  unique_id?: string | null;
  disabled_by?: string | null;
  data?: unknown;
  options?: unknown;
  [key: string]: unknown;
};

type Manifest = {
  domain?: string;
  name?: string;
  version?: string;
  is_built_in?: boolean;
  [key: string]: unknown;
};

const CONFIG_ENTRIES_PATH = "/homeassistant/.storage/core.config_entries";
const READ_ATTEMPTS = 3;

async function getInventory(): Promise<Response> {
  try {
    const [coreConfig, storedEntries, socketEntries, manifests, apps, uuid] = await Promise.all([
      helpers.doHaInternalApiRequest("/config"),
      readConfigEntries(CONFIG_ENTRIES_PATH),
      getConfigEntryStates(),
      getManifests(),
      helpers.doSupervisorRequest("/addons"),
      getUuid(),
    ]);

    const stateByEntryId = new Map<string, string>();
    for (const entry of Array.isArray(socketEntries) ? socketEntries : []) {
      if (entry?.entry_id && entry?.state) stateByEntryId.set(entry.entry_id, entry.state);
    }
    const manifestByDomain = new Map<string, Manifest>();
    for (const manifest of Array.isArray(manifests) ? manifests : []) {
      if (manifest?.domain) manifestByDomain.set(manifest.domain, manifest);
    }

    const entriesByDomain = new Map<string, StoredConfigEntry[]>();
    for (const entry of storedEntries) {
      if (!entry.domain) continue;
      const entries = entriesByDomain.get(entry.domain) ?? [];
      entries.push(entry);
      entriesByDomain.set(entry.domain, entries);
    }

    const domains = new Set<string>(entriesByDomain.keys());
    for (const component of Array.isArray(coreConfig?.components) ? coreConfig.components : []) {
      if (typeof component === "string") domains.add(component.split(".", 1)[0]);
    }

    const integrations = Array.from(domains).sort().map((domain) => {
      const manifest = manifestByDomain.get(domain);
      const entries = entriesByDomain.get(domain) ?? [];
      const states = entries.map((entry) => entry.entry_id ? stateByEntryId.get(entry.entry_id) : undefined).filter(Boolean);
      const state = states.includes("loaded") ? "loaded" : states[0] ?? (entries.length === 0 ? "loaded_component" : "unknown");
      return {
        domain,
        name: manifest?.name ?? humanizeDomain(domain),
        version: manifest?.is_built_in === false ? manifest?.version ?? null : null,
        state,
        configurations: entries.map((entry) => ({
          entry_id: entry.entry_id ?? null,
          title: entry.title ?? humanizeDomain(domain),
          source: entry.source ?? null,
          unique_id: entry.unique_id ?? null,
          disabled_by: entry.disabled_by ?? null,
          state: entry.entry_id ? stateByEntryId.get(entry.entry_id) ?? "unknown" : "unknown",
          data: entry.data ?? {},
          options: entry.options ?? {},
        })),
      };
    });

    const supervisorApps = Array.isArray(apps?.data?.addons) ? apps.data.addons : [];
    const installedApps = supervisorApps.filter((app: any) => app?.installed === true).map((app: any) => ({
      slug: String(app.slug ?? "unknown"),
      name: String(app.name ?? app.slug ?? "Unknown app"),
      version: app.version == null ? null : String(app.version),
      state: app.state == null ? null : String(app.state),
      configuration: {
        redacted: true,
        reason: "App options are intentionally excluded from inventory exports.",
      },
    }));

    return jsonResponse(200, {
      device_id: uuid ?? "unknown",
      ha_version: String(coreConfig?.version ?? "unknown"),
      collected_at: new Date().toISOString(),
      integrations,
      apps: installedApps,
    });
  } catch (error) {
    console.error("Inventory collection failed:", error instanceof Error ? error.message : String(error));
    return jsonResponse(500, null, "Inventory collection failed");
  }
}

async function readConfigEntries(path: string): Promise<StoredConfigEntry[]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= READ_ATTEMPTS; attempt++) {
    try {
      const content = await Bun.file(path).text();
      return parseConfigEntries(content);
    } catch (error) {
      lastError = error;
      if (attempt < READ_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, attempt * 100));
    }
  }
  throw new Error(`Unable to read Home Assistant config entries after ${READ_ATTEMPTS} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function parseConfigEntries(content: string): StoredConfigEntry[] {
  const parsed = JSON.parse(content);
  const entries = parsed?.data?.entries;
  if (!Array.isArray(entries)) throw new Error("Home Assistant config entry storage has an unsupported structure.");
  return entries.filter((entry: unknown): entry is StoredConfigEntry => Boolean(entry) && typeof entry === "object");
}

async function getConfigEntryStates(): Promise<any[]> {
  await initWebsocketService();
  const result = await sendSocket("config_entries/get", {});
  return Array.isArray(result) ? result : [];
}

async function getManifests(): Promise<Manifest[]> {
  await initWebsocketService();
  const result = await sendSocket("manifest/list", {});
  return Array.isArray(result) ? result : [];
}

function humanizeDomain(domain: string): string {
  return domain.split("_").filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function jsonResponse(statusCode: number, data: unknown, message?: string): Response {
  return new Response(JSON.stringify({ StatusCode: statusCode, data, ...(message ? { Message: message } : {}) }), {
    status: statusCode,
    headers: { "Content-Type": "application/json" },
  });
}

export { getInventory, parseConfigEntries, humanizeDomain };
