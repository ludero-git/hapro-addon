import { watch, watchFile, existsSync } from "fs";
import { readdir } from "fs/promises";
import { doSupervisorRequest, getApiUrl, getUuid } from "./apiHelperService";
import {
  addConnectListener,
  initWebsocketService,
  sendSocket,
  subscribeToEvent,
} from "./websocketService";

const BACKUP_DIR = "/backup";
const HOMEASSISTANT_BACKUP_FILE = "/homeassistant/.storage/backup";
const BACKUP_MANAGER_ENTITY_ID = "sensor.backup_backup_manager_state";
const PENDING_BACKUP_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

type StateChangedEvent = {
  entity_id?: string;
  old_state?: { state?: string };
  new_state?: { state?: string };
};
function normalizeBackupName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function extractBackupNameFromFile(fileName: string): string {
  // Matches: <name>_YYYY-MM-DD_HH.MM_<id>.tar
  const match = fileName.match(
    /^(.*)_\d{4}-\d{2}-\d{2}_\d{2}\.\d{2}_[0-9]+\.tar$/,
  );
  if (!match) {
    return fileName.replace(/\.tar$/, "");
  }
  return match[1].replace(/_/g, " ");
}

async function getFiles(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    console.error(`Error reading directory: ${error}`);
    return [];
  }
}

async function getBackupList(): Promise<any[]> {
  try {
    const response = await doSupervisorRequest("/backups");
    return response.data.backups || [];
  } catch (error) {
    console.error(`Error reading backup list: ${error}`);
    return [];
  }
}

async function checkBackupCompletion(fileName: string): Promise<boolean> {
  const backupList = await getBackupList();
  const normalizedFileBase = normalizeBackupName(
    extractBackupNameFromFile(fileName),
  );
  const fileSlug = fileName.replace(/\.tar$/, "");

  return backupList.some((backup) => {
    const matchesSlug = backup.slug === fileSlug;
    const matchesName =
      typeof backup.name === "string" &&
      normalizeBackupName(backup.name) === normalizedFileBase;

    return matchesSlug || matchesName;
  });
}

async function notifyBackupComplete() {
  try {
    const uuid = await getUuid();
    const apiUrl = await getApiUrl();
    if (!uuid || !apiUrl) {
      console.error("Cannot send notification: Missing UUID or API URL.");
      return;
    }
    const response = await fetch(`${apiUrl.replace(/\/$/, "")}/api/backup/${uuid}/synchronize`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });
    if (response.ok) {
      console.debug("Backup completion notification sent.");
    } else {
      console.warn(`Backup completion notification responded with status ${response.status}`);
    }
  } catch (error) {
    console.error("Failed to send notification:", error);
  }
}

async function subscribeToBackupStateChanged() {
  try {
    await sendSocket("subscribe_events", { event_type: "state_changed" });
    console.log("Now listening to state_changed events for backup completion.");
  } catch (error) {
    console.error("Failed to subscribe to state_changed events:", error);
  }
}

let pendingBackupFile: string | null = null;
let removePendingStateListener: (() => void) | null = null;
let pendingBackupTimeoutId: ReturnType<typeof setTimeout> | null = null;

function isBackupTransitionToIdle(event: StateChangedEvent): boolean {
  return (
    event.entity_id === BACKUP_MANAGER_ENTITY_ID &&
    event.old_state?.state === "create_backup" &&
    event.new_state?.state === "idle"
  );
}

function clearPendingBackupState() {
  if (pendingBackupTimeoutId !== null) {
    clearTimeout(pendingBackupTimeoutId);
    pendingBackupTimeoutId = null;
  }
  removePendingStateListener?.();
  removePendingStateListener = null;
  pendingBackupFile = null;
}

async function handleBackupStateChanged(eventData: StateChangedEvent) {
  if (!pendingBackupFile || !isBackupTransitionToIdle(eventData)) {
    return;
  }

  const fileName = pendingBackupFile;
  const isBackupComplete = await checkBackupCompletion(fileName);
  if (!isBackupComplete) {
    console.debug(`Backup for ${fileName} not listed yet after idle transition.`);
    return;
  }

  await notifyBackupComplete();
  previousFiles.add(fileName);
  clearPendingBackupState();
}

let lastBackupPassword: string | null = null;

async function getBackupPassword(): Promise<string | null> {
  try {
    const backupFile = Bun.file(HOMEASSISTANT_BACKUP_FILE);
    const backupFileText = await backupFile.text();
    const backupFileContent = JSON.parse(backupFileText);
    return backupFileContent.data?.config?.create_backup?.password ?? null;
  } catch (error) {
    console.error(`Error reading backup password: ${error}`);
    return null;
  }
}

async function watchHomeAssistantBackupFile() {
  console.debug(`Watching file: ${HOMEASSISTANT_BACKUP_FILE}`);

  if (!existsSync(HOMEASSISTANT_BACKUP_FILE)) {
    console.warn(`File ${HOMEASSISTANT_BACKUP_FILE} does not exist yet. Will start watching once it exists.`);
  } else {
    lastBackupPassword = await getBackupPassword();
    console.debug(`Initial backup password loaded`);
  }

  watchFile(HOMEASSISTANT_BACKUP_FILE, { interval: 2000 }, async (curr, prev) => {
    if (curr.mtime.getTime() !== prev.mtime.getTime()) {
      console.debug(`File ${HOMEASSISTANT_BACKUP_FILE} modified at ${curr.mtime}`);

      const currentPassword = await getBackupPassword();
      if (currentPassword !== lastBackupPassword) {
        console.log(`Backup password changed, notifying API`);
        lastBackupPassword = currentPassword;
        await notifyBackupComplete();
      } else {
        console.debug(`File modified but password unchanged, skipping notification`);
      }
    }
  });

  console.log(`Now watching ${HOMEASSISTANT_BACKUP_FILE} for password changes (polling every 2s)`);
}

let lastFileCount: number | null = null;
let previousFiles: Set<string> = new Set();
export async function watchBackupDirectory() {
  console.debug(`Watching directory: ${BACKUP_DIR}`);
  const files = await getFiles(BACKUP_DIR);
  lastFileCount = files.length;
  previousFiles = new Set(files);

  addConnectListener(subscribeToBackupStateChanged);
  await initWebsocketService();
  // Watch the Home Assistant backup file for config/key changes
  watchHomeAssistantBackupFile();

  watch(BACKUP_DIR, async () => {
    const files = await getFiles(BACKUP_DIR);
    const currentFileCount = files.length;

    if (currentFileCount !== lastFileCount) {
      const previousCount = lastFileCount;
      lastFileCount = currentFileCount;
      const currentSet = new Set(files);
      for (const f of previousFiles) {
        if (!currentSet.has(f)) {
          previousFiles.delete(f);
        }
      }

      if (currentFileCount > (previousCount ?? 0)) {
        console.debug(
          `File count changed from ${previousCount} to ${currentFileCount}`,
        );
        const newFiles = files.filter((file) => !previousFiles.has(file));
        const newFile = newFiles[0];
        if (newFile) {
          console.debug(`New file detected: ${newFile}`);
          if (newFile.endsWith(".tar")) {
            if (pendingBackupFile) {
              console.warn(
                `New backup ${newFile} detected while ${pendingBackupFile} was still pending. Discarding old pending state.`,
              );
              clearPendingBackupState();
            }

            pendingBackupFile = newFile;
            removePendingStateListener = subscribeToEvent(
              "state_changed",
              handleBackupStateChanged,
            );

            pendingBackupTimeoutId = setTimeout(() => {
              if (pendingBackupFile === newFile) {
                console.warn(
                  `Pending backup ${newFile} timed out after ${PENDING_BACKUP_TIMEOUT_MS / 1000}s without a confirmed idle transition. Cleaning up listener.`,
                );
                clearPendingBackupState();
              }
            }, PENDING_BACKUP_TIMEOUT_MS);

            console.debug(
              `Waiting for ${BACKUP_MANAGER_ENTITY_ID} transition to idle for ${newFile}.`,
            );
          }
        }
      }
    }
  });
}
