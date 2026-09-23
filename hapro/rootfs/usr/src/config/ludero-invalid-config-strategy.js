const STRATEGY_TAG = "ll-strategy-dashboard-llm-virtual-grid-strategy";
const STRATEGY_TYPE = "llm-virtual-grid-strategy";
const INTEGRATION_STRATEGY_URL = "/ludero_frontend/grid-strategy.js";

function hasConfiguredLuderoIntegration(hass) {
  return Object.values(hass?.devices || {}).some(device =>
    device?.manufacturer === "Ludero" && device?.model === "Virtual Site"
  );
}

function getTargetLanguage(config, hass) {
  return config?.strategy?.language === "nl" || hass?.language === "nl" ? "nl" : "en";
}

function getMessage(targetLang, configured) {
  if (targetLang === "nl") {
    return configured
      ? "## Ludero Virtual Grid\n\n> [!WARNING]\n> De Ludero Virtual Grid kon niet worden geladen. \n>\n> Neem contact op met de beheerder."
      : "## Ludero Virtual Grid\n\n> [!WARNING]\n> De Ludero Virtual Grid is niet geconfigureerd. \n>\n> Neem contact op met de beheerder.";
  }

  return configured
    ? "## Ludero Virtual Grid\n\n> [!WARNING]\n> The Ludero Virtual Grid could not be loaded. \n>\n> Contact the administrator."
    : "## Ludero Virtual Grid\n\n> [!WARNING]\n> The Ludero Virtual Grid is not configured. \n>\n> Contact the administrator.";
}

function buildFallbackDashboard(info) {
  const config = info?.config && typeof info.config === "object" ? info.config : {};
  const configured = hasConfiguredLuderoIntegration(info?.hass);
  const targetLang = getTargetLanguage(config, info?.hass);

  return {
    ...config,
    views: [
      {
        title: "Ludero Virtual Grid",
        path: "ludero-strategy-error",
        icon: "mdi:alert-circle-outline",
        cards: [
          {
            type: "markdown",
            content: getMessage(targetLang, configured),
            text_only: true,
          },
        ],
      },
    ],
  };
}

async function integrationStrategyIsAvailable() {
  if (customElements.get(STRATEGY_TAG)) {
    return true;
  }

  try {
    const response = await fetch(INTEGRATION_STRATEGY_URL, {
      method: "HEAD",
      cache: "no-store",
    });
    return response.ok;
  } catch (_error) {
    return false;
  }
}

if (!(await integrationStrategyIsAvailable())) {
  class LuderoInvalidConfigStrategy extends HTMLElement {
    static async generateDashboard(info) {
      return buildFallbackDashboard(info);
    }
  }

  if (!customElements.get(STRATEGY_TAG)) {
    customElements.define(STRATEGY_TAG, LuderoInvalidConfigStrategy);
  }

  window.customStrategies = window.customStrategies || [];
  if (!window.customStrategies.some(strategy => strategy.type === STRATEGY_TYPE)) {
    window.customStrategies.push({
      type: STRATEGY_TYPE,
      strategyType: "dashboard",
      name: "Ludero Virtual Grid Dashboard",
      description: "Ludero Virtual Grid dashboard fallback",
    });
  }
}
