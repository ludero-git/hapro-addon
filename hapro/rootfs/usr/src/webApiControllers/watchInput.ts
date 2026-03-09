import { getApiUrl, getUuid } from "./apiHelperService";
import { initWebsocketService, sendSocket, subscribeToEvent, addConnectListener } from "./websocketService";
import clientToml from "/usr/bin/client.toml";

async function subscribeToHaproNotifications() {
  try {
    await sendSocket("subscribe_events", { event_type: "hapro_notification" });
    console.log("Now listening to Notifications for HaPro.");
  } catch (err) {
    console.error("Failed to subscribe to hapro_notification events:", err);
  }
}

async function watchNotifications() {
  subscribeToEvent("hapro_notification", handleNotification);
  addConnectListener(subscribeToHaproNotifications);
  await initWebsocketService();
}

async function handleNotification(notification) {
  const uuid = await getUuid();
  const apiUrl = await getApiUrl();
  if (!uuid || !apiUrl) {
    console.error("Cannot handle notification: Missing UUID or API URL.");
    return;
  }
  const token = await fetchToken();
  if (!token) {
    console.error("Cannot handle notification: Failed to fetch token.");
    return;
  }
  const response = await fetch(
    `${apiUrl.replace(/\/$/, "")}/api/notification/${uuid}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token.access_token}`,
      },
      body: JSON.stringify(notification),
    },
  );
  const data = await response.text();
}

let cachedToken = null;
let tokenExpiry = null;

async function fetchToken() {
  if (cachedToken && tokenExpiry && tokenExpiry > Date.now()) {
    return cachedToken;
  }

  const apiUrl = await getApiUrl();
  if (!apiUrl) {
    return null;
  }

  const key = clientToml.client.transport.noise.remote_public_key;
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}/connect/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: "hapro_addon",
      client_secret: key,
      scopes: "hapro_addon",
    }).toString(),
  });
  const data = await response.json();

  cachedToken = data;
  tokenExpiry = Date.now() + data.expires_in * 1000;

  return data;
}

export { watchNotifications };
