import * as helpers from "./apiHelperService";
import { initWebsocketService, sendSocket } from "./websocketService";

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
  var enabledStatistics: string[] = [];
  try {
    enabledStatistics = typeof getAllEnabledStatistics === "object" ? getAllEnabledStatistics : JSON.parse(getAllEnabledStatistics);
  }
  catch (error) {
    console.error("Error parsing enabled statistics response:", error instanceof Error ? error.message : error, "Response content:", getAllEnabledStatistics);
    enabledStatistics = getAllEnabledStatistics ? String(getAllEnabledStatistics).replace(/[\[\]"]+/g, "").split(",").map((item: string) => item.trim()) : [];
  }
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
  const systemMonitorEnabled = await helpers.isSystemMonitorEnabled();
  if (systemMonitorEnabled) {
    console.debug("System Monitor is already enabled");
    return new Response(
      JSON.stringify({
        StatusCode: 400,
        Message: "System Monitor is already enabled",
      })
    );
  }
  let enableIntegration = null;
  let integrationFlowId = null;
  try {
    enableIntegration = await helpers.doHaInternalApiRequest(
      "/config/config_entries/flow",
      "POST",
      { "handler": "systemmonitor", "show_advanced_options": false }
    );
    integrationFlowId = enableIntegration?.flow_id;

    if (!integrationFlowId) {
      console.error("Failed to start System Monitor integration flow, no flow_id received");
      throw new Error("Failed to start System Monitor integration flow, no flow_id received");
    }
  } catch (error) {
    console.error("System Monitor is not enabled, got a bad response");
    return new Response(
      JSON.stringify({
        StatusCode: 500,
        Message: "System Monitor is not enabled, got a bad response"
      })
    )
  }
  console.debug("Started System Monitor integration flow with flow_id:", integrationFlowId);
  if (enableIntegration?.type === "abort") {
    await initWebsocketService();
    const configEntries = await sendSocket(
      "config_entries/get",
      { "domain": "systemmonitor" }
    );
    const entryId = configEntries?.[0]?.entry_id;
    if (entryId) {
      await sendSocket(
        "config_entries/disable",
        { "entry_id": entryId, "disabled_by": null }
      );
    }
  } else if (enableIntegration?.type !== "form" || enableIntegration?.errors !== null) {
    console.error("System Monitor is not enabled, error");
    return new Response(
      JSON.stringify({
        StatusCode: 500,
        Message: "System Monitor is not enabled, error"
      })
    );
  }

  console.debug("System Monitor is now installed");
  await helpers.doHaInternalApiRequest(
    `/config/config_entries/flow/${integrationFlowId}`,
    "POST",
    {}
  );
  console.info("System Monitor is now enabled");
  await helpers.doHaInternalApiRequest("/events/hapro_notification", "POST", {
    type: "Info",
    title: "Enabled System Monitor",
    message: "System Monitor integration is now enabled",
  });
  return new Response(
    JSON.stringify({
      StatusCode: 200,
      Message: "System Monitor is now enabled",
    })
  );
}

async function enableSystemMonitorEntities() {
  const systemMonitorEnabled = await helpers.isSystemMonitorEnabled();
  if (!systemMonitorEnabled) {
    console.error("System Monitor is disabled, cannot enable entities");
    return new Response(
      JSON.stringify({
        StatusCode: 400,
        Message: "System Monitor is disabled, cannot enable entities",
      })
    );
  }
  await initWebsocketService();
  const entitiesList = await sendSocket(
    "config/entity_registry/list",
    {}
  );
  const entitiesDisabled = entitiesList.filter(
    (entry) => entry?.platform === "systemmonitor" && entry?.disabled_by !== null
  );
  const statistics = await helpers.getSMStatistics();
  for (const key in statistics) {
    if (statistics[key] !== null) {
      const entity = entitiesDisabled.find(
        (entry) => entry.entity_id === statistics[key]
      );
      if (entity) {
        await sendSocket(
          "config/entity_registry/update",
          {
            entity_id: entity.entity_id,
            disabled_by: null
          }
        );
      }
    }
  }
  console.info("Enabled System Monitor Entities");
  await helpers.doHaInternalApiRequest("/events/hapro_notification", "POST", {
    type: "Info",
    title: "Entities Enabled",
    message: "System Monitor entities have been (re-)enabled, it might take a few moments for them to be available",
  });
  return new Response(
    JSON.stringify({
      StatusCode: 200,
      Message: "Enabled System Monitor entities",
    })
  );
}

export {getStatisticHistory, enableSystemMonitor, enableSystemMonitorEntities};