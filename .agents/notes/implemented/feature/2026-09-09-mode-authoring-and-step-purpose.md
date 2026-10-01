# Agent Note: mode authoring — a step's stated purpose, and a metadata-only write path

Status: implemented

English | [中文](2026-09-09-mode-authoring-and-step-purpose.zh.md)

> AlphaDeck work order A (requirements R9 freedom of configuration). Records why a work-mode step gained an optional statement of purpose instead of a larger required schema, and why both authoring callers — the model and the assets page — write only a preset's metadata half.

## Problem

`FlowStep` carried `id`, `label`, and `model`. Nothing said what a step was FOR, so every workflow's actual content lived in one generic skill document that every mode shared. A mode authored by copying a work preset was therefore a shell: it reordered the step bar and changed nothing the model was told to do. The only authoring entry point was the assets page's form, which requires an existing work preset to copy and accepts only `from`/`id`/`name`/`steps` — and a session on the self-modifying `cordis` preset, which can already write any file, had no validated way to create a mode at all: it hand-wrote YAML, and a non-kebab-case id or a bare provider name as `model` produced a preset that discovery reported broken with no feedback at the time of the write.

## Decision

**A flow step gains one optional `prompt`: what that step does, in the model's own instructions.** It is rendered in the `mode:flow` prompt section under its step's entry, indented to the entry so multi-line prose stays inside the list item. The field is optional in the strongest sense — an absent key reads as a step named by its label alone, exactly how every flow declared before the field reads — and a present-but-blank one is refused rather than stored, because `prompt: ""` would be a declaration that means nothing. This is the "fields optional, expression free" balance: the schema stays three required fields plus one long-form slot, so creating a mode is never a form to fill, and it is never a shell either.

**The purpose is instruction text, not step data.** It adds to the agent's standing instructions rather than replacing them, it does not enter a `flow_step` result (a declaration still answers with the step's id, label, and model), and it gates nothing. The alternative — an enumerated per-step policy (`tools`, `checklist`) — was rejected: a step that says "this step may only search" would make the model ask why, and nothing in the runtime could answer.

**One authoring seam for both callers.** `AgentPresets.save` (the `savePreset` Remote) takes `AgentPresetWriteRequest` — `id`, optional `from`, and the authorable half: display name, description, `modeKind`, and the steps — and replaces `createFlowPreset`, which took the same shape positionally and could only create. `from` present means create: the source's whole directory is copied and only its `preset.yml` is then written. `from` absent means rewrite an existing user preset, where an omitted field keeps the stored value (including the stored `modeKind` when only the steps change) and the composition is never touched. The composition is not a parameter of either path, so a mode a caller writes cannot grant a session a capability its source preset did not have.

**The model reaches that seam through a tool, not through the filesystem.** `dsh-tool-preset-authoring` contributes `mode_list` (the roster with each mode's declared steps, `trust` marking what a write can change) and `mode_write` (create or rewrite, with the composition explicitly out of scope in the tool description). It is mounted by the shipped `cordis` preset, so authoring is a capability of the mode that already has shell access. The tool's own translation keeps the tool-level absences the wire type demands be explicit: an absent `name` stays absent so a rewrite keeps the stored one, and an absent step `model` becomes `default`.

**The renderer is shared, so the two declarations cannot disagree.** `renderPresetDocument` derives the mode from the step list it is handed — steps make it `work`, an empty list makes it `free`, `undefined` stores no mode — and it renders the display half through the same `renderPresetMetadata` the copy path uses. It replaced a hand-built line list in `save`, whose free-mode branch wrote no `mode_kind` line at all: a rewrite to `free` left the stored mode undeclared.

## Alternatives considered

**A required per-step description** — rejected. Every mode that exists today would become invalid or would acquire a description nobody wrote, and the requirement is explicit that creating a mode must not turn into filling a form.

**Appending step purposes as a second prompt section after the skills** — rejected. The flow, its current step, and what each step does are one declaration; splitting them across sections would let a reader of the prompt see the step list without the sentence saying what the steps are for. `mode:flow` already sits at first-party order 100, and a skill's text arrives later in the transcript as a tool result, so appending within the section keeps the purpose attached to its step.

**Per-step tool scoping** — rejected with the requirement. Tools are session-level, and narrowing them per step mostly produces a model asking why it cannot search this step.

**Letting `mode_write` edit `agent.cordis.yml`** — rejected. The composition is what makes a preset a capability grant; a tool that could rewrite it would be a less auditable `bash`. Creating from `from` is the supported way to get a different plugin set, and it is the same boundary the web form has always had.

## Consequences

Both callers now share one validated write, so an id, model route, or flow shape that discovery would reject is refused at the call with its rule named, and the assets page renders each step's purpose beside it. A rewrite replaces the whole step list; there is no per-step edit, which is why `mode_list` returns the steps in full. A mode written while a session runs is visible to the next session created, not to the running one: a composed session keeps the plugin composition it started with, and only the step declaration is re-read, so a rewritten flow reaches a running session when it next declares a step. The `cordis` persona now points at the tools for the metadata half and reserves direct file edits for the composition, which is the half those tools deliberately do not own.

## Verification

`packages/preset/agent-presets/tests/mode.spec.ts` covers the step shape: a stated purpose is read back with its step, an omitted one adds no key, a blank one is refused. `packages/preset/agent-presets/tests/remote.spec.ts` drives the authoring seam over temp roots: create-from carries the source description and drops its `order`, a rewrite keeps the stored description and name, `free` drops the flow and is stored as `mode_kind: free`, and the refusals (empty id, stepless work declaration, malformed step, taken id, unknown source, shipped preset) each name their rule. `packages/preset/tool-preset-authoring/tests/tool-preset-authoring.spec.ts` executes both tools against a real roster and asserts the stored files, including that the copied composition is byte-identical to its source. `packages/preset/mode/tests/mode.spec.ts` asserts the rendered flow section carries the indented purpose while a `flow_step` declaration still answers with only id, label, and model. `packages/client/ui-assets/tests/assets.client.spec.tsx` renders the purpose in the expanded flow card and asserts the form forwards it.
