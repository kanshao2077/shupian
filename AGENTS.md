# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

Keep long-form and short-form creation as separate, low-friction modes. Short-form cards are always 3:4 and currently have two presets: “材质大字” for a large serif sentence without an author row, and “重点摘录” for a highlighted quote with avatar, author, and date. Switching modes or presets must preserve what the user has already typed.

Short-form posters favor useful cover density over reproducing the references' large empty margins. Keep the text vertically balanced, allow up to 120 visible characters and 10 explicit lines, and use most of the safe central area before shrinking the type. Do not apply this denser layout to long-form cards.

Short-form typography must expose maximum font size, line height, and letter spacing while retaining continuous measured shrink-to-fit behavior. Keep input to 120 visible characters and at most 10 lines, using the same counting rules in input and status UI. Avoid orphaned final punctuation or a one-character last line when a balanced wrap is possible.

The long-form editor opens with the content panel visible. Its baseline style is obsidian `#121214`, 20 px card radius, 24 px image radius, 47 px body type, 1.45 line height, and the X footer mark.

“材质大字” supports one custom 3:4 background. Process uploads locally, crop and compress them before storage, remember the result only in the current browser origin, and always provide a clear “恢复默认” action. Do not imply cross-device or cross-domain sync.

Long-form card footers show exactly one right-aligned mark. The user chooses either the default X platform mark or a user-editable text mark; never render both at once. Keep the X mark visually larger than the custom text baseline (currently 42 px and shifted 6 px upward).

Treat long-form editing as two synchronized views of one document: the left panel is the full manuscript for bulk paste, images, page breaks, ordering, and clearing; the main preview is the current finished card and its text must be directly editable. A change in either view must update the other and repaginate without losing content. Keep structural image controls in the manuscript view instead of duplicating a full editor on the card.

Within one finished card, adjacent body text must render and edit as one continuous field, with the manuscript's explicit blank lines preserved. An image may divide the card into separate text regions, but paragraphs or wrapped lines alone must never become separate editors.

The editable long-form preview must keep the same line boxes before focus, during focus, and in PNG export. Focusing the text must not swap to a layout engine with different wrapping or blank-line height. Every normal and empty line must fit completely inside the body region; move any line that cannot fit in full to the next card.

Preview and PNG export must use identical line occupancy. Every measured body line, including empty and trailing empty lines before media, must render a real line box in the static export. Long-form cards use a 64 px horizontal safe margin and an approximately 952 × 1000 px body region so the 3:4 canvas carries more information without crowding the footer.

Keep both export paths visible: “导出本页” downloads the selected card as one PNG, while the existing multi-page action downloads every card as a ZIP.

Long-form content must always have a clear, guarded “清空图文” action that removes body text, images, and manual page breaks while preserving the post title, author, and style settings. Keep the full-manuscript editor tall enough for practical mobile-reading copy work.
