import * as helpers from "./apiHelperService";
import { getCurrentFileVersion } from "./fileController";
import { initWebsocketService, sendSocket } from "./websocketService";

type UpdateRefreshState = "idle" | "checking" | "completed" | "failed";

let updateRefreshStatus: {
  state: UpdateRefreshState;
  started_at?: string;
  finished_at?: string;
  result?: unknown;
  error?: string;
} = { state: "idle" };
let updateRefreshPromise: Promise<void> | null = null;

async function getUpdates() {
  try {
    const template = `
  {% set entities = states.update | selectattr('state', 'equalto', 'on') | list %}
  {% set skippedentities = states.update | selectattr('attributes.skipped_version', 'ne', None) | selectattr('state', 'equalto', 'off') | list %}
  {% set entities = entities + skippedentities %}
  [
  {% for entity in entities %}
  {
  "version_current": "{{ entity.attributes.installed_version }}",
  "version_latest": "{{ entity.attributes.latest_version }}",
  "name": "{{ entity.attributes.friendly_name | replace(' Update', '') }}",
  "identifier": "{{ entity.entity_id | replace('update.', '') }}",
  "icon": "{{ entity.attributes.entity_picture }}",
  "update_running": {{ entity.attributes.in_progress | lower }},
  "skipped": {{ entity.attributes.skipped_version is not none | lower }}
  }{% if not loop.last %},{% endif %}
  {% endfor %}
  ]
  `;
    const response = await helpers.doHaInternalApiRequest(`/template`, "POST", {
      template: template,
    });
    const fileUpdateStream = await getCurrentFileVersion();
    const fileUpdate = await fileUpdateStream.json();
    var listOfUpdates: any[] = [];
    try {
      if (Array.isArray(response)) {
        listOfUpdates = response;
      } else if (typeof response === "string") {
        const parsed = JSON.parse(response);
        listOfUpdates = Array.isArray(parsed) ? parsed : [];
      } else {
        listOfUpdates = [];
      }
    }
    catch (error) {
      console.error("Error parsing updates response:", error instanceof Error ? error.message : error, "Response content:", response);
      listOfUpdates = [];
    }
    listOfUpdates = listOfUpdates.filter((u: any) => u && u.identifier !== "hapro-files");
    listOfUpdates.push({
      version_current: fileUpdate?.data?.version || 0,
      version_latest: null,
      name: fileUpdate?.data?.partner_name || "unknown",
      identifier: "hapro-files"
    });
    return new Response(
      JSON.stringify({ StatusCode: 200, data: listOfUpdates })
    );
  } catch (error) {
    console.error(error);
    return new Response(
      JSON.stringify({ StatusCode: 500, Message: "Internal Server Error" })
    );
  }
}

async function reloadUpdates() {
  if (updateRefreshPromise) {
    return new Response(
      JSON.stringify({ StatusCode: 202, data: updateRefreshStatus }),
      { status: 202 },
    );
  }

  updateRefreshStatus = {
    state: "checking",
    started_at: new Date().toISOString(),
  };

  updateRefreshPromise = (async () => {
    try {
      const [supervisorResult, hacsResult] = await Promise.all([
        helpers.doSupervisorRequest("/reload_updates", "POST"),
        reloadHacsUpdates(),
      ]);
      updateRefreshStatus = {
        state: "completed",
        started_at: updateRefreshStatus.started_at,
        finished_at: new Date().toISOString(),
        result: { supervisor: supervisorResult, hacs: hacsResult },
      };
    } catch (error) {
      console.error("Error reloading updates:", error);
      updateRefreshStatus = {
        state: "failed",
        started_at: updateRefreshStatus.started_at,
        finished_at: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      updateRefreshPromise = null;
    }
  })();

  return new Response(
    JSON.stringify({ StatusCode: 202, data: updateRefreshStatus }),
    { status: 202 },
  );
}

function getReloadUpdatesStatus() {
  return new Response(
    JSON.stringify({ StatusCode: 200, data: updateRefreshStatus }),
  );
}

async function reloadHacsUpdates() {
  try {
    await initWebsocketService();
    const repositories = await sendSocket("hacs/repositories/list", {});
    const installedRepositories = Array.isArray(repositories)
      ? repositories.filter((repository) => repository?.installed)
      : [];
    const results = await Promise.all(
      installedRepositories.map(async (repository) => {
        const repositoryId = String(repository.id ?? repository.full_name ?? "");
        if (!repositoryId) return null;

        try {
          await sendSocket("hacs/repository/refresh", { repository: repositoryId });
          return null;
        } catch (error) {
          return {
            repository: repository.full_name ?? repositoryId,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );
    const failed = results.filter(
      (result): result is { repository: string; error: string } => result !== null,
    );

    return {
      available: true,
      checked: installedRepositories.length,
      failed,
    };
  } catch (error) {
    console.info(
      "HACS is unavailable; skipping HACS update refresh:",
      error instanceof Error ? error.message : error,
    );
    return {
      available: false,
      checked: 0,
      failed: [],
    };
  }
}

async function getIconOfUpdate(updateIdentifier) {
  try {
    const template = `
  {% set entity = states.update | selectattr('entity_id', 'search', 'update.${updateIdentifier}', ignorecase=True) | first %}
  {{ entity.attributes.entity_picture }}
  `;
    const response = await helpers.doHaInternalApiRequest(`/template`, "POST", {
      template: template,
    });
    if (typeof response !== "string")
      return new Response(
        JSON.stringify({ StatusCode: 404, Message: "Not Found" })
      );
    var icon = response;
    const baseUrl = "http://localhost:8123";
    if (!icon.includes("https")) {
      icon = `${baseUrl}${icon}`;
    }
    const imageResponse = await fetch(icon);
    if (!imageResponse.ok)
      return new Response("Failed to fetch icon", { status: 500 });

    const contentType =
      imageResponse.headers.get("Content-Type") || "image/png";

    const imageData = await imageResponse.arrayBuffer();
    return new Response(imageData, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (error) {
    console.error(error);
    return new Response(
      JSON.stringify({ StatusCode: 500, Message: "Internal Server Error" })
    );
  }
}

async function performUpdate(updateIdentifier) {
  const idleTimeout = 3000;

  async function withTimeout(promise, timeout) {
    let timerId: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timerId = setTimeout(() => reject(new Error("Request timed out")), timeout);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timerId!));
  }
  try {
    const updateResult = await withTimeout(
      helpers.doHaInternalApiRequest(`/services/update/install`, "POST", {
        entity_id: `update.${updateIdentifier}`,
      }),
      idleTimeout
    );
    if (updateResult.includes("400 Bad Request") || updateResult.length === 0)
      return new Response(
        JSON.stringify({ StatusCode: 400, Message: "Bad Request" })
      );
    return new Response(
      JSON.stringify({ StatusCode: 200, result: updateResult })
    );
  } catch (error) {
    if (error.message === "Request timed out") {
      return new Response(
        JSON.stringify({ StatusCode: 200, Message: "Update in progress" })
      );
    }
    return new Response(
      JSON.stringify({ StatusCode: 500, Message: "Internal Server Error" })
    );
  }
}

async function skipUpdate(updateIdentifier) {
  try {
    const updateResult = await helpers.doHaInternalApiRequest(
      `/services/update/skip`,
      "POST",
      { entity_id: `update.${updateIdentifier}` }
    );
    if (updateResult.includes("400 Bad Request") || updateResult.length === 0)
      return new Response(
        JSON.stringify({ StatusCode: 400, Message: "Bad Request" })
      );
    return new Response(
      JSON.stringify({ StatusCode: 200, result: updateResult })
    );
  } catch (error) {
    console.error(error);
    return new Response(
      JSON.stringify({ StatusCode: 500, Message: "Internal Server Error" })
    );
  }
}

async function clearSkippedUpdate(updateIdentifier) {
  try {
    const updateResult = await helpers.doHaInternalApiRequest(
      `/services/update/clear_skipped`,
      "POST",
      { entity_id: `update.${updateIdentifier}` }
    );
    if (updateResult.includes("400 Bad Request") || updateResult.length === 0)
      return new Response(
        JSON.stringify({ StatusCode: 400, Message: "Bad Request" })
      );
    return new Response(
      JSON.stringify({ StatusCode: 200, result: updateResult })
    );
  } catch (error) {
    console.error(error);
    return new Response(
      JSON.stringify({ StatusCode: 500, Message: "Internal Server Error" })
    );
  }
}

export {
  getUpdates,
  reloadUpdates,
  getReloadUpdatesStatus,
  getIconOfUpdate,
  performUpdate,
  skipUpdate,
  clearSkippedUpdate,
};
