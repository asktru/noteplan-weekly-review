# What's changed in 🔭 Weekly Review plugin?

## [1.4.0] 2026-06-07
### New
- **Move completed to bottom**: card action that moves completed/cancelled top-level tasks (with their nested content) under a `## Done` heading at the end of the note.
- **Working** project status option.
- jgclark `project:` frontmatter is recognised for project/area detection.
- np.Shared is auto-installed on install/update.

### Changes
- View commands renamed to the shared **Open in sidebar** (alias `wrd`) / **Open in separate window** (alias `wrw`) convention.
- Note-level added tasks insert above the `## Done` section.

### Fixes
- End-of-note "Add task" no longer lands inside the Done section, and an empty `## Done` heading is hidden.

## [1.3.0] 2026-05-17
### New
- **Responsive layout**: filter bar, Show dropdown, and cards reflow gracefully in narrow or floating windows.
- **"Has open tasks" filter**: hide projects/areas that have no incomplete tasks from the Show dropdown.

## [1.2.0] 2026-05-09
### New
- **Editable review schedule**: click the "Every N week(s)" label on a card to change the interval or remove it; unscheduled notes show a "Set schedule" affordance.
- **Editable last-reviewed date**: click the date on a card to back-date or clear it; notes never reviewed show a "Never reviewed" affordance.
- **Per-section task input**: each heading section inside an expanded card gets its own "+ Add task" control, in addition to the existing bottom-of-note input.
- **Lifecycle filter**: new Show dropdown replaces the type-pill row, grouping Type and Status (active/paused/someday/completed/cancelled) with frontmatter `status` support and legacy mention fallback.
- **Hide done-tasks toggle**: eye icon in expanded cards to hide completed and cancelled tasks.

### Changes
- All filter choices persist across sessions via `DataStore.preference`.

## [1.1.1] 2026-04-12
### New
- **Archive button**: appears on expanded cards with zero open tasks; moves the note to `@Archive/YYYY-MM-DD/` and animates it out of the dashboard.
- **Frontmatter project/area syntax**: `type: project/area`, `review:`, `reviewed:`, `status:` frontmatter keys are recognised alongside existing hashtag/mention syntax — both work simultaneously.
- **Slash commands**: `/Turn into project` and `/Turn into area` set frontmatter and migrate existing hashtag/mention syntax in one step.
- **Routine plugin integration**: completing or cancelling a task from the dashboard invokes the Routine plugin to generate repeats.

### Changes
- Notes open in split view to avoid accumulating full-screen windows.
- Inline and end-of-line comments are muted in task rendering.
- New **Append Completion Date** setting (default: on) controls whether `@done(date time)` is appended when completing tasks.

## [1.0.0] 2026-03-21
- Initial release: **Weekly Review Dashboard** command — a sidebar view listing all projects and areas due for review, with priority colours, wiki-link rendering, light/dark theme support, and a schedule picker.
