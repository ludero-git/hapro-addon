async function doSupervisorRequest(
  path: string,
  method = "GET",
  body: object | undefined = undefined
) {
  const response = await fetch(`http://supervisor${path}`, {
    method: method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Bun.env.SUPERVISOR_TOKEN}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return await response.json();
}

async function doHaInternalApiRequest(
  path: string,
  method = "GET",
  body: object | undefined = undefined
) {
  const response = await fetch(`http://supervisor/core/api${path}`, {
    method: method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Bun.env.SUPERVISOR_TOKEN}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.headers.get("content-type") === "application/json")
    return await response.json();
  return await response.text();
}

async function isSystemMonitorEnabled() {
  const configEntries = Bun.file("/homeassistant/.storage/core.config_entries");
  const configEntriesText = await configEntries.text();
  const configEntriesContent = JSON.parse(configEntriesText);
  const systemMonitorEntry = configEntriesContent.data.entries.find(
    (entry) => entry.domain === "systemmonitor"
  );
  if (systemMonitorEntry && systemMonitorEntry.disabled_by !== null) {
    return false;
  }

  const response = await doHaInternalApiRequest(`/template`, "POST", {
    template: `{{ integration_entities('System Monitor') | tojson }}`,
  });
  return response.length > 0;
}

async function getSMStatistics() {
  const result = await doHaInternalApiRequest("/template", "POST", {
    template: `{{ integration_entities('System Monitor') | tojson }}`,
  });
  const SMStatistics = JSON.parse(result);
  if (SMStatistics.length <= 0) return SMStatistics;
  const languageConfig = Bun.file("/homeassistant/.storage/core.config");
  const languageConfigContent = await languageConfig.json();
  const language = languageConfigContent.data.language;
  
  switch (language) {
    case "nl":
      return {
        storageUsed: SMStatistics.find(sensor => sensor.includes("sensor.system_monitor_disk_use")) ?? "sensor.system_monitor_disk_use",
        storageFree: SMStatistics.find(sensor => sensor.includes("sensor.system_monitor_disk_free")) ?? "sensor.system_monitor_disk_free",
        storageUsage: SMStatistics.find(sensor => sensor.includes("sensor.system_monitor_schijfgebruik")) ?? "sensor.system_monitor_disk_usage",
        cpuUsage: SMStatistics.find(sensor => sensor.includes("sensor.system_monitor_processor_use")) ?? "sensor.system_monitor_processor_use",
        cpuTemp: SMStatistics.find(sensor => sensor.includes("sensor.system_monitor_processortemperatuur")) ?? "sensor.system_monitor_processor_temperature",
        memoryUsed: SMStatistics.find(sensor => sensor.includes("sensor.system_monitor_memory_use")) ?? "sensor.system_monitor_memory_use",
        memoryFree: SMStatistics.find(sensor => sensor.includes("sensor.system_monitor_memory_free")) ?? "sensor.system_monitor_memory_free",
        memoryUsage: SMStatistics.find(sensor => sensor.includes("sensor.system_monitor_memory_usage")) ?? "sensor.system_monitor_memory_usage",
      };  
    default:
      return {
        storageUsed: SMStatistics.find(sensor => sensor.includes("sensor.system_monitor_disk_use")),
        storageFree: SMStatistics.find(sensor => sensor.includes("sensor.system_monitor_disk_free")),
        storageUsage: SMStatistics.find(sensor => sensor.includes("sensor.system_monitor_disk_usage")),
        cpuUsage: SMStatistics.find(sensor => sensor.includes("sensor.system_monitor_processor_use")),
        cpuTemp: SMStatistics.find(sensor => sensor.includes("sensor.system_monitor_processor_temperature")),
        memoryUsed: SMStatistics.find(sensor => sensor.includes("sensor.system_monitor_memory_use")),
        memoryFree: SMStatistics.find(sensor => sensor.includes("sensor.system_monitor_memory_free")),
        memoryUsage: SMStatistics.find(sensor => sensor.includes("sensor.system_monitor_memory_usage")),
      };
  }
}

async function getUuid() {
  const uuid = Bun.env.HAPRO_UUID;
  if (!uuid) {
    console.error(
      "WebApi failed to retrieve UUID: UUID is not set in environment variables.",
    );
    return null;
  }
  return uuid;
}

async function getApiUrl() {
  const apiUrl = Bun.env.HAPRO_API_URL;
  if (!apiUrl) {
    console.error(
      "WebApi failed to retrieve API URL: API URL is not set in environment variables.",
    );
    return null;
  }
  return apiUrl;
}

export { doSupervisorRequest, doHaInternalApiRequest, isSystemMonitorEnabled, getSMStatistics, getUuid, getApiUrl };