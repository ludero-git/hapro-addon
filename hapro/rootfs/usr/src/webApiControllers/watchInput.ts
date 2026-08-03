import { getApiUrl, getUuid } from "./apiHelperService";
import { initWebsocketService, sendSocket, subscribeToEvent, addConnectListener } from "./websocketService";

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
  try {
    console.debug("Received notification event:", notification);
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
    console.debug(
      `Sent notification to API, received status ${response.status} and body: ${data}`,
    );
  } catch (err) {
    console.error("Error handling notification:", err);
  }
}

let cachedToken: any = null;
let tokenExpiry: number | null = null;

async function getRemotePublicKey(): Promise<string | null> {
  try {
    const file = Bun.file("/usr/bin/client.toml");
    if (!(await file.exists())) return null;
    const text = await file.text();
    const match = text.match(/remote_public_key\s*=\s*"([^"]+)"/);
    return match ? match[1] : null;
  } catch (error) {
    console.error("Error reading client.toml for remote_public_key:", error);
    return null;
  }
}

async function fetchToken() {
  if (cachedToken && tokenExpiry && tokenExpiry > Date.now()) {
    return cachedToken;
  }

  const apiUrl = await getApiUrl();
  if (!apiUrl) {
    return null;
  }

  const key = await getRemotePublicKey();
  if (!key) {
    console.error("Cannot fetch token: remote_public_key not found in client.toml.");
    return null;
  }

  try {
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

    if (!response.ok) {
      console.error(`Fetch token request failed with status ${response.status}`);
      return null;
    }

    const data: any = await response.json();
    if (data && data.access_token && data.expires_in) {
      cachedToken = data;
      tokenExpiry = Date.now() + data.expires_in * 1000;
      return data;
    }
    return null;
  } catch (error) {
    console.error("Error fetching token from remote server:", error);
    return null;
  }
}

export { watchNotifications };
