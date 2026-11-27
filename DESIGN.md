# Gym Bro UI rules

These are the rules the app's screens follow. Read this before you add or change anything on screen, and check new work against the list at the end before opening a PR. The token values and the shared classes are listed in README → *Design tokens*.

## One look everywhere

- **Tokens, not pixels.** Spacing, corners, control sizes and colours come from the tokens in `frontend/src/styles/main.css`. New code never sets its own padding, height, corner or colour in raw numbers. If a token is missing, add it to `main.css` and use it, rather than writing the number in one place.
- **The same kind of thing looks the same on every screen.** A box in a page has the same padding and corners wherever it is, and a card title sits the same way on every card. Don't change these per page.
- **Reuse before you build.** Use the shared classes and components (`.btn`, `.chip`, `.card`, `.well`, `.field`, `.tag`, `.chead`, `Segmented`, `SwipePanels`, the app keypad, `AmountScreen`, `Icon`). A new control that does the job of an existing one must look like that one.
- **Depth comes from three tiers in `styles/depth.css`, never a shadow written in place.** Medium (`--d-float`) for things that float over the page, subtle (`--d-card`, `--d-control`, `--d-action`) for things on the page or pressed, light (`--d-sunk`, `--d-edge`) for fields and panels inside a card. A new control takes the tier of the control it looks like; charts, bars, list rows and dividers stay flat.
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
- **Swipes wrap like a carousel.** Past the last page is the first, both ways, in every pager (`SwipePanels`, `lib/carousel.ts`).
- **A filter row above page chips** (the exercise types over the muscle groups) uses ring chips (`.chip.ring`): no fill, a thin ring, a stronger ring and primary ink when picked. Two rows of filled chips would read as one control.
- **Chips that name swipe pages** (`PageChips`) share the row equally, so a count never moves them, and mark the page with one pill that slides with the swipe instead of a colour jump. When chips name the pages, the dots stay but are visual only (`quiet-dots`).
- **One action, one icon.** The same action uses the same icon everywhere it appears (Add food's tabs and the + fan share theirs). A segmented option takes an icon with `icon` in `Segmented`'s options, 16px beside its label.
- **A button inside a field** (Scan in the search field) is a `.btn.sm` with its word, not a bare icon, so it doesn't read as part of the field. Its face sits as far in from the field's end as from its top.
- **Rings of buttons** (the + fan) hold up to five to a page, 27° apart; a shorter page is centred on the ring, never stretched to fill it. Dots for the pages sit inside the ring, and the cog straight below them, halfway to the ×; their 44px hits touch but don't overlap. A new action starts off the fan, in the "+ button" sheet's "Not in the fan", never as a sixth spot. A drag turns the page with the finger, as `SwipePanels` does: the incoming page dims until it has more of the turn, and buttons fade before they reach the tab bar.
- **Lists you reorder** use the shared drag list (`lib/rowDrag.ts` with `.drag-list`, `.drag-line`, `.drag-row` and `.grip` in `main.css`): a grip on the left that drags at once, a 400ms hold anywhere else on the row, ↑/↓ on the grip, rows sliding aside, and the move read out. A place a row can't go opens no gap and its heading says why.
- **Long lists inside a card** show five rows, then scroll inside the card. A thin bar and a fade show that there is more.
- **Numbers are typed on the app keypad** on a touch screen, never on the phone's number pad.
  - In a table of fields (the workout's set table) the keypad sits in the sheet's footer only while a field is focused, labelled with what it types ("Set 2 · kg"), with **Next** and **Done**. The cells are `--control-chip` tall; a value not typed yet shows as a tertiary placeholder hint.
- **Settings for occasional use** go behind the cog. Anything new on Home gets its own on/off switch in Settings → Home sections; the week strip always stays.
- **Pickers with an automatic choice** (time zone, food country) put the automatic option first as its own radio row, then the search, then the list. Picking a row by hand stops the automatic choice until it is picked again, and the Settings row says which it is ("Follows the time zone", "Set by hand"). When the automatic choice changes on its own, a toast says so with a Change action that opens the picker.
- **Toasts** say what happened in one line, the same way everywhere: what was done, then the detail after a `·` ("Added 150 g Kylling · 165 kcal"). Every add and delete has Undo, except Settings → Reset data, which can't be undone and asks first in an inline confirm in its card (`role="alertdialog"`, the safe choice "Keep" as the primary button); a failure goes through `toastError` (alert icon, no button). They sit at the bottom, above the lowest bar, so a new bottom bar or keypad in a sheet gets `data-toast-floor`. Never move a sheet's content to make room for one.
- **Muscles are drawn with the one body map** (`MuscleMap`): main muscles in the action colour, helping ones in a mix of it (the `--muscle-*` tokens), and the muscles always named beside it in words, never by colour alone.
- **Hints are subtle.** Show that something can be changed, or that something is new, with a small cue (a pencil, a dot, a tint), not with extra text.

## Mocks

- Mock first for anything visible, with a recommendation, before building.
- Mocks use the real app's components, text sizes, spacing and copy. A card that already exists appears as it really looks, not as a sketch of it.

## Before a PR with UI changes

1. Every new size, gap, corner and colour is a token.
2. Each new control has the same face height, padding and icon size as the existing control of its kind. Screenshot them side by side: a new pill next to "Done" or "Log weight", a new switch next to Goal's.
3. Every tap target is at least 44px.
4. Nothing moves when switching modes, swiping, or loading, or when a value is empty or long.
5. Check it at the phone width (390px), at the largest text size, and in one non-Mono accent. Don't reuse the class `.preview` or `[data-nutrient-card]` for anything else: `main.css` pins their type near the default size at the largest text size, so the rest of the sheet would grow around them. To check the largest text size, set the system text size (or `html { font-size: 30px }` in a stylesheet), not an inline style on `<html>`: an inline size hides a scoped rule that resizes the root.
6. In a scoped style, write a text-size rule as `html.dt-xl .thing { … }`, never `:global(html.dt-xl) .thing`: Vue compiles that to a bare `html.dt-xl { … }`, which styles the root instead (a test fails on it).
7. The README describes the new behaviour, and this file has any new rule.
