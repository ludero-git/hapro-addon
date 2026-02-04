import { serve } from "bun";
import { watchBackupDirectory } from "./webApiControllers/watchBackup";
import * as backupController from "./webApiControllers/backupController";
import * as updateController from "./webApiControllers/updateController";
import * as statisticController from "./webApiControllers/statisticController";
import * as infoController from "./webApiControllers/infoController";
import * as fileController from "./webApiControllers/fileController";
import { watchNotifications } from "./webApiControllers/watchInput";

const PORT = 3000;
const DEBUG = Bun.env.DEBUG === "*" || Bun.env.BUN_DEBUG === "1";

["log", "info", "warn", "error", "debug"].forEach((level) => {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    if (level === "debug" && !DEBUG) return;
    original(`[${level.toUpperCase()}]`, ...args);
  };
});

const PATHS = {
  DEFAULT: "/",
  INFO: "/info",
  IP: "/ip",
  USERS: "/users",
  UPDATES: "/updates",
  UPDATES_ICON: "/updates/:updateId/icon",
  UPDATES_SKIP: "/updates/:updateId/skip",
  UPDATES_CLEAR: "/updates/:updateId/clear",
  UPDATES_PERFORM: "/updates/:updateId",
  SYSTEMMONITOR_ENABLE: "/systemmonitor/enable",
  SYSTEMMONITOR_ENABLE_ENTITIES: "/systemmonitor/enable_entities",
  STATISTIC_HISTORY: "/statistic/history/:entityId",
  BACKUPS: "/backups",
  BACKUPS_INFO: "/backups/:backupId/info",
  BACKUPS_DOWNLOAD: "/backups/:backupId/download",
  BACKUPS_UPLOAD: "/backups/upload",
  BACKUPS_DELETE: "/backups/:backupId/delete",
  BACKUPS_RESTORE: "/backups/:backupId/restore",
  BACKUPS_STATUS: "/backups/:backupId/status",
  FILE_UPLOAD: "/file/upload",
};

serve({
  port: PORT,
  async fetch(req: Request) {
    try {
      const url = new URL(req.url);
      const path = url.pathname;
      console.debug(`Request: ${req.method} ${path}`);
      switch (true) {
        case matchPath(PATHS.DEFAULT, req):
          return await infoController.ping();
        case matchPath(PATHS.INFO, req):
          return await infoController.getInfo();
        case matchPath(PATHS.IP, req):
          return await infoController.getIp();
        case matchPath(PATHS.USERS, req):
          return await infoController.getUsers();
        case matchPath(PATHS.UPDATES, req):
          return await updateController.getUpdates();
        case matchPath(PATHS.UPDATES_ICON, req):
          return await updateController.getIconOfUpdate(
            extractPathParams(PATHS.UPDATES_ICON, path)["updateId"],
          );
        case matchPath(PATHS.UPDATES_SKIP, req, "POST"):
          return await updateController.skipUpdate(
            extractPathParams(PATHS.UPDATES_SKIP, path)["updateId"],
          );
        case matchPath(PATHS.UPDATES_CLEAR, req, "POST"):
          return await updateController.clearSkippedUpdate(
            extractPathParams(PATHS.UPDATES_CLEAR, path)["updateId"],
          );
        case matchPath(PATHS.UPDATES_PERFORM, req, "POST"):
          return await updateController.performUpdate(
            extractPathParams(PATHS.UPDATES_PERFORM, path)["updateId"],
          );
        case matchPath(PATHS.SYSTEMMONITOR_ENABLE, req, "POST"):
          return await statisticController.enableSystemMonitor();
        case matchPath(PATHS.SYSTEMMONITOR_ENABLE_ENTITIES, req, "POST"):
          return await statisticController.enableSystemMonitorEntities();
        case matchPath(PATHS.STATISTIC_HISTORY, req):
          return await statisticController.getStatisticHistory(
            extractPathParams(PATHS.STATISTIC_HISTORY, path)["entityId"],
          );
        case matchPath(PATHS.BACKUPS, req):
          return await backupController.getBackups();
        case matchPath(PATHS.BACKUPS_INFO, req):
          return await backupController.getBackupInfo(
            extractPathParams(PATHS.BACKUPS_INFO, path)["backupId"],
          );
        case matchPath(PATHS.BACKUPS_DOWNLOAD, req):
          return await backupController.downloadBackup(
            extractPathParams(PATHS.BACKUPS_DOWNLOAD, path)["backupId"],
          );
        case matchPath(PATHS.BACKUPS_UPLOAD, req, "POST"):
          return await backupController.uploadBackup(req);
        case matchPath(PATHS.BACKUPS_DELETE, req, "DELETE"):
          return await backupController.deleteBackup(
            extractPathParams(PATHS.BACKUPS_DELETE, path)["backupId"],
          );
        case matchPath(PATHS.BACKUPS_RESTORE, req, "POST"):
          return await backupController.restoreBackup(
            extractPathParams(PATHS.BACKUPS_RESTORE, path)["backupId"],
          );
        case matchPath(PATHS.BACKUPS_STATUS, req):
          return await backupController.backupStatus(
            extractPathParams(PATHS.BACKUPS_STATUS, path)["backupId"],
          );
        case matchPath(PATHS.FILE_UPLOAD, req, "POST"):
          return await fileController.updateFile(req);
        default:
          return new Response(
            JSON.stringify({ StatusCode: 404, Message: "Not Found" }),
          );
      }
    } catch (error) {
      if (error instanceof Response) return error;
      console.error(error);
      return new Response(
        JSON.stringify({ StatusCode: 500, Message: "Internal Server Error" }),
      );
    }
  },
});

function matchPath(route: string, req: Request, method: string = "GET") {
  const routeParts = route.split("/");
  const pathParts = new URL(req.url).pathname.split("/");
  if (
    routeParts.length !== pathParts.length ||
    !routeParts.every((part, index) =>
      part.match(/^:\w+Id$/) ? true : part === pathParts[index],
    )
  )
    return false;
  if (method && req.method !== method)
    throw new Response(
      JSON.stringify({ StatusCode: 405, Message: "Method Not Allowed" }),
    );
  return true;
}

function extractPathParams(route: string, path: string) {
  const routeParts = route.split("/");
  const pathParts = path.split("/");
  return routeParts.reduce((acc, part, index) => {
    if (part.match(/^:\w+Id$/)) {
      acc[part.slice(1)] = pathParts[index];
    }
    return acc;
  }, {});
}

console.debug(`Listening on http://localhost:${PORT} ...`);

watchBackupDirectory();
watchNotifications();
