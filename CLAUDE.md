# Hex CA — Claude Project

## What This Is

A heterogeneous cellular automaton on a hex grid. Each cell has a **color state** and a **genome** (set of fully-specified transition rules). Cells die when no rule matches their situation. Rules reproduce and evolve through an energy-based threshold mechanic.

Full design spec: `spec.md`

## Key Design Decisions

- **Hex grid**, 6 neighbors
- **Fully-specified count rules**: condition = (self_color, exact count of each neighbor color) -> next_color. No wildcards — each condition is unambiguous.
- **Death on no-match**: if no rule fires, cell becomes empty
- **Random death**: small per-tick probability p_death (tunable)
- **Energy model**: transition counter increments only on color change (not self-loops). Threshold = k * genome_length. On threshold hit, attempt to reproduce into empty neighbor cell.
- **Spreading**: depth of reproduction search increases with each failed threshold hit (hex-pipe style). Resets to depth 1 after successful reproduction.
- **Mutation**: on reproduction, genome is copied with possible point mutations, insertions, deletions (rates TBD)

## Implementation Notes

- Web simulation (JavaScript/Canvas)
- Start with n=3 or n=4 colors for PoC
- All tunable parameters: n (colors), k (threshold scaling), p_death (random death rate), mutation rates
