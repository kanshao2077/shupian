const DRAFT_KEY = "piankeXhsDraft";
const XHS_PUBLISH_URL =
  "https://creator.xiaohongshu.com/publish/publish?source=official";

function isValidDraft(payload) {
  return (
    payload &&
    typeof payload.title === "string" &&
    typeof payload.body === "string" &&
    Array.isArray(payload.images) &&
    payload.images.every(
      (image) => typeof image === "string" && image.startsWith("data:image/png"),
    )
  );
}

async function saveDraft(payload) {
  if (!isValidDraft(payload)) {
    throw new Error("发布素材格式不正确");
  }

  await chrome.storage.local.set({
    [DRAFT_KEY]: {
      ...payload,
      savedAt: Date.now(),
    },
  });
}

async function openPublishPage() {
  const createdTab = await chrome.tabs.create({
    active: true,
    url: XHS_PUBLISH_URL,
  });
  return createdTab.id;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.action !== "string") {
    return false;
  }

  if (message.action === "PIANKE_CACHE_DRAFT") {
    saveDraft(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.action === "PIANKE_OPEN_XHS_DRAFT") {
    saveDraft(message.payload)
      .then(() => openPublishPage())
      .then((tabId) => sendResponse({ ok: true, tabId }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.action === "PIANKE_GET_DRAFT") {
    chrome.storage.local
      .get(DRAFT_KEY)
      .then((result) =>
        sendResponse({ ok: true, draft: result[DRAFT_KEY] || null }),
      )
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.action === "PIANKE_CLEAR_DRAFT") {
    chrome.storage.local
      .remove(DRAFT_KEY)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: "https://kanshao2077.github.io/shupian/" });
});
