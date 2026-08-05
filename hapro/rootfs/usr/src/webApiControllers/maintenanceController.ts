import { doSupervisorRequest, doHaInternalApiRequest } from "./apiHelperService";

async function restartAddon() {
  try {
    const addonInfo = await doSupervisorRequest("/addons/self/info");
    const slug = addonInfo?.data?.slug;
    if (!slug) {
      return new Response(
        JSON.stringify({ StatusCode: 500, Message: "Could not determine addon slug" }),
        { status: 500 },
      );
    }
    console.info(`Restarting addon: ${slug}`);
    const result = await doSupervisorRequest(`/addons/${slug}/restart`, "POST");
    return new Response(JSON.stringify({ StatusCode: 200, data: result }));
  } catch (error) {
    console.error("Error restarting addon:", error instanceof Error ? error.message : error);
    return new Response(
      JSON.stringify({ StatusCode: 500, Message: "Failed to restart addon" }),
      { status: 500 },
    );
  }
}

async function restartCore() {
  try {
    console.info("Restarting Home Assistant Core...");
    const result = await doSupervisorRequest("/core/restart", "POST");
    return new Response(JSON.stringify({ StatusCode: 200, data: result }));
  } catch (error) {
    console.error("Error restarting core:", error instanceof Error ? error.message : error);
    return new Response(
      JSON.stringify({ StatusCode: 500, Message: "Failed to restart core" }),
      { status: 500 },
    );
  }
}

async function restartSupervisor() {
  try {
    console.info("Restarting Supervisor...");
    const result = await doSupervisorRequest("/supervisor/restart", "POST");
    return new Response(JSON.stringify({ StatusCode: 200, data: result }));
  } catch (error) {
    console.error("Error restarting supervisor:", error instanceof Error ? error.message : error);
    return new Response(
      JSON.stringify({ StatusCode: 500, Message: "Failed to restart supervisor" }),
      { status: 500 },
    );
  }
}

async function rebootHost() {
  try {
    console.warn("Rebooting host system — this will take the machine offline!");
    const result = await doSupervisorRequest("/host/reboot", "POST");
    return new Response(JSON.stringify({ StatusCode: 200, data: result }));
  } catch (error) {
    console.error("Error rebooting host:", error instanceof Error ? error.message : error);
    return new Response(
      JSON.stringify({ StatusCode: 500, Message: "Failed to reboot host" }),
      { status: 500 },
    );
  }
}

async function getHealth() {
  try {
    const [supervisorPing, coreApiState] = await Promise.allSettled([
      doSupervisorRequest("/supervisor/ping"),
      doHaInternalApiRequest("/"),
    ]);

    const supervisorOk = supervisorPing.status === "fulfilled" && supervisorPing.value?.result === "ok";
    const coreOk = coreApiState.status === "fulfilled";

    return new Response(
      JSON.stringify({
        StatusCode: 200,
        data: {
          supervisor: supervisorOk ? "ok" : "error",
          core: coreOk ? "ok" : "error",
        },
      }),
    );
  } catch (error) {
    console.error("Error fetching health:", error instanceof Error ? error.message : error);
    return new Response(
      JSON.stringify({ StatusCode: 500, Message: "Health check failed" }),
      { status: 500 },
    );
  }
}

async function getLogIdentifiers() {
  try {
    const result = await doSupervisorRequest("/host/logs/identifiers");
    return new Response(JSON.stringify({ StatusCode: 200, data: result?.data }));
  } catch (error) {
    console.error("Error fetching log identifiers:", error instanceof Error ? error.message : error);
    return new Response(
      JSON.stringify({ StatusCode: 500, Message: "Failed to fetch log identifiers" }),
      { status: 500 },
    );
  }
}

async function getLogBoots() {
  try {
    const result = await doSupervisorRequest("/host/logs/boots");
    return new Response(JSON.stringify({ StatusCode: 200, data: result?.data }));
  } catch (error) {
    console.error("Error fetching log boots:", error instanceof Error ? error.message : error);
    return new Response(
      JSON.stringify({ StatusCode: 500, Message: "Failed to fetch log boots" }),
      { status: 500 },
    );
  }
}

async function getLogs(identifier: string, cursor?: string | null, numEntries = 100, boot?: string | null, follow = false) {
  try {
    let range = `entries=`;
    if (cursor && cursor.startsWith(":")) {
      range += cursor;
    } else if (cursor) {
      range += `${cursor}::${numEntries}`;
    } else {
      range += `:-${numEntries - 1}:`;
    }

    let url: string;
    if (follow) {
      if (identifier === "supervisor" && boot) {
        url = `http://supervisor/supervisor/logs/boots/${encodeURIComponent(boot)}/follow`;
      } else {
        url = `http://supervisor/host/logs/identifiers/${encodeURIComponent(identifier)}/follow`;
        if (boot) {
          url += `?boot=${encodeURIComponent(boot)}`;
        }
      }
    } else {
      if (identifier === "supervisor" && boot) {
        url = `http://supervisor/supervisor/logs/boots/${encodeURIComponent(boot)}`;
      } else {
        url = `http://supervisor/host/logs/identifiers/${encodeURIComponent(identifier)}`;
        if (boot) {
          url += `?boot=${encodeURIComponent(boot)}`;
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${Bun.env.SUPERVISOR_TOKEN}`,
      Range: range,
    };

    const response = await fetch(url, {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      return new Response(
        JSON.stringify({ StatusCode: response.status, Message: `Failed to fetch logs for ${identifier}` }),
        { status: response.status },
      );
    }

    if (follow) {
      return new Response(response.body, { status: response.status, headers: response.headers });
    }

    const text = await response.text();
    const nextCursor = response.headers.get("X-Log-Cursor") ?? null;

    return new Response(
      JSON.stringify({ StatusCode: 200, data: { logs: text, nextCursor } }),
    );
  } catch (error) {
    console.error(`Error fetching logs for ${identifier}:`, error instanceof Error ? error.message : error);
    return new Response(
      JSON.stringify({ StatusCode: 500, Message: "Failed to fetch logs" }),
      { status: 500 },
    );
  }
}

export {
  restartAddon,
  restartCore,
  restartSupervisor,
  rebootHost,
  getHealth,
  getLogIdentifiers,
  getLogBoots,
  getLogs,
};