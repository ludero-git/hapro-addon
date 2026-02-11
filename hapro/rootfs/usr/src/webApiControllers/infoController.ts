import * as helpers from "./apiHelperService";
import { getCurrentFileVersion } from "./fileController";
async function ping() {
  const pingResponse = await helpers.doSupervisorRequest("/supervisor/ping");
  return new Response(JSON.stringify(pingResponse));
}

async function getIp() {
  const ipResponse = await fetch("https://ipinfo.io/ip");
  const ip = await ipResponse.text();
  return new Response(JSON.stringify({ StatusCode: 200, data: ip }));
}

async function getInfo() {
  try {
    const [coreInfo, updateInfo, hostInfo, isSMEnabled, statistics, fileObject] = await Promise.all([
      helpers.doSupervisorRequest("/core/info"),
      helpers.doHaInternalApiRequest("/template", "POST", {template: `{{states.update | selectattr('state', 'equalto', 'on') | list | count}}`}),
      helpers.doSupervisorRequest("/host/info"),
      helpers.isSystemMonitorEnabled(),
      helpers.getSMStatistics(),
      getCurrentFileVersion()
  ]);

    const warnings: string[] = [];
    const alternativeStatistics = {
      storageUsed: hostInfo.data.disk_used,
      storageFree: hostInfo.data.disk_free
    };
    if(!isSMEnabled) {
      warnings.push("System Monitor Integration is disabled");
        for (const key in statistics) {
          if (alternativeStatistics.hasOwnProperty(key)) {
            statistics[key] = alternativeStatistics[key];
            warnings.push(`Using alternative value for ${key}`);
          } else {
            statistics[key] = null;
          }
        }
    }
    else {
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
      const statPromises = Object.entries(statistics).map(async ([key, entity]) => {
        if (enabledStatistics.includes(entity)) {
          const result = await helpers.doHaInternalApiRequest(`/states/${entity}`);
          return [key, parseFloat(result.state)];
        } else if (alternativeStatistics.hasOwnProperty(key)) {
          warnings.push(`Statistic ${key} is not enabled, using alternative value`);
          return [key, alternativeStatistics[key]];
        } else {
          warnings.push(`Statistic ${key} is not enabled, and no alternative value is available`);
          return [key, null];
        }
      });
    const resolvedStats = await Promise.all(statPromises);
    resolvedStats.forEach(([key, value]) => {
      statistics[key] = value;
    });
  }
  const fileVersion = await fileObject.json();
    const response = {
      machine: coreInfo.data.machine,
      haVersion: coreInfo.data.version,
      updates: updateInfo,
      fileVersion: fileVersion?.data?.version || 0,
      storage: {
        total: (statistics["storageUsed"] + statistics["storageFree"]),
        used: statistics["storageUsed"],
        free: statistics["storageFree"],
        usage: statistics["storageUsage"] ?? parseFloat(statistics["storageUsed"]) / parseFloat(statistics["storageUsed"] + statistics["storageFree"]) * 100,
      },
      cpu: {
        usage: statistics["cpuUsage"],
        temperature: statistics["cpuTemp"]
      },
      memory: {
        total: (statistics["memoryUsed"] == null || statistics["memoryFree"] == null) ? null : (statistics["memoryUsed"] + statistics["memoryFree"]),
        used: statistics["memoryUsed"],
        free: statistics["memoryFree"],
        usage: statistics["memoryUsage"],
      },
    };
    return new Response(JSON.stringify({ StatusCode: 200, data: response, Warnings: warnings }));
  } catch (error) {
    console.error(error);
    return new Response(
      JSON.stringify({ StatusCode: 500, Message: "Internal Server Error" })
    );
  }
}

async function getUsers() {
  try {
    var users: object[] = [];
    const authList = Bun.file("/homeassistant/.storage/auth");
    const authContent = JSON.parse(await authList.text());
    for (const user of authContent.data.users.filter((user) => !user.system_generated)) {
      users.push({
        name: user.name,
        isOwner: user.is_owner,
        isAdmin: user.group_ids.includes("system-admin"),
        isActivated: user.is_active,
      });
    }
    return new Response(JSON.stringify({ StatusCode: 200, data: users }));
  } catch (error) {
    console.error(error);
    return new Response(
      JSON.stringify({ StatusCode: 500, Message: "Internal Server Error" })
    );
  }
}

export { ping, getIp, getInfo, getUsers };