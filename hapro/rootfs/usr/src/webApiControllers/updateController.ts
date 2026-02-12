import * as helpers from "./apiHelperService";
import { getCurrentFileVersion } from "./fileController";

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
    const listOfUpdates = typeof response === "object" ? response : JSON.parse(response);
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
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Request timed out")), timeout)
      ),
    ]);
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

export {getUpdates, getIconOfUpdate, performUpdate, skipUpdate, clearSkippedUpdate};