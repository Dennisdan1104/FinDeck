# Code review in this fork

English | [中文](maintaining-dsh-code-review.zh.md)

This fork ships no `dsh-code-review` skill and no skill-maintenance workflow. The periodic review-feedback mining tool, its reviewer adapters, the promotion helper, and the machine that runs them are private infrastructure with no counterpart in this repository, so there is no candidate diff to promote and no operator runbook to follow.

Review guidance for a change is the same documentation a contributor reads: the owning package README for its contract, [docs/AGENTS.md](../AGENTS.md) for documentation structure and writing rules, and the owning [subsystems page](../subsystems/README.md) for type-level facts. A reviewer reads the diff against those, and against the running product, rather than against a checklist.
