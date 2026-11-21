# Gym Bro UI rules

These are the rules the app's screens follow. Read this before you add or change anything on screen, and check new work against the list at the end before opening a PR. The token values and the shared classes are listed in README → *Design tokens*.

## One look everywhere

- **Tokens, not pixels.** Spacing, corners, control sizes and colours come from the tokens in `frontend/src/styles/main.css`. New code never sets its own padding, height, corner or colour in raw numbers. If a token is missing, add it to `main.css` and use it, rather than writing the number in one place.
- **The same kind of thing looks the same on every screen.** A box in a page has the same padding and corners wherever it is, and a card title sits the same way on every card. Don't change these per page.
- **Reuse before you build.** Use the shared classes and components (`.btn`, `.chip`, `.card`, `.well`, `.field`, `.tag`, `.chead`, `Segmented`, `SwipePanels`, the app keypad, `AmountScreen`, `Icon`). A new control that does the job of an existing one must look like that one.
- **One change applies everywhere.** When a pattern changes (the amount box, the keypad, a card's title row), it changes on every screen that uses it, not only the one being worked on.

## Buttons and controls

- **Primary** actions (Save, Add food, Log weight, Recalculate) are filled with the action colour: white in Mono, the accent's main colour otherwise. They are filled, but not big. **Secondary** actions (Cancel, Dismiss, Delete, Reset) are grey.
- **Two sizes only.** A regular button is 44px tall (`--control-btn`). A small button (`.btn.sm`), chip, compact switch or pill has a **30px face** (`--control-chip`) and `--space-m` padding at the sides. Its icon is 14px beside a label and 16px when the icon is the whole button (the + on an amount, the add pill).
- **Every tap target is at least 44px** (`--control-hit`). A small control gets there with a 44px hit area around its 30px face, never by drawing the face bigger. The first Home add pill did that: its face was 34px with 18px icons, and it looked heavier than every button around it.
- **A small control beside a card title** is centred on the title and overhangs the title row, so the row stays as tall as the title (see `.chead`).
- Sheets close with an ×. Actions use the shared icon set (`Icon`), not new drawings.

## Nothing jumps

- **Switching modes doesn't move anything.** Select mode, editing, loading and empty states keep the same heights and positions. A button that changes (Add → Done) takes the same spot at the same size.
- **Swiping cards keep one height** on every page, including when there is no data. An empty card still swipes; it doesn't shrink.
- **Changing text doesn't resize the layout.** A longer value or label wraps or shortens with an ellipsis inside its box. It never pushes the screen wider or taller.
- **Messages don't shove content.** Prefer a quiet line or an info icon that opens the detail to a banner that appears and moves the card.

## Repeated patterns

- **Swipe dots** sit 12px above and below the dots, in every card that has them (`SwipePanels` `tight`).
- **Long lists inside a card** show five rows, then scroll inside the card. A thin bar and a fade show that there is more.
- **Numbers are typed on the app keypad** on a touch screen, never on the phone's number pad.
- **Settings for occasional use** go behind the cog. Anything new on Home gets its own on/off switch in Settings → Home sections; the week strip always stays.
- **Pickers with an automatic choice** (time zone, food country) put the automatic option first as its own radio row, then the search, then the list. Picking a row by hand stops the automatic choice until it is picked again, and the Settings row says which it is ("Follows the time zone", "Set by hand"). When the automatic choice changes on its own, a toast says so with a Change action that opens the picker.
- **Hints are subtle.** Show that something can be changed, or that something is new, with a small cue (a pencil, a dot, a tint), not with extra text.

## Mocks

- Mock first for anything visible, with a recommendation, before building.
- Mocks use the real app's components, text sizes, spacing and copy. A card that already exists appears as it really looks, not as a sketch of it.

## Before a PR with UI changes

1. Every new size, gap, corner and colour is a token.
2. Each new control has the same face height, padding and icon size as the existing control of its kind. Screenshot them side by side: a new pill next to "Done" or "Log weight", a new switch next to Goal's.
3. Every tap target is at least 44px.
4. Nothing moves when switching modes, swiping, or loading, or when a value is empty or long.
5. Check it at the phone width (390px), at the largest text size, and in one non-Mono accent.
6. The README describes the new behaviour, and this file has any new rule.
