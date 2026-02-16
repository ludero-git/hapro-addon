async function doSupervisorRequest(
  path: string,
  method = "GET",
  body: object | undefined = undefined,
) {
  try {
    const response = await fetch(`http://supervisor${path}`, {
      method: method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Bun.env.SUPERVISOR_TOKEN}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const responseText = await response.text();
    console.debug(
      `Supervisor API request to ${path} responded with status ${response.status} and content-type ${response.headers.get("content-type")} and body: ${responseText}`,
    );
    return JSON.parse(responseText);
  } catch (error) {
    console.error(
      `Error during Supervisor API request to ${path}:`,
      error instanceof Error ? error.message : error,
    );
    throw error;
  }
}

async function doHaInternalApiRequest(
  path: string,
  method = "GET",
  body: object | undefined = undefined,
) {
  try {
    const response = await fetch(`http://supervisor/core/api${path}`, {
      method: method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Bun.env.SUPERVISOR_TOKEN}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const contentType = response.headers.get("content-type");
    const responseText = await response.text();
    console.debug(
      `HA internal API request to ${path} responded with status ${response.status} and content-type ${contentType} and body: ${responseText}`,
    );
    if (
      typeof contentType === "string" &&
      contentType.indexOf("application/json") !== -1
    )
      return JSON.parse(responseText);
    return responseText;
  } catch (error) {
    console.error(
      `Error during HA internal API request to ${path}:`,
      error instanceof Error ? error.message : error,
    );
    throw error;
  }
}

async function isSystemMonitorEnabled() {
  const configEntries = Bun.file("/homeassistant/.storage/core.config_entries");
  const configEntriesText = await configEntries.text();
  const configEntriesContent = JSON.parse(configEntriesText);
  const systemMonitorEntry = configEntriesContent.data.entries.find(
    (entry) => entry.domain === "systemmonitor",
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
  var SMStatistics: string[] = [];
  try {
    SMStatistics = typeof result === "object" ? result : JSON.parse(result);
  } catch (error) {
    console.error(
      "Error parsing System Monitor statistics response:",
      error instanceof Error ? error.message : error,
      "Response content:",
      result,
    );
    SMStatistics = result
      ? String(result)
          .replace(/[\[\]"]+/g, "")
          .split(",")
          .map((item: string) => item.trim())
      : [];
  }
  if (SMStatistics.length <= 0) return SMStatistics;
  const languageConfig = Bun.file("/homeassistant/.storage/core.config");
  const languageConfigContent = await languageConfig.json();
  const language = languageConfigContent.data.language;

  var defaultRegexSet = {
    storageUsed: /^sensor\.(system_monitor_)?disk_use(_\d+)?$/i,
    storageFree: /^sensor\.(system_monitor_)?disk_free(_\d+)?$/i,
    storageUsage:
      /^sensor\.(system_monitor_)?disk_((usage)|(use_percent))(_\d+)?$/i,
    cpuUsage: /^sensor\.(system_monitor_)?processor_use(_\d+)?$/i,
    cpuTemp: /^sensor\.(system_monitor_)?processor_temperature(_\d+)?$/i,
    memoryUsed: /^sensor\.(system_monitor_)?memory_use(_\d+)?$/i,
    memoryFree: /^sensor\.(system_monitor_)?memory_free(_\d+)?$/i,
    memoryUsage:
      /^sensor\.(system_monitor_)?memory_((usage)|(use_percent))(_\d+)?$/i,
    swapUsed: /^sensor\.(system_monitor_)?swap_use(_\d+)?$/i,
    swapFree: /^sensor\.(system_monitor_)?swap_free(_\d+)?$/i,
    swapUsage:
      /^sensor\.(system_monitor_)?swap_((usage)|(use_percent))(_\d+)?$/i,
  };

  var regexSet = { ...defaultRegexSet };

  // Adjust regex patterns based on language
  switch (language) {
    case "nl":
      regexSet = {
        ...defaultRegexSet,
        storageUsage: /^sensor\.(system_monitor_)?schijfgebruik(_\d+)?$/i,
        cpuTemp: /^sensor\.(system_monitor_)?processortemperatuur(_\d+)?$/i,
        memoryUsage: /^sensor\.(system_monitor_)?geheugengebruik(_\d+)?$/i,
      };
  }

  return {
    storageUsed:
      SMStatistics.find((sensor) => sensor.match(regexSet.storageUsed)) ??
      SMStatistics.find((sensor) => sensor.match(defaultRegexSet.storageUsed)),
    storageFree:
      SMStatistics.find((sensor) => sensor.match(regexSet.storageFree)) ??
      SMStatistics.find((sensor) => sensor.match(defaultRegexSet.storageFree)),
    storageUsage:
      SMStatistics.find((sensor) => sensor.match(regexSet.storageUsage)) ??
      SMStatistics.find((sensor) => sensor.match(defaultRegexSet.storageUsage)),
    cpuUsage:
      SMStatistics.find((sensor) => sensor.match(regexSet.cpuUsage)) ??
      SMStatistics.find((sensor) => sensor.match(defaultRegexSet.cpuUsage)),
    cpuTemp:
      SMStatistics.find((sensor) => sensor.match(regexSet.cpuTemp)) ??
      SMStatistics.find((sensor) => sensor.match(defaultRegexSet.cpuTemp)),
    memoryUsed:
      SMStatistics.find((sensor) => sensor.match(regexSet.memoryUsed)) ??
      SMStatistics.find((sensor) => sensor.match(defaultRegexSet.memoryUsed)),
    memoryFree:
      SMStatistics.find((sensor) => sensor.match(regexSet.memoryFree)) ??
      SMStatistics.find((sensor) => sensor.match(defaultRegexSet.memoryFree)),
    memoryUsage:
      SMStatistics.find((sensor) => sensor.match(regexSet.memoryUsage)) ??
      SMStatistics.find((sensor) => sensor.match(defaultRegexSet.memoryUsage)),
    swapUsed:
      SMStatistics.find((sensor) => sensor.match(regexSet.swapUsed)) ??
      SMStatistics.find((sensor) => sensor.match(defaultRegexSet.swapUsed)),
    swapFree:
      SMStatistics.find((sensor) => sensor.match(regexSet.swapFree)) ??
      SMStatistics.find((sensor) => sensor.match(defaultRegexSet.swapFree)),
    swapUsage:
      SMStatistics.find((sensor) => sensor.match(regexSet.swapUsage)) ??
      SMStatistics.find((sensor) => sensor.match(defaultRegexSet.swapUsage)),
  };
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

export {
  doSupervisorRequest,
  doHaInternalApiRequest,
  isSystemMonitorEnabled,
  getSMStatistics,
  getUuid,
  getApiUrl,
};
