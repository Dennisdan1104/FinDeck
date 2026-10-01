# Agent Note: AlphaDeck resolves its own home directory

Status: implemented

English | [中文](2026-09-11-alphadeck-separate-home-directory.zh.md)

## Problem

AlphaDeck is installed beside a stock DeepSeek Harness and is expected to run at the same time as it. Both products resolve their user data through the single harness-home resolver, whose default directory name was `.dsh` ([one harness home resolver](2026-07-24-single-harness-home-resolver.md)). Sharing that root would put both products on one session store, one `settings.yaml`, one `.credentials.yaml` and one `profiles/` tree: a settings change or credential write in either product would be visible to, and able to break, the other, and neither product could be upgraded or reset independently.

The divergence also arrived without a record. A reader of `@deepseek-ai/dsh-home-paths` sees `~/.dsh` in the surrounding prose of the very constant that reads `.alphadeck`, and cannot tell whether the value is deliberate or a stale edit.

## Decision

`DSH_HOME_DIR_NAME` is `.alphadeck`, so the default AlphaDeck home is `~/.alphadeck`. Precedence is owned by `@deepseek-ai/dsh-home-paths`: an explicit configured path, then `$ALPHADECK_HOME`, then `$DSH_HOME`, then `~/.alphadeck`. A `$DSH_HOME` that resolves to the stock harness home `~/.dsh` is refused with one diagnostic per process: the stock build exports that value into every shell it starts, so an AlphaDeck server launched from a stock-DSH terminal, or by an agent running in one, would otherwise collapse onto the other product's root without anyone choosing it. `$ALPHADECK_HOME` is the deliberate opt-in for that directory. `dshHomeDisplay()` reports `~/.alphadeck`, `$ALPHADECK_HOME`, or `$DSH_HOME` for the home each selects.

Every AlphaDeck user-data location resolves through `resolveDshHome()` or `dshHomePath()`. The asset library, the thesis registry, the web-app asset overview and the default workspace derive their paths from that seam rather than repeating the directory name.

The two products are also separated on the network: AlphaDeck serves on port 3081 while stock DeepSeek Harness serves on 3080. `start-alphadeck.ps1` owns port 3081: it sets `$ALPHADECK_HOME` and `$DSH_HOME` to `~/.alphadeck`, records the server pid in `~/.alphadeck/logs/web-server.pid`, and replaces any server on that port it did not itself start, so a collapsed instance is corrected by re-running the launcher.

## Alternatives considered

**Keep `~/.dsh` and require `$DSH_HOME` for coexistence.** Rejected: running both products is the ordinary setup for this fork's users, and a shared home is not a cosmetic collision — sessions, settings and credentials would interleave. Requiring an environment variable before the second product's first run turns the default path into a configuration failure.

**Copy or migrate `~/.dsh` into `~/.alphadeck` on first run.** Rejected: the fork must not move, rewrite or delete the other installation's user data. A copy would silently fork sessions and credentials into two stores that then diverge, and nothing in AlphaDeck can know which installation the user intends to keep using.

**Keep the shared home and namespace AlphaDeck's files inside it.** Rejected: sessions, settings, credentials and profiles all key off the home root, so namespacing would have to reach every consumer of the resolver, including upstream packages the fork does not own.

## Consequences

- A stock DeepSeek Harness install and AlphaDeck keep separate sessions, settings, credentials, profiles and attached objects, and both can run at once.
- A `$DSH_HOME` naming the stock home no longer relocates AlphaDeck, so the separation does not depend on how the server was launched. A user who deliberately wants the shared root sets `$ALPHADECK_HOME`.
- Data already under `~/.dsh` does not appear in AlphaDeck. There is no migration path, and a user who wants their upstream history must point `$DSH_HOME` at that tree or copy it deliberately.
- Any user-data path that hardcodes `~/.alphadeck` instead of calling the resolver stops following a configured home or `$DSH_HOME`. The shared root and its precedence remain the resolver's decision, not each consumer's.
- Upstream documentation and Agent Notes that describe the default home as `~/.dsh` are stale in this fork wherever they describe AlphaDeck's own behaviour.
