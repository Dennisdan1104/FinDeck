# Agent Note: U2 — conversation page in the AlphaDeck shell

Status: implemented

English | [中文](2026-09-06-u2-conversation-page-in-alphadeck-shell.zh.md)

> AlphaDeck UI rebuild work item U2 plus the 5.1 rework items from the U1 review (`UI_REBUILD_PLAN.md`). Records where the session-mode and model selectors live, why the flow strip renders inside the session header, and how the dsh palette yields to the AlphaDeck one without forking component CSS.

## Problem

U1 replaced the shell chrome, but the conversation surface kept dsh presentation: the trajectory was reachable only through a View tab strip under the title, the mode and model selectors sat only in the composer tool row (the plan wanted them at hand in the title bar), the flow strip kept dsh visuals instead of the prototype's dot-and-line progress bar, and every dsh-styled surface still used the DeepSeek blue rather than the AlphaDeck accent. The U1 review also left hard rework items: a fixed back affordance on every full page, the trajectory button in the flow strip's row, and a no-overlap assertion at narrow widths.

## Decision

**The header owns the flow row.** Rendering of `conversation.session.flow` moved from `ConversationRoot` into the session header occupant — the one place that already holds the per-session view store and `selectView`. The header passes the trajectory control into the strip through the flow seat's new owner share (`trailing`), so `ui-mode`'s FlowBar stays view-agnostic and only places the control between the steps and the current-step line (the prototype's exact order). Occupants that render no strip simply drop the control; the seat declaration moved with the rendering, and the slot contract's owner share documents it.

**One selector component, two seats.** `conversation.session.header.mode` and `conversation.session.header.model` are new single seats whose owner share is the composer seats' `InputControlOwnerProps`; `ui-mode` and `ui-model-selection` occupy them with the same components and injected faces as the composer seats. There is no second selector implementation to drift: the title bar and the composer both read the host projection and both act through `/mode` and `session.selectModel`. The header locks them only for `session.removed` — the composer's `inert`/`blocked` reasons are owner-local states a title bar never has.

**The trajectory toggle replaces the View tab strip.** The dsh tab list is gone from the header. The chip (icon + label, prototype styling) selects the registered `trajectory` View — the original dsh trajectory component, still mounted through `conversation.view` — and flips to a back-to-chat face with the accent treatment while that View is active. Views remain an open extension point: anything a future plugin registers beyond `chat`/`trajectory` is reached the same way, and the strip renders the chip only when a trajectory view is actually registered.

**The dsw alias layer carries the palette swap.** `alphadeck.css` now remaps the handful of dsw aliases that carry brand color — `state-business-primary`, `link`, `button-info` pair, the brand primary, and the user-bubble pair — onto the `--ad-*` accent scale, after the design-platform sheet in load order. Every dsh-styled surface (chat transcript, composer, menus, dialogs) adopts the AlphaDeck accent and bubble palette without touching component CSS, and the grayscale aliases needed no remap because the dsh neutral ramp already matches the prototype's grays. Dark theme keeps dsh values until the dark-theme work item.

**A page is route state, so its back affordance is fixed chrome.** `ShellFrame`'s page area renders a slim bar with the `i-back` glyph above the scrolling page content; any sidebar navigation or session selection leaves the page directly (already true through the shell store, now asserted in tests).

## Verification

Focused Vitest suites for `ui-shell`, `ui-conversation`, `ui-mode`, and `ui-model-selection` cover the page back chrome, the trajectory toggle's round trip and its back face, the strip's trailing placement, and the seated selectors. `verify-client-ui-i18n` stays green (all new copy rides the `shell`/`conversation`/`mode`/`model` dictionaries). A Playwright smoke (`output/u2-smoke.cjs`) drives the real web app: it asserts the page back bar, the two title-bar menus, the flow strip's current-step line, the trajectory round trip, English copy under an `en-US` locale, and — the 5.1.3 assertion — that a 900px viewport shows no sidebar/main overlap and no horizontal overflow, with screenshots at 1366 and 1920 for the alignment self-check.

## Debt recorded

The web browser e2e lane (`apps/web/tests`) is paused by the creativity-first check policy for the UI rebuild (golden comparison against a chrome that changes daily is noise; it resumes once the UI settles). The lane has been stale since U1 — that commit updated no file under `apps/web`, and dialog-era settings assertions cannot pass against a shell with no settings modal. This change migrates the lane's one load-bearing scaffold locator off the retired layout (`[class*="centerCol"]` → `[data-conversation-scroll]`, 35 spec files) so the lane boots against the new shell when it resumes; full golden refresh and the per-spec chrome rewrites remain deferred work for that resumption. The focused suites and the smoke script above are the evidence of record for U2.

## Consequences

The mode/model selectors are reachable without opening the composer row, and both surfaces stay one implementation. The flow strip is now header chrome: a blank session hides strip and controls together, and plugins that register flow-strip-adjacent controls receive them through the seat's owner share rather than importing view state. Losing the tab strip removes the generic per-View navigation surface — today's only registered views are chat and trajectory, and a future third view must reintroduce navigation deliberately (the store and `openView` request path remain). The dsw remap re-colors every dsh-styled surface at once, so upstream component restyles keep working under the AlphaDeck palette; the cost is one more indirection between the design platform and what renders. The web browser e2e lane remains a recorded debt (stale since U1); the U-series evidence of record is the focused suites plus the Playwright smoke.

## Alternatives considered

**Parallel header selector components** (a chip-styled variant beside each composer seat) — rejected. Two implementations of the same roster/menu behavior drift on lock rules, failure copy, and menu structure; one component over two seats keeps the composer and title bar provably identical.

**Moving the trajectory control into the header row instead of threading it through the flow strip** — rejected. The plan fixes the chip's position between the steps and the current-step line, which only the FlowBar owns; threading the rendered control through the seat's owner share keeps the position with the strip and the behavior with the header, without giving ui-mode a view dependency.

**Forking the dsh component CSS to the AlphaDeck palette** — rejected. Every touched component would need per-rule edits and would diverge on each upstream restyle; the alias remap is one definition and survives upstream change by construction.
