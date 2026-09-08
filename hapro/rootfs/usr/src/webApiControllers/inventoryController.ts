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

async function getSupervisorApps(): Promise<any[]> {
  for (const [path, key] of [["/addons", "addons"], ["/apps", "apps"]] as const) {
    try {
      const response = await helpers.doSupervisorRequest(path);
      const apps = response?.data?.[key];
      if (Array.isArray(apps)) return apps;
    } catch (error) {
      console.warn(`Unable to read Supervisor ${path} endpoint:`, error instanceof Error ? error.message : String(error));
    }
  }
  return [];
}

async function getSupervisorAppConfiguration(app: any): Promise<{
  schema: Record<string, unknown>;
  options: Record<string, unknown>;
}> {
  let schema: Record<string, unknown> = {};
  let options: Record<string, unknown> = {};

  if (app?.schema && typeof app.schema === "object" && !Array.isArray(app.schema)) schema = app.schema;
  if (app?.options && typeof app.options === "object" && !Array.isArray(app.options)) options = app.options;

  const slug = encodeURIComponent(String(app.slug));
  const paths = [
    `/addons/${slug}/options/config`,
    `/apps/${slug}/options/config`,
    `/addons/${slug}/info`,
    `/apps/${slug}/info`,
  ];

  for (const path of paths) {
    try {
      const response = await helpers.doSupervisorRequest(path);
      const data = response?.data ?? response;
      const candidateSchema = data?.schema ?? data?.configuration?.schema;
      const candidateOptions = data?.options ?? data?.configuration?.options;
      if (candidateSchema && typeof candidateSchema === "object" && !Array.isArray(candidateSchema)) {
        schema = { ...schema, ...candidateSchema };
      }
      if (candidateOptions && typeof candidateOptions === "object" && !Array.isArray(candidateOptions)) {
        options = { ...options, ...candidateOptions };
      }
      if (Object.keys(schema).length > 0) break;
    } catch {
      // Try the next Supervisor API route for compatibility.
    }
  }

  return { schema, options };
}

function schemaField(rule: unknown, defaultValue?: unknown): Record<string, unknown> {
  const value = String(rule ?? "");
  if (!value && defaultValue !== undefined) {
    return {
      type: Array.isArray(defaultValue) ? "array" : typeof defaultValue,
      required: false,
    };
  }
  const optional = value.endsWith("?");
  const normalized = value.replace(/\?$/, "");
  const match = normalized.match(/^match\((.*)\)$/);
  const type = normalized === "int"
    ? "integer"
    : normalized === "bool"
      ? "boolean"
      : "string";

  return {
    type,
    required: !optional,
    ...(match ? { validation: match[1] } : {}),
  };
}

async function getConfigurationSchema(app: any): Promise<Record<string, unknown>> {
  const { schema, options } = await getSupervisorAppConfiguration(app);
  const fieldNames = new Set([...Object.keys(options), ...Object.keys(schema)]);
  const fields = Object.fromEntries(
    Array.from(fieldNames).map((name) => [name, schemaField(schema[name], options[name])])
  );
  return { fields };
}

async function getInventory(): Promise<Response> {
  try {
    const [coreConfig, storedEntries, socketEntries, manifests, apps, uuid] = await Promise.all([
      helpers.doHaInternalApiRequest("/config"),
      readConfigEntries(CONFIG_ENTRIES_PATH),
      getConfigEntryStates(),
      getManifests(),
      getSupervisorApps(),
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

    const installedApps = await Promise.all(apps
      .filter((app: any) => app?.installed === true || app?.state === "started" || app?.state === "stopped")
      .map(async (app: any) => ({
      slug: String(app.slug ?? "unknown"),
      name: String(app.name ?? app.slug ?? "Unknown app"),
      version: app.version == null ? null : String(app.version),
      state: app.state == null ? null : String(app.state),
      configuration: await getConfigurationSchema(app),
    })));

    return helpers.jsonResponse(200, {
      device_id: uuid ?? "unknown",
      ha_version: String(coreConfig?.version ?? "unknown"),
      collected_at: new Date().toISOString(),
      integrations,
      apps: installedApps,
    });
  } catch (error) {
    console.error("Inventory collection failed:", error instanceof Error ? error.message : String(error));
    return helpers.jsonResponse(500, null, "Inventory collection failed");
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

export { getInventory, parseConfigEntries, humanizeDomain };
