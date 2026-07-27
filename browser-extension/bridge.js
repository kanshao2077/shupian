const APP_SOURCE = "PIANKE_CARD_STUDIO";
const EXTENSION_SOURCE = "PIANKE_BROWSER_ASSISTANT";
const SUPPORTED_MESSAGES = new Set([
  "PIANKE_CACHE_DRAFT",
  "PIANKE_OPEN_XHS_DRAFT",
]);

function notifyReady() {
  window.postMessage(
    {
      source: EXTENSION_SOURCE,
      type: "PIANKE_EXTENSION_READY",
    },
    "*",
  );
}

window.addEventListener("message", async (event) => {
  if (
    event.source !== window ||
    event.data?.source !== APP_SOURCE ||
    typeof event.data?.type !== "string"
  ) {
    return;
  }

  if (event.data.type === "PIANKE_EXTENSION_PING") {
    notifyReady();
    return;
  }

  if (!SUPPORTED_MESSAGES.has(event.data.type)) {
    return;
  }

  const requestId = event.data.requestId;

  try {
    const response = await chrome.runtime.sendMessage({
      action: event.data.type,
      payload: event.data.payload,
    });

    window.postMessage(
      {
        source: EXTENSION_SOURCE,
        type: "PIANKE_EXTENSION_ACK",
        requestId,
        ok: Boolean(response?.ok),
        error: response?.error,
      },
      "*",
    );
  } catch (error) {
    window.postMessage(
      {
        source: EXTENSION_SOURCE,
        type: "PIANKE_EXTENSION_ACK",
        requestId,
        ok: false,
        error: error.message,
      },
      "*",
    );
  }
});

notifyReady();
