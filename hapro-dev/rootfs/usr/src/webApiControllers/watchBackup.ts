import { watch } from "fs";
import { readdir } from "fs/promises";
import { doSupervisorRequest } from "./apiHelperService";

const BACKUP_DIR = "/backup";

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
  const isBackupComplete = backupList.some(
    (backup) => backup.slug === fileName.replace(".tar", ""),
  );
  return isBackupComplete;
}

async function notifyBackupComplete() {
  try {
    const uuidEntry = await Bun.file(
      "/homeassistant/.storage/core.uuid",
    ).text();
    const uuid = JSON.parse(uuidEntry).data.uuid;
    await fetch(`https://api.test.ludero.nl/api/backup/${uuid}/synchronize`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });
    console.debug("Backup completion notification sent.");
  } catch (error) {
    console.error("Failed to send notification:", error);
  }
}

let lastFileCount: number | null = null;
let previousFiles: Set<string> = new Set();
export async function watchBackupDirectory() {
  console.debug(`Watching directory: ${BACKUP_DIR}`);
  const files = await getFiles(BACKUP_DIR);
  lastFileCount = files.length;
  previousFiles = new Set(files);

  watch(BACKUP_DIR, async () => {
    const files = await getFiles(BACKUP_DIR);
    const currentFileCount = files.length;
    if (currentFileCount !== lastFileCount) {
      console.debug(
        `File count changed from ${lastFileCount} to ${currentFileCount}`,
      );
      lastFileCount = currentFileCount;
      const newFiles = files.filter((file) => !previousFiles.has(file));
      const newFile = newFiles[0];
      if (newFile) {
        console.debug(`New file detected: ${newFile}`);
        if (newFile.endsWith(".tar")) {
          const retryInterval = setInterval(async () => {
            const isBackupComplete = await checkBackupCompletion(newFile);
            if (isBackupComplete) {
              await notifyBackupComplete();
              clearInterval(retryInterval);
            } else {
              console.debug(
                `Backup for ${newFile} is not yet listed, retrying...`,
              );
            }
          }, 10000);
        }
      }
    }
  });
}
