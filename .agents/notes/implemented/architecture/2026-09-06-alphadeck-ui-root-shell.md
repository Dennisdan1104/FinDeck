# Agent Note: AlphaDeck root shell — replacing the dsh three-column frame

Status: implemented

English | [中文](2026-09-06-alphadeck-ui-root-shell.zh.md)

> AlphaDeck UI rebuild work order U1 (design: `UI_REBUILD_PLAN.md`, visual baseline: `output/ui-prototype/index.html`). Records why the new shell is a replacement rather than an extension of the dsh chrome, and what moved with it.

## Problem

The user's decision for the AlphaDeck UI was a clean rebuild, explicitly not an extension of dsh's window chrome: a fixed 236px navigation sidebar (research/roundtable tabs, direct nav, workspace-grouped sessions, a collapsible settings box, a user card) beside a routed content area, with the dsh three-column AppFrame (resizable sidebar, details column, settings modal dialogs) gone. The dsh layout machinery is slot-based and replaceable — the runtime renders only the built-in `root` slot — but the replacement had to keep every feature surface working: the conversation (ui-conversation), the tool-details panel (ui-chat's DetailsPanel), the workspaces browser (ui-workspace), and every settings section (Models, System, Agent presets, Help, and the placeholder pages) all register into slots the old shell declared.

## Decision

**One new package owns the root slot.** `dsh-client-ui-shell` contributes `ShellFrame` into `root` (web-app bundle row; the `ui-layout` and `ui-sidebar` rows are disabled there, not deleted — a profile mounting both shells fails loud on the child-slot declaration conflict, which is composition error surfaced by design, not a hidden fallback). ShellFrame re-declares the occupant-facing holes the replaced entries owned — `conversation`, `details`, `shell.overlay`, `sidebar.workspaces` — so every occupant mounts unchanged. Fixed 236px sidebar, no collapse; `ctx.layout` keeps its contract, with `toggleSidebar` a documented no-op (the details open/close pair keeps working).

**Page navigation is one `settings.section` id.** The shell's route is a section id or `undefined` (the conversation). Non-chat pages render through a new `shell.page` hole occupied by the settings domain's page host (`SettingsPageHost` in ui-settings-general): it resolves the requested section id and renders that section's content full-page — same registry, same components, no dialog. The settings-box items, the direct nav block, and the roundtable tab are fixed shell copy; the roundtable surface is just the `roundtable` section. Opening a session anywhere returns the content area to the conversation (a current-session change effect).

**Theme and title projection moved with the shell.** The theme presenter moved from ui-layout to ui-shell (no profile mounts ui-layout's root entry anymore, and feature plugins must not share the presenter as a value import — the shell carries its own). The browser-title effect is inlined in ShellFrame to avoid a twin component file. The prototype palette lives as one `--ad-*` token scale in `ui-theme/src/styles/alphadeck.css` (global sheets belong to ui-theme), the single color source for the U-series.

**Settings pages keep working without the modal.** ui-settings-general registers `SettingsPageHost` into `shell.page` — the second registration next to the legacy `SettingsRoot` (which stays for profiles that render `sidebar.settings`); the two never coexist because each sleeps on its own hole declaration, and the settings.section declaration conflict makes a both-mounted world fail loud.

**Onboarding is deliberately dormant in U1.** The first-run tour coordinator lives on the (unrendered) SettingsRoot; it returns with the U5 settings pages. The workspace browser keeps its dsh visuals until the U2 conversation work restyles it.

## Alternatives considered

**Shadow the `root` cell at a lower priority.** Keeping ui-layout's root entry registered and rendering over it avoids disabling rows, but the shadowed entry still declares `conversation`/`details` — ui-shell could not re-declare them, so the composition stays coupled to the dsh frame's shape. Disabling the replaced rows makes the replacement complete.

**Make the shell declare `settings.section` itself.** The section registry is the settings domain's (ui-settings); declaring it from the shell would move ownership and break any profile that mounts both worlds. The page host stays in ui-settings-general, where the declaration already lives.

**Reuse ui-layout's theme presenter as a value import.** Feature plugins may not runtime-import another feature plugin's values; moving the file keeps one copy and one owner (the mounted shell). `DocumentTitle` stays in ui-layout for AppFrame; the shell inlines the equivalent effect.

**Nav labels from the section ledger.** Reading labels per section id would reuse registrant-owned copy, but the curated IA (研究/圆桌 tabs, fixed box items) differs from the ledger's orders and set — the shell owns its chrome copy in the `shell` namespace.

## Consequences

The assembled web app renders the AlphaDeck sidebar and routes pages on first load: nav block, settings box (模型/数据与环境/系统/预设/帮助), roundtable tab, and the existing sections as full pages. Settings reachability is unchanged (Models, System, Agent presets, Help, data environment), plugins inventory renders as a page, and the conversation keeps its modal-free behavior. Details panel and overlay occupants behave as before. Dark `--ad-*` overrides, onboarding, and the restyled workspaces browser are follow-up work (U2/U5, dark theme item).
