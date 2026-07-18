# Changelog

## Unreleased

- Use `Option+Up` to enter editing, plain arrows to select rows, and `Option+Up`/`Option+Down` to reorder rows across lane boundaries.
- Replace the lane-toggle shortcut with direct queue movement and rollback-safe order drafts.
- Simplify lane titles and move shared keybinding help below the queue boxes.
- Use consistent diamond and circle queue-state icons, with distinct `⏸` paused and `◈` editing-held states.
- Preserve normal `Up`/`Down` suggestion navigation while autocomplete is visible.
- Show the selected lane position, such as `steer 2/4`, in the shared help line.
- Keep shortcut help compact with `↑↓`, `⌥↑↓`, and `⌥X` symbols.
- Show a shared `• unsaved` indicator for pending text, order, lane, and removal changes.
- Keep `Option+X` removal marks, restored by `Escape` or a second press and compatible with image-only rows.

- Show steering and follow-ups as separate lanes in one delivery-ordered timeline.
- Group the lanes into stacked blue and yellow boxes with aligned inline editing.
- Add a compact looping demo in the original GitHub Dark terminal treatment, starting on a populated screen.
- Keep steering rows editable until Pi's native turn boundary.
- Honour Pi's independent `one-at-a-time` and `all` modes at active-run delivery boundaries.
- Add `Option+Down` navigation and recency-first `Option+Up` selection.
- Pin edited heads so asynchronous delivery cannot consume a row under the cursor.
- Stash unrelated composer text and remove empty text-only rows on save.
- Pause both lanes after an abort and require an explicit empty `Enter` to resume.
- Feed follow-ups into Pi's native continuation queue to preserve transcript and run semantics.

## 0.1.0 — 2026-07-16

- Add a visible, session-local FIFO for queued Pi follow-ups.
- Add inline row editing with stable queue positions and rollback on Escape.
- Preserve image attachments, editor integrations, and failed dispatches.
- Compose with existing Pi custom editors while removing nested editor chrome from the active row.
