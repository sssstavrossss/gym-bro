# Dynamic Type check — webkit (Playwright WebKit, iPhone 15 emulation) · 393×852

Text size simulated with `?dt=N` (root font-size). Clipped = text cut off by an overflow-hidden ancestor or off-screen; Ellipsis = text-overflow truncation; Overlap = two text runs drawn on top of each other; Small = touch target under 44×44 pt (incl. ::after hit areas).


## today
- **default (17 px, root 17px)**: 
  - overlap: span.t-dxl.num "472" ↔ span.t-label.c2 "kcal left"
- **xxxL (23 px, root 23px)**: no clipping, ellipsis or overlap
- **2x (34 px, root 34px)**: no clipping, ellipsis or overlap
  - all touch targets ≥ 44 pt
- **AX5 (53 px, root 53px)**: no clipping, ellipsis or overlap
  - all touch targets ≥ 44 pt

## log
- **default (17 px, root 17px)**: no clipping, ellipsis or overlap
- **xxxL (23 px, root 23px)**: no clipping, ellipsis or overlap
- **2x (34 px, root 34px)**: no clipping, ellipsis or overlap
  - all touch targets ≥ 44 pt
- **AX5 (53 px, root 53px)**: no clipping, ellipsis or overlap
  - all touch targets ≥ 44 pt

## food-sheet
- **default (17 px, root 17px)**: no clipping, ellipsis or overlap
  - note: 3 name-only text(s) shortened with … (by design at default size; wrap from xxLarge)
- **xxxL (23 px, root 23px)**: no clipping, ellipsis or overlap
- **2x (34 px, root 34px)**: no clipping, ellipsis or overlap
  - all touch targets ≥ 44 pt
- **AX5 (53 px, root 53px)**: no clipping, ellipsis or overlap
  - all touch targets ≥ 44 pt

## food-detail
- **default (17 px, root 17px)**: no clipping, ellipsis or overlap
- **xxxL (23 px, root 23px)**: no clipping, ellipsis or overlap
- **2x (34 px, root 34px)**: no clipping, ellipsis or overlap
  - all touch targets ≥ 44 pt
- **AX5 (53 px, root 53px)**: no clipping, ellipsis or overlap
  - all touch targets ≥ 44 pt

## weight
- **default (17 px, root 17px)**: no clipping, ellipsis or overlap
- **xxxL (23 px, root 23px)**: no clipping, ellipsis or overlap
- **2x (34 px, root 34px)**: no clipping, ellipsis or overlap
  - all touch targets ≥ 44 pt
- **AX5 (53 px, root 53px)**: no clipping, ellipsis or overlap
  - all touch targets ≥ 44 pt

## progress
- **default (17 px, root 17px)**: no clipping, ellipsis or overlap
- **xxxL (23 px, root 23px)**: no clipping, ellipsis or overlap
- **2x (34 px, root 34px)**: no clipping, ellipsis or overlap
  - all touch targets ≥ 44 pt
- **AX5 (53 px, root 53px)**: no clipping, ellipsis or overlap
  - all touch targets ≥ 44 pt

## profile
- **default (17 px, root 17px)**: no clipping, ellipsis or overlap
- **xxxL (23 px, root 23px)**: no clipping, ellipsis or overlap
- **2x (34 px, root 34px)**: no clipping, ellipsis or overlap
  - all touch targets ≥ 44 pt
- **AX5 (53 px, root 53px)**: no clipping, ellipsis or overlap
  - all touch targets ≥ 44 pt

## onboarding-1
- **default (17 px, root 17px)**: no clipping, ellipsis or overlap
- **xxxL (23 px, root 23px)**: no clipping, ellipsis or overlap
- **2x (34 px, root 34px)**: no clipping, ellipsis or overlap
  - all touch targets ≥ 44 pt
- **AX5 (53 px, root 53px)**: no clipping, ellipsis or overlap
  - all touch targets ≥ 44 pt

## onboarding-2
- **default (17 px, root 17px)**: no clipping, ellipsis or overlap
- **xxxL (23 px, root 23px)**: no clipping, ellipsis or overlap
- **2x (34 px, root 34px)**: no clipping, ellipsis or overlap
  - all touch targets ≥ 44 pt
- **AX5 (53 px, root 53px)**: no clipping, ellipsis or overlap
  - all touch targets ≥ 44 pt

## Live text-size change
Root changed 17 → 53px without reload, then visibilitychange: AX layout classes applied ✓ (CSS rem sizes follow immediately).

## Totals (issues per size; AX5 includes small targets)
- default: 1
- xxxL: 0
- 2x: 0
- AX5: 0

No page errors.
