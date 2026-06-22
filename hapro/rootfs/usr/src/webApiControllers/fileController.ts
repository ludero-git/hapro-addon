import * as helpers from "./apiHelperService";
import * as fs from 'fs';
import * as path from 'path';
import * as unzipper from 'unzipper';
import { Buffer } from 'buffer';

async function getCurrentFileVersion() {
  const configFilesPath = Bun.env.HAPRO_CONFIG_FILES_PATH || '/homeassistant/hapro-files';
  const versionFilePath = path.join(configFilesPath, 'version.json');
  try {
    if (fs.existsSync(versionFilePath)) {
      const versionData = await fs.promises.readFile(versionFilePath, 'utf-8');
      return new Response(JSON.stringify({ StatusCode: 200, data: JSON.parse(versionData) }));

    } else {
      console.log('Version file does not exist.');
      return new Response(JSON.stringify({ StatusCode: 404, Message: 'Version file does not exist.' }));
    }
  } catch (error) {
    console.error('Error reading version file:', error);
    return new Response(JSON.stringify({ StatusCode: 500, Message: 'Internal Server Error' }));
  }
}

async function updateFile(req: Request) {
  const configFilesPath = Bun.env.HAPRO_CONFIG_FILES_PATH || '/homeassistant/hapro-files';
  const haproFilesPath = path.join(configFilesPath);
  const zipFilePath = path.join(haproFilesPath, 'update.zip');
  const backupFile = await req.arrayBuffer();
  const blob = new Blob([backupFile], { type: "application/zip" });

  try {
    if (!fs.existsSync(haproFilesPath))
      fs.mkdirSync(haproFilesPath, { recursive: true });

    const versionFilePath = path.join(haproFilesPath, 'version.json');
    let currentVersion = null;
    if (fs.existsSync(versionFilePath)) {
      const versionData = await fs.promises.readFile(versionFilePath, 'utf-8');
      currentVersion = JSON.parse(versionData).version;
    }

    const newVersion = req.headers.get('Version') || '0';
    if (currentVersion === newVersion) {
      console.log('Version is the same. No update needed.');
      return new Response(JSON.stringify({ StatusCode: 304, Message: 'Version is the same. No update needed.' }));
    }

    const files = await fs.promises.readdir(haproFilesPath);
    for (const file of files) {
      const filePath = path.join(haproFilesPath, file);
      const stat = await fs.promises.stat(filePath);
      if (stat.isDirectory()) {
        await fs.promises.rmdir(filePath, { recursive: true });
      } else {
        await fs.promises.unlink(filePath);
      }
    }

    const buffer = Buffer.from(await blob.arrayBuffer());
    await fs.promises.writeFile(zipFilePath, buffer);

    const directory = await unzipper.Open.file(zipFilePath);
    await directory.extract({ path: haproFilesPath, overwrite: true });
    fs.unlinkSync(zipFilePath);

    const versionData = {
      version: newVersion,
      partner_name: req.headers.get('PartnerName') || 'unknown'
    };
    await fs.promises.writeFile(versionFilePath, JSON.stringify(versionData, null, 2), 'utf-8');

    console.log('Files updated successfully.');
    await sendFileUpdateEvent(newVersion, versionData.partner_name);
    return new Response(JSON.stringify({ StatusCode: 200, Message: 'Files updated successfully.' }));
  } catch (error) {
    console.error('Error updating files:', error);
    return new Response(JSON.stringify({ StatusCode: 500, Message: 'Internal Server Error' }));
  }
}

async function sendFileUpdateEvent(version: string, partnerName: string) {
  try {
    const template = `
  {% set event_data = {
    version: '${version}',
    partner_name: '${partnerName}'
  } %}
  {{ event_data | tojson }
   `
    const response = await helpers.doHaInternalApiRequest(`/events/hapro-files-update`, "POST", {
      template: template,
    });
    if (response?.message?.includes('Event') && response?.message?.includes('fired')) {
      console.log('HA file updated event triggered successfully with version:', version, 'and partner name:', partnerName);
    } else {
      console.error('Unexpected response from HA event trigger:', response);
    }
  }
  catch (error) {
    console.error('Error sending file update event:', error instanceof Error ? error.message : error);
  }
}

export { getCurrentFileVersion, updateFile };