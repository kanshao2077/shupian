import {
  Fragment,
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  CaretDown,
  CaretUp,
  CheckCircle,
  ClipboardText,
  Package,
  PaperPlaneTilt,
  SealCheck,
  SlidersHorizontal,
  TextT,
  Trash,
  UploadSimple,
  WarningCircle,
  XLogo,
} from "@phosphor-icons/react";
import { toBlob } from "html-to-image";
import JSZip from "jszip";

const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1440;
const CONTENT_WIDTH = 904;
const BODY_HEIGHT = 968;
const MAX_UPLOADS = 6;
const MAX_IMAGE_EDGE = 2400;
const MAX_IMAGE_FILE_SIZE = 25 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 64_000_000;
const MINERAL_BACKGROUND_STORAGE_KEY =
  "shupian:mineral-background:v1";
const MAX_STORED_BACKGROUND_LENGTH = 2_400_000;
const APP_MESSAGE_SOURCE = "PIANKE_CARD_STUDIO";
const EXTENSION_MESSAGE_SOURCE = "PIANKE_BROWSER_ASSISTANT";
const APP_ASSET_BASE = import.meta.env.BASE_URL;
const DEFAULT_AVATAR = `${APP_ASSET_BASE}assets/avatar-kan-shao.png`;
const APP_LOGO = `${APP_ASSET_BASE}assets/shupian-logo.png`;
const SHORT_POSTER_BACKGROUNDS = {
  mineral: `${APP_ASSET_BASE}assets/short-poster-mineral.png`,
  highlight: `${APP_ASSET_BASE}assets/short-poster-highlight.png`,
};
const IMAGE_ASPECT_RATIOS = {
  "16:9": 16 / 9,
  "4:3": 4 / 3,
  "1:1": 1,
};

const DEFAULT_TEXT = `从 Codex 额度重置这件事里，

能看出很多人的工作方式已经变了。

有人攒了三次重置，额度都没用完。

有人一天就用完了一周的额度。

还有人每天都在等重置，

隔一会儿就去看看 Tibo 有没有发新消息。

这件事本身还挺有意思的。

我们居然已经开始围着一个 Agent 的额度，

安排自己的工作节奏了。`;

const DEFAULT_SHORT_TEXT = `种一棵树最好的时间是十年前，
其次是现在。`;

function limitShortText(value) {
  const sourceLines = value
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .split("\n");
  const limitedLines =
    sourceLines.length <= 8
      ? sourceLines
      : [
          ...sourceLines.slice(0, 7),
          sourceLines.slice(7).join(" "),
        ];
  let visibleCharacterCount = 0;
  let result = "";

  for (const character of Array.from(limitedLines.join("\n"))) {
    if (!/\s/.test(character)) {
      if (visibleCharacterCount >= 80) break;
      visibleCharacterCount += 1;
    }
    result += character;
  }

  return result;
}

const SHORT_STYLE_OPTIONS = [
  {
    id: "mineral",
    name: "材质大字",
    description: "留白与宋体",
  },
  {
    id: "highlight",
    name: "重点摘录",
    description: "高亮与落款",
  },
];

const COLOR_PRESETS = [
  { name: "曜石", value: "#121214" },
  { name: "墨蓝", value: "#111827" },
  { name: "栗棕", value: "#211815" },
  { name: "纸白", value: "#F7F6F2" },
];

function hexToRgb(hex) {
  const normalized = hex.replace("#", "");
  const value =
    normalized.length === 3
      ? normalized
          .split("")
          .map((character) => character + character)
          .join("")
      : normalized;

  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function getPalette(background) {
  const { r, g, b } = hexToRgb(background);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const isDark = luminance < 0.54;

  return isDark
    ? {
        foreground: "#F3F2EE",
        secondary: "rgba(243, 242, 238, 0.52)",
        line: "rgba(255, 255, 255, 0.11)",
        watermark: "rgba(243, 242, 238, 0.34)",
        mediaBackground: "rgba(255, 255, 255, 0.055)",
      }
    : {
        foreground: "#171717",
        secondary: "rgba(23, 23, 23, 0.50)",
        line: "rgba(23, 23, 23, 0.09)",
        watermark: "rgba(23, 23, 23, 0.28)",
        mediaBackground: "rgba(23, 23, 23, 0.045)",
      };
}

function getContext(fontSize) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  context.font = `400 ${fontSize}px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`;
  return context;
}

function wrapText(value, fontSize) {
  const cleanValue = value.trim();
  if (!cleanValue) return [];

  const context = getContext(fontSize);
  const lines = [];
  let currentLine = "";

  for (const character of Array.from(cleanValue)) {
    const candidate = currentLine + character;
    if (context.measureText(candidate).width <= CONTENT_WIDTH || !currentLine) {
      currentLine = candidate;
    } else {
      lines.push(currentLine);
      currentLine = character;
    }
  }

  if (currentLine) lines.push(currentLine);
  return lines;
}

function getContentParagraphs(value) {
  return value
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph && !/^---+$/.test(paragraph));
}

function createBlockId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function createTextBlock(text = "", id = createBlockId("text")) {
  return { id, type: "text", text };
}

function createInitialContentBlocks(value) {
  const paragraphs = getContentParagraphs(value);
  return paragraphs.length
    ? paragraphs.map((paragraph) => createTextBlock(paragraph))
    : [createTextBlock()];
}

function getMediaHeight(media) {
  const selectedRatio = IMAGE_ASPECT_RATIOS[media.aspectRatio];
  if (selectedRatio) {
    return Math.round(CONTENT_WIDTH / selectedRatio);
  }

  const naturalHeight = (CONTENT_WIDTH * media.height) / media.width;
  return Math.min(760, Math.max(150, naturalHeight));
}

function getShortPosterFontSize(
  style,
  preferredSize,
  value,
  lineHeight,
  letterSpacing,
) {
  if (!value.trim()) return preferredSize;

  const maxWidth = style === "mineral" ? 900 : 846;
  const maxHeight = style === "mineral" ? 620 : 204;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const explicitLines = value.split(/\r?\n/);

  const fits = (fontSize) => {
    context.font =
      style === "mineral"
        ? `560 ${fontSize}px "Songti SC", "STSong", "Noto Serif CJK SC", "Source Han Serif SC", serif`
        : `700 ${fontSize}px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`;

    let visualLineCount = 0;

    explicitLines.forEach((line) => {
      const characters = Array.from(line);
      if (!characters.length) {
        visualLineCount += 1;
        return;
      }

      let currentLineWidth = 0;
      visualLineCount += 1;
      const safeWidth = maxWidth * 0.93;

      const addCharacters = (tokenCharacters) => {
        tokenCharacters.forEach((character) => {
          const characterWidth =
            context.measureText(character).width +
            (currentLineWidth > 0 ? letterSpacing : 0);

          if (
            currentLineWidth > 0 &&
            currentLineWidth + characterWidth > safeWidth
          ) {
            visualLineCount += 1;
            currentLineWidth = Math.max(
              0,
              context.measureText(character).width,
            );
          } else {
            currentLineWidth += characterWidth;
          }
        });
      };

      const tokens =
        line.match(/[A-Za-z0-9]+|\s+|[^A-Za-z0-9\s]/gu) || [];

      tokens.forEach((token) => {
        const tokenCharacters = Array.from(token);
        const isLatinWord = /^[A-Za-z0-9]+$/u.test(token);
        const tokenWidth =
          context.measureText(token).width +
          Math.max(0, tokenCharacters.length - 1) * letterSpacing;

        if (isLatinWord && tokenWidth <= safeWidth) {
          const leadingSpacing =
            currentLineWidth > 0 ? letterSpacing : 0;

          if (
            currentLineWidth > 0 &&
            currentLineWidth + leadingSpacing + tokenWidth > safeWidth
          ) {
            visualLineCount += 1;
            currentLineWidth = tokenWidth;
          } else {
            currentLineWidth += leadingSpacing + tokenWidth;
          }
          return;
        }

        if (isLatinWord && currentLineWidth > 0) {
          visualLineCount += 1;
          currentLineWidth = 0;
        }

        addCharacters(tokenCharacters);
      });
    });

    return (
      visualLineCount * fontSize * lineHeight <= maxHeight - 8
    );
  };

  let smallest = 12;
  let largest = Math.max(smallest, Math.round(preferredSize));
  let resolvedSize = smallest;

  while (smallest <= largest) {
    const candidate = Math.floor((smallest + largest) / 2);
    if (fits(candidate)) {
      resolvedSize = candidate;
      smallest = candidate + 1;
    } else {
      largest = candidate - 1;
    }
  }

  return Math.min(preferredSize, resolvedSize);
}

function paginateContent(contentBlocks, fontSize, lineHeight) {
  const pages = [];
  const lineHeightPx = fontSize * lineHeight;
  const paragraphGap = Math.max(28, fontSize * 0.86);
  const mediaGap = paragraphGap;

  let currentPage = { elements: [], usedHeight: 0 };

  const commitPage = () => {
    if (currentPage.elements.length > 0) {
      pages.push(currentPage);
    }
    currentPage = { elements: [], usedHeight: 0 };
  };

  const addMedia = (asset) => {
    const height = getMediaHeight(asset);
    const gap = currentPage.elements.length ? mediaGap : 0;

    if (
      currentPage.elements.length &&
      currentPage.usedHeight + gap + height > BODY_HEIGHT
    ) {
      commitPage();
    }

    currentPage.elements.push({ type: "media", asset, height });
    currentPage.usedHeight +=
      (currentPage.elements.length > 1 ? mediaGap : 0) + height;
  };

  contentBlocks.forEach((block) => {
    if (block.type === "pageBreak") {
      commitPage();
      return;
    }

    if (block.type === "media") {
      addMedia(block.asset);
      return;
    }

    if (block.type !== "text") return;

    const paragraphs = block.text
      .split(/\n/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);

    paragraphs.forEach((paragraph) => {
      if (/^---+$/.test(paragraph)) {
        commitPage();
        return;
      }

      let remainingLines = wrapText(paragraph, fontSize);

      while (remainingLines.length) {
        const gap = currentPage.elements.length ? paragraphGap : 0;
        const availableHeight = BODY_HEIGHT - currentPage.usedHeight - gap;
        let lineCapacity = Math.floor(availableHeight / lineHeightPx);

        if (
          currentPage.elements.length &&
          (lineCapacity <= 0 ||
            (lineCapacity === 1 && remainingLines.length > 1))
        ) {
          commitPage();
          continue;
        }

        lineCapacity = Math.max(1, lineCapacity);
        const lines = remainingLines.slice(0, lineCapacity);
        remainingLines = remainingLines.slice(lineCapacity);

        currentPage.elements.push({ type: "text", lines });
        currentPage.usedHeight +=
          (currentPage.elements.length > 1 ? gap : 0) +
          lines.length * lineHeightPx;

        if (remainingLines.length) {
          commitPage();
        }
      }
    });
  });

  commitPage();

  return pages.length
    ? pages
    : [{ elements: [{ type: "text", lines: ["在这里写下你的内容。"] }] }];
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_IMAGE_FILE_SIZE) {
      reject(new Error(`图片超过 25 MB：${file.name}`));
      return;
    }

    const sourceUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      try {
        if (image.naturalWidth * image.naturalHeight > MAX_IMAGE_PIXELS) {
          throw new Error(`图片像素过大：${file.name}`);
        }

        const scale = Math.min(
          1,
          MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight),
        );
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(image, 0, 0, width, height);

        resolve({
          id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
          name: file.name,
          src: canvas.toDataURL(
            file.type === "image/jpeg" ? "image/jpeg" : "image/png",
            0.9,
          ),
          width,
          height,
          aspectRatio: "16:9",
        });
      } catch (error) {
        reject(
          error instanceof Error
            ? error
            : new Error(`无法处理图片：${file.name}`),
        );
      } finally {
        image.onload = null;
        image.onerror = null;
        image.src = "";
        URL.revokeObjectURL(sourceUrl);
      }
    };

    image.onerror = () => {
      URL.revokeObjectURL(sourceUrl);
      reject(new Error(`无法读取图片：${file.name}`));
    };
    image.src = sourceUrl;
  });
}

function getStoredMineralBackground() {
  if (typeof window === "undefined") return null;

  try {
    const storedValue = window.localStorage.getItem(
      MINERAL_BACKGROUND_STORAGE_KEY,
    );
    if (!storedValue) return null;

    const parsedValue = JSON.parse(storedValue);
    if (
      typeof parsedValue?.src !== "string" ||
      !parsedValue.src.startsWith("data:image/")
    ) {
      return null;
    }

    return {
      src: parsedValue.src,
      name:
        typeof parsedValue.name === "string"
          ? parsedValue.name
          : "自定义背景",
      remembered: true,
    };
  } catch {
    return null;
  }
}

function readMineralBackgroundFile(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("请选择图片文件"));
      return;
    }

    if (file.size > MAX_IMAGE_FILE_SIZE) {
      reject(new Error("背景图片不能超过 25 MB"));
      return;
    }

    const sourceUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      try {
        if (image.naturalWidth * image.naturalHeight > MAX_IMAGE_PIXELS) {
          throw new Error("背景图片像素过大");
        }

        const targetWidth = CARD_WIDTH;
        const targetHeight = CARD_HEIGHT;
        const targetRatio = targetWidth / targetHeight;
        const sourceRatio = image.naturalWidth / image.naturalHeight;
        let sourceWidth = image.naturalWidth;
        let sourceHeight = image.naturalHeight;
        let sourceX = 0;
        let sourceY = 0;

        if (sourceRatio > targetRatio) {
          sourceWidth = Math.round(image.naturalHeight * targetRatio);
          sourceX = Math.round((image.naturalWidth - sourceWidth) / 2);
        } else {
          sourceHeight = Math.round(image.naturalWidth / targetRatio);
          sourceY = Math.round((image.naturalHeight - sourceHeight) / 2);
        }

        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const context = canvas.getContext("2d");
        context.fillStyle = "#eef0ef";
        context.fillRect(0, 0, targetWidth, targetHeight);
        context.drawImage(
          image,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          0,
          0,
          targetWidth,
          targetHeight,
        );

        let src = canvas.toDataURL("image/jpeg", 0.84);
        if (src.length > MAX_STORED_BACKGROUND_LENGTH) {
          src = canvas.toDataURL("image/jpeg", 0.62);
        }
        if (src.length > MAX_STORED_BACKGROUND_LENGTH) {
          const compactCanvas = document.createElement("canvas");
          compactCanvas.width = 900;
          compactCanvas.height = 1200;
          compactCanvas
            .getContext("2d")
            .drawImage(
              canvas,
              0,
              0,
              compactCanvas.width,
              compactCanvas.height,
            );
          src = compactCanvas.toDataURL("image/jpeg", 0.68);
        }
        if (src.length > MAX_STORED_BACKGROUND_LENGTH) {
          throw new Error("背景图片压缩后仍然过大，请换一张");
        }

        resolve({
          src,
          name: file.name || "自定义背景",
        });
      } catch (error) {
        reject(
          error instanceof Error
            ? error
            : new Error("无法处理背景图片"),
        );
      } finally {
        image.onload = null;
        image.onerror = null;
        image.src = "";
        URL.revokeObjectURL(sourceUrl);
      }
    };

    image.onerror = () => {
      URL.revokeObjectURL(sourceUrl);
      reject(new Error("无法读取背景图片"));
    };
    image.src = sourceUrl;
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("图片转换失败"));
    reader.readAsDataURL(blob);
  });
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function copyTextSynchronously(value) {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.readOnly = true;
  textarea.style.position = "fixed";
  textarea.style.inset = "0 auto auto -9999px";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

function buildPostHtml(payload) {
  const bodyHtml = payload.body
    .split(/\n+/)
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join("");
  const imagesHtml = payload.images
    .map(
      (src, index) =>
        `<img src="${src}" alt="卡片 ${index + 1}" style="display:block;max-width:100%;margin:16px 0;border-radius:16px;" />`,
    )
    .join("");

  return `<article><h1>${escapeHtml(
    payload.title,
  )}</h1>${bodyHtml}${imagesHtml}</article>`;
}

const CardCanvas = forwardRef(function CardCanvas(
  {
    page,
    pageIndex,
    pageCount,
    author,
    date,
    avatar,
    background,
    cardRadius,
    imageRadius,
    fontSize,
    lineHeight,
    watermark,
    footerMarkType,
    cardMode,
    shortStyle,
    shortText,
    shortSettings,
    shortBackgrounds,
    shortFontSize,
  },
  ref,
) {
  const palette = getPalette(background);
  const shortSetting = shortSettings[shortStyle];

  if (cardMode === "short") {
    return (
      <article
        ref={ref}
        className="card-export-frame short-poster-frame"
        aria-label={`短文海报，${SHORT_STYLE_OPTIONS.find(
          (option) => option.id === shortStyle,
        )?.name || "短文样式"}`}
      >
        <div
          className={`card-surface short-poster-surface is-${shortStyle}`}
          style={{
            "--card-radius": `${cardRadius}px`,
            "--short-text-color": shortSetting.textColor,
            "--short-font-size": `${shortFontSize}px`,
            "--short-line-height": shortSetting.lineHeight,
            "--short-letter-spacing": `${shortSetting.letterSpacing}px`,
            backgroundImage: `url("${shortBackgrounds[shortStyle]}")`,
          }}
        >
          <div className="short-poster-copy">{shortText}</div>

          {shortStyle === "highlight" ? (
            <footer className="short-poster-author">
              <img src={avatar} alt="" />
              <div>
                <strong>{author || "未命名"}</strong>
                <time>{date}</time>
              </div>
            </footer>
          ) : null}
        </div>
      </article>
    );
  }

  return (
    <article
      ref={ref}
      className="card-export-frame"
      style={{
        "--card-background": background,
        "--card-foreground": palette.foreground,
        "--card-secondary": palette.secondary,
        "--card-line": palette.line,
        "--card-watermark": palette.watermark,
        "--media-background": palette.mediaBackground,
        "--card-radius": `${cardRadius}px`,
        "--image-radius": `${imageRadius}px`,
        "--body-font-size": `${fontSize}px`,
        "--body-line-height": lineHeight,
        "--paragraph-gap": `${Math.max(28, fontSize * 0.86)}px`,
      }}
      aria-label={`卡片 ${pageIndex + 1}，共 ${pageCount} 张`}
    >
      <div className="card-surface">
        <header className="card-author">
          <img className="card-avatar" src={avatar} alt="" />
          <div className="card-author-copy">
            <div className="card-author-name">
              <span>{author || "未命名"}</span>
              <SealCheck aria-label="已认证" weight="fill" />
            </div>
            <time>{date}</time>
          </div>
        </header>

        <div className="card-body">
          {page.elements.map((element, elementIndex) =>
            element.type === "media" ? (
              <figure
                className="card-media"
                key={element.asset.id}
                style={{ height: `${element.height}px` }}
              >
                <img
                  src={element.asset.src}
                  alt={element.asset.name}
                  style={
                    IMAGE_ASPECT_RATIOS[element.asset.aspectRatio]
                      ? {
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                        }
                      : element.asset.width / element.asset.height >=
                          CONTENT_WIDTH / element.height
                      ? { width: "100%", height: "auto" }
                      : { width: "auto", height: "100%" }
                  }
                />
              </figure>
            ) : (
              <p key={`text-${elementIndex}`}>
                {element.lines.map((line, lineIndex) => (
                  <Fragment key={`${line}-${lineIndex}`}>
                    {line}
                    {lineIndex < element.lines.length - 1 ? <br /> : null}
                  </Fragment>
                ))}
              </p>
            ),
          )}
        </div>

        <footer className="card-footer">
          <div className="card-divider" />
          <div className="card-footer-mark">
            {footerMarkType === "x" ? (
              <span
                className="card-platform-mark"
                role="img"
                aria-label="X 标识"
              >
                <XLogo weight="bold" aria-hidden="true" />
              </span>
            ) : watermark ? (
              <span className="card-custom-mark">{watermark}</span>
            ) : null}
          </div>
        </footer>
      </div>
    </article>
  );
});

function ResponsiveCardPreview({ children }) {
  const frameRef = useRef(null);
  const [scale, setScale] = useState(0.5);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;

    const observer = new ResizeObserver(([entry]) => {
      const nextScale = Math.min(1, entry.contentRect.width / CARD_WIDTH);
      setScale(nextScale);
    });

    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className="responsive-card-frame"
      ref={frameRef}
      style={{ height: `${CARD_HEIGHT * scale}px` }}
    >
      <div
        className="responsive-card-scale"
        style={{ transform: `scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  );
}

function CardThumbnail({
  page,
  index,
  pageCount,
  selected,
  onSelect,
  cardProps,
}) {
  const scale = 142 / CARD_WIDTH;

  return (
    <button
      className={`page-thumbnail ${selected ? "is-selected" : ""}`}
      type="button"
      onClick={onSelect}
      aria-label={`查看第 ${index + 1} 张卡片`}
    >
      <span className="thumbnail-canvas">
        <span
          className="thumbnail-scale"
          style={{ transform: `scale(${scale})` }}
        >
          <CardCanvas
            page={page}
            pageIndex={index}
            pageCount={pageCount}
            {...cardProps}
          />
        </span>
      </span>
      <span className="thumbnail-meta">
        <span>{String(index + 1).padStart(2, "0")}</span>
        <span>
          {cardProps.cardMode === "short"
            ? "短文海报"
            : `${page.elements.length} 个内容块`}
        </span>
      </span>
    </button>
  );
}

export function App() {
  const [activePanel, setActivePanel] = useState("content");
  const [cardMode, setCardMode] = useState("long");
  const [contentBlocks, setContentBlocks] = useState(() =>
    createInitialContentBlocks(DEFAULT_TEXT),
  );
  const [shortText, setShortText] = useState(DEFAULT_SHORT_TEXT);
  const [shortStyle, setShortStyle] = useState("mineral");
  const [shortSettings, setShortSettings] = useState({
    mineral: {
      fontSize: 132,
      textColor: "#B45C06",
      lineHeight: 1.42,
      letterSpacing: 0,
    },
    highlight: {
      fontSize: 68,
      textColor: "#111111",
      lineHeight: 1.3,
      letterSpacing: -0.8,
    },
  });
  const [customMineralBackground, setCustomMineralBackground] = useState(
    getStoredMineralBackground,
  );
  const [postTitle, setPostTitle] = useState("从额度重置，看见新的工作节奏");
  const [author, setAuthor] = useState("侃少2077");
  const [date, setDate] = useState("2026-07-27");
  const [avatar, setAvatar] = useState(DEFAULT_AVATAR);
  const [background, setBackground] = useState("#121214");
  const [cardRadius, setCardRadius] = useState(64);
  const [imageRadius, setImageRadius] = useState(28);
  const [fontSize, setFontSize] = useState(42);
  const [lineHeight, setLineHeight] = useState(1.55);
  const [watermark, setWatermark] = useState("Created with 薯片");
  const [footerMarkType, setFooterMarkType] = useState("x");
  const [selectedPage, setSelectedPage] = useState(0);
  const [exportState, setExportState] = useState("");
  const [activeAction, setActiveAction] = useState("");
  const [notice, setNotice] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [extensionReady, setExtensionReady] = useState(false);
  const [pendingImageReads, setPendingImageReads] = useState(0);
  const [activeTextBlockId, setActiveTextBlockId] = useState(null);

  const fileInputRef = useRef(null);
  const avatarInputRef = useRef(null);
  const mineralBackgroundInputRef = useRef(null);
  const mineralBackgroundRequestRef = useRef(0);
  const textBlockRefs = useRef(new Map());
  const activeTextSelectionRef = useRef(null);
  const pendingFilePlacementRef = useRef(null);
  const exportRefs = useRef([]);
  const noticeTimeoutRef = useRef(null);

  const text = useMemo(
    () =>
      contentBlocks
        .flatMap((block) => {
          if (block.type === "text") return [block.text];
          if (block.type === "pageBreak") return ["---"];
          return [];
        })
        .join("\n\n"),
    [contentBlocks],
  );
  const media = useMemo(
    () =>
      contentBlocks
        .filter((block) => block.type === "media")
        .map((block) => block.asset),
    [contentBlocks],
  );
  const pages = useMemo(
    () =>
      cardMode === "short"
        ? [{ elements: [] }]
        : paginateContent(contentBlocks, fontSize, lineHeight),
    [cardMode, contentBlocks, fontSize, lineHeight],
  );
  const postBody = cardMode === "short" ? shortText : text;
  const safeSelectedPage = Math.min(selectedPage, pages.length - 1);
  const shortBackgrounds = useMemo(
    () => ({
      ...SHORT_POSTER_BACKGROUNDS,
      mineral:
        customMineralBackground?.src ||
        SHORT_POSTER_BACKGROUNDS.mineral,
    }),
    [customMineralBackground],
  );
  const resolvedShortFontSize = useMemo(
    () =>
      cardMode === "short"
        ? getShortPosterFontSize(
            shortStyle,
            shortSettings[shortStyle].fontSize,
            shortText,
            shortSettings[shortStyle].lineHeight,
            shortSettings[shortStyle].letterSpacing,
          )
        : shortSettings[shortStyle].fontSize,
    [cardMode, shortSettings, shortStyle, shortText],
  );

  useEffect(() => {
    setSelectedPage((current) => Math.min(current, pages.length - 1));
  }, [pages.length]);

  useEffect(
    () => () => {
      if (noticeTimeoutRef.current) {
        window.clearTimeout(noticeTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const handleExtensionMessage = (event) => {
      if (
        event.source === window &&
        event.data?.source === EXTENSION_MESSAGE_SOURCE &&
        event.data?.type === "PIANKE_EXTENSION_READY"
      ) {
        setExtensionReady(true);
      }
    };

    window.addEventListener("message", handleExtensionMessage);
    window.postMessage(
      { source: APP_MESSAGE_SOURCE, type: "PIANKE_EXTENSION_PING" },
      "*",
    );

    return () => window.removeEventListener("message", handleExtensionMessage);
  }, []);

  const showNotice = useCallback((message, tone = "success") => {
    setNotice({ message, tone });
    if (noticeTimeoutRef.current) {
      window.clearTimeout(noticeTimeoutRef.current);
    }
    noticeTimeoutRef.current = window.setTimeout(() => setNotice(null), 2600);
  }, []);

  const requestExtension = useCallback((type, payload) => {
    const requestId = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        window.removeEventListener("message", handleReply);
        reject(new Error("浏览器助手未连接"));
      }, 2500);

      function handleReply(event) {
        if (
          event.source !== window ||
          event.data?.source !== EXTENSION_MESSAGE_SOURCE ||
          event.data?.type !== "PIANKE_EXTENSION_ACK" ||
          event.data?.requestId !== requestId
        ) {
          return;
        }

        window.clearTimeout(timeout);
        window.removeEventListener("message", handleReply);

        if (event.data.ok) {
          resolve(event.data);
        } else {
          reject(new Error(event.data.error || "浏览器助手处理失败"));
        }
      }

      window.addEventListener("message", handleReply);
      window.postMessage(
        { source: APP_MESSAGE_SOURCE, type, requestId, payload },
        "*",
      );
    });
  }, []);

  const cardProps = {
    author,
    date,
    avatar,
    background,
    cardRadius,
    imageRadius,
    fontSize,
    lineHeight,
    watermark,
    footerMarkType,
    cardMode,
    shortStyle,
    shortText,
    shortSettings,
    shortBackgrounds,
    shortFontSize: resolvedShortFontSize,
  };

  const updateShortSetting = useCallback(
    (key, value) => {
      setShortSettings((current) => ({
        ...current,
        [shortStyle]: {
          ...current[shortStyle],
          [key]: value,
        },
      }));
    },
    [shortStyle],
  );

  const focusTextBlock = useCallback((blockId, cursorPosition = 0) => {
    window.requestAnimationFrame(() => {
      const textarea = textBlockRefs.current.get(blockId);
      if (!textarea) return;
      textarea.focus();
      const safeCursor = Math.min(cursorPosition, textarea.value.length);
      textarea.setSelectionRange(safeCursor, safeCursor);
      activeTextSelectionRef.current = {
        blockId,
        start: safeCursor,
        end: safeCursor,
      };
    });
  }, []);

  const rememberTextSelection = useCallback((event, blockId) => {
    setActiveTextBlockId(blockId);
    activeTextSelectionRef.current = {
      blockId,
      start: event.currentTarget.selectionStart,
      end: event.currentTarget.selectionEnd,
    };
  }, []);

  const updateTextBlock = useCallback((blockId, value, selectionStart) => {
    setContentBlocks((current) =>
      current.map((block) =>
        block.id === blockId && block.type === "text"
          ? { ...block, text: value }
          : block,
      ),
    );
    activeTextSelectionRef.current = {
      blockId,
      start: selectionStart,
      end: selectionStart,
    };
  }, []);

  const splitTextBlock = useCallback(
    (event, blockId) => {
      if (
        event.key !== "Enter" ||
        event.shiftKey ||
        event.nativeEvent.isComposing
      ) {
        if (
          event.key === "Backspace" &&
          event.currentTarget.selectionStart === 0 &&
          event.currentTarget.selectionEnd === 0
        ) {
          const currentValue = event.currentTarget.value;
          let previousTextId = null;
          let previousLength = 0;

          setContentBlocks((current) => {
            const currentIndex = current.findIndex(
              (block) => block.id === blockId,
            );
            const previousBlock = current[currentIndex - 1];
            if (currentIndex <= 0 || previousBlock?.type !== "text") {
              return current;
            }

            event.preventDefault();
            previousTextId = previousBlock.id;
            previousLength = previousBlock.text.length;
            return current
              .map((block) =>
                block.id === previousBlock.id
                  ? { ...block, text: block.text + currentValue }
                  : block,
              )
              .filter((block) => block.id !== blockId);
          });

          window.requestAnimationFrame(() => {
            if (previousTextId) {
              focusTextBlock(previousTextId, previousLength);
            }
          });
        }
        return;
      }

      event.preventDefault();
      const start = event.currentTarget.selectionStart;
      const end = event.currentTarget.selectionEnd;
      const value = event.currentTarget.value;
      const nextBlock = createTextBlock(value.slice(end));

      setContentBlocks((current) => {
        const index = current.findIndex((block) => block.id === blockId);
        if (index < 0) return current;
        const next = [...current];
        next.splice(
          index,
          1,
          { ...current[index], text: value.slice(0, start) },
          nextBlock,
        );
        return next;
      });
      setActiveTextBlockId(nextBlock.id);
      focusTextBlock(nextBlock.id);
    },
    [focusTextBlock],
  );

  const pastePlainTextBlocks = useCallback(
    (event, blockId) => {
      const imageFiles = Array.from(event.clipboardData?.items || [])
        .filter(
          (item) =>
            item.kind === "file" && item.type.startsWith("image/"),
        )
        .map((item) => item.getAsFile())
        .filter(Boolean);

      if (imageFiles.length) {
        event.preventDefault();
        const placement = {
          blockId,
          start: event.currentTarget.selectionStart,
          end: event.currentTarget.selectionEnd,
        };
        pendingFilePlacementRef.current = placement;
        return placement;
      }

      const pastedText = event.clipboardData?.getData("text/plain") || "";
      if (!/\r?\n/.test(pastedText)) return null;

      event.preventDefault();
      const start = event.currentTarget.selectionStart;
      const end = event.currentTarget.selectionEnd;
      const value = event.currentTarget.value;
      const pastedParagraphs = pastedText.split(/\r?\n+/);
      const firstText = value.slice(0, start) + pastedParagraphs[0];
      const trailingText =
        pastedParagraphs[pastedParagraphs.length - 1] + value.slice(end);
      const insertedBlocks = [
        { id: blockId, type: "text", text: firstText },
        ...pastedParagraphs
          .slice(1, -1)
          .map((paragraph) => createTextBlock(paragraph)),
      ];
      const trailingBlock =
        pastedParagraphs.length > 1
          ? createTextBlock(trailingText)
          : insertedBlocks[0];

      if (pastedParagraphs.length > 1) {
        insertedBlocks.push(trailingBlock);
      }

      setContentBlocks((current) => {
        const index = current.findIndex((block) => block.id === blockId);
        if (index < 0) return current;
        const next = [...current];
        next.splice(index, 1, ...insertedBlocks);
        return next;
      });
      setActiveTextBlockId(trailingBlock.id);
      focusTextBlock(
        trailingBlock.id,
        pastedParagraphs[pastedParagraphs.length - 1].length,
      );
      return [];
    },
    [focusTextBlock],
  );

  const addFiles = useCallback(
    async (fileList, placement = activeTextSelectionRef.current) => {
      if (pendingImageReads) {
        showNotice("上一批图片还在读取", "warning");
        return;
      }

      const files = Array.from(fileList)
        .filter((file) => file.type.startsWith("image/"))
        .slice(0, Math.max(0, MAX_UPLOADS - media.length));

      if (!files.length) {
        showNotice("请选择图片文件", "warning");
        return;
      }

      const pendingBlock = {
        id: createBlockId("pending"),
        type: "pendingMedia",
        count: files.length,
      };
      const trailingBlock = createTextBlock();

      setContentBlocks((current) => {
        const targetIndex = placement?.blockId
          ? current.findIndex((block) => block.id === placement.blockId)
          : -1;
        const targetBlock = current[targetIndex];

        if (
          targetIndex >= 0 &&
          targetBlock?.type === "text" &&
          Number.isInteger(placement.start)
        ) {
          const start = Math.min(placement.start, targetBlock.text.length);
          const end = Math.min(
            Math.max(placement.end ?? start, start),
            targetBlock.text.length,
          );
          const next = [...current];
          next.splice(
            targetIndex,
            1,
            { ...targetBlock, text: targetBlock.text.slice(0, start) },
            pendingBlock,
            { ...trailingBlock, text: targetBlock.text.slice(end) },
          );
          return next;
        }

        const insertionIndex =
          targetIndex >= 0 ? targetIndex + 1 : current.length;
        const next = [...current];
        next.splice(insertionIndex, 0, pendingBlock, trailingBlock);
        return next;
      });
      setActiveTextBlockId(trailingBlock.id);
      focusTextBlock(trailingBlock.id);
      setPendingImageReads((current) => current + 1);
      try {
        const assets = [];
        const failures = [];

        for (const file of files) {
          try {
            assets.push(await readImageFile(file));
          } catch (error) {
            failures.push(error);
          }
        }

        if (!assets.length) {
          throw failures[0] || new Error("图片读取失败");
        }

        setContentBlocks((current) =>
          current.flatMap((block) =>
            block.id === pendingBlock.id
              ? assets.map((asset) => ({
                  id: asset.id,
                  type: "media",
                  asset,
                }))
              : [block],
          ),
        );
        showNotice(
          failures.length
            ? `已加入 ${assets.length} 张，${failures.length} 张读取失败`
            : `已在光标位置插入 ${assets.length} 张图片`,
        );
      } catch (error) {
        setContentBlocks((current) =>
          current.filter((block) => block.id !== pendingBlock.id),
        );
        showNotice(error.message, "error");
      } finally {
        setPendingImageReads((current) => Math.max(0, current - 1));
      }
    },
    [focusTextBlock, media.length, pendingImageReads, showNotice],
  );

  const moveContentBlock = useCallback((blockId, direction) => {
    setContentBlocks((current) => {
      const sourceIndex = current.findIndex((block) => block.id === blockId);
      const targetIndex = sourceIndex + direction;

      if (
        sourceIndex < 0 ||
        targetIndex < 0 ||
        targetIndex >= current.length
      ) {
        return current;
      }

      const next = [...current];
      [next[sourceIndex], next[targetIndex]] = [
        next[targetIndex],
        next[sourceIndex],
      ];
      return next;
    });
  }, []);

  const setMediaAspectRatio = useCallback((assetId, aspectRatio) => {
    setContentBlocks((current) =>
      current.map((block) =>
        block.type === "media" && block.asset.id === assetId
          ? { ...block, asset: { ...block.asset, aspectRatio } }
          : block,
      ),
    );
  }, []);

  const removeContentBlock = useCallback((blockId) => {
    setContentBlocks((current) => {
      const next = current.filter((block) => block.id !== blockId);
      return next.some((block) => block.type === "text")
        ? next
        : [...next, createTextBlock()];
    });
  }, []);

  const insertPageBreak = useCallback(() => {
    const placement = activeTextSelectionRef.current;
    const pageBreak = { id: createBlockId("break"), type: "pageBreak" };
    const trailingBlock = createTextBlock();

    setContentBlocks((current) => {
      const targetIndex = placement?.blockId
        ? current.findIndex((block) => block.id === placement.blockId)
        : -1;
      const targetBlock = current[targetIndex];

      if (
        targetIndex >= 0 &&
        targetBlock?.type === "text" &&
        Number.isInteger(placement.start)
      ) {
        const start = Math.min(placement.start, targetBlock.text.length);
        const end = Math.min(
          Math.max(placement.end ?? start, start),
          targetBlock.text.length,
        );
        const next = [...current];
        next.splice(
          targetIndex,
          1,
          { ...targetBlock, text: targetBlock.text.slice(0, start) },
          pageBreak,
          { ...trailingBlock, text: targetBlock.text.slice(end) },
        );
        return next;
      }

      return [...current, pageBreak, trailingBlock];
    });
    setActiveTextBlockId(trailingBlock.id);
    focusTextBlock(trailingBlock.id);
    showNotice("已从光标位置开始新卡片");
  }, [focusTextBlock, showNotice]);

  const handleContentPaste = useCallback(
    (event, blockId) => {
      const placement = pastePlainTextBlocks(event, blockId);
      if (Array.isArray(placement)) return;

      if (placement) {
        const imageFiles = Array.from(event.clipboardData?.items || [])
          .filter(
            (item) =>
              item.kind === "file" && item.type.startsWith("image/"),
          )
          .map((item) => item.getAsFile())
          .filter(Boolean);
        addFiles(imageFiles, placement);
      }
    },
    [addFiles, pastePlainTextBlocks],
  );

  const openImagePicker = useCallback(() => {
    pendingFilePlacementRef.current = activeTextSelectionRef.current;
    fileInputRef.current?.click();
  }, []);

  const getImageEditorAspectRatio = useCallback((asset) => {
    if (IMAGE_ASPECT_RATIOS[asset.aspectRatio]) {
      return asset.aspectRatio.replace(":", " / ");
    }
    return `${asset.width} / ${asset.height}`;
  }, []);

  const getImageEditorFit = useCallback(
    (asset) =>
      IMAGE_ASPECT_RATIOS[asset.aspectRatio] ? "cover" : "contain",
    [],
  );

  const onAvatarChange = useCallback(
    async (event) => {
      const input = event.currentTarget;

      if (pendingImageReads) {
        input.value = "";
        showNotice("头像还在读取", "warning");
        return;
      }

      const [file] = Array.from(input.files || []);
      if (!file) return;

      setPendingImageReads((current) => current + 1);
      try {
        const asset = await readImageFile(file);
        setAvatar(asset.src);
        showNotice("头像已更新");
      } catch (error) {
        showNotice(error.message, "error");
      } finally {
        input.value = "";
        setPendingImageReads((current) => Math.max(0, current - 1));
      }
    },
    [pendingImageReads, showNotice],
  );

  const onMineralBackgroundChange = useCallback(
    async (event) => {
      const input = event.currentTarget;

      if (pendingImageReads) {
        input.value = "";
        showNotice("上一张图片还在读取", "warning");
        return;
      }

      const [file] = Array.from(input.files || []);
      if (!file) return;

      const requestId = mineralBackgroundRequestRef.current + 1;
      mineralBackgroundRequestRef.current = requestId;
      setPendingImageReads((current) => current + 1);
      try {
        const nextBackground = await readMineralBackgroundFile(file);
        if (requestId !== mineralBackgroundRequestRef.current) {
          return;
        }
        let remembered = true;

        try {
          window.localStorage.setItem(
            MINERAL_BACKGROUND_STORAGE_KEY,
            JSON.stringify(nextBackground),
          );
        } catch {
          remembered = false;
        }

        setCustomMineralBackground({
          ...nextBackground,
          remembered,
        });
        showNotice(
          remembered
            ? "背景已更换，并保存在当前浏览器"
            : "背景已更换，但浏览器空间不足，刷新后会恢复",
          remembered ? "success" : "warning",
        );
      } catch (error) {
        showNotice(error.message, "error");
      } finally {
        input.value = "";
        setPendingImageReads((current) => Math.max(0, current - 1));
      }
    },
    [pendingImageReads, showNotice],
  );

  const resetMineralBackground = useCallback(() => {
    mineralBackgroundRequestRef.current += 1;
    let forgotten = true;
    try {
      window.localStorage.removeItem(MINERAL_BACKGROUND_STORAGE_KEY);
    } catch {
      forgotten = false;
    }
    setCustomMineralBackground(null);
    showNotice(
      forgotten
        ? "已恢复默认材质背景"
        : "本次已恢复默认，但未能清除浏览器记忆",
      forgotten ? "success" : "warning",
    );
  }, [showNotice]);

  const renderCardBlob = useCallback(async (index) => {
    const node = exportRefs.current[index];
    if (!node) throw new Error("卡片尚未准备好");

    await document.fonts.ready;
    const blob = await toBlob(node, {
      cacheBust: true,
      pixelRatio: 1,
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      canvasWidth: CARD_WIDTH,
      canvasHeight: CARD_HEIGHT,
      skipAutoScale: true,
    });

    if (!blob) throw new Error("卡片导出失败");
    return blob;
  }, []);

  const preparePostAssets = useCallback(
    async (progressLabel) => {
      const blobs = [];
      const images = [];

      for (let index = 0; index < pages.length; index += 1) {
        setExportState(`${progressLabel} ${index + 1} / ${pages.length}`);
        const blob = await renderCardBlob(index);
        blobs.push(blob);
        images.push(await blobToDataUrl(blob));
      }

      return {
        blobs,
        payload: {
          version: 1,
          title: postTitle.trim(),
          body: postBody.trim(),
          images,
          author: author.trim(),
          createdAt: new Date().toISOString(),
        },
      };
    },
    [author, pages.length, postBody, postTitle, renderCardBlob],
  );

  const copyPost = useCallback(async () => {
    if (exportState || pendingImageReads) return;
    setActiveAction("copy");

    try {
      const plainText = `${postTitle.trim()}\n\n${postBody.trim()}`.trim();
      const assetsPromise = preparePostAssets("正在复制图文");
      let richClipboardPromise = null;

      if (navigator.clipboard?.write && window.ClipboardItem) {
        const clipboardTypes = {
          "text/plain": new Blob([plainText], { type: "text/plain" }),
          "text/html": assetsPromise.then(
            ({ payload }) =>
              new Blob([buildPostHtml(payload)], { type: "text/html" }),
          ),
        };
        const supportsPng =
          typeof ClipboardItem.supports !== "function" ||
          ClipboardItem.supports("image/png");

        if (supportsPng) {
          clipboardTypes["image/png"] = assetsPromise.then(({ blobs }) => {
            if (!blobs[0]) throw new Error("没有可复制的卡片");
            return blobs[0];
          });
        }

        richClipboardPromise = navigator.clipboard
          .write([new ClipboardItem(clipboardTypes)])
          .then(() => true)
          .catch(() => false);
      }

      let copiedPlainText = copyTextSynchronously(plainText);
      const { payload } = await assetsPromise;
      const copiedRichContent = richClipboardPromise
        ? await richClipboardPromise
        : false;

      if (!copiedRichContent && !copiedPlainText) {
        try {
          await navigator.clipboard.writeText(plainText);
          copiedPlainText = true;
        } catch {
          throw new Error("浏览器未允许访问剪贴板");
        }
      }

      if (extensionReady) {
        try {
          await requestExtension("PIANKE_CACHE_DRAFT", payload);
        } catch (error) {
          if (error.message === "浏览器助手未连接") {
            setExtensionReady(false);
          }
        }
      }

      showNotice(
        copiedRichContent
          ? `图文已复制；共准备 ${pages.length} 张卡片`
          : copiedPlainText
            ? "标题正文已复制；卡片图请用一键导出"
            : "浏览器未允许访问剪贴板",
      );
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      setExportState("");
      setActiveAction("");
    }
  }, [
    exportState,
    extensionReady,
    pendingImageReads,
    pages.length,
    postBody,
    preparePostAssets,
    requestExtension,
    showNotice,
  ]);

  const publishToXhs = useCallback(async () => {
    if (exportState || pendingImageReads) return;

    if (!extensionReady) {
      try {
        await navigator.clipboard.writeText(
          `${postTitle}\n\n${postBody}`.trim(),
        );
        showNotice(
          "浏览器助手未连接；标题正文已先复制",
          "warning",
        );
      } catch {
        showNotice("请先加载配套浏览器扩展", "warning");
      }
      return;
    }

    setActiveAction("publish");
    try {
      const { payload } = await preparePostAssets("正在准备发布");
      await requestExtension("PIANKE_OPEN_XHS_DRAFT", payload);
      showNotice("已打开小红书创作后台并准备自动填入");
    } catch (error) {
      if (error.message === "浏览器助手未连接") {
        setExtensionReady(false);
      }
      showNotice(error.message, "error");
    } finally {
      setExportState("");
      setActiveAction("");
    }
  }, [
    exportState,
    extensionReady,
    pendingImageReads,
    postBody,
    postTitle,
    preparePostAssets,
    requestExtension,
    showNotice,
  ]);

  const exportAll = useCallback(async () => {
    if (exportState || pendingImageReads) return;
    setActiveAction("export");
    const zip = new JSZip();

    try {
      for (let index = 0; index < pages.length; index += 1) {
        setExportState(`正在切图 ${index + 1} / ${pages.length}`);
        const blob = await renderCardBlob(index);
        zip.file(`薯片-${String(index + 1).padStart(2, "0")}.png`, blob);
      }

      setExportState("正在打包 ZIP…");
      const bundle = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });
      downloadBlob(bundle, `薯片卡片-${pages.length}张.zip`);
      showNotice(`${pages.length} 张卡片已打包下载`);
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      setExportState("");
      setActiveAction("");
    }
  }, [
    exportState,
    pages.length,
    pendingImageReads,
    renderCardBlob,
    showNotice,
  ]);

  const goToPage = useCallback(
    (direction) => {
      setSelectedPage((current) => {
        const next = current + direction;
        return Math.min(Math.max(next, 0), pages.length - 1);
      });
    },
    [pages.length],
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <img
            className="brand-mark"
            src={APP_LOGO}
            alt=""
            aria-hidden="true"
          />
          <div>
            <strong>薯片</strong>
            <span>图文切片工作台</span>
          </div>
        </div>

        <div className="output-spec">
          3:4 · 1080 × 1440 PNG
        </div>

        <div className="topbar-actions">
          <button
            className="button secondary"
            type="button"
            onClick={copyPost}
            disabled={Boolean(exportState) || pendingImageReads > 0}
          >
            <ClipboardText weight="bold" />
            {activeAction === "copy" ? exportState : "复制图文"}
          </button>
          <button
            className="button secondary"
            type="button"
            onClick={exportAll}
            disabled={Boolean(exportState) || pendingImageReads > 0}
          >
            <Package weight="fill" />
            {activeAction === "export"
              ? exportState
              : `导出 ${pages.length} 张`}
          </button>
          <button
            className="button primary xhs-button"
            type="button"
            onClick={publishToXhs}
            disabled={Boolean(exportState) || pendingImageReads > 0}
            title={
              extensionReady
                ? "打开小红书创作后台并自动填入"
                : "需先加载配套浏览器扩展"
            }
          >
            <PaperPlaneTilt weight="fill" />
            {activeAction === "publish" ? exportState : "一键填充小红书"}
          </button>
        </div>
      </header>

      <main className="studio">
        <aside
          className="editor-panel"
          aria-busy={Boolean(exportState)}
          inert={exportState ? true : undefined}
        >
          <div className="panel-tabs" role="tablist" aria-label="编辑区域">
            <button
              type="button"
              role="tab"
              aria-selected={activePanel === "content"}
              className={activePanel === "content" ? "is-active" : ""}
              onClick={() => setActivePanel("content")}
            >
              <TextT weight="bold" />
              内容
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activePanel === "style"}
              className={activePanel === "style" ? "is-active" : ""}
              onClick={() => setActivePanel("style")}
            >
              <SlidersHorizontal weight="bold" />
              样式
            </button>
          </div>
          <a className="mobile-preview-jump" href="#live-preview">
            查看实时预览
          </a>

          {activePanel === "content" ? (
            <div className="panel-content">
              <section className="control-section mode-section">
                <div className="section-heading">
                  <h2>卡片模式</h2>
                </div>

                <div className="card-mode-switch" role="radiogroup" aria-label="卡片模式">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={cardMode === "long"}
                    className={cardMode === "long" ? "is-active" : ""}
                    onClick={() => {
                      setCardMode("long");
                      setSelectedPage(0);
                    }}
                  >
                    <strong>长文卡片</strong>
                    <span>自动分页</span>
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={cardMode === "short"}
                    className={cardMode === "short" ? "is-active" : ""}
                    onClick={() => {
                      setCardMode("short");
                      setSelectedPage(0);
                    }}
                  >
                    <strong>短文海报</strong>
                    <span>一句成图</span>
                  </button>
                </div>

                {cardMode === "short" ? (
                  <div
                    className="short-style-grid"
                    role="group"
                    aria-label="短文样式"
                  >
                    {SHORT_STYLE_OPTIONS.map((option) => (
                      <button
                        type="button"
                        key={option.id}
                        className={shortStyle === option.id ? "is-active" : ""}
                        aria-pressed={shortStyle === option.id}
                        onClick={() => setShortStyle(option.id)}
                      >
                        <span
                          className="short-style-preview"
                          style={{
                            backgroundImage: `url("${shortBackgrounds[option.id]}")`,
                          }}
                        />
                        <span className="short-style-copy">
                          <strong>{option.name}</strong>
                          <small>{option.description}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}

                {cardMode === "short" && shortStyle === "mineral" ? (
                  <div className="mineral-background-control">
                    <button
                      type="button"
                      className="mineral-background-upload"
                      disabled={
                        pendingImageReads > 0 || Boolean(exportState)
                      }
                      onClick={() =>
                        mineralBackgroundInputRef.current?.click()
                      }
                      aria-label={
                        customMineralBackground
                          ? customMineralBackground.remembered
                            ? "更换材质大字背景，当前自定义背景已保存"
                            : "更换材质大字背景，当前背景刷新后会恢复"
                          : "更换材质大字背景，当前使用默认背景"
                      }
                    >
                      <span
                        className="mineral-background-preview"
                        style={{
                          backgroundImage: `url("${shortBackgrounds.mineral}")`,
                        }}
                      />
                      <span>
                        <strong>
                          {customMineralBackground
                            ? "自定义背景"
                            : "默认材质背景"}
                        </strong>
                        <small>
                          {customMineralBackground
                            ? customMineralBackground.remembered
                              ? "已保存在当前浏览器"
                              : "本次使用 · 刷新后恢复"
                            : "点击上传 · 自动裁成 3:4"}
                        </small>
                      </span>
                      <UploadSimple weight="bold" />
                    </button>
                    {customMineralBackground ? (
                      <button
                        type="button"
                        className="mineral-background-reset"
                        disabled={
                          pendingImageReads > 0 || Boolean(exportState)
                        }
                        onClick={resetMineralBackground}
                      >
                        恢复默认
                      </button>
                    ) : null}
                    <input
                      ref={mineralBackgroundInputRef}
                      hidden
                      type="file"
                      accept="image/*"
                      onChange={onMineralBackgroundChange}
                    />
                  </div>
                ) : null}
              </section>

              <section className="control-section">
                <div className="section-heading">
                  <h2>
                    {cardMode === "short" && shortStyle === "mineral"
                      ? "发布信息"
                      : "作者信息"}
                  </h2>
                </div>

                {cardMode !== "short" || shortStyle === "highlight" ? (
                  <div className="profile-editor">
                    <button
                      type="button"
                      className="avatar-button"
                      disabled={
                        pendingImageReads > 0 || Boolean(exportState)
                      }
                      onClick={() => avatarInputRef.current?.click()}
                      aria-label="更换头像"
                    >
                      <img src={avatar} alt="" />
                      <span>更换</span>
                    </button>
                    <input
                      ref={avatarInputRef}
                      hidden
                      type="file"
                      accept="image/*"
                      onChange={onAvatarChange}
                    />
                    <div className="profile-fields">
                      <label>
                        昵称
                        <input
                          value={author}
                          onChange={(event) =>
                            setAuthor(event.target.value)
                          }
                          maxLength={18}
                        />
                      </label>
                      <label>
                        日期
                        <input
                          value={date}
                          onChange={(event) =>
                            setDate(event.target.value)
                          }
                          maxLength={20}
                        />
                      </label>
                    </div>
                  </div>
                ) : null}

                <label className="stacked-field publish-title-field">
                  <span>
                    小红书标题
                    <small>{postTitle.length} / 20</small>
                  </span>
                  <input
                    value={postTitle}
                    onChange={(event) => setPostTitle(event.target.value)}
                    maxLength={20}
                    placeholder="输入发布标题"
                  />
                </label>
                <div
                  className={`extension-state ${
                    extensionReady ? "is-ready" : ""
                  }`}
                >
                  <span />
                  {extensionReady ? "发布助手已连接" : "发布助手未连接"}
                </div>
              </section>

              {cardMode === "long" ? (
                <section className="control-section text-section">
                <div className="section-heading">
                  <h2>图文内容</h2>
                  <span className="page-count">{pages.length} 张</span>
                </div>

                <div
                  className={`mixed-content-editor ${
                    isDragging ? "is-dragging" : ""
                  }`}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) {
                      setIsDragging(false);
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setIsDragging(false);
                    addFiles(
                      event.dataTransfer.files,
                      activeTextSelectionRef.current,
                    );
                  }}
                >
                  {contentBlocks.map((block, blockIndex) => {
                    if (block.type === "text") {
                      return (
                        <textarea
                          key={block.id}
                          ref={(node) => {
                            if (node) {
                              textBlockRefs.current.set(block.id, node);
                            } else {
                              textBlockRefs.current.delete(block.id);
                            }
                          }}
                          className={`content-text-block ${
                            activeTextBlockId === block.id ? "is-active" : ""
                          }`}
                          data-block-id={block.id}
                          value={block.text}
                          rows="1"
                          placeholder={
                            contentBlocks.length === 1
                              ? "粘贴正文，或直接粘贴图片…"
                              : "继续输入…"
                          }
                          spellCheck="false"
                          onFocus={(event) =>
                            rememberTextSelection(event, block.id)
                          }
                          onSelect={(event) =>
                            rememberTextSelection(event, block.id)
                          }
                          onClick={(event) =>
                            rememberTextSelection(event, block.id)
                          }
                          onKeyUp={(event) =>
                            rememberTextSelection(event, block.id)
                          }
                          onKeyDown={(event) =>
                            splitTextBlock(event, block.id)
                          }
                          onPaste={(event) =>
                            handleContentPaste(event, block.id)
                          }
                          onChange={(event) =>
                            updateTextBlock(
                              block.id,
                              event.currentTarget.value,
                              event.currentTarget.selectionStart,
                            )
                          }
                        />
                      );
                    }

                    if (block.type === "pendingMedia") {
                      return (
                        <div className="pending-media-block" key={block.id}>
                          <UploadSimple weight="bold" />
                          正在读取 {block.count} 张图片…
                        </div>
                      );
                    }

                    if (block.type === "pageBreak") {
                      return (
                        <div className="page-break-block" key={block.id}>
                          <span>从这里开始新卡片</span>
                          <button
                            type="button"
                            onClick={() => removeContentBlock(block.id)}
                            aria-label="删除手动分页"
                            title="删除分页"
                          >
                            <Trash weight="bold" />
                          </button>
                        </div>
                      );
                    }

                    if (block.type === "media") {
                      const asset = block.asset;
                      return (
                        <div className="content-media-block" key={block.id}>
                          <div
                            className="content-media-preview"
                            style={{
                              aspectRatio:
                                getImageEditorAspectRatio(asset),
                            }}
                          >
                            <img
                              src={asset.src}
                              alt={asset.name}
                              style={{
                                objectFit: getImageEditorFit(asset),
                              }}
                            />
                          </div>
                          <div className="content-media-toolbar">
                            <div className="content-media-name">
                              <strong title={asset.name}>{asset.name}</strong>
                              <span>
                                {asset.width} × {asset.height}
                              </span>
                            </div>
                            <select
                              className="content-media-ratio"
                              value={asset.aspectRatio || "original"}
                              aria-label={`${asset.name}的显示比例`}
                              onChange={(event) =>
                                setMediaAspectRatio(
                                  asset.id,
                                  event.target.value,
                                )
                              }
                            >
                              <option value="16:9">16:9</option>
                              <option value="original">原图</option>
                              <option value="4:3">4:3</option>
                              <option value="1:1">1:1</option>
                            </select>
                            <div
                              className="content-media-actions"
                              aria-label={`${asset.name}的排序操作`}
                            >
                              <button
                                type="button"
                                disabled={blockIndex === 0}
                                onClick={() =>
                                  moveContentBlock(block.id, -1)
                                }
                                aria-label={`上移 ${asset.name}`}
                                title="向上一段"
                              >
                                <CaretUp weight="bold" />
                              </button>
                              <button
                                type="button"
                                disabled={
                                  blockIndex === contentBlocks.length - 1
                                }
                                onClick={() =>
                                  moveContentBlock(block.id, 1)
                                }
                                aria-label={`下移 ${asset.name}`}
                                title="向下一段"
                              >
                                <CaretDown weight="bold" />
                              </button>
                              <button
                                className="content-media-remove"
                                type="button"
                                onClick={() => removeContentBlock(block.id)}
                                aria-label={`移除 ${asset.name}`}
                                title="移除"
                              >
                                <Trash weight="bold" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    return null;
                  })}
                  <div className="content-editor-footer">
                    <button
                      className="insert-image-button"
                      type="button"
                      disabled={
                        pendingImageReads > 0 ||
                        Boolean(exportState) ||
                        media.length >= MAX_UPLOADS
                      }
                      onClick={openImagePicker}
                    >
                      <UploadSimple weight="bold" />
                      在光标处添加图片
                    </button>
                    <span>也可直接粘贴或拖入 · 默认 16:9 居中裁切</span>
                  </div>
                </div>

                <input
                  ref={fileInputRef}
                  hidden
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(event) => {
                    addFiles(
                      event.target.files,
                      pendingFilePlacementRef.current,
                    );
                    pendingFilePlacementRef.current = null;
                    event.target.value = "";
                  }}
                />

                <div className="inline-actions">
                  <span>{text.replace(/\s|---/g, "").length} 字</span>
                  <button type="button" onClick={insertPageBreak}>
                    + 从光标处分新卡片
                  </button>
                </div>
                </section>
              ) : (
                <section className="control-section short-copy-section">
                  <div className="section-heading">
                    <h2>短句内容</h2>
                    <span className="page-count">1 张</span>
                  </div>

                  <textarea
                    value={shortText}
                    onChange={(event) =>
                      setShortText(limitShortText(event.target.value))
                    }
                    rows="6"
                    placeholder="写下一句值得被看见的话…"
                    spellCheck="false"
                  />

                  <div className="short-copy-meta">
                    <span>
                      {Array.from(shortText.replace(/\s/g, "")).length} / 80 字
                    </span>
                    <span>最多 8 行 · 自动缩放</span>
                  </div>
                </section>
              )}
            </div>
          ) : (
            <div className="panel-content">
              {cardMode === "long" ? (
                <>
                  <section className="control-section">
                <div className="section-heading">
                  <h2>卡片背景</h2>
                </div>

                <div className="color-presets">
                  {COLOR_PRESETS.map((preset) => (
                    <button
                      key={preset.value}
                      className={background === preset.value ? "is-active" : ""}
                      type="button"
                      onClick={() => setBackground(preset.value)}
                      aria-label={`使用${preset.name}背景`}
                    >
                      <span style={{ backgroundColor: preset.value }} />
                      {preset.name}
                    </button>
                  ))}
                </div>

                <label className="color-field">
                  <span>
                    自定义背景
                    <small>{background.toUpperCase()}</small>
                  </span>
                  <input
                    type="color"
                    value={background}
                    onChange={(event) => setBackground(event.target.value)}
                  />
                </label>
              </section>

              <section className="control-section">
                <div className="section-heading">
                  <h2>圆角</h2>
                  <span className="section-value">{cardRadius}px</span>
                </div>

                <label className="range-field">
                  <span>
                    卡片圆角
                    <span className="range-output">{cardRadius}px</span>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="96"
                    step="4"
                    value={cardRadius}
                    onChange={(event) =>
                      setCardRadius(Number(event.target.value))
                    }
                  />
                </label>

                <label className="range-field">
                  <span>
                    图片圆角
                    <span className="range-output">{imageRadius}px</span>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="48"
                    step="2"
                    value={imageRadius}
                    onChange={(event) =>
                      setImageRadius(Number(event.target.value))
                    }
                  />
                </label>
              </section>

              <section className="control-section">
                <div className="section-heading">
                  <h2>排版与标识</h2>
                  <span className="section-value">{fontSize}px</span>
                </div>

                <label className="range-field">
                  <span>
                    正文字号
                    <span className="range-output">{fontSize}px</span>
                  </span>
                  <input
                    type="range"
                    min="34"
                    max="52"
                    step="1"
                    value={fontSize}
                    onChange={(event) =>
                      setFontSize(Number(event.target.value))
                    }
                  />
                </label>

                <label className="range-field">
                  <span>
                    正文行高
                    <span className="range-output">
                      {lineHeight.toFixed(2)}
                    </span>
                  </span>
                  <input
                    type="range"
                    min="1.35"
                    max="1.85"
                    step="0.05"
                    value={lineHeight}
                    onChange={(event) =>
                      setLineHeight(Number(event.target.value))
                    }
                  />
                </label>

                <div
                  className="footer-mark-options"
                  role="group"
                  aria-label="底部标识"
                >
                  <button
                    type="button"
                    className={
                      footerMarkType === "x" ? "is-active" : ""
                    }
                    aria-pressed={footerMarkType === "x"}
                    onClick={() => setFooterMarkType("x")}
                  >
                    <XLogo weight="bold" aria-hidden="true" />
                    X 标识
                  </button>
                  <button
                    type="button"
                    className={
                      footerMarkType === "custom" ? "is-active" : ""
                    }
                    aria-pressed={footerMarkType === "custom"}
                    onClick={() => setFooterMarkType("custom")}
                  >
                    自定义文字
                  </button>
                </div>

                {footerMarkType === "custom" ? (
                  <label className="stacked-field footer-mark-input">
                    标识文字
                    <input
                      value={watermark}
                      onChange={(event) =>
                        setWatermark(event.target.value)
                      }
                      maxLength={36}
                    />
                    <small>只显示在卡片右下角。</small>
                  </label>
                ) : null}
              </section>

                  <p className="settings-note">
                    设置会同步到每张卡片，PNG 保留透明圆角。
                  </p>
                </>
              ) : (
                <>
                  <section className="control-section">
                    <div className="section-heading">
                      <h2>短句排版</h2>
                      <span className="section-value">
                        实际 {resolvedShortFontSize}px
                      </span>
                    </div>

                    <label className="range-field">
                      <span>
                        最大字号
                        <span className="range-output">
                          {shortSettings[shortStyle].fontSize}px
                        </span>
                      </span>
                      <input
                        type="range"
                        min={shortStyle === "mineral" ? "56" : "36"}
                        max={shortStyle === "mineral" ? "144" : "72"}
                        step="2"
                        value={shortSettings[shortStyle].fontSize}
                        onChange={(event) =>
                          updateShortSetting(
                            "fontSize",
                            Number(event.target.value),
                          )
                        }
                      />
                    </label>

                    <label className="range-field">
                      <span>
                        行距
                        <span className="range-output">
                          {shortSettings[shortStyle].lineHeight.toFixed(2)}
                        </span>
                      </span>
                      <input
                        type="range"
                        min="1.2"
                        max="1.65"
                        step="0.01"
                        value={shortSettings[shortStyle].lineHeight}
                        onChange={(event) =>
                          updateShortSetting(
                            "lineHeight",
                            Number(event.target.value),
                          )
                        }
                      />
                    </label>

                    <label className="range-field">
                      <span>
                        字距
                        <span className="range-output">
                          {shortSettings[shortStyle].letterSpacing > 0
                            ? "+"
                            : ""}
                          {shortSettings[shortStyle].letterSpacing}px
                        </span>
                      </span>
                      <input
                        type="range"
                        min="-4"
                        max="8"
                        step="0.2"
                        value={shortSettings[shortStyle].letterSpacing}
                        onChange={(event) =>
                          updateShortSetting(
                            "letterSpacing",
                            Number(event.target.value),
                          )
                        }
                      />
                    </label>

                    <label className="color-field">
                      <span>
                        文字颜色
                        <small>
                          {shortSettings[shortStyle].textColor.toUpperCase()}
                        </small>
                      </span>
                      <input
                        type="color"
                        value={shortSettings[shortStyle].textColor}
                        onChange={(event) =>
                          updateShortSetting("textColor", event.target.value)
                        }
                      />
                    </label>
                  </section>

                  <section className="control-section">
                    <div className="section-heading">
                      <h2>海报圆角</h2>
                      <span className="section-value">{cardRadius}px</span>
                    </div>

                    <label className="range-field">
                      <span>
                        卡片圆角
                        <span className="range-output">
                          {cardRadius}px
                        </span>
                      </span>
                      <input
                        type="range"
                        min="0"
                        max="96"
                        step="4"
                        value={cardRadius}
                        onChange={(event) =>
                          setCardRadius(Number(event.target.value))
                        }
                      />
                    </label>
                  </section>

                  <p className="settings-note">
                    {shortStyle === "highlight"
                      ? "长句会自动缩小，重点摘录会显示当前头像、昵称和日期。"
                      : "长句会自动缩小并优化换行；材质大字不显示作者栏。"}
                  </p>
                </>
              )}
            </div>
          )}
        </aside>

        <section className="preview-panel" id="live-preview">
          <div className="preview-toolbar">
            <h1>
              {cardMode === "short"
                ? "短文海报预览"
                : `实时预览 · 第 ${safeSelectedPage + 1} 张`}
            </h1>
            <div className="preview-navigation">
              <button
                type="button"
                onClick={() => goToPage(-1)}
                disabled={safeSelectedPage === 0}
                aria-label="上一张"
              >
                <ArrowLeft weight="bold" />
              </button>
              <span>
                {String(safeSelectedPage + 1).padStart(2, "0")} /{" "}
                {String(pages.length).padStart(2, "0")}
              </span>
              <button
                type="button"
                onClick={() => goToPage(1)}
                disabled={safeSelectedPage === pages.length - 1}
                aria-label="下一张"
              >
                <ArrowRight weight="bold" />
              </button>
            </div>
          </div>

          <div className="preview-stage">
            <div className="preview-card-wrap">
              <ResponsiveCardPreview>
                <CardCanvas
                  page={pages[safeSelectedPage]}
                  pageIndex={safeSelectedPage}
                  pageCount={pages.length}
                  {...cardProps}
                />
              </ResponsiveCardPreview>
            </div>
          </div>

          <div className="mobile-page-strip">
            {pages.map((page, index) => (
              <button
                key={`page-pill-${index}`}
                className={safeSelectedPage === index ? "is-active" : ""}
                type="button"
                onClick={() => setSelectedPage(index)}
              >
                {String(index + 1).padStart(2, "0")}
              </button>
            ))}
          </div>
        </section>

        <aside className="page-rail">
          <div className="rail-heading">
            <h2>全部卡片</h2>
            <span>{pages.length}</span>
          </div>

          <div className="thumbnail-list">
            {pages.map((page, index) => (
              <CardThumbnail
                key={`thumbnail-${index}`}
                page={page}
                index={index}
                pageCount={pages.length}
                selected={safeSelectedPage === index}
                onSelect={() => setSelectedPage(index)}
                cardProps={cardProps}
              />
            ))}
          </div>
        </aside>
      </main>

      <div className="export-deck" aria-hidden="true">
        {pages.map((page, index) => (
          <CardCanvas
            key={`export-${index}`}
            ref={(node) => {
              exportRefs.current[index] = node;
            }}
            page={page}
            pageIndex={index}
            pageCount={pages.length}
            {...cardProps}
          />
        ))}
      </div>

      {notice ? (
        <div
          className={`notice is-${notice.tone}`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.tone === "success" ? (
            <CheckCircle weight="fill" />
          ) : (
            <WarningCircle weight="fill" />
          )}
          {notice.message}
        </div>
      ) : null}
    </div>
  );
}
