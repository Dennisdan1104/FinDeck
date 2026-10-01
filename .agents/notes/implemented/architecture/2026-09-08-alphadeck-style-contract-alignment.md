# Agent Note: AlphaDeck surfaces conform to the ui-theme style contract

Status: implemented

English | [中文](2026-09-08-alphadeck-style-contract-alignment.zh.md)

## Problem

`ui-theme`'s style gates enforce the client visual contract on the shipped CSS: a rounded surface declares the paired `corner-shape`, neutral-token solid borders use the 0.5px hairline, and an elevated scroll container rebinds `--dsh-scrollbar-thumb`/`-hover` at the raised tier. AlphaDeck's new UI packages added surfaces that violated the contract — seven rounded surfaces without the paired declaration, one neutral-token border at 1px, and two elevated scroll containers without the rebinding — so the gates failed on the new packages.

## Decision

Each violating surface conforms to the existing contract: `corner-shape: round` is added to the seven surfaces, the 1px neutral border moves to 0.5px, and the two scroll containers get the raised-tier rebinding. No gate, rule, or token value changes; the fix is on the new surfaces, not on the contract.

## Alternatives considered

**Relax the gates for AlphaDeck surfaces.** Rejected: the contract is what keeps the palette and depth scale coherent, and per-package exceptions would fragment it.

**Restyle the surfaces to avoid the patterns.** Rejected: the violations are missing declarations on designs that already fit the contract, not wrong designs.

**Move the declarations into a shared component.** Rejected as out of scope: the surfaces are in five packages with no shared primitive for a rounded card or an elevated scroll region yet; extracting one is a larger change than aligning the declarations.

## Consequences

- The style gates pass with the new packages included.
- A new surface must copy the paired declarations from an existing card or scroll region; the gate is the enforcement point, and the failure names the file.
