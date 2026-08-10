# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

Keep long-form and short-form creation as separate, low-friction modes. Short-form cards are always 3:4 and currently have two presets: “材质大字” for a large serif sentence without an author row, and “重点摘录” for a highlighted quote with avatar, author, and date. Switching modes or presets must preserve what the user has already typed.

Short-form typography must expose maximum font size, line height, and letter spacing while retaining continuous measured shrink-to-fit behavior. Keep input to 80 visible characters and at most 8 lines, using the same counting rules in input and status UI. Avoid orphaned final punctuation or a one-character last line when a balanced wrap is possible.

“材质大字” supports one custom 3:4 background. Process uploads locally, crop and compress them before storage, remember the result only in the current browser origin, and always provide a clear “恢复默认” action. Do not imply cross-device or cross-domain sync.

Long-form card footers show exactly one right-aligned mark. The user chooses either the default X platform mark or a user-editable text mark; never render both at once. Keep the X mark visually larger than the custom text baseline (currently 42 px and shifted 6 px upward).

Treat long-form editing as two synchronized views of one document: the left panel is the full manuscript for bulk paste, images, page breaks, ordering, and clearing; the main preview is the current finished card and its text must be directly editable. A change in either view must update the other and repaginate without losing content. Keep structural image controls in the manuscript view instead of duplicating a full editor on the card.

Within one finished card, adjacent body text must render and edit as one continuous field, with the manuscript's explicit blank lines preserved. An image may divide the card into separate text regions, but paragraphs or wrapped lines alone must never become separate editors.

Long-form content must always have a clear, guarded “清空图文” action that removes body text, images, and manual page breaks while preserving the post title, author, and style settings. Keep the full-manuscript editor tall enough for practical mobile-reading copy work.
