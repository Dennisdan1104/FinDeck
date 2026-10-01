# Agent Note: Mode authoring writes are closed under the writable root

Status: implemented

English | [中文](2026-09-11-preset-authoring-write-integrity.zh.md)

## Problem

The mode-authoring tools (`mode_list`, `mode_write`) let a Creator-mode session create and rewrite presets. A review of that change found four ways the write path could produce a state its own readers cannot use, plus a deployment gap:

- `renderPresetDocument` interpolated a step's `model` into the YAML as a bare scalar while `flowProblem` accepted any slash-containing string. A model route carrying a newline therefore injected a line at column 0: a new key landed silently, and a duplicate key made the file unparsable, which both readers degrade to `{}` — so the mode vanished while `mode_write` still reported success.
- The rewrite path resolved the preset from whichever user root held it but wrote into the first user root. With two `user`-trust roots that created a directory with no composition, which discovery reports as broken and which, because roots are first-wins, shadowed the real preset. `deleteComposition` already carried the ownership guard the write path lacked.
- Create ran a whole-directory copy and then wrote the document. When the second write failed, the copied directory stayed on the roster carrying the source's description and no declaration, and the caller was told the write had failed.
- A blank `name` rendered no metadata, so the write was skipped while `save` returned success.
- `resolveAuthoredFlow` treated any `modeKind` that was neither `free` nor absent as `work`, so a wire caller could ask for `"banana"` and get a work mode.
- The `cordis` preset's new row named `@deepseek-ai/dsh-tool-preset-authoring`, which the runtime dependency manifest did not declare. Discovery resolves a row package by walking up from the harness base, so an installed deployment reported the Creator preset broken — the mode this feature exists for.

## Decision

The write path only ever produces a preset the readers can load, and it writes only where the resolved preset lives.

- The renderer emits every non-identifier scalar through `JSON.stringify`, and `flowProblem` refuses a control character in a step model. Quoting is a property of the writer, so no value can become document structure; the validation makes the nonsense value fail loud at both write and discovery, since the same text also feeds the model-facing flow section one line per step.
- `writePresetDocument` and `deleteComposition` share one `ownedPresetDir` guard, so a rewrite of a preset the writable root does not own is refused rather than written into the wrong root.
- A failed document write rolls the copied directory back, so a failed create leaves no roster entry behind.
- A blank stated name reads as absent and falls back to the stored name, then the id, matching what the read path already treated an empty string as meaning.
- An unknown `modeKind` is refused by name instead of coerced.
- The runtime dependency manifest declares the tool package and its required peer.

## Alternatives considered

**Escape only the characters that can break a plain scalar.** Rejected: it makes the guarantee depend on hand-rolled YAML rules that a later validation change can widen. Quoting one scalar through the existing serializer needs no such reasoning and matches how the neighbouring free-text fields are already emitted.

**Refuse a blank name instead of normalising it.** Rejected: the read path already treats an empty string as "no display name" and the picker already falls back to the id, so refusing would make `save({id, name: ''})` fail while `save({id})` succeeds although both state the same thing.

**Let a rewrite in a later user root write there.** Rejected for now: save and delete would then disagree about which root owns a preset. The guard is the single place to change if a deployment needs presets in a second user root editable — and delete must change with it.

## Consequences

- A preset the tools write is a preset discovery can load; a refused write leaves the roster unchanged and names its rule.
- A deployment with more than one `user`-trust root cannot rewrite a preset that lives in a later root; it is reported as not writable rather than silently written elsewhere.
- Installations resolve the authoring tool, so the Creator preset activates instead of reporting a broken row.
- The create path performs one extra roster read, because the write target is deliberately whatever discovery resolved.
- A step `label` carrying a line break still reaches the model-facing flow section verbatim. It cannot alter the document, and authoring is already shell-trust, so it is left as is.
