import clientToml from "/usr/bin/client.toml";

async function watchNotifications() {
  const socket = new WebSocket(`ws://supervisor/core/websocket`);
  socket.onmessage = function (event) {
    const data = JSON.parse(event.data);
    if (data.type === "auth_required")
      socket.send(
        JSON.stringify({
          type: "auth",
          access_token: Bun.env.SUPERVISOR_TOKEN,
        }),
      );

    if (data.type === "auth_ok")
      socket.send(
        JSON.stringify({
          id: 1,
          type: "subscribe_events",
          event_type: "hapro_notification",
        }),
      );

    if (data.type === "result") {
      if (data.success)
        console.log("Now listening to Notifications for HaPro.");
      else console.error("Failed to listen to Notifications for HaPro:", data);
    }
    if (data.type === "event") handleNotification(data.event.data);
  };
  socket.onclose = function (event) {
    console.warn("Stopped listening to Notifications for HaPro.");
    setTimeout(() => {
      watchNotifications();
    }, 30000);
  };
  socket.onerror = function (event) {
    console.error("Error while listening to Notifications for HaPro:", event);
  };
}

async function handleNotification(notification) {
  const token = await fetchToken();
  const uuidEntry = await Bun.file("/homeassistant/.storage/core.uuid").text();
  const uuid = JSON.parse(uuidEntry).data.uuid;
  const response = await fetch(
    `https://api.ludero.nl/api/notification/${uuid}`,
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

  const key = clientToml.client.transport.noise.remote_public_key;
  const response = await fetch("https://api.ludero.nl/connect/token", {
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
