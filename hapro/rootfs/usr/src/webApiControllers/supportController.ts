import { doHaInternalApiRequest, getApiUrl, getUuid, jsonResponse } from "./apiHelperService";
import { subscribeToEvent } from "./websocketService";

let cachedSupportInfo: any = null;

async function applySupportInfoToHomeAssistant(supportInfo: any): Promise<void> {
  cachedSupportInfo = supportInfo;
  try {
    const payload = {
      email: supportInfo?.email ?? supportInfo?.Email ?? null,
      phone: supportInfo?.phone ?? supportInfo?.Phone ?? null,
      opening_hours: supportInfo?.openingHours ?? supportInfo?.OpeningHours ?? null,
      response_time: supportInfo?.responseTime ?? supportInfo?.ResponseTime ?? null,
    };
    console.debug("Applying support info to Home Assistant:", payload);
    await doHaInternalApiRequest(
      "/services/ludero_virtual_grid/set_support_info",
      "POST",
      payload,
    );
  } catch (error) {
    console.error("Failed to apply support info to Home Assistant:", error);
  }
}

async function handleSupportPush(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    console.debug("Received partner support push update:", body);
    await applySupportInfoToHomeAssistant(body);
    return jsonResponse(200, { success: true }, "Support info updated");
  } catch (error) {
    console.error("Error handling support push:", error);
    return jsonResponse(500, null, "Failed to handle support push");
  }
}

async function syncSupportInfoFromApi(): Promise<void> {
  const uuid = await getUuid().catch(() => null);
  const apiUrl = await getApiUrl().catch(() => null);
  if (!uuid || !apiUrl) {
    console.warn("Cannot sync support info: UUID or API URL missing.");
    return;
  }
  try {
    const cleanApiUrl = apiUrl.replace(/\/$/, "");
    console.debug(`Fetching support info from central API: ${cleanApiUrl}/api/Device/${uuid}/support`);
    const res = await fetch(`${cleanApiUrl}/api/Device/${uuid}/support`);
    if (res.ok) {
      const data: any = await res.json();
      const supportInfo = data?.data ?? data;
      console.debug("Fetched support info from central API:", supportInfo);
      await applySupportInfoToHomeAssistant(supportInfo);
    } else {
      console.warn(`Failed to fetch support info from API, status: ${res.status}`);
    }
  } catch (error) {
    console.error("Error fetching support info from central API:", error);
  }
}

async function initSupportService(): Promise<void> {
  await syncSupportInfoFromApi();

  subscribeToEvent("homeassistant_started", async () => {
    console.debug("Home Assistant Core started, resyncing support info...");
    if (cachedSupportInfo) {
      await applySupportInfoToHomeAssistant(cachedSupportInfo);
    } else {
      await syncSupportInfoFromApi();
    }
  });
}

export {
  handleSupportPush,
  syncSupportInfoFromApi,
  applySupportInfoToHomeAssistant,
  initSupportService,
};
