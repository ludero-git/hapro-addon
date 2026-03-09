import * as helpers from "./apiHelperService";

async function getBackups() {
  try {
    const response = await helpers.doSupervisorRequest("/backups");
    return new Response(
      JSON.stringify({ StatusCode: 200, data: response.data.backups }),
    );
  } catch (error) {
    console.error(error);
    return new Response(
      JSON.stringify({ StatusCode: 500, Message: "Internal Server Error" }),
    );
  }
}

async function getBackupInfo(backupId) {
  try {
    const response = await helpers.doSupervisorRequest(
      `/backups/${backupId}/info`,
    );
    const returnObject = {
      slug: response.data.slug,
      date: response.data.date,
      name: response.data.name,
      type: response.data.type,
      protected: response.data.protected,
      compressed: response.data.compressed,
      size: response.data.size,
      content: {
        homeassistant: response.data.homeassistant !== null,
        addons: response.data.addons.map((addon) => addon.slug),
        folders: response.data.folders,
      },
    };
    return new Response(
      JSON.stringify({ StatusCode: 200, data: returnObject }),
    );
  } catch (error) {
    console.error(error);
    return new Response(
      JSON.stringify({ StatusCode: 500, Message: "Internal Server Error" }),
    );
  }
}

async function downloadBackup(backupId) {
  try {
    const response = await fetch(
      `http://supervisor/backups/${backupId}/download`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${Bun.env.SUPERVISOR_TOKEN}`,
        },
      },
    );
    return response;
  } catch (error) {
    console.error(error);
    return new Response(
      JSON.stringify({ StatusCode: 500, Message: "Internal Server Error" }),
    );
  }
}

async function uploadBackup(req) {
  try {
    const backupFile = await req.arrayBuffer();
    const fileName = "backup.tar";
    const blob = new Blob([backupFile], { type: "application/x-tar" });
    const formData = new FormData();
    formData.append("file", blob, fileName);
    const response = await fetch("http://supervisor/backups/new/upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Bun.env.SUPERVISOR_TOKEN}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Failed to upload backup: ${response.statusText}`);
    }

    console.debug("Backup uploaded successfully");
    return new Response(
      JSON.stringify({
        StatusCode: 200,
        Message: "Backup uploaded successfully",
      }),
      {
        status: 200,
      },
    );
  } catch (error) {
    console.error("Error uploading backup:", error);
    return new Response(
      JSON.stringify({ StatusCode: 500, Message: "Internal Server Error" }),
      { status: 500 },
    );
  }
}

async function deleteBackup(backupId) {
  try {
    const response = await helpers.doSupervisorRequest(
      `/backups/${backupId}`,
      "DELETE",
    );
    return new Response(
      JSON.stringify({
        StatusCode:
          response.result == "ok"
            ? 200
            : response.message == "Backup does not exist"
              ? 404
              : 500,
        Message: response.message,
      }),
    );
  } catch (error) {
    console.error(error);
    return new Response(
      JSON.stringify({ StatusCode: 500, Message: "Internal Server Error" }),
    );
  }
}

async function restoreBackup(backupId, backupPassword = null) {
  try {
    const backups = await helpers.doSupervisorRequest("/backups");
    const backup = backups.data.backups.find(
      (backup) => backup.slug === backupId,
    );
    if (backup === undefined)
      return new Response(
        JSON.stringify({ StatusCode: 404, Message: "Backup not found" }),
      );
    if (backup.protected && backupPassword === null)
      return new Response(
        JSON.stringify({
          StatusCode: 401,
          Message: "Backup is password protected",
        }),
      );
    if (backup.type === "full") {
      const response = await helpers.doSupervisorRequest(
        `/backups/${backupId}/restore/full`,
        "POST",
        { background: true },
      );
      return new Response(
        JSON.stringify({
          StatusCode: 200,
          Message: "Restore started",
          Data: response.data.job_id,
        }),
      );
    } else {
      const response = await helpers.doSupervisorRequest(
        `/backups/${backupId}/restore/partial`,
        "POST",
        {
          background: true,
          homeassistant: backup.content.homeassistant,
          addons: backup.content.addons,
          folders: backup.content.folders,
        },
      );
      return new Response(
        JSON.stringify({
          StatusCode: 200,
          Message: "Restore started",
          Data: response.data.job_id,
        }),
      );
    }
  } catch (error) {
    console.error(error);
    return new Response(
      JSON.stringify({ StatusCode: 500, Message: "Internal Server Error" }),
    );
  }
}

async function backupStatus(jobId) {
  try {
    const response = await helpers.doSupervisorRequest(`/jobs/info`);
    const job = response.data.jobs.find((job) => job.uuid === jobId);
    if (job === undefined)
      return new Response(
        JSON.stringify({ StatusCode: 404, Message: "Job not found" }),
      );
    if (job.done && job.errors.length > 0)
      return new Response(
        JSON.stringify({
          StatusCode: 500,
          Message: "Backup failed",
          Data: job.errors,
        }),
      );
    if (job.done)
      return new Response(
        JSON.stringify({ StatusCode: 200, Message: "Backup completed" }),
      );
    return new Response(
      JSON.stringify({ StatusCode: 100, Message: "Backup in progress" }),
    );
  } catch (error) {
    console.error(error);
    return new Response(
      JSON.stringify({ StatusCode: 500, Message: "Internal Server Error" }),
    );
  }
}

async function getBackupEmergencyKey() {
  // read /homeassistant/.storage/backup and parse the json to get the key
  try {
    const backupFile = Bun.file("/homeassistant/.storage/backup");
    const backupFileText = await backupFile.text();
    const backupFileContent = JSON.parse(backupFileText);
    const key = backupFileContent.data.config.create_backup.password;
    if (key === undefined)
      return new Response(
        JSON.stringify({
          StatusCode: 404,
          Message: "Backup emergency key not found",
        }),
      );

    return new Response(
      JSON.stringify({
        StatusCode: 200,
        Message: "Backup emergency key retrieved successfully",
        Data: key,
      }),
    );
  } catch (error) {
    console.error(
      "Error reading backup emergency key:",
      error instanceof Error ? error.message : error,
    );
    return new Response(
      JSON.stringify({ StatusCode: 500, Message: "Internal Server Error" }),
    );
  }
}

async function getBackupConfig() {
  try {
    const backupFile = Bun.file("/homeassistant/.storage/backup");
    const backupHassioFile = Bun.file("/homeassistant/.storage/hassio");
    const [backupFileText, backupHassioFileText] = await Promise.all([
      backupFile.text(),
      backupHassioFile.text(),
    ]);
    const backupFileContent = JSON.parse(backupFileText);
    const backupFileData = backupFileContent.data.config;
    const backupHassioFileContent = JSON.parse(backupHassioFileText);
    const backupHassioFileData = backupHassioFileContent.data.update_config;
    const backupConfig = {
      automaticBackupsEnabled: backupFileData.automatic_backups_configured, //ha uses to determain a popup in the UI to ask the user to configure automatic backups, true once configured
      content: backupFileData.automatic_backups_configured
        ? {
            includeAllAddons: backupFileData.create_backup.include_all_addons,
            Addons: backupFileData.create_backup.include_addons, // filled if all_addons is false, if false and this is empty, no addons will be included
            includeDatabase: backupFileData.create_backup.include_database, //history
            Folders: backupFileData.create_backup.include_folders, // if empty, no folders will be included, media and share can be included here
          }
        : null,
      retention: backupFileData.automatic_backups_configured
        ? {
            // both null = forever
            copies: backupFileData.retention.copies, // int indicating how many backups to keep
            days: backupFileData.retention.days, // int indicating how many days to keep backups
          }
        : null,
      schedule: backupFileData.automatic_backups_configured
        ? {
            recurrence: backupFileData.schedule.recurrence, // never, daily, custom_days
            days: backupFileData.schedule.days, // filled if recurrence is custom_days, values are the days of the week, e.g. ["mon", "tue"]
            time: backupFileData.schedule.time, // time of the day null=System Optiomal, otherwise "HH:mm:00"
          }
        : null,
      backupOnUpdate: {
        homeassistant: backupHassioFileData.core_backup_before_update,
        addons: backupHassioFileData.add_on_backup_before_update,
        addonsRetain: backupHassioFileData.add_on_backup_retain_copies, // int of copies to keep
      },
    };
    return new Response(
      JSON.stringify({
        StatusCode: 200,
        Message: "Backup config retrieved successfully",
        Data: backupConfig,
      }),
    );
  } catch (error) {
    console.error(
      "Error reading backup config:",
      error instanceof Error ? error.message : error,
    );
    return new Response(
      JSON.stringify({ StatusCode: 500, Message: "Internal Server Error" }),
    );
  }
}

export {
  getBackups,
  getBackupInfo,
  downloadBackup,
  uploadBackup,
  deleteBackup,
  restoreBackup,
  backupStatus,
  getBackupEmergencyKey,
  getBackupConfig,
};
