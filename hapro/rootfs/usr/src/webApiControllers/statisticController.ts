import * as helpers from "./apiHelperService";

async function getStatisticHistory(statistic) {
  if (!(await helpers.isSystemMonitorEnabled()))
    return new Response(
      JSON.stringify({
        StatusCode: 400,
        Message: "System Monitor Integration is disabled",
      })
    );
  const statistics = await helpers.getSMStatistics();

  if (!statistics.hasOwnProperty(statistic))
    return new Response(
      JSON.stringify({ StatusCode: 400, Message: "Invalid Statistic" })
    );

  const getAllEnabledStatistics = await helpers.doHaInternalApiRequest(
    `/template`,
    "POST",
    {
      template: `{% set enabled_entities = namespace(entities=[]) %}
{% for entity in integration_entities('System Monitor') %}
  {% if states(entity) != "unknown" %}
   {% set enabled_entities.entities = enabled_entities.entities + [ entity ] %}
  {% endif %}
{% endfor %}
{{ enabled_entities.entities | tojson }}`,
    }
  );
  const enabledStatistics = JSON.parse(getAllEnabledStatistics);
  if (!enabledStatistics.includes(statistics[statistic]))
    return new Response(
      JSON.stringify({ StatusCode: 400, Message: "Statistic is not enabled" })
    );
  var entityId = statistics[statistic];
  const currentDateTimeMinusOneHour = new Date(
    new Date().getTime() - 3600 * 1000
  );
  const response = await helpers.doHaInternalApiRequest(
    `/history/period/${currentDateTimeMinusOneHour.toISOString()}?filter_entity_id=${entityId}&minimal_response&no_attributes&significant_changes_only`
  );
  return new Response(JSON.stringify({ StatusCode: 200, data: response }));
}

async function enableSystemMonitor() {
  const configEntries = Bun.file("/homeassistant/.storage/core.config_entries");
  const configEntriesText = await configEntries.text();
  const configEntriesContent = JSON.parse(configEntriesText);
  const systemMonitorEntry = configEntriesContent.data.entries.find(
    (entry) => entry.domain === "systemmonitor"
  );
  if (systemMonitorEntry && systemMonitorEntry.disabled_by === null) {
    console.debug("System Monitor is already enabled");
    return new Response(
      JSON.stringify({
        StatusCode: 400,
        Message: "System Monitor is already enabled",
      })
    );
  }
  if (systemMonitorEntry) {
    systemMonitorEntry.disabled_by = null;
    await Bun.write(
      "/homeassistant/.storage/core.config_entries",
      JSON.stringify(configEntriesContent, null, 2)
    );
    console.info("System Monitor is now enabled");
    await helpers.doHaInternalApiRequest("/events/hapro_notification", "POST", {
      type: "Info",
      title: "Restarting",
      message: "System Monitor is now enabled, Home Assistant is restarting",
    });
    setTimeout(async () => {
      try {
        await fetch("http://supervisor/core/restart", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Bun.env.SUPERVISOR_TOKEN}`,
          },
        });
      } catch (error) {
        console.error("Error during system restart:", error);
      }
    }, 500);
    return new Response(
      JSON.stringify({
        StatusCode: 200,
        Message: "System Monitor is now enabled, Home Assistant is restarting",
      })
    );
  }
  const dateTime = new Date().toISOString();
  const systemMonitorConfig = {
    created_at: dateTime,
    data: {},
    discovery_keys: {},
    disabled_by: null,
    domain: "systemmonitor",
    entry_id: crypto
      .randomUUID()
      .replace(/-/g, "")
      .substring(0, 26)
      .toUpperCase(),
    minor_version: 3,
    modified_at: dateTime,
    options: {},
    pref_disable_new_entities: false,
    pref_disable_polling: false,
    source: "user",
    subentries: [],
    title: "System Monitor",
    unique_id: null,
    version: 1,
  };
  configEntriesContent.data.entries.push(systemMonitorConfig);
  await Bun.write(
    "/homeassistant/.storage/core.config_entries",
    JSON.stringify(configEntriesContent, null, 2)
  );
  console.info("System Monitor is now installed");
  const configEntries2 = Bun.file(
    "/homeassistant/.storage/core.config_entries"
  );

  await helpers.doHaInternalApiRequest("/events/hapro_notification", "POST", {
    type: "Info",
    title: "Restarting",
    message: "System Monitor is now installed, Home Assistant is restarting",
  });
  const configEntriesText2 = await configEntries2.text();
  const configEntriesContent2 = JSON.parse(configEntriesText2);
  const systemMonitorEntry2 = configEntriesContent2.data.entries.find(
    (entry) => entry.domain === "systemmonitor"
  );

  console.warn("Home Assistant is restarting");
  setTimeout(async () => {
    try {
      await fetch("http://supervisor/core/restart", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Bun.env.SUPERVISOR_TOKEN}`,
        },
      });
    } catch (error) {
      console.error("Error during system restart:", error);
    }
  }, 500);

  return new Response(
    JSON.stringify({
      StatusCode: 200,
      Message: "System Monitor is now installed, Home Assistant is restarting",
    })
  );
}

async function enableSystemMonitorEntities() {
  const isSMEnabled = await helpers.isSystemMonitorEnabled();
  if (!isSMEnabled) {
    console.error("System Monitor is disabled, cannot enable entities");
    return new Response(
      JSON.stringify({
        StatusCode: 400,
        Message: "System Monitor is disabled, cannot enable entities",
      })
    );
  }
  const entityEntries = Bun.file(
    "/homeassistant/.storage/core.entity_registry"
  );
  const entityEntriesText = await entityEntries.text();
  const entityEntriesContent = JSON.parse(entityEntriesText);
  const statistics = await helpers.getSMStatistics();
  for (const key in statistics) {
    if (statistics[key] !== null) {
      const entity = entityEntriesContent.data.entities.find(
        (entry) => entry.entity_id === statistics[key]
      );
      if (entity) {
        entity.disabled_by = null;
        entity.hidden_by = null;
      }
    }
  }
  await Bun.write(
    "/homeassistant/.storage/core.entity_registry",
    JSON.stringify(entityEntriesContent, null, 2)
  );
  console.info("Enabled System Monitor entities");

  console.warn("Home Assistant is restarting");
  setTimeout(async () => {
    try {
      await fetch("http://supervisor/core/restart", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Bun.env.SUPERVISOR_TOKEN}`,
        },
      });
    } catch (error) {
      console.error("Error during system restart:", error);
    }
  }, 500);

  return new Response(
    JSON.stringify({
      StatusCode: 200,
      Message: "Enabled System Monitor entities, Home Assistant is restarting",
    })
  );
}

export {getStatisticHistory, enableSystemMonitor, enableSystemMonitorEntities};