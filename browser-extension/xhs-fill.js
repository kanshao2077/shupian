const TITLE_SELECTORS = [
  "div.d-input input",
  'input[placeholder*="标题"]',
  'textarea[placeholder*="标题"]',
  '[contenteditable="true"][data-placeholder*="标题"]',
];

const BODY_SELECTORS = [
  "div.tiptap.ProseMirror",
  'div.ProseMirror[contenteditable="true"]',
  'textarea[placeholder*="正文"]',
  'textarea[placeholder*="描述"]',
  '[contenteditable="true"][data-placeholder*="正文"]',
  '.ql-editor[contenteditable="true"]',
];

const IMAGE_INPUT_SELECTORS = [
  "input.upload-input[type=file]",
  'input[type="file"][accept*="image"][multiple]',
  'input[type="file"][multiple]',
  'input[type="file"][accept*="image"]',
];

function isVisible(element) {
  if (!element) return false;
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function findUnique(selectors, { allowHidden = false } = {}) {
  for (const selector of selectors) {
    const candidates = Array.from(document.querySelectorAll(selector)).filter(
      (element) => allowHidden || isVisible(element),
    );
    if (candidates.length === 1) return candidates[0];
  }
  return null;
}

function findBodyEditor(titleElement) {
  const matched = findUnique(BODY_SELECTORS);
  if (matched && matched !== titleElement) return matched;

  const fallbacks = Array.from(
    document.querySelectorAll('[contenteditable="true"][role="textbox"]'),
  ).filter(
    (element) => element !== titleElement && isVisible(element),
  );
  return fallbacks.length === 1 ? fallbacks[0] : null;
}

function setNativeValue(element, value) {
  const prototype =
    element instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

  if (setter) {
    setter.call(element, value);
  } else {
    element.value = value;
  }

  element.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      composed: true,
      data: value,
      inputType: "insertText",
    }),
  );
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function setEditableValue(element, value) {
  element.focus();
  element.textContent = value;
  element.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      composed: true,
      data: value,
      inputType: "insertText",
    }),
  );
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function fillField(element, value) {
  if (!element || !value) return false;

  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  ) {
    const maxLength = Number(element.getAttribute("maxlength")) || Infinity;
    setNativeValue(element, value.slice(0, maxLength));
  } else {
    setEditableValue(element, value);
  }

  element.dataset.piankeFilled = "true";
  return true;
}

async function dataUrlToFile(dataUrl, index) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], `薯片-${String(index + 1).padStart(2, "0")}.png`, {
    type: "image/png",
    lastModified: Date.now(),
  });
}

async function fillImages(input, imageDataUrls) {
  if (!input || !imageDataUrls.length) return 0;

  const files = await Promise.all(imageDataUrls.map(dataUrlToFile));
  const transfer = new DataTransfer();
  files.forEach((file) => transfer.items.add(file));
  input.files = transfer.files;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dataset.piankeFilled = "true";
  return files.length;
}

function showStatus(message, tone = "working") {
  let status = document.getElementById("pianke-fill-status");

  if (!status) {
    status = document.createElement("section");
    status.id = "pianke-fill-status";
    Object.assign(status.style, {
      position: "fixed",
      right: "20px",
      bottom: "20px",
      zIndex: "2147483647",
      maxWidth: "340px",
      padding: "13px 16px",
      border: "1px solid rgba(255,255,255,.18)",
      borderRadius: "12px",
      background: "#131416",
      color: "#f7f6f2",
      boxShadow: "0 16px 48px rgba(0,0,0,.32)",
      fontFamily:
        '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif',
      fontSize: "13px",
      lineHeight: "1.55",
    });
    document.documentElement.appendChild(status);
  }

  status.textContent = message;
  status.style.borderColor =
    tone === "success"
      ? "rgba(115,226,167,.55)"
      : tone === "error"
        ? "rgba(255,90,109,.58)"
        : "rgba(255,255,255,.18)";
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(getValue, timeoutMilliseconds = 45000) {
  const deadline = Date.now() + timeoutMilliseconds;

  while (Date.now() < deadline) {
    const value = getValue();
    if (value) return value;

    await sleep(500);
  }

  return null;
}

async function switchToImagePost() {
  const candidates = Array.from(
    document.querySelectorAll('.creator-tab, [role="tab"], button'),
  ).filter(
    (element) =>
      isVisible(element) && element.textContent?.trim() === "上传图文",
  );

  if (candidates.length === 1) {
    candidates[0].click();
    await sleep(300);
  }
}

function readField(element) {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  ) {
    return element.value;
  }
  return element.textContent || "";
}

async function getDraft() {
  const response = await chrome.runtime.sendMessage({
    action: "PIANKE_GET_DRAFT",
  });
  return response?.ok ? response.draft : null;
}

async function autoFill() {
  const isOfficialPublishPage =
    location.hostname === "creator.xiaohongshu.com" &&
    location.pathname.startsWith("/publish");
  const isLocalTestPage =
    document.documentElement.dataset.piankeXhsMock === "true";

  if (!isOfficialPublishPage && !isLocalTestPage) {
    return;
  }

  const draft = await getDraft();
  if (!draft) return;

  showStatus("薯片正在进入“上传图文”…");
  await switchToImagePost();

  const imageInput = await waitFor(
    () => findUnique(IMAGE_INPUT_SELECTORS, { allowHidden: true }),
    15000,
  );

  if (!imageInput) {
    showStatus(
      "没有找到唯一的图片上传控件。请确认已登录并进入“上传图文”页面，然后刷新一次。",
      "error",
    );
    return;
  }

  try {
    showStatus(`正在填入 ${draft.images?.length || 0} 张卡片…`);
    const imageCount = await fillImages(imageInput, draft.images || []);

    const editor = await waitFor(() => {
      const title = findUnique(TITLE_SELECTORS);
      const body = findBodyEditor(title);
      return title && body ? { title, body } : null;
    });

    if (!editor) {
      showStatus(
        `已提交 ${imageCount} 张卡片，但标题与正文编辑器没有按预期出现。请检查图片上传状态。`,
        "error",
      );
      return;
    }

    const titleFilled = fillField(editor.title, draft.title);
    const bodyFilled = fillField(editor.body, draft.body);
    const titleVerified = readField(editor.title).includes(
      draft.title.slice(0, 8),
    );
    const bodyVerified = readField(editor.body).includes(
      draft.body.slice(0, 12),
    );
    const imageVerified =
      imageInput.files?.length === imageCount ||
      document.querySelectorAll(".img-preview-area .pr").length >= imageCount;

    if (
      !titleFilled ||
      !bodyFilled ||
      !titleVerified ||
      !bodyVerified ||
      imageCount === 0 ||
      !imageVerified
    ) {
      throw new Error("部分素材未能填入");
    }

    showStatus(
      `已填入标题、正文和 ${imageCount} 张卡片。请校对后由你点击最终发布。`,
      "success",
    );
  } catch {
    showStatus(
      "标题或正文已尝试填入，但图片控件发生变化。请手动检查并补充未成功的部分。",
      "error",
    );
  }
}

autoFill();
