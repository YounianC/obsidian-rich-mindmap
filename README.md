# Rich Mindmap

**English** · [简体中文](README.zh-CN.md)

An Obsidian plugin that turns an indented Markdown list into an editable mind map, with priority, progress and flag marks. The source of truth stays a plain `.md` file — the same structured Markdown you and any AI read and write.

> **Note on language:** the plugin's user interface is currently Chinese only (command names, tooltips, settings, error messages). There is no i18n yet. Everything below describes behaviour, not UI strings.

<!-- Screenshot goes here: one shot of the mindmap view, ideally one for light
     and one for dark theme. This is a visual tool; a README without a
     screenshot makes people much less likely to try it. -->

## How it differs from other mindmap plugins

Mindmap plugins in the Obsidian community mostly fall into two groups: **read-only previews** built on [markmap](https://markmap.js.org/) (they render a note as a mind map but you cannot edit on the map), and plugins built on Obsidian Canvas, whose data is `.canvas` JSON.

This one aims for:

- **Editing directly on the map**, while the data remains a plain Markdown indented list — no proprietary format, no coordinates, no JSON
- **Priority / progress / flag marks** written inline in the node text, readable and writable by both humans and AI
- **An explicit file-safety boundary**: only five byte-level normalizations are permitted (listed below), locked down by round-trip property tests

Editing is not unique to this plugin — several others manage it too. The mark system is, at the time of writing, uncommon in this category.

## Example

Copy [`examples/conference-talk.md`](examples/conference-talk.md) into your vault and open it in mindmap view. It exercises every feature: all seven priorities, all seven flag colours, progress across every stage, nesting four levels deep, wiki links, inline formatting, a parenthesized group that is *not* a mark, plus frontmatter keys and trailing prose that the plugin must leave alone.

```markdown
---
mindmap: true
tags:
  - talk
  - 2026
speaker: me
mindmap-collapsed:
  - Logistics
---

# Conference Talk: Taming Legacy Code

- Outline
  - (p1 100%) Opening story — the 3 a.m. pager incident
  - (p1 67%) Core argument
    - (p2) Legacy code is simply code without tests
    - (p2 50%) A safety net comes before any refactor
      - Seams and sprout methods
      - Characterization tests
    - (p3 33%) The rare case where a rewrite actually wins
  - (p2 17%) Live demo
    - (flag:red) Rehearse fully offline — venue wifi is never reliable
    - (flag:orange) Record a fallback video just in case
  - (p4 0%) Closing and call to action
- Slides
  - (p2 60%) Draft the deck in [[Talk Slides]]
  - (p5) Before/after call graphs — the **one diagram** people remember
  - (p6) Accessibility pass: contrast, alt text, `font-size >= 24pt`
  - (p7 0%) Speaker notes
- Rehearsal
  - (p1 83%) Timing — 25 min talk, 5 min Q&A
  - (p3 50%) Dry run with a colleague
  - (flag:yellow) Record it and watch it back — *unpleasant but effective*
  - (flag:green) Cut the ~~long tangent about monorepos~~
- Logistics
  - (flag:blue) Flights booked
  - (flag:purple) Hotel confirmation filed under [[Travel 2026]]
  - (flag:gray) Expense report — after the trip
  - (draft) this line opens with parentheses but is not a mark
- Follow-up
  - (p4 0%) Publish the written version
  - (p5 0%) Share slides and the demo repository

## Notes

Everything after the list block is left untouched by the plugin.
```

## Installation

Not in the Obsidian community plugin browser yet, so installation is manual.

**From a release**

Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/YounianC/obsidian-rich-mindmap/releases/latest), put all three into `<your vault>/.obsidian/plugins/rich-mindmap/`, then enable **Rich Mindmap** under Settings → Community plugins.

**From source**

```bash
git clone https://github.com/YounianC/obsidian-rich-mindmap.git
cd obsidian-rich-mindmap
npm install
npm run build          # produces main.js
```

Then copy (or symlink) `main.js`, `manifest.json` and `styles.css` into `<your vault>/.obsidian/plugins/rich-mindmap/`.

> `main.js` is a build artifact and is not committed — build it yourself or take it from a release.

## Data format

The first level-1 heading is the root node; the first contiguous unordered list after it is the tree. Indentation depth defines the hierarchy.

### Inline marks

A parenthesized group at the very start of a node's text is parsed as marks **only if every space-separated token in it is a known mark**:

| Syntax | Meaning |
|---|---|
| `p1` … `p7` | Priority (p1 red, p2 orange, p3 yellow, p4+ grey) |
| `0%` … `100%` | Progress (mapped to a 7-stage pie; the value you wrote is preserved verbatim) |
| `flag:red` `flag:orange` `flag:yellow` `flag:green` `flag:blue` `flag:purple` `flag:gray` | Flag |

Combine them freely: `- (p1 60% flag:blue) node text`. Order does not matter when reading.

If the group contains anything unrecognised, the whole group is treated as ordinary text — `- (draft) some note` is not a mark.

### Working with AI

The plugin embeds no AI. Point any AI at the `.md` file and let it edit directly — adding a node is one ordinary list item, with no ids, coordinates or JSON involved. When the file changes on disk the canvas re-parses and refreshes, keeping your viewport and selection where they were. If you had a local edit that had not yet been written to disk, the external content wins and a notice tells you so.

Content outside the list block — other frontmatter keys, preamble, code blocks, trailing paragraphs — is never rewritten.

### Write-back normalizations

Opening a file in mindmap view and switching away can cause Obsidian to rewrite it even if you changed nothing. That rewrite may produce these five byte-level changes and **only** these five:

1. A file not ending in a newline gains one.
2. A loose list (blank lines between items) becomes compact.
3. `CRLF` (`\r\n`) becomes `LF` (`\n`).
4. List indentation follows whatever the file already uses — 2 spaces, 4 spaces, tabs are all preserved. Only when a single file mixes indentation styles, so that no one consistent unit can be inferred, is it rewritten to 2 spaces per level.
5. Inline marks are written in a fixed order: priority → progress → flag (`(flag:blue 60% p3)` becomes `(p3 60% flag:blue)`).

Everything else is byte-for-byte stable — including `*` and `+` list markers (never converted to `-`), extra spaces in the heading line, trailing whitespace after the frontmatter fence, and all content outside the list block.

### Parse failure

If a file cannot be parsed as a mind map, the canvas shows an error card with a "switch to source mode" button. In that state the plugin does not write to the file at all.

## Keyboard

| Key | Action |
|---|---|
| `Tab` | Add child node |
| `Enter` | Add sibling node |
| `F2` / double-click | Edit text |
| `Delete` / `Backspace` | Delete node and its subtree |
| Arrow keys | Move selection through the tree |
| `Space` | Collapse / expand |
| `Esc` | Cancel editing / clear selection |
| `Cmd/Ctrl` + wheel | Zoom |
| Drag empty space | Pan |

Dragging a node changes its parent and its position among siblings.

## Toolbar

Selecting a node brings up a floating toolbar next to it: bold / italic / strikethrough, the marks panel (priority, progress, flag — clicking an active item clears it), insert a `[[link]]`, and button equivalents for add child, add sibling, delete and collapse.

## Commands

- **Toggle mindmap / source view**
- **Mark as mindmap (write frontmatter)** — writes `mindmap: true` so the file opens in mindmap view from then on (can be turned off in settings). On a file with no frontmatter it creates one. This command also normalizes the whole file's line endings to `LF` (normalization 3 above); visible content is unaffected.

## Development

```bash
npm install
npm run dev            # esbuild watch
npm test               # vitest
npm run typecheck
npm run check:purity
```

`src/model/` (`collapse-state.ts`, `marks.ts`, `parser.ts`, `serializer.ts`, `tree-ops.ts`, `types.ts`) plus `src/view/layout.ts` and `src/view/camera.ts` form a pure-function layer with no dependency on the Obsidian API or the DOM. `npm run check:purity` enforces that boundary; all of it is unit tested.

## Releasing

Pushing a version tag builds and publishes a release automatically:

```bash
# 1. Bump version in manifest.json and add the matching entry to versions.json
# 2. Tag it — the name must equal manifest.version exactly, with no v prefix
git tag -a 0.2.0 -m "..."
git push origin 0.2.0
```

GitHub Actions runs the type check, unit tests, purity check and build, and only then creates the release with `main.js`, `manifest.json` and `styles.css` attached.

## Project status

Version `0.1.0`, personal-use stage.

- The pure-function layer (parsing, serialization, marks, collapse state, tree operations, layout, camera) has 194 automated tests, including Markdown round-trip property tests.
- The view layer (rendering, zoom/pan, keyboard, drag, toolbar) is verified **by hand** by design. The checklist lives in [docs/MANUAL-VERIFICATION.md](docs/MANUAL-VERIFICATION.md) and **has not been worked through end to end yet**. Its appendix lists ten defects that were found and fixed during development — that is where regressions are most likely.
- The UI is Chinese only; no i18n yet.

Because the plugin rewrites your notes, **verify write-back behaviour in a test vault or a git-tracked directory first**, and only point it at notes you care about once you are satisfied.

## Documentation

- [AGENTS.md](AGENTS.md) — guide for AI agents working in this repo: architecture boundaries, ten hard constraints, the gates, and what the automated checks cannot see
- [docs/MANUAL-VERIFICATION.md](docs/MANUAL-VERIFICATION.md) — 92-item manual verification checklist
- [docs/superpowers/specs/](docs/superpowers/specs/) — design and decision record, including known limitations

## License

[MIT](LICENSE)
