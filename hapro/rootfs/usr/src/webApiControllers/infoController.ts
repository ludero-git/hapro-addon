import { initWebsocketService, sendSocket } from "./websocketService";
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
      var enabledStatistics: string[] = [];
      try {        
        enabledStatistics = typeof getAllEnabledStatistics === "object" ? getAllEnabledStatistics : JSON.parse(getAllEnabledStatistics);
      }
      catch (error) {
        console.error("Error parsing enabled statistics response:", error instanceof Error ? error.message : error, "Response content:", getAllEnabledStatistics);
        enabledStatistics = getAllEnabledStatistics ? String(getAllEnabledStatistics).replace(/[\[\]"]+/g, "").split(",").map((item: string) => item.trim()) : [];
      }
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
      filePartnerName: fileVersion?.data?.partner_name || "unknown",
      storage: {
        total: statistics["storageUsed"] + statistics["storageFree"],
        used: statistics["storageUsed"],
        free: statistics["storageFree"],
        usage:
          statistics["storageUsage"] ??
          (parseFloat(statistics["storageUsed"]) /
            parseFloat(statistics["storageUsed"] + statistics["storageFree"])) *
            100,
      },
      cpu: {
        usage: statistics["cpuUsage"],
        temperature: statistics["cpuTemp"],
      },
      memory: {
        total:
          statistics["memoryUsed"] == null || statistics["memoryFree"] == null
            ? null
            : statistics["memoryUsed"] + statistics["memoryFree"],
        used: statistics["memoryUsed"],
        free: statistics["memoryFree"],
        usage: statistics["memoryUsage"],
      },
      swap: {
        total:
          statistics["swapUsed"] == null || statistics["swapFree"] == null
            ? null
            : statistics["swapUsed"] + statistics["swapFree"],
        used: statistics["swapUsed"],
        free: statistics["swapFree"],
        usage: statistics["swapUsage"],
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

export async function getConnectionModes(req: Request) {
  const { account, dashboard } = await req.json();
  if (typeof account !== "string" || !account) return new Response(null, { status: 400 });
  const response = await fetch("http://supervisor/core/api/hapro/debug-role", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Bun.env.SUPERVISOR_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ account }),
    signal: AbortSignal.timeout(2000),
  });
  const debug = response.ok && (await response.json()).debug === true;
  let dashboardPath: string | undefined;
  if (dashboard === true) {
    try {
      dashboardPath = await Promise.race([findEmsDashboard(), Bun.sleep(2500).then(() => undefined)]);
    } catch {
      // Home Assistant may still be starting. Its root is still a valid portal link.
    }
  }
  return Response.json({ debug, dashboardPath });
}

async function findEmsDashboard(): Promise<string | undefined> {
  await initWebsocketService();
  const dashboards = await sendSocket("lovelace/dashboards/list", {});
  const supported = new Set(["ludero-ems-strategy", "ludero-ems-hub-strategy", "llm-virtual-grid-strategy"]);
  for (const entry of dashboards) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(entry.url_path || "")) continue;
    try {
      const config = await sendSocket("lovelace/config", { url_path: entry.url_path });
      if (supported.has(config.strategy?.type?.replace(/^custom:/, ""))) return "/" + entry.url_path;
    } catch {
      // One unavailable dashboard should not hide another.
    }
  }
}

export { ping, getIp, getInfo, getUsers };
