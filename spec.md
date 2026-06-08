# Hex CA — Specification

## Overview

A heterogeneous cellular automaton on a hex grid. Each cell carries a **state** (color) and a **genome** (set of transition rules). Rules are evolved through reproduction with mutation. Cells die when no rule matches their current neighborhood situation.

Inspired by inner-loop heterogeneous CA literature, with novel additions: structured semantic state, energy-based reproduction, and partial-rule death pressure.

---

## Grid

- **Topology**: Hex grid (6 neighbors per cell)
- **Cell states**: n discrete colors + dead/empty
- **Recommended PoC**: n = 3 or 4 colors

---

## Rules

### Structure

A rule is a fully specified condition-action pair:

```
(self_color, n1, n2, n3, n4, n5, n6_counts) -> next_color | die
```

Where the condition specifies the **exact count of each color** among the 6 neighbors, plus the cell's own current color. The output is one of the n colors (or die, though death-on-no-match makes explicit die outputs redundant).

### Rule Space Size (hex grid, 6 neighbors)

| Colors (n) | Neighborhood configs C(n+6,n) | Conditions (x n) | Full rule space (x n+1 outputs) |
|---|---|---|---|
| 2 | 28 | 56 | 168 |
| 3 | 84 | 252 | 1,008 |
| 4 | 210 | 840 | 4,200 |
| 5 | 462 | 2,310 | 13,860 |
| 6 | 924 | 5,544 | 38,808 |

### Death

If no rule in the genome matches the cell's current state + neighborhood, the cell dies (becomes empty).

---

## Genome

- An **ordered list of rules**
- Full specification makes each condition unambiguous — no two rules can share the same condition
- Genome length is unbounded but subject to selection pressure via reproduction threshold

---

## Reproduction

### Energy Model

- Each cell tracks a **transition counter** (incremented when output color != current color; self-loops do not count)
- **Threshold** = k * genome_length (where k is a tunable constant)
- When counter hits threshold: attempt to reproduce, reset counter

### Spreading Mechanic (Hex-Pipe style)

- On first threshold hit: search depth-1 neighbors for empty cells
- If none found, keep accumulating transitions
- On second threshold hit: search depth 1 AND depth 2
- On nth threshold hit: search up to depth n
- On successful reproduction: reset counter AND reset reach back to depth 1
- When multiple empty cells found: pick randomly

### Reproduction Action

- Copy genome into target empty cell with possible mutation
- Child begins with transition counter = 0

---

## Mutation

TBD. Candidates:
- **Point mutation**: change the output color of a random rule
- **Rule insertion**: add a randomly generated rule to the genome
- **Rule deletion**: remove a random rule from the genome
- Mutation rate is a tunable parameter

---

## Death

Two death mechanisms:

1. **Rule death**: no matching rule for current state + neighborhood -> cell dies immediately
2. **Random death**: each tick, living cells have a small probability p_death of dying regardless of rules (tunable; prevents immortal stagnant cells)

---

## Regulatory Dynamics

The energy model creates implicit selection for **cyclic state transitions** (A->B->C->A), since:
- Self-loops don't accumulate transitions (no progress toward reproduction)
- Long transition chains without dying require rules that cover many successive states
- This structurally resembles gene regulatory networks: rules are nodes, shared color states are edges

---

## Open Design Questions

- Exact value of k (threshold scaling constant)
- Mutation rates and operator mix
- Whether reproduction requires the parent to "choose" a neighbor or is automatic
- Whether dead cells persist as empty indefinitely or decay/diffuse
- Initial conditions (random seeding, single organism, etc.)
- Whether color has any semantic meaning (e.g., resource type) or is purely structural

---

## Related Work

- [Emergent Dynamics in Heterogeneous Life-Like CA (2024)](https://arxiv.org/abs/2406.13383) — closest ancestor; inner-loop evolution of per-cell life-like rules; but binary state and computation is epiphenomenal
- [Flow-Lenia (2023/2025)](https://arxiv.org/abs/2212.07906) — parameters as state channels, multi-species; continuous, global architecture
- Avida — per-cell programs, reproduction, evolution; but arbitrary logic computation, not structured semantic state
- Hex-Pipes — hex grid, colored state, niche construction; static organisms, no genome evolution
