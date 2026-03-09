// This service is responsible for handling the ws connection to the supervisor

let socket: WebSocket | null = null;
let messageId = 1;
const pendingMessages = new Map<number, { resolve: (result: any) => void; reject: (err: Error) => void }>();
const eventSubscriptions = new Map<string, Set<(data: any) => void>>();
const connectListeners = new Set<() => void>();
let initPromise: Promise<void> | null = null;
let isAuthenticated = false;

async function initWebsocketService(): Promise<void> {
  // Return existing initialization if already in progress or completed
  if (initPromise) {
    return initPromise;
  }

  initPromise = new Promise((resolve, reject) => {
    socket = new WebSocket(`ws://supervisor/core/websocket`);

    socket.onmessage = function (event) {
      const data = JSON.parse(event.data);

      if (data.type === "auth_required") {
        socket!.send(
          JSON.stringify({
            type: "auth",
            access_token: Bun.env.SUPERVISOR_TOKEN,
          }),
        );
      } else if (data.type === "auth_ok") {
        console.log("WebSocket authenticated.");
        isAuthenticated = true;
        resolve();
        connectListeners.forEach((cb) => cb());
      } else if (data.type === "auth_invalid") {
        console.error("WebSocket authentication failed:", data);
        reject(new Error("WebSocket authentication failed"));
      } else if (data.type === "result") {
        const pending = pendingMessages.get(data.id);
        if (pending) {
          pendingMessages.delete(data.id);
          if (data.success) {
            pending.resolve(data.result);
          } else {
            const errorMessage = typeof data.error === "string" ? data.error : data.error?.message ?? "Command failed";
            pending.reject(new Error(errorMessage));
          }
        }
      } else if (data.type === "event") {
        const handlers = eventSubscriptions.get(data.event.event_type);
        if (handlers) {
          handlers.forEach((handler) => handler(data.event.data));
        }
      }
    };

    socket.onclose = function () {
      console.warn("WebSocket connection closed. Reconnecting in 30s...");
      pendingMessages.forEach(({ reject }) => reject(new Error("WebSocket closed")));
      isAuthenticated = false;
      pendingMessages.clear();
      initPromise = null;
      setTimeout(initWebsocketService, 30000);
    };

    socket.onerror = function (event) {
      console.error("WebSocket error:", event);
    };

  return initPromise;
  });
}

async function sendSocket(type: string, props: Record<string, any>): Promise<any> {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    throw new Error(`WebSocket is not open. Cannot send message: ${JSON.stringify({ type, ...props })}`);
  }

  const id = messageId++;
  const message = { id, type, ...props };
  console.debug("Sending WebSocket message:", message);
  return new Promise((resolve, reject) => {
    pendingMessages.set(id, { resolve, reject });
    socket!.send(JSON.stringify(message));
  });
}

function subscribeToEvent(eventType: string, callback: (data: any) => void): () => void {
  if (!eventSubscriptions.has(eventType)) {
    eventSubscriptions.set(eventType, new Set());
  }
  eventSubscriptions.get(eventType)!.add(callback);

  return () => {
    eventSubscriptions.get(eventType)?.delete(callback);
  };
}

function addConnectListener(callback: () => void): () => void {
  if (isAuthenticated) {
    callback();
  }
  connectListeners.add(callback);
  return () => connectListeners.delete(callback);
}

export { initWebsocketService, sendSocket, subscribeToEvent, addConnectListener };