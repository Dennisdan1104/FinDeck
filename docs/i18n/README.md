# Bilingual documentation

English | [中文](README.zh.md)

This repo's documentation is read by people and agents both inside and outside the company, so every document in scope is maintained in English and Simplified Chinese. This page defines the pairing contract, its scope, and its exclusions; [translation-rules.md](translation-rules.md) defines how to translate; [terminology.md](terminology.md) is the terminology source of truth. Routine agent work follows the lightweight path in [docs/AGENTS.md](../AGENTS.md). Nothing in the repository checks a pair, so the conventions below are editorial judgment and review is their only enforcement.

## The pairing contract

- **Both languages carry equal authority.** A document may be authored and reviewed in either language first — a Chinese-first Agent Note is as legitimate as an English-first one — and the counterpart is translated from it. Neither file outranks the other; what binds them is that they must say the same thing.
- **A pair is three sibling files.** The English `foo.md`, the Chinese `foo.zh.md`, and a consistency record `foo.i18n.yaml`, all in the same directory. No locale directories, no separate translation repo, no interleaved bilingual files. Pairs merge whole: a PR never lands one language without the other two files.
- **The consistency record.** `foo.i18n.yaml` holds the full git blob hash of each side as of the last time the two were confirmed to say the same thing:

  ```yaml
  foo.md: 3f786850e387550fdab836ed7e6dc881de23001b
  foo.zh.md: 89e6c98d92887913cadf06b2adb97f26cde4849b
  ```

  Blob hashes, not commit hashes, so the record is computable for files edited in the same change (`git hash-object foo.md`) and consistency is a pure content comparison. The recorded hashes recover the exact last-confirmed text of either side, so an out-of-sync pair is updated by patching the counterpart minimally against the edited side's diff — never by re-translating whole files. After bringing the pair back in line, write the two current blob hashes into `foo.i18n.yaml` by hand; that yaml diff is the reviewable act of confirming consistency, which is why a change records only the pairs it actually confirmed. Nothing verifies the record, so a file edited since the last confirmation simply no longer matches its recorded hash — that mismatch is the normal state between confirmations, not a defect. A generator that owns both sides writes the record itself, as `docs/module-graph.md` and its `.i18n.yaml` are written together.
- **Language switcher.** The Chinese file always links back immediately after its H1 heading with `[English](foo.md) | 中文`. An authored English file reciprocates there with `English | [中文](foo.zh.md)`; a listed generated English source omits that line so it remains byte-identical to generator output. A README published outside GitHub, such as PyPI project metadata, may use the canonical `https://github.com/deepseek-ai/deepseek-harness/blob/master/<repository-path>` URL to the same counterpart so the switcher still resolves there.
- **Structure mirrors the counterpart.** Heading depths and order, list kinds, ordered-list starts, list item counts, table row and column counts, semantic link targets with exact query/fragment suffixes, and verbatim code blocks match one to one across the pair. When a relative document link targets the active bilingual corpus, the English side uses its `.md` path and the Chinese side uses its `.zh.md` path. A missing counterpart in that corpus is a pair-completeness error rather than a fallback; targets outside the active corpus keep the authored path. See [translation-rules.md](translation-rules.md) for the full preservation rules.

## Keeping a pair in sync

There is no pairing checker, no linking or wrapping linter, and no Git merge driver or hook for `.i18n.yaml`; the fork ships none of them. Sync rests on one working rule: **when a change edits either side of a paired document, the same change updates the counterpart directly in one terminology-guided pass and re-records the pair**, exactly like any other doc edit that ships with its docs.

Both branches recording the same pair is an ordinary text conflict like any other. Resolve it after the content merge by writing the hashes the merged files actually have; do not hand-copy a hash from either side.

Two limits are worth stating plainly:

- **A recorded pair means someone confirmed the two sides consistent at these exact contents, not that the confirmation was sound.** Nothing compares the hashes for you, and even a perfect check could only compare structure: whether the two sides say the same thing, and whether the wording is accurate, well-termed, and natural, is the reviewer's half of the contract, per [translation-rules.md](translation-rules.md). A re-recorded pair with a sloppy counterpart must not pass review.
- **Scoped attention is not corpus coverage.** Reading one pair carefully says nothing about the other ninety; a change that touches shared terminology or a cross-cutting fact owns the sweep across every pair that repeats it.

## Scope and exclusions

**Scope**: the root `CONTRIBUTING.md`, `BRAND_GUIDELINES.md`, `SAFETY.md`, and `SECURITY.md` documents, every non-vendor README, and every active document under `.agents/notes/**`, `docs/**`, and `python/**`. README matching is case-insensitive on the basename, so a README in a new directory joins the scope without a manifest edit. Dependency and ignored build-output trees and the frozen `.agents/notes/archived/` tree are discovery exclusions, not evolving translation source.

Generated English references and graphs participate in pairing when a reviewed Chinese counterpart is available. Their generators remain the English source of truth, and regenerating either side rewrites the pair's `.i18n.yaml` along with it. A generator that owns both sides, such as the Cordis subsystem-region generator, projects paired document paths to each output locale while keeping every other generated byte equal. Generated English sources omit the language switcher that ordinary authored sources carry, because adding it would make the generator output stale; their Chinese counterparts still link back to the English source. A generated page's Chinese counterpart may rewrite only self-referential generation and maintenance statements that would otherwise be false for the reviewed translation; all technical content remains subject to the ordinary faithfulness rules.

**Excluded** (never paired; a `.zh.md` or `.i18n.yaml` for these is itself the error, and this list is the record of them):

- [cordis-api/inherited.md](../cordis-api/inherited.md) — generated without a reviewed Chinese counterpart, so both website locales project the English source.
- `docs/AGENTS.md`, `.agents/notes/**/AGENTS.md`, and their `CLAUDE.md` instruction symlinks — agent instructions, maintained in English only like the root `AGENTS.md`.
- `docs/i18n/terminology.md` and [style-samples.md](style-samples.md) — both are bilingual by construction.
- [translation-prompt.md](translation-prompt.md) — a prompt template whose body is verbatim English instruction text, bilingual by construction in the same way.
- `.agents/notes/archived/` — frozen historical triplets. Translation maintenance must never rewrite them.

**Universal requirement**: every current or future document in scope merges as a complete bilingual pair. [scripts/translation-pairing.manifest.json](../../scripts/translation-pairing.manifest.json) carries the exclusion list as data, because the Cordis catalog generator reads it to project paired document links to each output locale. Records under `.agents/notes/archived/` stay exactly as they were sealed, header and hashes included. There is no per-file rollout list, date cutoff, or README-specific policy class.

## Division of labor

A counterpart is updated directly by the working agent in one pass after it loads [terminology.md](terminology.md); it does not invoke a translation skill, generate a briefing, run a separate translation-review pass, or delegate to a subagent. Review owns everything a machine cannot: translation quality, terminology, and structural preservation beyond the shape rules above. [translation-prompt.md](translation-prompt.md) holds the calibrated prompt template, including its few-shot examples and the three-section output format, for anyone running a translation through a model.
