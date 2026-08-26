# THE ISAIART DESIGN SYSTEM

**VECTOR — the flat design language for the isaiart.com app pages**

> "THE RULE: everything is DRAWN, not built." — `assets/vector.css`

As of **2026-08-20**. Shared assets ship at `?v=10` on eleven of the twelve pages; `connect/` runs them at `?v=11` and `docs/docs.css` is at `?v=9`. Versions are per-file and per-page — see §14.

This is the working guide to the language the app pages are built in. It is not a rulebook and it is not exhaustive. It is a record of the decisions that have already been made, why they were made, and which of them you can walk away from without the page stopping being part of this site.

### How to read the markers

Four labels, always as a standalone line beginning with the word in caps.

| Marker | Means | If you break it |
|---|---|---|
| **FLOOR** | Accessibility or correctness. | It is a bug. Fix it. |
| **LOAD-BEARING** | Identity. The whole system rests on it. | The page reads as a different site wearing this one's colours. |
| **CONVENTION** | Consistent everywhere, costless to break. | Nothing breaks. Say why in a comment. |
| **FREE** | Yours. Vary it, invent inside it, argue with it. | Nothing to break. |

**Unmarked text is CONVENTION by default.** It records what the pages do. Depart from it with a why-comment and you are still inside the system. §17 collects everything that is outright free in one place — read it before you decide this document has fenced you in.

**The conflict rule: when a FLOOR item and a LOAD-BEARING item collide, the floor wins,** and you note the trade in a comment. `docs/` lowering its touch targets to 38px is the shipped example of doing this the other way round, knowingly, with the reason written down.

**Where an argument goes:** into the file, as a why-comment naming the alternative you rejected and the measurement that killed it (§11). That is how every rule in here got made, and it is the only route by which this document changes.

**Where numbers live:** §2 (tokens), §7 (geometry and spacing) and §9 (the size ladder). Everywhere else cites the token name. If you find the same number written twice, one of them is stale — **§2 wins.**

---

## 0. The five-second index

Every row answers in the cell. The section number is where the reasoning is.

| I need to know… | Answer |
|---|---|
| Which pages this governs | The twelve that link `vector.css`. The root `index.html` and `404.html` are a different language — §1 |
| Page canvas / panel / recessed field | `--ground` `#0a0b0d` · `--panel` `#0e1013` · `--well` `#08090b` (dark); `#dcd9d0` · `#e5e2d9` · `#eeece4` (light) — §2 |
| Default border colour | `--rule` `#23272e` dark, `#b4b0a3` light. Written `var(--hair) solid var(--rule)` — §2 |
| Body ink | `--ink` `#d7dbe2` dark, `#262a2f` light — §2 |
| Ink for prose you have to read | `--hint-ink` `#7f8794` / `#52565e`. **Never `--ink-faint`** — that is furniture at 3.6:1 — §2 |
| The six stripe bands | `--s1` `#e5484d` · `--s2` `#ff6b35` · `--s3` `#ffb000` · `--s4` `#4ade80` · `--s5` `#3dd6c4` · `--s6` `#4c9aff`. Same in both themes — §4 |
| What colour is a warning | `--alert` = `--s1` `#e5484d`. Danger key, red LED, toast `.bad` left border — §2 |
| What colour is "good" | `--ok` = `--s4` `#4ade80`. Green LED, toast default left border — §2 |
| What colour is a focus ring | `--s6` `#4c9aff`, on every page, never `--accent` — §10 |
| What does the accent do | Nine to eleven marks change together off one `:root` line. One band per page — §3 |
| Border radius | `0`. `--r: 0px`. Everywhere — §7 |
| Shadows | None. `box-shadow: none`, restated, not omitted. One inset exception — §7 |
| The universal gap | `12px`. Page, rack columns, hub grid, work grid, sticky offset — §7 |
| How long does a state change take | `--snap`, `70ms linear`. Things that travel get `--slide`, `140ms cubic-bezier(0.2, 0, 0.1, 1)` — §8 |
| Why my transition has a delay | You wrote `transition: x 160ms var(--snap)`. `--snap` carries its own duration — it must be the **first** time value — §8 |
| Why my `[hidden]` element still shows | `.rack`, `.note` and `.opt` set `display`. Ship `[hidden] { display: none !important }` — §6 |
| What font is a label | IBM Plex Mono, `--label-size` `0.665rem`, `--label-track` `0.18em`, uppercase, weight 500 — §9 |
| What font is a heading | `--f-display` Chakra Petch, weight 600, `0.1em`. `.designation` and index numerals only — §9 |
| Which layer owns this | Tokens+primitives `vector.css` · composition `console.css` · runtime `cassette.js`/`console.js` · one accent line, your page — §1 |
| How do I make a new page | Copy the head and skeleton, change three strings, pick a band — §14 |
| What am I actually allowed to invent | More than you think — §17 |
| Where is `.seg-ctl` / `.chk` / range / readout | §5, with the modal and the z-index ladder |
| What can I call from JS | `CAS` and `SRCH` — §16 |

---

## 1. Scope, and two philosophies

### Which pages this governs

`vector.css` governs **twelve pages**, all of them app sub-pages:

`coinflip/` · `connect/` · `cutout/` · `dice/` · `docs/` · `halftone/` · `pixelate/` · `search/` · `search/x/` · `search/bluesky/` · `search/threads/` · `vhs/`

**The site's front door is a different design language and is out of scope.** The root `index.html` and `404.html` link no `/assets` stylesheet at all — grepping either for `vector.css`, `console.css` or `cassette` returns nothing. They are self-contained pages with their own inline `:root`:

| Front-door token | Value |
|---|---|
| `--bg` | `#06070b` |
| `--panel` | `rgba(7,8,13,0.44)` |
| `--rule` | `rgba(255,255,255,0.10)` |
| `--white` | `#f4f4f2` |
| `--accent` | `#8fb4ff` |

Set in Barlow and Barlow Condensed, with no light theme. **Four token names collide with vector's — `--panel`, `--rule`, `--rule-hi`, `--accent` — at different values and with different meanings.** Nothing in this guide describes those two pages, and nothing in those two pages should be copied into a page that links `vector.css`, or the reverse.

The repository also holds a long tail of standalone pages — games, one-off tools, experiments — that are in neither language. This guide does not govern them either. **The test is the `<link>`: if the page loads `assets/vector.css`, this document applies to it; if not, it does not.**

**LOAD-BEARING** — a new page decides which language it is in before it decides anything else, and the decision is visible in `<head>`.

### Two philosophies, one class API

There were meant to be two stylesheets: `cassette.css` (moulded plastic, bevels, screws, tape reels, a CRT that glows) and `vector.css` (a drawing of that machine). They were designed to share a class API exactly so a page could swap languages by swapping one `<link>`.

**`cassette.css` was never built.** It is not a file: `assets/` holds `STYLE.md`, `cassette.js`, `console.css`, `console.js`, `icon.svg` and `vector.css`, and nothing else. The skeuomorphic philosophy survives only as a compatibility alias block inside vector, where its depth vocabulary is preserved by name and collapsed in value:

From the source:
```css
--phos-glow: transparent;   /* nothing glows */
--bevel: 0px;
--screen: var(--well);
--screen-deep: var(--well);        /* identical, so no well can form */
--chassis-hi: var(--ground-2);     /* nearly identical to --chassis-lo, */
--chassis-lo: var(--panel);        /* so no gradient can form */
--r-key: var(--r);                 /* 0px */
```

That is the point. Markup written for the skeuomorphic language renders flat with zero changes.

The reference is **the graphic side of the era, not the industrial one**: NASA technical manuals, wireframe vector displays, plotter output, Vignelli-grade colour bands. Nothing here pretends to be an object.

**The four sub-rules, verbatim from the source:**

1. structure is a 1px hairline, never a bevel
2. emphasis is a flat colour block, never a highlight
3. depth does not exist; hierarchy comes from contrast and spacing
4. a control is a labelled rectangle that inverts, not a cap that travels

**LOAD-BEARING** — all four. Everything below is an elaboration of these.

### The layer cake

| Layer | File | Owns |
|---|---|---|
| Tokens + primitives | `assets/vector.css` | Colour, geometry, motion, type tokens. `.chassis`, `.key`, `.screen`, `.field`, `.led`, `.rocker`, `.stripe`, `.tape`, `.seg`, `.seg-ctl`, `.chk`, `.meter`, `.label`, `.designation`, `.prose`, `.panel-modal`, range inputs, utilities, and the reduced-motion / forced-colors / print floors. No width media queries at all. |
| Composition | `assets/console.css` | Nothing new. Arranges the primitives into a console: page frame, masthead, channel strip, readout, racks, dock, footer, hint prose. Adds two legibility tokens — `--hint-ink` and `--fld-ink` — and raises `--label-size`. |
| Runtime | `assets/cassette.js` (`CAS`) | Theme, toast, seven-segment, copy/paste/download, boot-once, page wipe, globe, braille, service worker. |
| Runtime | `assets/console.js` (`SRCH`) | Clock, scope, theme switch, the whole query-terminal contract. Depends on `CAS`, never the reverse. |
| Page | `<yourpage>/index.html` | One `--accent` line, page-local layout, page-local devices. |

**The page-local test:** if a second page would plausibly want it, it belongs in `console.css`. If no second page could want it, it is page-local. `console.css` says the same thing from the other side:

> "Nothing here invents a new visual device; this file only arranges the existing ones into a console."

**FREE** — whether you load `console.css` at all. `connect/` deliberately loads only `vector.css` and `console.js`, because "this is a game, not an instrument panel, and it should feel like somewhere you sit down." Half-loading is a real move, not a mistake.

Know what you give up. Without `console.css` you lose `--hint-ink`, the `--label-size` bump to `0.665rem`, `--fld-ink`, and the entire page frame — `.page`, `.rack`, `.dock`, `.net-nav`, the masthead. `connect/` had to re-implement the theme icons by hand (13px, plus its own `:root:not([data-theme]) .ico-moon` arm) and still loads `console.js` for `SRCH.themeSwitch`. It also still calls `CAS.bootOnce($('headScreen'))`, `SRCH.clock($('clock'))` and `SRCH.scope($('scope'))` for elements its markup no longer has — the subtraction was done in the HTML and not in the boot sequence. If you half-load, audit the boot sequence too.

---

## 2. Tokens

### Ground — flat, no vignette

| Token | Dark | Light | Job |
|---|---|---|---|
| `--ground` | `#0a0b0d` | `#dcd9d0` | Page canvas, `body` background, page-wipe fill |
| `--ground-2` | `#101216` | `#d3d0c6` | Raised / hover fill. **Hover is a fill change, nothing else.** |
| `--panel` | `#0e1013` | `#e5e2d9` | Panel body — `.chassis`, toast, modal sheet, dock |
| `--well` | `#08090b` | `#eeece4` | Recessed field — `.screen`, `.field`, `.seg`, meter track, checkbox interior |
| `--paper` | `#e9e6df` | `#16181c` | `.printout` stock. Inverts across themes — it is a sheet of paper, not a surface |

Three fills for the machine, and because there is no shadow, **depth is communicated purely by which of the three a region takes.**

**LOAD-BEARING** — the `--ground` / `--panel` / `--well` ladder is the only depth cue in the system.

### Hairlines — the only structural device

| Token | Dark | Light | Job |
|---|---|---|---|
| `--rule-lo` | `#191c21` | `#c9c5b8` | Faintest — the 32px minor grid, list separators, decorative |
| `--rule` | `#23272e` | `#b4b0a3` | Default structural border on every panel, control, field |
| `--rule-hi` | `#333942` | `#8b8779` | Emphasis — hover borders, LED outlines, toast and modal-sheet borders, unlit index numerals |

`--hair` is `1px`. Borders are written `var(--hair) solid var(--rule)`, never `1px solid`. That is not pedantry — it means one edit changes every edge on the site.

**CONVENTION** — and not universal. It holds throughout `console.css` and the four tool pages. `connect/` writes literal `1px solid var(--rule-lo)` on `button.t`, `.pick`, `.pick label + label`, `.strip` and `kbd`; `vector.css`'s own `forced-colors` block writes literal `1px`/`2px` because system keywords are the point there. Use the token; know that two places do not.

### Ink

| Token | Dark | Light | Job |
|---|---|---|---|
| `--ink` | `#d7dbe2` | `#262a2f` | Primary text, headings, active/filled labels |
| `--ink-soft` | `#939aa5` | `#55595f` | Secondary — `.label`, `.prose`, resting `.key` |
| `--ink-faint` | `#656c77` | `#767a82` | **Furniture only.** Unlit numerals, rules, disabled. Measures 3.6:1 — under the floor. |
| `--hint-ink` | `#7f8794` | `#52565e` | Reading prose. Measured 5.3:1 on `--panel` in both themes. From `console.css`. |
| `--fld-ink` | — | — | Not a colour. A per-field switch: `.fld` sets it to `var(--ink)` when the field is filled, and `.label` reads `var(--fld-ink, var(--ink-soft))`. §6. |

> "vector.css spends `--ink-faint` on two very different jobs: furniture that is meant to recede, and PROSE THE USER HAS TO READ. At 3.6:1 it is under the 4.5:1 floor, and the hints are the most numerous text on the page — so the reading text gets its own token."

**FLOOR** — prose gets `--hint-ink`, furniture gets `--ink-faint`. Never the other way round.

Note the light value is a separate measurement, not the dark one lightened — "a grey that reads as *quiet* on near-black is nearly invisible on paper."

### Display phosphor — the readout ink

| Token | Dark | Light | Job |
|---|---|---|---|
| `--phos` | `#ffb000` | `#7a4a00` | `.screen` text, `.phos`, rocker `.rock`, meter fill, seg bars, `.field` caret |
| `--phos-dim` | `#b07b06` | `#7a5108` | Operator chips, `<code>` in notes, list ticks |
| `--phos-faint` | `#5c4108` | `#c8b88e` | Declared and unused in CSS. The light value exists for parity. Nothing reads it — treat it as unproven. |

> "Amber on paper is illegible, so the display colour becomes the pigment a plotter would actually have laid down."

Note `--phos-dim` is *lighter* than `--phos` in light mode. The dim/bright relationship there is warmth-based, not luminance-based. That is deliberate; don't "fix" it.

### Shaded solids — for canvas only

| Token | Dark | Light |
|---|---|---|
| `--solid-lo` | `#0c0d10` | `#f4f2ea` |
| `--solid-hi` | `#2a2d34` | `#c4bfb0` |

> "The lit and unlit ends of a shaded facet, for anything drawing solids into a canvas — the dice and the coin sample these so their shading follows the theme instead of being hardcoded dark."

No CSS rule reads these. They exist as a contract with JS canvas code (§13). If you draw solids, read these two and walk between them.

### Geometry, motion, type

| Token | Value |
|---|---|
| `--r` | `0px` |
| `--hair` | `1px` |
| `--snap` | `70ms linear` |
| `--slide` | `140ms cubic-bezier(0.2, 0, 0.1, 1)` |
| `--f-display` | `'Chakra Petch', 'Eurostile', 'Bahnschrift', sans-serif` |
| `--f-mono` | `'IBM Plex Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace` |
| `--label-size` | `0.625rem` in vector, **raised to `0.665rem` by `console.css`** |
| `--label-track` | `0.18em` |

### Semantic aliases

| Alias | Resolves to | Used for |
|---|---|---|
| `--accent` | `var(--s3)` `#ffb000` by default | See §3 for the canonical list of everything it drives. |
| `--alert` | `var(--s1)` `#e5484d` | `.key-danger`, `.led.on.red`, `.phos-red`, toast `.bad` |
| `--ok` | `var(--s4)` `#4ade80` | `.led.on.green`, toast default left border |
| `--s6` | `#4c9aff` | The focus ring, on every page. **Also available as a channel accent** — four pages take it. See the collision note in §3. |

**LOAD-BEARING** — `--alert` and `--ok` are the only two colours with fixed meaning across every channel. A page may not re-point them.

### The compatibility aliases that do not retheme

The alias block preserves the skeuomorphic vocabulary, and **some of it is hardcoded and will not follow the theme.** These are the dangerous half:

`--amber` `#ffb000` · `--amber-dim` `#b07b06` · `--green-dim` `#2b8f52` · `--tape-ink` `#0a0b0d` · `--alert-dim` `#4a1712`

Also declared, also legacy: `--chassis-edge`, `--chassis-deep`, `--screen-edge`, `--travel`, `--green`, `--cyan`, `--caution`, `--tape`.

**Reach for the themed token, not the alias.** `--amber` looks identical to `--phos` in dark mode and stays amber on paper, where `--phos` correctly becomes `#7a4a00`. The aliases exist so old markup runs, not so new markup uses them.

### Light theme in one sentence

> "Not an inversion of the dark palette but the other half of the same reference… light mode is the drawing as it came off the plotter — warm white stock, graphite ruling, and the same six bands of ink. Nothing glows, because nothing is lit."

The light theme was deliberately pulled back from maximum contrast:

> "The first pass ran `#16181c` on near-white stock — 16:1, which is a lot of glare for a page you sit in front of. Warm graphite on toned paper still clears AA comfortably at ~11:1 and stops the whole thing shouting."

**LOAD-BEARING** — light mode is toned stock, not white. `--ground` is `#dcd9d0`, not `#fff`.

Light does **not** redefine `--s1`–`--s6`, `--accent`/`--alert`/`--ok`, `--r`, `--hair`, `--snap`, `--slide`, the faces, or the label metrics. One licensed exception exists and it is `docs/`'s paper — §15.

---

## 3. The accent swap

This is the single page-level idea in the whole system, and it is one line.

```css
/* Channel 01 runs on the amber band. */
:root { --accent: var(--s3); }
```

| Page | `--accent` | Colour | Loads |
|---|---|---|---|
| `search/` (hub) | `--s3` | `#ffb000` amber — "the index belongs to no channel, so it keeps the house amber" | vector + console |
| `search/x/` | `--s3` | `#ffb000` | vector + console |
| `search/bluesky/` | `--s6` | `#4c9aff` | vector + console |
| `search/threads/` | `--s2` | `#ff6b35` | vector + console |
| `coinflip/` | `--s3` | `#ffb000` | vector + console |
| `dice/` | `--s4` | `#4ade80` | vector + console |
| `cutout/` | `--s6` | `#4c9aff` | vector + console |
| `pixelate/` | `--s5` | `#3dd6c4` | vector + console |
| `halftone/` | `--s6` | `#4c9aff` | vector + console |
| `vhs/` | `--s2` | `#ff6b35` | vector + console |
| `docs/` | `--s6` | `#4c9aff` — "drafting blue, for the terminal that draws documents". Set in `docs.css`, not an inline block. | vector + console + `docs.css` |
| `connect/` | *(none)* | Sets no `--accent` at all and inherits the default `var(--s3)`. It declares `--p1`, `--p2`, `--board`, `--hole`, `--halo`, `--on-accent` instead. | vector only (+ `console.js`) |

### What the one variable drives

Canonical list. Everything below changes together when you change that line:

1. `.key:active`, `[aria-pressed="true"]` and `.latched` — background and border
2. `.key-go` — resting fill and border
3. `.field:focus` — border colour
4. The filled-field inset bar (`inset 2px 0 0`)
5. `.chk input:checked + .box` — fill and border
6. `.seg-ctl input:checked + span` — fill
7. `.net-nav .net[aria-current="page"]` — the 3px bottom band
8. `.net-ix` on the selected channel
9. `.rack:focus-within` — the 3px left spine
10. `.rack-ix` on the focused rack
11. Range thumb fill; page-local accent bars (`.busybar`, `.conf-bar`, `.prog i`); `.sl.moved .val`

**LOAD-BEARING** — every page picks exactly one band and takes it from the stripe. **CONVENTION** — a one-line `:root` block with a comment saying which channel it is. The comment earns its keep; where in the style block it sits does not.

**FREE** — which band. Pick one that isn't already loud on a neighbouring page. Note `--s6` now carries four of the twelve.

### The `--s6` collision, stated plainly

`--s6` is the focus ring on every page (§10) **and** the channel accent on `search/bluesky/`, `cutout/`, `halftone/` and `docs/`. On those four channels the ring and the accent are the same blue, so a focused key and a latched key are not distinguishable by hue alone.

This is accepted, not solved, and the reason is that the alternative is worse: a ring that follows `--accent` disappears against a latched amber or orange key on the other eight pages. The mitigation is that focus and latch differ by **shape** — the ring is a 2px outline at a 1px offset *outside* the border box, the latch is a solid fill *inside* it — and latched state also carries `aria-pressed`. If you are adding a ninth page, prefer a band other than `--s6` and the question does not arise.

### What "one line" actually means

`:root { --accent: … }` is the *entire* page-local style block of `search/x/` and `search/bluesky/`. It is not the whole story elsewhere:

- `search/threads/` adds three rules: `[hidden] { display: none !important; }` (see §6), `.mode-rack .rack-body { gap: 10px; }`, and `@media (min-width: 720px) { [data-panel="native"] { column-count: 2; } }`.
- Markup is **not** identical across the three terminals either. `search/threads/` mounts two entirely different rack sets behind a MODE switch (`data-panel="native"` 01–02 versus `data-panel="web"` 01–03, plus an em-dash MODE rack) and uses its own id scheme (`tQ`, `tTarget`, `wAll`, `wEngine`). `search/x/` has a page-local `#geoBtn` / `#geoStat` control neither of the others has.

The honest version of the claim: **three products on one composition and one class API, differing by an accent line, a rack set and a compile function.** That is still the point; it is just not byte-identity.

---

## 4. The stripe

> "The stripe. Six flat bands, the identity mark of the whole system."

| Band | Hex | Informal |
|---|---|---|
| `--s1` | `#e5484d` | red |
| `--s2` | `#ff6b35` | orange |
| `--s3` | `#ffb000` | amber |
| `--s4` | `#4ade80` | green |
| `--s5` | `#3dd6c4` | teal |
| `--s6` | `#4c9aff` | blue |

Markup is always exactly six empty `<i>` elements, no classes, coloured by `:nth-child`:

Copy:
```html
<span class="stripe brand-stripe" aria-hidden="true">
  <i></i><i></i><i></i><i></i><i></i><i></i>
</span>
```

**LOAD-BEARING** — the stripe never re-tints with the theme. Identical values in dark and light. "It is the identity mark; a mark that changes colour with the lights is not a mark."

**LOAD-BEARING** — always six bands, always in order s1→s6, always empty `<i>`, always `aria-hidden="true"`.

The bands are numbered, not named. Their meaning is ordinal position in the mark, not hue. Semantic names (`--accent`, `--alert`, `--ok`) are layered on top as separate aliases.

**FREE** — thickness and deployment. The four deployments in use:

| Variant | Geometry | Where |
|---|---|---|
| `.brand-stripe` | `height: 5px; max-width: 230px;` bands `flex: 1 1 0; min-height: 5px` | Under the wordmark |
| `.dock-stripe` | `position: absolute; top: -3px; height: 3px;` bands `flex: 1 1 0; min-height: 0` | Straddling the dock's top border |
| `.stripe-bar` | Full-width 3px bar; bands `flex: 1 1 0; height: 3px; min-height: 0` | A section rule that is also the mark |
| `.page-wipe-edge` | `width: 6px; right: -6px;` a flex column of six `flex: 1 1 0` | The leading edge of the page transition |

The default `.stripe i` is `width: 10px; min-height: 12px` — a vertical spine. The bar variants override to `flex: 1 1 0` so the six divide the width evenly, and zero `min-height` to get under 12px.

The page transition is branded with the same mark: "a flat sweep led by the six-band stripe. Same mark the pages are branded with, used as the transition."

---

## 5. Devices

`.chassis` · `.key` · `.led` · `.screen` · `.field` · `.seg-ctl` · `.chk` · range · `.rocker` · `.tape` · `.seg` · `.meter` · `.readout` · `.readout-toast` · `.panel-modal` · `.rule` — then, at the end, the ones nothing uses.

Every one of these follows the same recipe: **background fill + 1px hairline border + `border-radius: 0` + `box-shadow: none`.** Only the fill token and the rule token vary.

### `.chassis` — the panel

> "Was moulded plastic; now a ruled region."

From the source:
```css
.chassis {
  position: relative;
  background: var(--panel);
  border: var(--hair) solid var(--rule);
  color: var(--ink);
}
.chassis::after { display: none; }   /* kill the moulding grain */
```

Every top-level block on a page is a chassis: header, readout, each rack, each note, the footer, hub cards. It is always the **first** class, then the role class: `chassis page-head`, `chassis rack`, `chassis stage`, `chassis page-foot`.

**FREE** — what goes inside.

### `.key` — the control

> "A control is a labelled rectangle. It inverts; it does not travel."

From the source:
```css
.key {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.5em;
  min-height: 28px; padding: 0.35em 0.75em;
  font-family: var(--f-mono);
  font-size: var(--label-size);
  font-weight: 500;
  letter-spacing: var(--label-track);
  text-transform: uppercase;
  color: var(--ink-soft);
  background: transparent;
  border: var(--hair) solid var(--rule);
  border-radius: var(--r);
  transition: color var(--snap), border-color var(--snap), background var(--snap);
}
```

| State | Treatment |
|---|---|
| `:hover` | `color: var(--ink); border-color: var(--rule-hi); background: var(--ground-2)` |
| `:active` / `[aria-pressed="true"]` / `.latched` | `color: #0a0b0d; background: var(--accent); border-color: var(--accent); transform: none` |
| `:focus-visible` | `outline: 2px solid var(--s6); outline-offset: 1px` |
| `[disabled]` | `opacity: 0.35; cursor: not-allowed` |
| `(pointer: coarse)` | `min-height: 44px` |

`transform: none` on `:active` is written explicitly, with the comment "no travel — this is not a cap". It exists to *assert* zero displacement.

Variants:

| Class | What |
|---|---|
| `.key-sq` | 28×28, padding 0. Icon only. SVG child is 14×14. |
| `.key-danger` | `color: var(--alert)`; resting border `color-mix(in srgb, var(--alert) 45%, var(--rule))`; hover and active both fill solid alert with `#0a0b0d` text. The only `color-mix` in `vector.css`. |
| `.key-go` | Dock primary. `flex: 1 1 auto; max-width: 420px; min-height: 40px; color: #0a0b0d; background: var(--accent); border-color: var(--accent); font-weight: 600`. **Hover swaps the fill to `--ink`, not a brighter accent** — the button gets whiter, not more saturated. Disabled empties out to transparent / `--rule` / `--ink-faint`. |
| `.key-lbl` | Wraps the droppable half of a two-word label. `display: none` below 560px. |

`.key` is used interchangeably as `<a>` and `<button>`. That is fine.

**LOAD-BEARING** — `#0a0b0d` appears literally as the knockout ink on any accent fill, rather than as `var(--ground)`, so it stays dark in the light theme too.

Scoped size overrides, as shipped — the ladder for controls inside a dense context:

| Context | Size |
|---|---|
| `.ribbon .key`, `.ribbon .key-sq`, `.stage-bar .key`, preset chip, rail tab | 26px |
| Alt chip, zoom key, disclosure key | 24px |
| `(pointer: coarse)`, house default | 44px |
| `(pointer: coarse)`, `docs/` ribbon and head-ctl only | **38px — a knowing trade, not a default** |

### `.led` — the indicator

> "A flat marker, not a bulb."

7×7px. `border-radius: 0` written **literally**, not `var(--r)` — a round indicator would be a bulb. Transparent with a `--rule-hi` hairline when off.

| State | Fill + border |
|---|---|
| `.on` | `--s3` |
| `.on.green` | `--ok` |
| `.on.red` | `--alert` |
| `.blink` | `mark-blink 1.4s steps(1, end) infinite` — a square wave, never a fade. Off state is opacity **0.2, not 0** — the mark never disappears from the drawing. |

**LEDs do not follow the channel.** `.on` is `--s3` on every page, so a plain lit LED on `dice/` (green channel) is amber, not green. If you want the channel colour, that is not an LED.

**FLOOR** — an LED is always beside a text label. `PWR`, `READY`, `ARMED`, `IDLE`, `SAVED`, `NO BACKEND · NOTHING LEAVES THE BROWSER`. Status is never colour alone.

### `.screen` — the display

From the source:
```css
.screen {
  background: var(--well);
  border: var(--hair) solid var(--rule);
  color: var(--phos);
  font-family: var(--f-mono);
  overflow: hidden;
  box-shadow: none;
}
.screen::before, .screen::after { display: none; }
```

> "No scanlines, no vignette — a vector display draws lines, it doesn't glow."

`.bezel` is a no-op wrapper now — transparent, no border, no padding, no shadow. It survives only so markup can move between languages. Wrap a screen in one out of habit; it costs nothing.

Phosphor text utilities: `.phos`, `.phos-dim`, `.phos-red` re-theme. `.phos-amber` (`#ffb000`) and `.phos-green` (`#4ade80`) are hardcoded and do **not** re-theme — know that before you reach for them.

### `.field` — input

From the source:
```css
.field {
  width: 100%; padding: 0.5em 0.65em;
  font-family: var(--f-mono);
  font-size: 0.8rem;
  color: var(--ink);
  background: var(--well);
  border: var(--hair) solid var(--rule);
  border-radius: var(--r);
  outline: none;
  box-shadow: none;
  caret-color: var(--phos);
}
.field::placeholder { color: var(--hint-ink); }
.field:focus        { border-color: var(--accent); }
textarea.field      { line-height: 1.5; }
select.field option { background: var(--panel); color: var(--ink); }
```

`console.css` override: `font-size: 0.85rem`, argued as "12.8px mono is small for something you type into and re-read." A hero input can go to `0.95rem`.

Focus is **a colour change, not a ring.** This is the one component whose focus indication is not an outline, and it is deliberate — a ring around a full-width field reads as a second border.

`select.field` strips native appearance and **draws** its arrow from two gradients:

From the source:
```css
background-image:
  linear-gradient(45deg,  transparent 50%, var(--ink-soft) 50%),
  linear-gradient(135deg, var(--ink-soft) 50%, transparent 50%);
background-position: calc(100% - 14px) 52%, calc(100% - 9px) 52%;
background-size: 5px 5px, 5px 5px;
padding-right: 26px;
```
No SVG, no font glyph. Consistent with "everything is DRAWN". `option` must be re-coloured explicitly or the native list renders unstyled.

### `.seg-ctl` — the segmented control

A radio group drawn as one bordered bar of butted cells. This is the house answer to "pick one of three or four".

From the source:
```css
.seg-ctl { display: flex; flex-wrap: wrap; border: var(--hair) solid var(--rule); }
.seg-ctl label { flex: 1 1 0; min-width: 62px; display: flex; cursor: pointer; }
.seg-ctl label + label { border-left: var(--hair) solid var(--rule); }
.seg-ctl span {
  flex: 1 1 auto; display: flex; align-items: center; justify-content: center;
  padding: 0.5em 0.4em; min-height: 30px;
  font-size: var(--label-size); font-weight: 500; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--ink-soft);
  transition: color var(--snap), background var(--snap);
}
.seg-ctl input:checked + span { color: #0a0b0d; background: var(--accent); }
.seg-ctl input:focus-visible + span { outline: 2px solid var(--s6); outline-offset: -2px; }
@media (pointer: coarse) { .seg-ctl span { min-height: 42px; } }
```

Dividers come from the adjacent sibling, never from a wrapper — same rule as the channel strip, and for the same reason: no double hairlines.

Markup conventions:

- `role="radiogroup"` with `aria-labelledby` pointing at the visible `.label`'s id.
- The **first option is the neutral one** and carries `checked`.
- `value=""` means "emit nothing" — the neutral option contributes no operator.
- Option words are one-word caps: `ANY` / `DEFAULT` / `TOP` / `ANYONE`.

### `.chk` — the checkbox

From the source:
```css
.checks { display: flex; flex-wrap: wrap; gap: 8px 14px; }
.chk { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
.chk .box {
  width: 13px; height: 13px; flex: none;
  background: var(--well);
  border: var(--hair) solid var(--rule-hi);
  transition: background var(--snap), border-color var(--snap);
}
.chk:hover .box               { border-color: var(--ink-faint); }
.chk input:checked + .box     { background: var(--accent); border-color: var(--accent); }
.chk input:checked ~ .label   { color: var(--ink); }
.chk input:focus-visible + .box { outline: 2px solid var(--s6); outline-offset: 2px; }
```

Markup order is fixed: `input`, `span.box`, `span.label`. The input is visually hidden but focusable — see §10.

**The label lifts with the box.** That is the same coordinated-mark idea as filled-vs-empty in §6: state is never carried by one mark alone, and never by brightness alone.

### Range inputs — the slider

The most-reset control in the system. Both vendor track and thumb are rewritten, and `border-radius: 0` is asserted on both thumb pseudo-elements because the UA default is a circle.

From the source:
```css
input[type="range"] {
  -webkit-appearance: none; appearance: none;
  width: 100%; background: transparent; cursor: pointer;
}
input[type="range"]::-webkit-slider-runnable-track { height: 2px; background: var(--rule-hi); }
input[type="range"]::-moz-range-track              { height: 2px; background: var(--rule-hi); }
input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 12px; height: 12px; margin-top: -5px;
  background: var(--accent); border: 0; border-radius: 0;
}
input[type="range"]::-moz-range-thumb {
  width: 12px; height: 12px;
  background: var(--accent); border: 0; border-radius: 0;
}
input[type="range"]:focus-visible { outline: 2px solid var(--s6); outline-offset: 2px; }
input[type="range"]:disabled      { opacity: 0.35; cursor: not-allowed; }
```

The row it lives in is tighter than a generic `.fld` — label and live value share one line, track underneath:

```html
<div class="sl">
  <div class="sl-top">
    <label class="label" for="dot">DOT SIZE <span class="val op" id="dotVal">6 px</span></label>
  </div>
  <input type="range" class="rng" id="dot" min="1" max="40" value="6">
</div>
```

**`.sl.moved` is a reusable house pattern and it belongs beside filled-vs-empty.** When a slider leaves its preset the row marks itself twice: the label lifts `--ink-soft → --ink` and the value lifts `--phos → --accent`. A panel of twenty sliders then shows at a glance which four you actually moved.

```css
.sl.moved .label { color: var(--ink); }
.sl.moved .val   { color: var(--accent); }
```

**CONVENTION** — and a good one. Any control with a meaningful default should be able to say it is off it.

### `.rocker` — two-state switch

40×18px, transparent, hairline border. The input is visually hidden with `position: absolute; opacity: 0; width: 0; height: 0` — **not** `display: none`, so it stays focusable and in the tab order. `.rock` is a 50%-width block filled `--phos` that `translateX(100%)` on `:checked`. Focus ring lands on `.rock` via the adjacent-sibling selector, so focus is never lost.

Used site-wide for exactly one thing: the theme switch.

### `.tape` — printed label

> "A label printed as a solid colour block. Replaces the dymo tape."

`background: var(--s3); color: #0a0b0d;` mono, `--label-size`, weight **600** (one step heavier than `.label`), `--label-track`, uppercase. Variants `.tape-alt` (`--s2`) and `.tape-cool` (`--s5`) are defined; no page currently uses either.

Usually `READ ME` on a note panel, and it stays amber even on a blue or orange channel — the note is a house annotation, not part of the channel. **One exception in the wild:** `vhs/` uses `<span class="tape">NO GPU</span>` inside its `.nosupport` panel. The tape is a printed label, not a fixed string; it is just that "READ ME" is what a house annotation says.

Note the layout trap, already solved: `.note { align-items: flex-start; }`, because "without this the tape is a flex item at default `stretch` and grows into a tall colour block down the side of the panel. It is a label; it should be the height of its own text."

### `.seg` / `.seg-digit` — numerals

> "Numerals are set, not simulated."

Seven bars drawn as 1px flat rules at `opacity: 0.08` off and `1` on, inside a ruled box with `font-variant-numeric: tabular-nums`. `CAS.segInit(el, count)` builds it; `CAS.segSet(el, value)` right-aligns and space-pads. Overflow shows a full row of dashes — a real instrument's out-of-range display. `SEG_MAP` includes `'E': 'adefg'`, an error character, in the tradition of the hardware being imitated.

**FLOOR** — `segInit` sets `aria-hidden="true"` on the container. The real value must live elsewhere in the DOM.

### `.meter` — progress

3px tall, `--well` track, hairline border, fill in `--phos`, `transition: width var(--slide)`. The only width animation in `vector.css`.

There is a thickness grammar worth keeping (from the tool pages):

| Thickness | Meaning |
|---|---|
| 2px accent bar pinned inside a stage's top edge (`.busybar`) | the picture is being computed |
| 3px phosphor `.meter` in a rack | a file is downloading |
| 4px accent bar in a rack (`.conf-bar`) | a measured confidence |

**CONVENTION** — bar thickness tells you what kind of number it is.

### `.readout` — the compiled output

The panel a query terminal writes into. Missing from every earlier draft of this guide despite `qOut`/`uOut` being required ids.

From the source:
```css
.readout      { padding: 0; overflow: hidden; }
.readout-body { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px 14px; }
.readout-row  { display: grid; grid-template-columns: 62px 1fr; gap: 10px; align-items: start; }
.readout-row .label { padding-top: 7px; }     /* optical: aligns the cap-height to the first line */
.q-screen, .u-screen {
  padding: 7px 10px; min-height: 2.4em; max-height: 8.5em; overflow-y: auto;
  white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.6;
}
.q-screen { font-size: 0.82rem; color: var(--phos); }
.u-screen { font-size: 0.72rem; color: var(--ink-soft); }
.q-screen.empty, .u-screen.empty { color: var(--hint-ink); }
```

Copy:
```html
<pre class="screen q-screen empty" id="qOut" aria-live="polite">Fill anything in — the query assembles as you type.</pre>
```

At 480px the row goes to one column and the label moves above the screen, so `padding-top` is cleared (§7).

`max-height: 8.5em` with scroll is deliberate — "so a 40-operator query cannot push the racks off the fold." The `.empty` class is a *state*, not a colour choice: it says the text you are reading is placeholder prose, not an answer.

### `.readout-toast` — the notification

Fixed, `left: 50%; bottom: 20px`, z-index 900. Rests at `translateY(6px)` at opacity 0, rises to `translateY(0)` at opacity 1 with `.up`. A 6px lift — the largest positional move any component makes.

Built by `CAS.toast(message, isError)`. Singleton. Timing: 140ms in, 2200ms hold, 140ms out. Repeated calls extend rather than stack.

The built markup is `div.readout-toast[role="status"][aria-live="polite"]` containing a `span.led.on.green` (or `.on.red`) **and** the message span, with `.bad` toggled on the container.

Status is carried three ways at once: the LED beside the text, a 3px coloured left edge (`--ok`, or `--alert` with `.bad`), and the wording itself. **It is not a background tint and not an icon-only signal.**

**CONVENTION** — toast copy is uppercase, short, and states what happened. `QUERY COPIED`, `URL COPIED`, `CONSOLE CLEARED`, `NOTHING TO SEARCH`, `POPUP BLOCKED — COPY THE URL`, `STORAGE FULL — EXPORT THIS DOCUMENT`.

### `.panel-modal` — the dialog

From the source:
```css
.panel-modal {
  position: fixed; inset: 0; z-index: 1000;
  display: flex; align-items: center; justify-content: center;
  background: rgba(5, 6, 8, 0.82);          /* hardcoded — the scrim does NOT retheme */
}
.panel-modal .sheet {
  max-width: 340px;
  background: var(--panel);
  border: var(--hair) solid var(--rule-hi);
  animation: sheet-in 120ms linear both;
}
```

The scrim staying dark in light mode is intentional and worth knowing before you file it as a bug: it is the room going dark, not the paper.

`docs/` builds nine dialogs on this base and the anatomy it settled on is reusable:

| Part | Contents |
|---|---|
| `.sheet-head` | index numeral · `.designation` · `.spacer` · a `.key-sq` close |
| `.sheet-body` | the only scroller in the sheet |
| `.sheet-foot` | see the grammar below |

Three widths — **380 / 520 / 660px** — and `max-height: 88vh` on all of them.

**Footer grammar:** destructive `.key-danger` first, then `.spacer`, then `CANCEL` as a plain key, then the affirmative as `.key.latched`. A read-only dialog gets a single `CLOSE` after a spacer and nothing else.

### The z-index ladder

| z | What |
|---|---|
| `-1` | Both grid layers |
| `700` | Menu sheet |
| `750` | Palette |
| `780` | Rail drawer |
| `800` | Dock |
| `900` | Toast |
| `1000` | Modal |
| `2000` | Page wipe |

**LOAD-BEARING** — nothing invents a value outside this ladder. A new floating surface takes an existing rung or argues for a new one in a comment.

### `.rule` — divider

```html
<div class="rule" aria-hidden="true"></div>
```
`height: var(--hair); background: var(--rule)`. Inside a `.rack-body` it takes `margin: 2px 0`. Use it when one card holds two ideas.

### Suppressed hardware

```css
.screw, .vents, .reel { display: none !important; }
```
> "Hardware furniture has no place in a drawing."

### Defined but unused

Both of these are real, shipped and correct. **No page currently uses either.** They are here so you know they exist, not so you feel obliged.

**`.hazard`** — caution ruling.
```css
background-image: repeating-linear-gradient(45deg, var(--s1) 0 6px, transparent 6px 12px);
```
6px band, 6px gap, 12px period. Drawn flat, like everything else.

**`.printout`** — tractor-feed paper. `background: var(--paper)`, text hardcoded `#16181c`, padding 12px 24px, with 14px sprocket strips down both edges drawn as a `repeat-y` radial gradient at opacity 0.25. `--paper` inverts across themes.

---

## 6. Composition

`.page` · masthead · theme icons · `.net-nav` · `.racks` / `.work` · `-ix` numerals · `.op` · filled-vs-empty · `.fld`/`.pair`/`.trio` · `.hint` · `.note` · `.dock` · `.page-foot` · utilities · the two collisions

### The page skeleton

Copy:
```html
<main class="page">
  <header class="chassis page-head">
    <div class="head-row"> … </div>
    <nav class="net-nav"> … </nav>          <!-- optional; the header's LAST child, outside .head-row -->
  </header>
  <div class="work"> … </div>               <!-- or <div class="racks"> -->
  <section class="chassis note wide"> … </section>
  <footer class="chassis page-foot"> … </footer>
</main>
<div class="dock"> … </div>                 <!-- OUTSIDE main -->
```

`.page` is `max-width: 1240px; min-height: 100dvh; padding: 14px 12px 96px; display: flex; flex-direction: column; gap: 12px`. The 96px bottom padding is dock clearance — a page with no dock drops it to 14px. `100dvh`, not `vh`, so mobile browser chrome does not clip it.

**LOAD-BEARING** — the dock is a sibling of `<main>`, never a child. It is `position: fixed`, and `.dock-inner` shares `.page`'s 1240px max-width so its controls sit on the same measure as the content above them.

### Masthead

Identical across every terminal except the designation, the strapline, `aria-current`, and `data-no-save` on `#themeSw` — and occasionally the head-well's contents. `docs/` re-tightens nine of its measurements (§15) and swaps the head-well; `connect/` has no masthead at all.

Copy:
```html
<header class="chassis page-head">
  <div class="head-row">
    <div class="brand">
      <h1 class="designation">DICE</h1>
      <span class="stripe brand-stripe" aria-hidden="true">
        <i></i><i></i><i></i><i></i><i></i><i></i>
      </span>
      <span class="label">RANDOMISER 01 &middot; d4 &rarr; d100 &middot; TRUE SOLIDS</span>
    </div>

    <div class="bezel head-well">
      <div class="screen" id="headScreen">
        <div class="well-row">
          <span class="phos" id="clock" role="timer" aria-label="System clock">--:--:--</span>
          <canvas id="scope" width="120" height="28" aria-hidden="true"></canvas>
        </div>
      </div>
    </div>

    <div class="head-ctl">
      <div class="lamp"><span class="led on green" aria-hidden="true"></span><span class="label">PWR</span></div>
      <div class="phos-sw theme-sw">
        <svg class="theme-ico ico-moon" …>…</svg>
        <label class="rocker">
          <input type="checkbox" id="themeSw" aria-label="Light or dark theme" data-no-save>
          <span class="rock"></span>
        </label>
        <svg class="theme-ico ico-sun" …>…</svg>
      </div>
    </div>
  </div>
</header>
```

`.head-row` is a three-state grid:

| Width | Template | Arrangement |
|---|---|---|
| base | `1fr` | brand / well / controls stacked, source order |
| ≥540px | `1fr auto` | brand top-left, controls top-right, well spanning row 2 |
| ≥900px | `auto minmax(210px, 1fr) auto` | all three on one line, well takes the slack, never below 210px |

**LOAD-BEARING** — wordmark over colour bar, left-aligned, never centred. `.brand .designation` is `clamp(0.98rem, 3.2vw, 1.28rem)` at `line-height: 1`.

**CONVENTION** — `#themeSw` carries `data-no-save` on every terminal, so the theme is never captured into a page's shared-link state.

**FREE** — the strapline. It is a run of two or three uppercase clauses joined by `&middot;`, and the fullest form is `SERIAL NN · RANGE · CLAIM`. Plenty of pages ship a shorter version and that is fine: `QUERY TERMINAL 01 · X.COM/SEARCH` drops the claim, `NINE ENGINES · ALPHA MATTING · DECONTAMINATION` drops the serial. What is not free is the register — uppercase, tracked, no sentence.

**FREE** — the head-well's contents. It is normally clock + scope. `docs/` puts an editable title field in it — a bare input in `--phos` with a `SAVED / SAVING / NOT SAVED` LED beside it — and that works.

### Theme icons — symbols, not words

> "A moon and a sun flanking the switch, rather than the words DARK and LIGHT. The pair reads at a glance in any language and takes about a third of the width, which matters because this sits in the header of every page."

14×14, `stroke-width: 1.4`, `stroke-linecap: round`, `--ink-faint` at rest, `transition: color var(--slide)`. The moon is filled (`fill: currentColor; stroke: none`); the sun is a 1.4px outline. Lit state is pure CSS off the root attribute — no JavaScript keeps the icons in sync:

From the source:
```css
:root[data-theme="dark"]  .ico-moon { color: var(--phos); }
:root[data-theme="light"] .ico-sun  { color: var(--phos); }
:root:not([data-theme])   .ico-moon { color: var(--phos); }  /* pre-lit, no first-paint flicker */
```

Paths, verbatim:
```html
<!-- moon -->
<path d="M13.2 10.6A5.8 5.8 0 0 1 5.4 2.8a5.8 5.8 0 1 0 7.8 7.8Z"/>
<!-- sun -->
<circle cx="8" cy="8" r="3.1"/>
<path d="M8 .8v2M8 13.2v2M.8 8h2M13.2 8h2M2.9 2.9l1.4 1.4M11.7 11.7l1.4 1.4M13.1 2.9l-1.4 1.4M4.3 11.7l-1.4 1.4"/>
```

### Channel strip

`.net-nav` is the **header's last child**, after `.head-row`, inside `<header class="chassis page-head">`.

From the source:
```css
.net-nav {
  display: flex; align-items: stretch; flex-wrap: wrap; gap: 0;
  margin: 16px -20px 0; padding: 0 20px;      /* bleed to the chassis walls */
  border-top: var(--hair) solid var(--rule);
}
.net-nav .net {
  flex: 1 1 auto; min-width: 96px; min-height: 40px;
  border: 0; border-right: var(--hair) solid var(--rule);
  border-bottom: 3px solid transparent;
}
.net-nav .net:first-child { border-left: var(--hair) solid var(--rule); }
.net-nav .net[aria-current="page"] {
  color: var(--ink); background: var(--ground-2);
  border-bottom-color: var(--accent);
}
```

- `gap: 0` — cells butt.
- Right border on every cell, left border on the first only. **Never double hairlines.**
- The negative margin plus matching padding is what bleeds it edge-to-edge while keeping cells on the header's gutter. Re-tune both at the small-screen breakpoint — 14px there, not 20px (§7).
- **FLOOR** — selected state is `[aria-current="page"]`, never an `.is-active` class, and it changes ink, background **and** the band. Not colour alone.
- The unnumbered entry (the hub) gets `&mdash;` where a number would go. It is not a channel.

**The unstated cost of a new channel:** every terminal's `.net-nav` hard-lists all its siblings. Adding a page means editing every existing sibling's markup, not just writing the new one. Budget for it.

### Racks

A rack is one card of controls, numbered.

Copy:
```html
<section class="chassis rack">
  <div class="rack-head">
    <span class="rack-ix" aria-hidden="true">01</span>
    <span class="designation rack-name">WORDS</span>
    <span class="spacer"></span>
    <button class="key" id="clearLog">CLEAR</button>   <!-- optional trailing action -->
  </div>
  <div class="rack-body">
    <div class="fld">
      <label class="label" for="xAll">ALL OF THESE <span class="op">a b c</span></label>
      <input class="field" id="xAll" placeholder="cyberpunk poster">
      <span class="hint">A space means AND.</span>
    </div>
  </div>
</section>
```

`.rack` carries a **3px `border-left` colour spine** that is `--rule` at rest and lights to `--accent` on `:focus-within` — along with the rack numeral. That is the only "you are here" affordance in a control column, and it works for keyboard and mouse identically.

The head's right slot takes exactly one of three things: a status lamp pair, a live label, or a single key. Not two.

**LOAD-BEARING — racks are CSS multi-column, not grid.** This is the most load-bearing layout decision in the system and it has its measurements in the comment:

> "Multi-column, NOT grid. A grid row is as tall as its tallest cell, so a short rack next to a long one leaves a card-shaped hole beneath it — with racks this uneven (WORDS is ~590px, ENGAGEMENT ~430px) the page was more hole than panel. Columns pack each rack directly under the one above it, which is what a real rack does."

From the source:
```css
.racks { column-count: 1; column-gap: 12px; }
@media (min-width: 720px)  { .racks { column-count: 2; } }
@media (min-width: 1080px) { .racks { column-count: 3; } }
.racks > *       { break-inside: avoid; margin-bottom: 12px; }
.racks > .wide   { column-span: all; }
```

`break-inside: avoid` is non-negotiable — "half a card at the foot of one column and half at the head of the next is unreadable." The 12px `margin-bottom` stands in for the row-gap grid used to provide.

**FREE** — the tool pages use a different frame entirely and that is legitimate: a two-column `.work` grid of `[fixed control column] [fluid stage]`, with `.stage { order: -1 }` on mobile so the picture comes first, and `order: 0; position: sticky; top: 12px` from 900px up. Control columns there are `.controls { display: flex; flex-direction: column; gap: 12px }` with `.controls .rack { break-inside: auto; margin: 0 }` to undo the column-flow rules.

### Index numerals

The `-ix` suffix means index numeral. Three scales, all `--f-display` at weight 700, all starting unlit in `--rule-hi` or `--ink-faint` and igniting to the channel colour:

| Class | Size | Where |
|---|---|---|
| `.net-ix` | inherits `--label-size` | Channel strip |
| `.rack-ix` | `0.95rem`, line-height 1 | Rack head |
| `.net-card-ix` | `2.4rem`, absolutely positioned top 14 / right 18 | Hub card |

**LOAD-BEARING** — numbers are zero-padded two digits and always `aria-hidden="true"`. The zero-padding is the visual: `01` and `1` are different marks.

**CONVENTION** — sequential from 01, one run per page. `docs/` deliberately restarts the sequence for its dialogs (bays 01–06, comments rail 07, dialogs back to 01–09) because they are a second coordinate space, not a continuation. That is a legitimate departure and it is documented in §15.

A block that is not part of a numbered run gets an em dash.

Rack names are short uppercase nouns: `WORDS`, `ACCOUNTS`, `ENGAGEMENT`, `TIME`, `MEDIA & LINKS`, `SOURCE`, `SIGNAL`, `LEVELS`, `GLOW`, `NOISE`, `FRAME`, `SCREEN`, `TONE`, `INK`, `LINEWORK`, `DIE`, `THROW`, `HISTORY`, `TALLY`.

**CONVENTION — rack order is pipeline order, and `01 SOURCE` is always the file picker on a tool page.** Three of the four tool pages end in `OUTPUT` (cutout at 07, pixelate and halftone at 06); `vhs/` ends at `06 FRAME` and keeps export in the dock only. Ending in OUTPUT is the norm, not a requirement — a page whose only output is a download can say so in the dock.

### The operator chip

> "The operator a field compiles to, printed beside its name. This is the thing that turns the console into documentation."

From the source:
```css
.op {
  font-family: var(--f-mono); font-size: 0.62rem; font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: none;          /* the operator is literal syntax */
  color: var(--phos-dim);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
```

It sits inside the `.label` on the same baseline (`.fld > .label { display: flex; align-items: baseline; gap: 8px }`). It is the single most characteristic detail on the site.

On tool pages the same slot holds a **live value with units**, and the static HTML ships the correct default so the page reads right before JS runs: `512 px`, `6%`, `0.060`, `1e-6`, `1×`, `28 px`.

**FREE** — whether your fields have operators. **CONVENTION** — if a field compiles to something, print it.

### Filled vs empty

> "The console is mostly placeholders, and a placeholder that only differs from a real value by brightness is unreadable as a state: a page full of example text looks like a page full of answers."

From the source:
```css
input.field[placeholder]:not(:placeholder-shown),
textarea.field[placeholder]:not(:placeholder-shown) {
  box-shadow: inset 2px 0 0 var(--accent);   /* inset, so nothing reflows on the first keystroke */
}
.fld:has(input.field[placeholder]:not(:placeholder-shown)) { --fld-ink: var(--ink); }
.fld > .label { color: var(--fld-ink, var(--ink-soft)); transition: color var(--snap); }
```

Two coordinated marks: an accent bar down the field's inner edge and its label lifted to full ink. Now the eye can count the filled fields without reading any of them. Same shape as `.chk`'s checked label and `.sl.moved`.

**FLOOR** — the `[placeholder]` attribute in the selector. `:placeholder-shown` is FALSE for any control with no placeholder, so a bare `:not(:placeholder-shown)` lights every empty date field on the page. Requiring the attribute puts the mark exactly where the ambiguity is. Dates and selects opt out by having none — which is right, an empty date already reads as `mm/dd/yyyy`.

Note the `:has()` dependency: where `:has()` is unsupported the bar still draws but the label does not lift, which degrades to a brightness-only mark — the exact thing §12 refuses. See the browser baseline in §14.

### Field wrappers

```css
.fld   { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.fld > .label { display: flex; align-items: baseline; gap: 8px; }
.pair  { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.trio  { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
```
Both grids collapse to one column below 480px. `min-width: 0` on `.fld` is what stops a long `.op` chip from forcing the grid column wider than its share.

**CONVENTION** — a hint that describes a whole `.pair` sits *after* the grid as a sibling, not inside one of its cells.

### Hint prose

From the source:
```css
.hint {
  max-width: 46ch;
  font-size: 0.68rem; line-height: 1.6; letter-spacing: 0.015em;
  color: var(--hint-ink);
}
```

> "Hints are prose, and prose wants a measure. Left to run the full width of a 400px rack they set as one unbroken block of 10px mono, which is what made the racks read as a wall rather than as labelled fields."

**FLOOR** — capped at 46ch, in `--hint-ink`.

**CONVENTION** — sentence case, states a **consequence or a limit** rather than restating the label, and follows the control rather than preceding it.

**FREE** — the voice. Good hints from the codebase:

> "A space means AND."
> "There is no max operator — a ceiling is the minimum, negated."
> "Coordinates win over the place name when both are filled."
> "Each is thrown as its real solid — a tetrahedron, a cube, an octahedron, a trapezohedron, a dodecahedron, an icosahedron."
> "A fair coin drifts towards even, slowly and unevenly. A run of six one way is ordinary, not a sign of anything."
> "Left at zero on purpose… drawn-on scanlines are the single thing that most makes a 'VHS filter' look fake. It is here if you want it."

That last one is the house voice at full strength: the control exists, the default refuses it, and the hint says why.

Inline emphasis: `<strong>` for option names, `<em>` for stressed words, `<code>` or `.phos` for values, `<kbd>` for keys.

### The note panel

Copy:
```html
<section class="chassis note wide">
  <span class="tape">READ ME</span>
  <div class="note-body">
    <p>…</p>
  </div>
</section>
```

> "Where a page has to be honest about what a network cannot do."

`.note p` is `0.72rem / 1.7 / max-width 78ch` — "the READ ME panels run the full width of the grid, so they need a measure even more than the hints do — 90ch of 11px mono is unreadable as prose."

`border-left: 3px solid var(--s3)` — amber by default and independent of the channel. **Severity is the only thing that changes it:** `--s2` for caution, `--s1` for "this will not work here" (`vhs/`'s `NO GPU` panel).

**Placement** depends on the frame. On a `.racks` page it is the last child of the container, always `.wide` (`column-span: all`). On a tool page there is no `.racks` container, so it sits after the `.work` grid and before the footer. `cutout/` also nests a `.note warn` *inside* an engine drawer with `style="padding:10px 0 0;border-left:0"` — a scoped note is a legitimate move; it just stops being the page's READ ME.

### The dock

Copy:
```html
<div class="dock">
  <span class="stripe dock-stripe" aria-hidden="true">
    <i></i><i></i><i></i><i></i><i></i><i></i>
  </span>
  <div class="dock-inner">
    <button class="key key-go" id="goBtn">SEARCH X &rarr;</button>
    <button class="key" id="copyBtn">COPY <span class="key-lbl">QUERY</span></button>
    <button class="key key-danger" id="resetBtn">CLEAR</button>
    <span class="spacer"></span>
    <span class="label count" id="opCount">0 TERMS</span>
  </div>
</div>
```

> "The controls that actually fire. Fixed, because a builder this long should never make you scroll back to the top to run it."

`position: fixed; z-index: 800; padding: 9px 12px; padding-bottom: max(9px, env(safe-area-inset-bottom)); border-top: var(--hair) solid var(--rule-hi)`.

Below 560px, `.key-lbl` and `.count` go `display: none` — `COPY QUERY` shrinks to `COPY`, the term count disappears.

**CONVENTION** — the export/primary key ends in an arrow entity: `&rarr;` or `&darr;`.

**FREE** — the secondary action may be duplicated inline where the user is actually looking. `dice/` and `coinflip/` do it with `.throw-2` — 34px, deliberately shorter than the dock's 40px so it reads as the same action, not a competing one, and hidden below 520px so the dock is never competing with itself.

### The footer, and the standing claim

Copy:
```html
<footer class="chassis page-foot">
  <a class="key" href="../">&larr; INDEX</a>
  <a class="key" href="https://isaiart.com">ISAIART.COM</a>
  <div class="foot-right">
    <span class="row-tight">
      <span class="led on green" aria-hidden="true"></span>
      <span class="label">NO BACKEND &middot; NOTHING LEAVES THE BROWSER</span>
    </span>
  </div>
</footer>
```

`margin-top: auto` pins it to the bottom of the `.page` flex column on short pages. `.foot-right { margin-left: auto }`.

**The standing claim is an honesty rule, not a visual one.** Ten of the twelve pages carry it next to a lit green LED — `NO BACKEND · NOTHING LEAVES THE BROWSER`, `CRYPTO-RANDOM · NOTHING LEAVES THE BROWSER` (dice, coinflip), `STATIC · NO BACKEND · NOTHING LEAVES THE BROWSER` (the search hub). `connect/` and `docs/` do not. **Print it only if it is true, and never on a page that phones home.**

### Utilities

From the source:
```css
.row       { display:flex; align-items:center; gap:10px; }
.row-tight { display:flex; align-items:center; gap:6px; }
.stack     { display:flex; flex-direction:column; gap:8px; }
.spacer    { flex:1 1 auto; }
.busy      { opacity:0.5; pointer-events:none; }
.sr-only   { position:absolute; width:1px; height:1px; padding:0; margin:-1px;
             overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
```

### The two collisions

Both of these have already cost someone an afternoon. Neither is obvious.

**1. Page-local names must not collide with the shared sheet.** `.row` is a global. `connect/` had to rename its own `.row` to `.opt` after the inherited `align-items: center` shrank every control to content width inside a column flex box.

**LOAD-BEARING lesson:** any property the shared sheet would have set must be pinned explicitly anyway, even when you think you are not inheriting it.

**2. `[hidden]` loses to any class that sets `display`.** `.rack`, `.note` and `.opt` all set `display` in author origin, which beats the UA stylesheet's `[hidden] { display: none }`. An element with `hidden` on it stays visible.

**FLOOR** — any class that sets `display` ships a matching companion:
```css
[hidden] { display: none !important; }   /* the !important is doing real work */
```
`search/threads/` fixes it this way and says so in a comment. **`connect/` has the same bug unfixed** — its Strength picker never hides in two-player mode. If you set `display` on a class that anything toggles, write the companion in the same style block.

---

## 7. Geometry

> "Geometry — square. Rounding reads as a physical moulding."

`--r: 0px`. `--r-chassis`, `--r-key`, `--r-screen` all point at it. `--bevel: 0px`.

**LOAD-BEARING** — square. It is not a stylistic preference, it is the thing that makes the flat treatment cohere.

**LOAD-BEARING** — `box-shadow: none`. There is no depth. In 644 lines of `console.css` there is exactly **one** box-shadow, and it is the inset filled-field bar. The tool pages add one more — `inset 0 0 0 1px var(--accent)` on a soloed engine thumbnail. Both are inset; neither describes a light source.

Four widths, used consistently:

| Width | Job |
|---|---|
| 1px (`--hair`) | Every structural border |
| 2px | The filled-field inset bar; the `.busybar`; a row's leading-edge spine (`docs/`) |
| 3px | A panel's colour spine; the selected-channel band; the toast's status edge; the `.stripe-bar` |
| 4px | The `.conf-bar` — a measured confidence, the one thing thick enough to read as a quantity |

### The one page that left

`connect/` is the licensed exception, and it is cited in §1, §3, §6 and §14. Here is the whole of it in one place.

It rounds — 12px on the board, 2px on buttons, 50% on discs. It uses inset shadows for depth. It drops the display face, the masthead, the channel strip, the dock and `console.css` entirely. It sets no `--accent`. It writes literal `1px solid`. Its disc drop uses a third cubic-bezier with a deliberate overshoot.

None of that is a mistake, and none of it is precedent. **It stopped being a console and became a boxed game.** The exception proves the rule because it had to leave *all* of the rules at once — you cannot round the corners and keep everything else. If you round, know that you are leaving.

### Spacing

The rhythm is **7 / 10 / 12 / 14**, and **12px is the universal gap** — page, rack columns, rack margins, hub grid, well-row, work grid, sticky offset. That is the rule; the padding table below is the evidence.

| Component | Padding |
|---|---|
| `.seg` | `2px 6px` |
| `.readout-toast` | `7px 14px` |
| `.stage-bar` / `.dock` | `9px 12px` |
| `.rack-head` | `11px 14px` |
| `.readout-body` | `12px 14px 14px` |
| `.page-foot` | `13px 18px` |
| `.rack-body` | `14px` |
| `.page-head` | `16px 20px 0` |
| `.tray` (felt) | `22px 16px` |

**FREE** — invent within the rhythm. Nudging a value by a pixel to make an optical alignment land is not a violation; `.readout-row .label { padding-top: 7px }` exists for exactly that reason.

### Breakpoints

There is no single scale, and that is intentional — each breakpoint is chosen where the thing it governs actually breaks.

| Width | What moves |
|---|---|
| 480px | The small-screen block, values below |
| 520px | Inline duplicate action hidden (dice, coinflip) |
| 540px | `.head-row` → two columns |
| 560px | Dock drops `.key-lbl` and `.count` |
| 720px | `.racks` → 2 columns; mouse legend appears (pixelate); threads' native panel → 2 columns |
| 760px | Mouse legend appears (cutout, vhs) |
| 780px | Hub cards → 3 columns |
| 900px | `.head-row` → three columns; **tool stage returns to `order: 0` and becomes `position: sticky; top: 12px`** |
| 940–1000px | Tool-page work grid → two columns |
| 1080px | `.racks` → 3 columns |
| 1100px | Docs rails become drawers |

Below 900px the stage is `order: -1` and not sticky, so the picture comes first on a phone. At 900px and up it returns to source order and pins.

The 480px block, with its values, because "re-tune the bleed" is not an instruction:

```css
@media (max-width: 480px) {
  .page     { padding: 10px 8px 92px; }
  .page-head{ padding: 14px 14px 0; }
  .net-nav  { margin: 14px -14px 0; padding: 0 14px; }   /* bleed re-tuned to the new gutter */
  .readout-row { grid-template-columns: 1fr; gap: 4px; }
  .readout-row .label { padding-top: 0; }
  .pair, .trio { grid-template-columns: 1fr; }
}
```

And one capability query, which matters more than any of them:

```css
@media (pointer: coarse) {
  .key    { min-height: 44px; }
  .key-sq { width: 44px; min-height: 44px; }
  .seg-ctl span { min-height: 42px; }
}
```

**LOAD-BEARING** — `vector.css` has **no width media queries at all**. The primitives are capability-responsive; width is the composition layer's problem.

---

## 8. Motion

> "Motion — instant state changes, no easing theatre."

Two tokens carry almost everything:

| Token | Value | For |
|---|---|---|
| `--snap` | `70ms linear` | Every discrete state change: key colour/border/background, LED, rocker rock, checkbox, seg opacity, label ink lift, spine colour |
| `--slide` | `140ms cubic-bezier(0.2, 0, 0.1, 1)` | Things that actually travel or fade: toast opacity+transform, meter width, theme-icon colour |

**LOAD-BEARING** — `--snap` is **linear**. A control that eases feels broken. `trace-in`, `sheet-in` and both grid drifts are linear too.

### The `var(--snap)` footgun

`--snap` is `70ms linear` — a duration **and** an easing, in one token. In the `transition` shorthand the **second** time value is the delay. So:

```css
transition: color var(--snap);              /* correct — 70ms, linear, no delay */
transition: color 160ms var(--snap);        /* WRONG — 160ms, 70ms DELAY, linear */
```

Four rules in `connect/` ship with an unintended 70ms delay because of this.

**FLOOR** — `var(--snap)` and `var(--slide)` must be the **first** time value in the shorthand, never appended after an explicit duration. If you need a different duration, write the easing out: `transition: color 160ms linear`.

### Curves

`vector.css` declares exactly two: `--slide`'s `cubic-bezier(0.2, 0, 0.1, 1)` and the page wipe's `cubic-bezier(0.4, 0, 0.2, 1)`. `docs.css`'s `--ease` is a re-declaration of the first, not a third curve.

**One page adds a genuine third.** `connect/` runs its disc drop on `cubic-bezier(0.45, 0.05, 0.35, 1.12)` — y₂ = 1.12 is an **overshoot**, so the disc passes slightly below its slot and settles back. That is a physical object falling into a physical slot, on the page that left the console language entirely (§7).

**LOAD-BEARING, in the console language** — nothing springs, bounces, overshoots, scales up from nothing, or blurs. Every entrance is opacity plus a 4–10px translate.

### Timing — system tokens

| Duration | What |
|---|---|
| 70ms (`--snap`) | Every state change |
| 110ms (`--m-fast`, `docs.css`) | "a surface acknowledging you" |
| 120ms | `sheet-in` — the base `.panel-modal` fade in `vector.css` |
| 140ms (`--slide`) | Slide / meter / toast |
| 160ms (`--m-base`, `docs.css`) | "a surface arriving" |
| 160ms | `trace-in` (boot) — hardcoded, predates the token |
| 220ms (`--m-slow`, `docs.css`) | "a surface crossing the frame" |
| 220ms | The page wipe; `WIPE_MS = 220` in JS matches exactly |

**Which governs a modal?** 120ms is the `vector.css` base and still governs `.panel-modal` on a page that loads only vector and console. Where `docs.css` is loaded, `--m-base` (160ms) supersedes it for every surface that arrives, dialogs included. Do not mix the two on one page.

### Timing — observed in pages, not tokens

These are page-local values. **Do not treat them as system durations.**

| Duration | What |
|---|---|
| 90ms | `.busybar` / `.prog i` fill — cutout and halftone, hardcoded in the page style block |
| 120 / 130 / 160ms | `connect/` transitions |
| 212–422ms | `connect/`'s `--fall`, computed `170 + (ROWS - row) * 42` |
| 300ms | `slip` — a new history row (dice, coinflip) |
| 420ms | Count-up; the docs search-hit flash |
| 780 / 900ms | Dice tumble / coin flip |
| 1.4s | LED blink (`mark-blink`) |
| 1.7s | `connect/`'s new-game glow |
| 34s / 96s | Minor / major grid drift |

Non-visual timers, part of the same vocabulary: **120ms** debounce, **4000ms** blob revoke after a download, **60000ms** blob revoke after `openInTab`, **260ms** `.theming` class lifetime, **600ms** `.crt-on` lifetime, **2200ms** toast hold, **620ms** page-wipe failsafe.

The 90ms fill appearing in two pages is worth noting: a hardcoded duration that shows up twice is a token waiting to be declared.

### Keyframes

```css
@keyframes grid-drift       { from { transform: translate3d(0,0,0) }  to { transform: translate3d(32px,32px,0) } }
@keyframes grid-drift-major { from { transform: translate3d(0,0,0) }  to { transform: translate3d(256px,256px,0) } }
@keyframes trace-in  { from { opacity: 0 } to { opacity: 1 } }
@keyframes sheet-in  { from { opacity: 0 } to { opacity: 1 } }
@keyframes mark-blink { 0%,49% { opacity: 1 } 50%,100% { opacity: 0.2 } }
```

### The drifting engineering grid

Two fixed pseudo-layers at `z-index: -1`, the page's only structure.

From the source:
```css
body::before {           /* minor */
  inset: -80px;
  background-image: linear-gradient(var(--rule-lo) var(--hair), transparent var(--hair)),
                    linear-gradient(90deg, var(--rule-lo) var(--hair), transparent var(--hair));
  background-size: 32px 32px, 32px 32px;
  animation: grid-drift 34s linear infinite;
  will-change: transform;
}
body::after  {           /* major — every 8 cells */
  inset: -300px;
  background-size: 256px 256px, 256px 256px;
  opacity: 0.5;
  animation: grid-drift-major 96s linear infinite;
}
```

- The overscan (`-80px` / `-300px`) means the translated edge never swings into view.
- Each animation travels **exactly one cell**, so the loop is seamless.
- The rates are deliberately incommensurate: "Drifts at a different rate so the two never lock into one moiré plane."
- "at 34s that reads as drift rather than motion, which is the whole point."
- It lives on a fixed pseudo-layer, not on `body`, "so the drift is one cheap compositor job instead of a repaint of every scroll frame."
- `z-index: -1` is safe because `html` has no background of its own — `body`'s background-color propagates to the canvas.

**LOAD-BEARING.** The grid is the most identifying feature of the whole site.

### The page wipe

> "The cut between pages: a flat sweep led by the six-band stripe — the same mark the pages are branded with, used as the cut between them."

`.page-wipe` is `position: fixed; inset: 0; z-index: 2000`, appended to `document.documentElement` (not `body`, so it cannot be affected by body-level stacking or transforms). `aria-hidden="true"`, `pointer-events: none`.

States, in the order they occur:

| Class | Transform | Meaning |
|---|---|---|
| *(none)* | `translateX(0)` | covering — where an arriving page starts |
| `.out` | `translateX(100%)` | swept off right — the arrival animation |
| `.idle` | `display: none` | removed from the compositor once arrival is done |
| `.arm` | `translateX(-100%)`, `transition: none` | parked off-screen left, pre-position for leaving |
| `.in` | `translateX(0)` | the departure animation |

Both `.out` and `.in` run `transform 220ms cubic-bezier(0.4, 0, 0.2, 1)`.

**Three independent escapes from a covered viewport**, and all three matter: navigation fires on `setTimeout(go, 220)`, a belt-and-braces `setTimeout(go, 620)` guarded by a `went` latch, and a `pageshow` handler for bfcache restores — "A restored bfcache page must never keep a covering overlay."

The departure sequence contains a load-bearing forced reflow:

From the source:
```js
wipe.classList.remove('idle', 'out');
wipe.classList.add('arm');
void wipe.offsetWidth;              // commit the .arm position
wipe.classList.remove('arm');
wipe.classList.add('in');
```
> "Without the reflow the browser coalesces both writes and nothing moves."

The wipe **never fires** on: modified clicks, non-left buttons, `defaultPrevented` events, `target` other than `_self`, `[download]` links, hash-only hrefs, `mailto:`/`tel:`/`javascript:`/`blob:`/`data:`, cross-origin URLs, or same-page hash changes.

**LOAD-BEARING** — every page's inline script ends with `CAS.pageTransition()`, guarded as `if (window.CAS)`. And links that must fire the wipe have to be real `<a href>` — "a click handler calling `location.href` would skip it."

### Boot-once

`CAS.bootOnce(el)` adds `.crt-on` for 600ms; `.crt-on > *` runs `trace-in 160ms linear both`. Every direct **child** fades in; the container does not animate.

Once per **tab session**, keyed on `sessionStorage['isa.booted']` — so moving between pages does not re-run it. Skipped under reduced motion. If storage throws (private mode), the flag is treated as set: **storage failure means the animation is skipped, never repeated.**

### Reduced motion

**FLOOR.** Handled in six places: **two in CSS, four in JS.**

The CSS, both blocks:
```css
@media (prefers-reduced-motion: reduce) {
  .page-wipe { display: none !important; }          /* removed entirely, not shortened */

  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
  }
  body::before, body::after {
    animation: none !important;
    transform: none !important;
  }
}
```
> "The grid stays — it just stops moving. Parked at the origin rather than at the keyframe's end offset, so the ruling still lands on whole cells."

The four JS checks, and **their fallbacks are static, not blank**: the globe and the scope each paint one frame before the animation gate, so a reduced-motion user sees the instrument, just not moving; the dice draw at their final orientation; settle time becomes 0.

**FLOOR gotcha, discovered by `docs/`:** a zeroed *duration* is not a zeroed *delay*. If you use the `visibility 0s linear var(--m-base)` hand-off pattern for animated surfaces (§15), you must also clear `transition-delay: 0s !important` under reduced motion, or a closed menu lingers 160ms in the accessibility tree.

### Performance

- `will-change: transform` on both grid layers and `.page-wipe`.
- Canvas animations bind `visibilitychange` and stop when `document.hidden` — "an idle background tab has no business animating."
- Frame gates are chosen per instrument: 20fps for the globe ("20fps is ample", and it makes the motion read as drift), ~30fps for the scope.
- `requestAnimationFrame` is never trusted alone. Every animated path is backed by a `setTimeout` that paints the settled frame, because **rAF does not run in a hidden tab**. Dice's comment: "The timeout is not belt-and-braces, it is the correctness path."

---

## 9. Typography

Two faces in the chrome. That is the whole system.

| Token | Stack | Job |
|---|---|---|
| `--f-display` | `'Chakra Petch', 'Eurostile', 'Bahnschrift', sans-serif` | `.designation` and index numerals. **Nothing else.** |
| `--f-mono` | `'IBM Plex Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace` | `body` default and every other component |

`body { font-family: var(--f-mono) }`. Loaded at exactly six weights: Chakra Petch 500/600/700, IBM Plex Mono 400/500/600.

### Chrome is monospace. A document is not.

**LOAD-BEARING** — the machine is set in mono. Labels, keys, hints, notes, readouts, footers: all `--f-mono`, and the display face is the exception reserved for names and numerals.

**The boundary is the reading surface, and it is absolute.** `docs/` is the only page with a document in it, and inside `.leaf` the house rules stop:

```css
.doc {
  font-family: var(--doc-font, Georgia, 'Times New Roman', serif);
  font-size: var(--doc-size, 11pt);
  color: inherit;
}
```

> "Inside the sheet the house rules stop applying… a document is set in a reading face at a reading size."

Everything inside `.leaf` is re-declared rather than inherited — reading face, mixed case, **points** for every vertical measure, no tracking, `color: inherit` — so nothing tracked, uppercased or monospaced leaks onto the paper. Outside it, rem/px and the house mono.

That is the general answer to "my page contains a reading surface": **draw a hard boundary and re-declare everything inside it.** Do not try to make the chrome type gently become document type.

### The three registers

| Register | Class | Spec |
|---|---|---|
| **Display** | `.designation` | `--f-display`, weight 600, `letter-spacing: 0.1em`, uppercase, `--ink`, `text-shadow: none`. Size inherited from context. |
| **Label** | `.label` | `--f-mono`, `--label-size`, weight 500, `--label-track`, uppercase, `--ink-soft`. `.label-lite` drops to `--ink-faint`. |
| **Prose** | three distinct classes | See below — they are not interchangeable. |

| Prose class | Size | Leading | Tracking | Ink | Measure |
|---|---|---|---|---|---|
| `.hint` | 0.68rem | 1.6 | 0.015em | `--hint-ink` | 46ch |
| `.note p` | 0.72rem | 1.7 | — | `--ink-soft` | 78ch |
| `.prose` | 0.72rem | 1.7 | 0.01em | `--ink-soft` | none |

`.engraved` is `color: var(--ink); text-shadow: none` — the flat replacement for what used to be an engraved cap.

### The uppercase rule

**LOAD-BEARING** — everything that labels is uppercase and tracked. Everything that reads is sentence case and near-untracked.

**Tracking correlates inversely with size — except that large numerals go negative and large words go positive.** `.total` (digits) is `-0.01em` while `.verdict` (HEADS/TAILS) in the same slot is `+0.06em`, and `.brand .designation` is positive at the top of the scale because a masthead may be both the largest and the widest-tracked. That is what makes a small title read as a masthead.

The evidence:

| Tracking | What |
|---|---|
| `-0.02em` | `.stat-num` |
| `-0.01em` | `.total` |
| 0.01–0.015em | prose, hints |
| 0.06em | the operator chip (it is code, not a label); `.verdict` |
| 0.1em | `.designation`, clock, seg-ctl cells |
| 0.12em | rack names, toast |
| 0.18em | labels, keys, tape |

### Size ladder

| Size | Used by |
|---|---|
| 2.4rem | `.net-card-ix` |
| `clamp(0.98rem, 3.2vw, 1.28rem)` | `.brand .designation` |
| 0.95rem | `.rack-ix`, hero input |
| 0.85rem | `.field` (console override), `#clock` |
| 0.82rem | `.q-screen` |
| 0.78rem | `.rack-name` |
| 0.72rem | `.u-screen`, `.note p`, `.prose`, `.seg-digit` |
| 0.7rem | net-card list |
| 0.68rem | `.hint`, toast, matrix |
| 0.665rem | `--label-size` (console); 0.625rem in vector |
| 0.62rem | `.op` |

### Weights

**500** (label, key, toast, clock) and **600** (tape, designation, key-go). Index numerals at **700**. No 800 anywhere.

400 is loaded and is used, sparingly and on purpose, where a mono cap would over-emphasise a data cell: `search/`'s capability matrix sets `tbody th { font-weight: 400 }` and `connect/` sets `.foot b { font-weight: 400 }`. The rule is **500 is the floor for anything that labels**, not "400 does not exist."

### Numerals

`font-variant-numeric: tabular-nums` on **anything whose digits change in place**.

**FLOOR.** A counter that reflows as it ticks is a bug.

Confirmed sites: `#clock` and `.dock .count` (the only two in `console.css`); `.seg`; `.stat b`, `.gridout b`, `.total`, `.split b`, `.tally-row .n`, `.stepper output` on the tool and game pages; `.bay-ix`, `.sheet-ix`, `.tree-ix` in `docs.css`.

**It is *not* currently set on `.net-ix`, `.rack-ix` or `.net-card-ix`.** Those are static numerals that never tick, so nothing is broken — but do not assume the property is inherited from somewhere. If you build a numeral that changes, set it yourself.

### Suppression

`text-shadow: none` is restated on `.engraved`, `.label`, `.prose`, `.designation`, `.tape`, `.phos` and `.screen`. The file suppresses glow at every typographic site rather than relying on inheritance. Do the same in page-local CSS.

One licensed exception exists: the removable-swatch chip draws its `×` in `#fff` with `text-shadow: 0 0 3px #000`, because the glyph sits over an arbitrary user-chosen colour and must survive all of them. A text-shadow that guarantees legibility is not a glow.

### Entity conventions

| Entity | Use |
|---|---|
| `&middot;` | Separates clauses in a strapline, status or footer line |
| `&mdash;` | The index numeral for an unnumbered rack or nav entry; an empty-value readout |
| `&rarr;` | Ends every outbound or forward control |
| `&darr;` | Ends every export/download control |
| `&larr;` | Opens every back link |
| `&amp;` | Inside rack names — `MEDIA &amp; LINKS`, `ENGINE &amp; TIME` |
| `&minus;` / `+` | Stepper keys |

Empty-state glyphs are real Unicode, not ASCII: a true ellipsis, a true em dash.

---

## 10. Accessibility floor

**Everything in this section is FLOOR.** The system has already made these decisions; you do not need to re-litigate them, and when one of them collides with a look, the floor wins.

### Focus

| Component | Ring |
|---|---|
| `.key` | `2px solid var(--s6)`, offset `1px` |
| `.rocker .rock` (via `input:focus-visible + .rock`) | `2px solid var(--s6)`, offset `2px` |
| `.chk .box`, `.net-card` | `2px solid var(--s6)`, offset `2px` |
| `.seg-ctl span` | `2px solid var(--s6)`, offset `-2px` (inset — the cell is flush inside a bordered bar) |
| `input[type="range"]` | `2px solid var(--s6)`, offset `2px` |
| `.field` | **No ring.** `border-color: var(--accent)` instead. |

The ring is always `--s6`, never `--accent`, so it survives on the amber and orange channels. On the four `--s6` channels it collides with the accent by hue and is distinguished by shape — see §3. The offset encodes containment: inset where an outward ring would clip or collide, outward where it would not.

### Contrast, already decided

| Decision | Value |
|---|---|
| Reading prose | `--hint-ink`, 5.3:1 on `--panel`, measured separately in each theme |
| Furniture only | `--ink-faint`, 3.6:1 — under the floor, never for prose |
| Light body ink | `#262a2f` on `#dcd9d0`, ~11:1, deliberately pulled back from 16:1 |
| Label size | 0.665rem, not 0.625rem — "uppercase mono at 0.18em tracking needs more height than lowercase" |
| Field size | 0.85rem, not 0.8rem — "12.8px mono is small for something you type into and re-read" |
| Ink on accent | `#0a0b0d` literal, so the knockout stays dark in light theme |

### Hidden inputs stay focusable

```css
.rocker input, .chk input, .seg-ctl input, .pick input {
  position: absolute; opacity: 0; width: 0; height: 0;
}
```
**Never `display: none`, never `visibility: hidden`.** They stay in the tab order and in the accessibility tree, and the ring renders on the adjacent visible element via `+`.

### Touch

`(pointer: coarse)` raises `.key` to 44px and `.seg-ctl span` to 42px. A dense toolbar may lower this — `docs/` goes to 38px on its ribbon and head-ctl to fit six bays — but that is a knowing trade with the reason written down, not a default.

`-webkit-tap-highlight-color: transparent` on `.key`, `.chk`, `.seg-ctl label`. `touch-action: none` on a canvas you pan yourself; `touch-action: manipulation` on a play surface to kill double-tap zoom.

### State is never colour alone

- LEDs sit beside text (`READY`, `ARMED`, `PWR`).
- The current channel changes ink, background **and** the band.
- A filled field gets an inset bar **and** a label ink lift.
- A moved slider gets a label lift **and** a value recolour.
- A capability matrix has a visible legend.
- A toggle prints `ON` / `OFF` as well as setting `aria-checked`.
- A discarded die is both dimmed **and** parenthesised in the history.

### Semantics

| Pattern | Rule |
|---|---|
| Selection | `[aria-current="page"]`, never `.is-active` |
| Toggle | `aria-pressed`, and only when it is latched — a momentary "hold to compare" key has none |
| Disclosure | `aria-expanded` |
| Radio group | `role="radiogroup"` with `aria-labelledby` at the visible `.label`'s id, or `aria-label` when there is no visible label |
| Live output | `aria-live="polite"` on the readout |
| Clock | `role="timer" aria-label="System clock"` |
| Decoration | `aria-hidden="true"` on every stripe, LED, `-ix` numeral, `.rule` divider, scope canvas, theme SVG, and dummy key inside a card link |
| Disabled | The real `disabled` attribute, not a dimming class. `goBtn.disabled` and the ARMED/IDLE text are keyed to the same boolean so visual and semantic state cannot disagree. |
| Seven-segment | `aria-hidden="true"` — the real value must exist elsewhere in the DOM |
| Hiding | The `hidden` attribute, backed by `[hidden] { display: none !important }` — see §6 |

### Forced colors

`vector.css` ships a block for the primitives. Adopt it; if you invent a device that signals with colour alone, extend it.

```css
@media (forced-colors: active) {
  .key    { border: 1px solid ButtonText; }
  .rocker { border: 1px solid ButtonText; }
  .rocker .rock { background: ButtonText; forced-color-adjust: none; }
  .led    { border: 2px solid GrayText; }
  .led.on { background: CanvasText; border-color: CanvasText; forced-color-adjust: none; }
  .tape   { border: 1px solid CanvasText; }
  .stripe i { forced-color-adjust: none; }               /* the mark survives */
  .seg-digit i    { background: GrayText; forced-color-adjust: none; }
  .seg-digit i.on { background: CanvasText; }
}
```

The stripe and the lit states opt **out** of forced colours so the identity mark and the on/off distinction survive; unlit segments drop to `GrayText` so on/off stays distinguishable by more than colour.

### Print

`vector.css` has a print block: white ground, black ink and borders, `.tape` reduced to an outline, and `.led`, `.rocker`, `.seg`, `.meter`, `.readout-toast`, `.panel-modal` and both grid layers set to `display: none`.

If your page has a printed deliverable, **extend that block rather than replacing it.** `docs/` is the worked example and it is documented in §15.

### Theme

```js
document.documentElement.setAttribute('data-theme', theme);  // at parse time, before DOMContentLoaded
```
> "Apply immediately so the page never flashes the wrong theme."

> "Keep the browser chrome in step, or the address bar stays black over a white page on mobile." — `<meta name="theme-color">` is rewritten on every `setTheme`. Light `#eceae3`, dark `#0a0b0d`.

> "someone who picked light at noon should not be flipped to dark by their OS at dusk." — `prefers-color-scheme` is followed on a first visit only; once the switch is touched the stored choice wins.

> "The applied value is held in memory, not re-read from storage. Reading it back made the switch one-way wherever storage is blocked."

`color-scheme` is declared per theme so native controls and scrollbars follow.

---

## 11. Naming

The vocabulary is a rack-mount console you operate, not a document you read. Class names describe **hardware parts** even though nothing here is hardware.

| Name | Is | Why that word |
|---|---|---|
| `chassis` | A panel | It is the metal box the module lives in |
| `key` | A button | On this console you press keys, not buttons |
| `rack` | A card of controls | They stack like rack units |
| `dock` | The fixed action bar | The transport dock |
| `screen` / `bezel` / `well` | The display and its recess | You look *into* a well |
| `led` / `lamp` | An indicator | |
| `rocker` | A two-state switch | |
| `stripe` | The identity mark | Six bands |
| `tape` | A stuck-on label | It replaced a dymo tape |
| `phos` | Phosphor, the readout ink | Kept even in light mode, where nothing glows |
| `net` / `channel` | One of several pages of the same machine | Broadcast channel strip |
| `readout` | The compiled output | |
| `designation` | The machine's name in the display face | |
| `hair` | A 1px rule | |

Each hardware name is re-defined by a comment stating what it **was** and what it now **is**: "Was moulded plastic; now a ruled region." "Was a recessed CRT well; now simply a darker ruled field." **The vocabulary is kept; the substance is replaced.**

### Conventions

| Convention | Rule | Examples |
|---|---|---|
| State classes | Appended, lowercase, single-word, no `is-`/`has-` prefix | `.on`, `.latched`, `.open`, `.bad`, `.busy`, `.empty` — and others in the same shape |
| Variants | Hyphen suffix on the base | `.key-sq`, `.key-danger`, `.key-go`, `.key-lbl`, `.tape-alt`, `.label-lite`, `.stripe-bar`, `.phos-dim`, `.row-tight` |
| Anatomy | `-head` / `-body` / `-foot` | `.rack-head`/`.rack-body`, `.net-card-body`/`.net-card-foot`, `.page-head`/`.page-foot`, `.readout-body`, `.note-body`, `.sheet-head`/`.sheet-body`/`.sheet-foot` |
| `-ix` | An index numeral | `.net-ix`, `.rack-ix`, `.net-card-ix`, `.bay-ix`, `.sheet-ix` |
| `-row` | A flex or grid line | `.head-row`, `.well-row`, `.readout-row`, `.hub-quick-row` |
| `-inner` | A centring wrapper | `.dock-inner` |
| `-well` | A recessed container | `.head-well` |
| `-stripe` | The six-band mark | `.brand-stripe`, `.dock-stripe` |
| Abbreviation | Terse and consistent | `fld`, `chk`, `ctl`, `ix`, `lbl`, `op`, `sw`, `sl`, `phos`, `ico`, `seg`, `s1`–`s6` |
| Sub-elements | Unclassed `<i>` styled by position | `.stripe i:nth-child(1..6)`, `.meter i`, `.seg-digit i` — `<i>` as a semantically empty flat block, never for italics |
| Scope | Every override prefixed by its owner | `.dock .key-go`, `.net-nav .net` — nothing re-styles a primitive globally |
| Identity | `data-*` attributes, not classes | `data-net`, `data-theme`, `data-panel`, `data-mode`, `data-no-save`, `data-cmd`, `data-braille` |

### Command ids

`docs/` namespaces its actions as dotted ids on `data-cmd` — `doc.*`, `exp.*`, `ed.*`, `ins.*`, `fmt.*`, `blk.*`, `al.*`, `li.*`, `tbl.*`, `t.*`, `v.*` — shared by menu items and ribbon keys so **one dispatcher serves both**. Any page with more than a handful of actions wants this.

### Tokens are named by role, not value

Ground family, rule family, ink family, phosphor family, solid family. **The `-hi`/`-lo` suffix means "more/less contrast", not "lighter/darker"** — proven by the fact that both themes keep the same suffixes while inverting luminance. `--solid-lo` is `#0c0d10` in dark and `#f4f2ea` in light.

### JS

Two globals: `window.CAS` (shared runtime) and `window.SRCH` (terminal runtime). `SRCH` depends on `CAS`, never the reverse. Full surface in §16.

Storage keys are namespaced `isa.`: `isa.theme`, `isa.booted`, `isa.search.x`, `isa.docs.v1`.

Snapshot keys are prefixed by control kind so one flat map round-trips without ambiguity: `c:` checkbox, `r:` radio group name, `v:` everything else. A control marked `data-no-save` is skipped entirely — that is how `#themeSw` stays out of a shared link.

Legacy aliases are kept deliberately — `CAS.getPhosphor` → `getTheme`, `SRCH.phosphorSwitch` === `SRCH.themeSwitch` — "Old names, so a page that has not been ported yet still runs." The design's own history is preserved in the API surface.

### Comments

Comments explain **why**, in prose, in the author's voice — often several sentences, often naming the rejected alternative and the measurement that killed it. This is a house convention, not incidental, and it is the only mechanism by which anything in this document changes: **an argument with a rule lives in the file as a why-comment, not in a discussion somewhere else.**

The best comments in the codebase are records of bugs:

> "The hover wash has to sit ABOVE the face, not behind it." (a background on the parent paints under every positioned descendant)
> "Deliberately NOT a flex container." (as a row-direction flex parent it squeezed the single child to 40px)
> "0.3 sank the losing discs into the board and they read as empty slots." (so 0.52)
> "Keying the lamp to the term count lit ARMED next to a dead button."
> "width/height, not just inset. A canvas is a replaced element with an intrinsic size taken from its width/height ATTRIBUTES."

Write those down. They are the most useful thing in a file.

### HTML authoring

The markup uses box-drawing banner comments — `HEADER`, `READOUT`, `RACKS`, `NOTE`, `FOOTER`, `TRANSPORT DOCK` — with per-rack markers (`01 · WORDS`) and a heavier double rule for a mode panel. A 500-line page of racks is navigable because of them.

---

## 12. What the system refuses

Each of these is a rule with a reason, and the reason is the part that matters. The rules themselves live in the sections above; this is the list of things you will be tempted to add back.

| Refuses | Because |
|---|---|
| **Bevels** | "structure is a 1px hairline, never a bevel." `--bevel: 0px`; `--chassis-hi`/`--chassis-lo` collapsed so no moulded gradient can be constructed. |
| **Highlights as emphasis** | "emphasis is a flat colour block, never a highlight" |
| **Depth** | "depth does not exist; hierarchy comes from contrast and spacing." `box-shadow: none` is *restated* on every surface rather than merely omitted. |
| **Travel on press** | "a control is a labelled rectangle that inverts, not a cap that travels" — enforced by `transform: none` on `:active` |
| **Rounding** | "Rounding reads as a physical moulding" |
| **Glow** | `--phos-glow: transparent` `/* nothing glows */`. "Nothing glows, because nothing is lit." |
| **Scanlines and vignettes** | "a vector display draws lines, it doesn't glow" |
| **Simulated hardware** | Screws, vents and reels are force-hidden. The dymo tape became a printed block; the CRT well became a ruled field; the seven-segment became ruled bars. |
| **Easing theatre** | Two curves in the whole language, both close to linear |
| **Motion that reads as motion** | The grid is tuned to 34s/96s specifically so it registers as drift; transitions are 70–220ms so they register as state changes |
| **Gradients that describe a lit surface** | Gradients are permitted as **drawing tools** — the grid hairlines, the hazard ruling, the select arrow's two triangles, the printout's sprocket dots, the transparency checkerboard, `connect/`'s `.cell::after` mask. They are refused as **material**: the dice draw flat because "a gradient would be the first thing on this page pretending to be a real surface." The coin gets exactly two — a contact shadow and a face sheen — because "a coin is a material, and reflection is what a material is." The test is whether the gradient is drawing a shape or faking a light. |
| **Re-tinting the mark** | "a mark that changes colour with the lights is not a mark" |
| **Maximum contrast for its own sake** | Light was pulled from 16:1 to ~11:1 to cut glare while still clearing AA |
| **Grid for the racks** | Grid rows leave card-shaped holes under short cards |
| **Brightness-only state** | Every state carries two marks: bar plus ink lift, box plus label, band plus background |
| **`:not(:placeholder-shown)` alone** | It is false for any control with no placeholder — it would light every empty date field |
| **A border for the filled mark** | It would reflow on the first keystroke; an inset shadow does not |
| **Words on the theme switch** | Icons read in any language and take a third of the width |
| **JavaScript for the theme icons** | The same root attribute that repaints the page lights the icon |
| **Unbounded prose** | `.hint` at 46ch, `.note p` at 78ch, both with stated reasons |
| **Unbounded readouts** | `max-height: 8.5em` with scroll, so a 40-operator query cannot push the racks off the fold |
| **Making you scroll back up** | The dock is fixed and `.page` reserves 96px |
| **`display: none` on hidden inputs** | They stay focusable |
| **Double hairlines** | Right borders on every cell, left border on the first only |
| **Frameworks, build steps, dependencies** | Plain CSS, two globals, ES5-era vanilla JS, cache-busted with `?v=n` |
| **A backend** | State lives in `localStorage`. Geolocation is written straight into visible fields. The footer says so, on the ten pages where it is true. |
| **`innerHTML` for user-facing strings** | Toast text, readouts and braille all go through `textContent` |
| **`allow-same-origin` on preview iframes** | "their JS runs, but it cannot touch this page, our localStorage, or our cookies" |
| **Fake retro** | `vhs/` ships SCANLINES at `0` and the hint explains why (§6) |

---

## 13. Canvas work

If your page draws into a canvas, the system has a contract for you. **All seven are LOAD-BEARING; 6 and 7 are also FLOOR.**

1. **Read tokens at runtime, never cache a literal.**
   ```js
   var c = getComputedStyle(document.documentElement).getPropertyValue('--phos').trim() || '#ffb000';
   ```
   > "Read the colour from the token, never a literal — otherwise the trace keeps drawing amber after the display is switched."

   Return a `repaint()` handle from your renderer and call it from the theme-switch callback.

2. **Sample `--solid-lo` / `--solid-hi` for shaded solids**, so they are dark on the dark table and pale on paper "without any of this code knowing which theme is on."

3. **Cap DPR at 2**: `Math.min(window.devicePixelRatio || 1, 2)`, set the backing store to `px * dpr`, `cv.style.width = px + 'px'`, then `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)`.

4. **Stop on `visibilitychange`.**

5. **Back every rAF loop with a `setTimeout` that paints the settled frame.**

6. **Give reduced motion a static frame, not a blank canvas.**

7. **Set `width: 100%; height: 100%` explicitly, not just `inset: 0`.**
   > "width/height, not just inset. A canvas is a replaced element with an intrinsic size taken from its width/height ATTRIBUTES."

   A canvas positioned with `inset: 0` alone is still sized by its attributes in one axis, which halves the picture on a HiDPI display. This is the single most-repeated canvas bug in the codebase.

**FREE, and instructive:**

- Flat shading only, unless the object is genuinely a material. See the gradient row in §12 for where that line sits.
- Objects have their own colour. The coin's gold ramp is fixed in both themes: "it is the object's colour, not the page's. Only the outline follows the theme."
- Express an animation as an **offset from the answer**, not a path towards one, so the final frame is exact by construction — "the die cannot drift and land a degree off its number, which is what happens if you spin freely and try to correct at the end."
- Pick a frame rate per instrument. 20fps reads as drift; 30fps reads as a live trace.
- Set the accessible name on the host element: `host.setAttribute('aria-label', 'd20 rolled 17')`, inside an `aria-live="polite"` region.

### The canvas stage, on a tool page

The four tool pages share an invariant three-band stage that is worth copying whole:

`.stage-bar` (`padding: 9px 12px`, hairline bottom border, `.key { min-height: 26px }`) → the picture → `.stage-foot` (mirrors the bar's padding, hairline top border, 0.68rem `--ink-soft`).

The bar's content order is fixed: **view control → `.spacer` → compare/overlay toggles → zoom cluster.** The zoom cluster is byte-identical on all of them: `zoomOut` `−` / `<span class="label" id="zoomVal">FIT</span>` / `zoomIn` `+` / `FIT` / `1:1`, with the readout **between** the −/+ keys and the resting value the word `FIT`.

The transparency checkerboard, which §12 names and nothing else gives:
```css
.canvas-wrap {
  min-height: 340px; overflow: hidden; touch-action: none;
  background: repeating-conic-gradient(var(--ground-2) 0% 25%, var(--well) 0% 50%) 50% / 16px 16px;
}
.canvas-wrap.drag { outline: 2px dashed var(--accent); outline-offset: -6px; }
```

And `.drop-hint` — absolutely positioned, `pointer-events: none` so it never eats its own drop target, containing `<span class="designation">DROP AN IMAGE</span>` plus `<span class="hint">PNG, JPG or WEBP &middot; or paste from the clipboard</span>`. **Three ways in — key, drop, paste — named in the `01 SOURCE` hint and repeated on the canvas.**

**FLOOR** — an empty state is removed from the DOM on first action (`te.remove()`), never toggled hidden, and never a blank rectangle.

---

## 14. Starting a new page

### Browser baseline

The system depends on `:has()`, `color-mix()`, `dvh`, `env(safe-area-inset-bottom)`, `repeating-conic-gradient`, and `forced-colors`. Evergreen Chrome, Firefox, Safari and Edge all carry these.

What degrades, and to what:

| Missing | Result |
|---|---|
| `:has()` | The filled-field label does not lift. The inset bar still draws — so the mark degrades to a bar plus brightness, which is thinner than intended but not invisible. |
| `color-mix()` | `.key-danger`'s resting border falls back to whatever the cascade left; all of `docs/`'s sheet furniture loses its rules. |
| `dvh` | Mobile browser chrome can clip the last few pixels of `.page`. |
| `env(safe-area-inset-bottom)` | `max()` returns the 9px literal; the dock sits under the home indicator on a notched phone. |

### `<head>` — copy verbatim, change three strings

Copy:
```html
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#0a0b0d">
<title>Halftone Plate</title>
<meta name="description" content="One sentence. What it does, not what it is.">
<link rel="icon" href="../assets/icon.svg" type="image/svg+xml">

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap">

<link rel="stylesheet" href="../assets/vector.css?v=10">
<link rel="stylesheet" href="../assets/console.css?v=10">
<script src="../assets/cassette.js?v=10"></script>

<style>
  /* Channel 0N runs on the <colour> band. */
  :root { --accent: var(--s5); }
</style>
```

**The `<title>` is the tool's name in title case and nothing else** — `Dice`, `Coin Flip`, `Cutout Lab`, `Halftone Plate`, `Tape Transfer`, `Search Terminals`, `X Advanced Search`. No site suffix, no separator.

`cassette.js` is a **blocking script in `<head>`** — it stamps `data-theme` before first paint so the page never flashes the wrong theme. Do not defer it.

**Cache-busting is per-file and per-page, and the numbers do not agree.** At time of writing: shared assets are `?v=10` on eleven pages and `?v=11` in `connect/`; `docs.css` is `?v=9`. There is no global version. **Check the page you are copying from, bump only what you actually touched, and expect the numbers to disagree.** A bump to a shared asset means editing every page that links it — that is the real cost of the checklist item.

### Body skeleton

Copy:
```html
<main class="page">
  <header class="chassis page-head">
    <div class="head-row">
      <div class="brand">…</div>
      <div class="bezel head-well">…</div>
      <div class="head-ctl">…</div>
    </div>
    <nav class="net-nav" aria-label="…">…</nav>
  </header>

  <div class="racks">      <!-- or <div class="work"> for a tool page -->
    <section class="chassis rack">…</section>
    <section class="chassis note wide">…</section>
  </div>

  <footer class="chassis page-foot">…</footer>
</main>

<div class="dock">…</div>

<script src="../assets/console.js?v=10"></script>
<script>
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };

  if (window.CAS) CAS.bootOnce($('headScreen'));
  SRCH.clock($('clock'));
  var trace = SRCH.scope($('scope'));
  SRCH.themeSwitch($('themeSw'), function () {
    if (trace) trace.repaint();
    /* repaint anything else that sampled a token */
  });

  /* your page here */

  if (window.CAS) CAS.pageTransition();
})();
</script>
```

**The wiring order** — `bootOnce` → `clock` → `scope` → `themeSwitch`, then your logic, then `pageTransition()` — has one real dependency and one convention. The dependency: **`themeSwitch` must come after `scope`**, because its callback needs the `trace` handle to repaint the canvas on a theme change. Everything before that is the order the pages happen to use. `pageTransition()` last is genuinely load-bearing — it binds a delegated click handler and wants the final DOM.

For a query terminal, replace the middle with the one call that does all of it — see §16.

**Required element ids**, split by what actually needs them:

| Always | `headScreen`, `clock`, `scope`, `themeSw` |
|---|---|
| **Query terminal only** | `qOut`, `uOut`, `opCount`, `qLed`, `qStat`, `goBtn`, `copyBtn`, `copyUrlBtn`, `resetBtn` |

A tool page needs the first row and none of the second.

### What you override, in order of how often it is right

| Override | When |
|---|---|
| `--accent` | Always. One line. |
| Page layout (`.work` grid, sticky stage, column counts) | Whenever your page isn't a rack column |
| `.page { padding-bottom }` | If you have no dock, drop 96px to 14px |
| `.rack-body { gap }` | If your rack is dense |
| Control sizes inside a scoped context | Per the ladder in §5 — 26px toolbars, 24px chips |
| `[hidden] { display: none !important }` | If any class of yours sets `display`. See §6. |
| A page-local device | If your page genuinely does something no other page does |
| Tokens beyond `--accent` | Rare, and it means you are building a sub-language. Two precedents: `connect/` (which left the console language) and `docs/` (which declares `--pw`, `--ph`, `--mt`–`--ml`, `--zoom`, `--rail-w`, `--m-fast`/`--m-base`/`--m-slow`/`--ease`, plus leaf-scoped `--sheet-bg`/`--sheet-ink`/`--doc-*`, and restates `--hint-ink` and `--label-size`). Both wrote down why. |

### Checklist

What you can still get wrong *after* copying the skeleton verbatim:

- [ ] One `--accent` line, with a comment naming the channel
- [ ] `aria-current="page"` on your own nav entry — and every sibling's nav edited to include you
- [ ] Racks numbered `01`… in pipeline order, every `-ix` `aria-hidden`
- [ ] Every field has a real `<label for>`; every icon-only key has `title` + `aria-label`
- [ ] Every hint capped at 46ch, sentence case, states a consequence
- [ ] Static HTML ships the correct default in every `.op` value span
- [ ] `[hidden] { display: none !important }` if you set `display` on anything
- [ ] `var(--snap)` is never the second time value in a `transition` shorthand
- [ ] Focus rings are `--s6`; tabular nums on anything that ticks
- [ ] Empty states are readable text — `&mdash;`, `NO IMAGE`, `IDLE`, `FIT`, `Not loaded.` — never blank, and removed rather than hidden
- [ ] Reduced-motion path is a static frame, not a blank one
- [ ] The footer's standing claim is true of your page — or absent
- [ ] `?v=` bumped on whatever you touched, on every page that links it

### Verification

Paste into the console on your page. It returns every element breaking the three geometry rules at once, which is faster than reading half the checklist:

```js
[...document.querySelectorAll('*')].filter(function (e) {
  var s = getComputedStyle(e);
  return s.borderRadius !== '0px'
      || (s.boxShadow !== 'none' && s.boxShadow.indexOf('inset') < 0)
      || s.textShadow !== 'none';
});
```

Expect two legitimate hits: the soloed-thumbnail inset shadow, and the swatch chip's `×`. Anything else is a bug. Run it in both themes.

---

## 15. What `docs/` invented, worth stealing

`docs/docs.css` is the newest layer. It hit problems the rest of the system had not — a surface that opens, a document on a page, a toolbar dense enough to fight the type scale — and its answers generalise. **Items 1–3 are the ones worth adopting wholesale; 4–9 are smaller and situational.**

### 1. A motion vocabulary for surfaces that arrive

Controls keep `--snap` — "a toolbar that eases is a toolbar that feels broken." But menus, dialogs and drawers are not controls; they are **things that arrive**. They get their own three-step scale and one curve:

| Token | Value | Comment |
|---|---|---|
| `--m-fast` | `110ms` | "a surface acknowledging you" |
| `--m-base` | `160ms` | "a surface arriving" |
| `--m-slow` | `220ms` | "a surface crossing the frame" |
| `--ease` | `cubic-bezier(0.2, 0, 0.1, 1)` | "the house curve, from `--slide`" — an alias, not a third curve |

> "A menu is a shutter. A dialog drops onto the page. A rail slides in from the edge it lives on. Nothing scales up from nothing, nothing bounces, nothing blurs — none of that belongs to a machine."

Where these are loaded, `--m-base` supersedes the base 120ms `sheet-in` for dialogs (§8). Note the tokens are named by intent, not speed — that is why they work.

### 2. The visibility hand-off

`display` cannot be transitioned, so an animated surface uses `visibility` + `opacity` + `transform`, with the visibility change delayed by the full duration on close and zero on open:

From the source:
```css
.menu-sheet {
  display: block; visibility: hidden; opacity: 0;
  transform: translateY(-5px); transform-origin: top center;
  pointer-events: none;
  transition: opacity var(--m-fast) linear,
              transform var(--m-base) var(--ease),
              visibility 0s linear var(--m-base);
}
.menu.open > .menu-sheet {
  visibility: visible; opacity: 1; transform: none;
  pointer-events: auto;
  transition: opacity var(--m-fast) linear,
              transform var(--m-base) var(--ease),
              visibility 0s;
}
```

> "visibility:hidden still removes the element from the accessibility tree and from hit-testing, so a closed menu is closed in every sense — it just gets to animate on the way out as well as in."

And the reduced-motion companion, which is the part everyone forgets:

> "a zeroed DURATION is not a zeroed DELAY — the visibility hand-offs above would still hold a menu on screen for 160ms after it closed."

```css
@media (prefers-reduced-motion: reduce) {
  .menu-sheet, .menu.open > .menu-sheet, .pal, .panel-modal, .rail {
    transition-delay: 0s !important;
  }
  .menu-sheet, .pal, .panel-modal .sheet, .rail-left, .rail-right {
    transform: none !important;
  }
}
```

**Adopt this wholesale.** It is the correct pattern for any surface that opens, and the delay clear is FLOOR.

### 3. The sheet, and the one licensed theme exception

`.leaf` is the page of paper:

From the source:
```css
.leaf {
  width: var(--pw); min-height: var(--ph);
  padding: var(--mt) var(--mr) var(--mb) var(--ml);
  background: var(--sheet-bg, #f4f2ec);
  color: var(--sheet-ink, #1a1c20);
  border: var(--hair) solid var(--rule-hi);
}
```

The whole page-geometry token set — `--pw` `816px`, `--ph` `1056px`, `--mt`/`--mr`/`--mb`/`--ml` `96px`, `--zoom` `1`, `--rail-w` `252px` — is rewritten from JS whenever the page setup changes.

Four things here are transferable:

- **`--sheet-bg` / `--sheet-ink` are never declared on `:root`.** They exist only as `var()` fallbacks, plus overrides under `body.stock-dark` and `@media print`. A token that describes one object should not be global.
- **`zoom: var(--zoom)`, deliberately, not `transform: scale`** — so layout reflows and `margin: 0 auto` still centres the sheet.
- **The plotter ruler is redrawn per setup, never scaled.** "A tick that has been stretched by a zoom is no longer a measurement." Same for the registration marks and the `.pbreak` guides.
- **The paper does not invert with the theme.** "A document does not change colour when you turn the lights off." This is the one licensed exception to §2's rule that everything re-themes, and it is licensed because the paper is an object on the page, not a surface of the page.

**Print.** This is what §10 points at. `docs/` extends `vector.css`'s print block rather than replacing it: the machine is hidden, `.leaf`'s padding drops to `0` so `@page` owns the margins, `orphans: 2; widows: 2`, `break-after: avoid` on headings, `break-inside: avoid` on tables, figures and `pre`.

`@page` itself cannot read custom properties — it is resolved outside the document tree. `editor.js` therefore **writes a live `@page` rule from the current page setup** into a style element, so the printed sheet size and margins match what is on screen. (An earlier build had only a comment claiming this; the rule is now real.)

### 4. Colour-mixed furniture from one token

Every rule drawn on the paper is a `color-mix` of a single `--sheet-ink`, at 6% / 8% / 22% / 25% / 28% / 30% / 34% / 45%. Change the token and every rule on the sheet re-tints in proportion. Cleaner than a family of tokens, and it means the paper can go dark on request without touching one border colour.

### 5. The temporary theme cross-fade

A whole-page repaint on theme switch is worth a transition, but a permanent colour transition would drag on every hover and focus. So the class is added and removed:

From the source:
```css
:root.theming body, :root.theming .chassis, :root.theming .deck,
:root.theming .screen, :root.theming .field, :root.theming .leaf,
:root.theming .dock, :root.theming .menu-sheet, :root.theming .rail,
:root.theming .doc {
  transition: background-color var(--m-base) linear,
              border-color     var(--m-base) linear,
              color            var(--m-base) linear;
}
```
JS adds `.theming` on switch and clears it after 260ms — 100ms of slack past the 160ms transition, and never left on.

### 6. Numbering as a coordinate system

`docs/` numbers its ribbon bays 01–06, continues the sequence at 07 for the comments rail, and **restarts at 01–09 for the dialogs** — a second coordinate space, not a continuation. Then it directs the user by number in its own hint prose:

> "Set a paragraph to Heading 1–4 in bay 02"
> "press the comment key in bay 05 to pin a note to it"

That only works because the numerals are permanently visible under every bay. It turns the house's decorative index numerals into something functional. Steal it — and note it is the reason §6 treats "sequential from 01" as a convention rather than a rule.

### 7. Headroom as a budget

> "A word processor whose toolbar scrolls away with the text is a web page pretending to be an application: the chrome has to stay put and the PAPER has to be the thing that moves."

The masthead cost 282px — 36% of a 900px laptop screen. The fix trimmed **air only**, across a list of measured steps — page-head padding, head-row gap, brand gap, brand-stripe height / max-width / min-height, head-well padding, screen padding, well-row min-height, head-ctl gap, head-ctl key size, head-well flex — and got chrome to roughly a fifth of the viewport.

> "type sizes and hit targets are untouched, so nothing became harder to read or to click; only the air between things changed."

That is the right way to buy space: do not shrink type, delete bands that have stopped earning their height. `docs/` removed the channel strip outright because "it had become a two-item nav."

**One caveat on that quote.** Hit targets were not entirely untouched — `docs.css` lowers `(pointer: coarse)` from the house 44px to 38px on `.ribbon .key`, `.ribbon .key-sq` and `.head-ctl .key` to fit six bays. That is the knowing trade recorded in §10, and it is the one place the page bought space from somewhere other than the air.

### 8. Icons as strokes

> "Icons. Drawn as strokes, never filled, so they belong to the same hand as the hairlines they sit between."

One inline `<svg width="0" height="0">` sprite of `<symbol>`s at the top of `<body>`, all on a 16×16 viewBox with `fill="none" stroke="currentColor"`, used via `<use href="#i-…">`. Stroke width is **1.3** for most of the set, **1.4** for `#i-plus`, `#i-minus` and `#i-x`, and **1.5** for `#i-check` — the optically thin glyphs get a little more weight so they read at the same density. This is the right answer for any page that needs more than the two theme icons.

### 9. A toolbar must not take the caret

From the source:
```js
document.addEventListener('mousedown', function (e) {
  if (e.target.closest('.ribbon [data-cmd], .ribbon [data-size], .menu-btn, .menu-item, .pal button, .sym-grid button, .rail-tabs [data-tab]')) {
    e.preventDefault();
  }
});
```
> "A toolbar must not take the caret."

Any page with an editable region needs this, and the selector has to name **every** clickable in the chrome — one omission and that control steals the selection.

---

## 16. The runtime — `CAS` and `SRCH`

Two globals, no modules, no build step. `SRCH` depends on `CAS`; never the reverse. Everything below is called from the page's own inline script.

### `CAS` — `assets/cassette.js`

| Call | Does |
|---|---|
| `CAS.getTheme()` / `CAS.setTheme(t)` / `CAS.toggleTheme()` | Theme, held in memory and mirrored to `isa.theme`. Also rewrites `<meta name="theme-color">`. Legacy alias: `CAS.getPhosphor`. |
| `CAS.toast(msg, isError)` | The singleton notification (§5). `textContent`, never `innerHTML`. |
| `CAS.segInit(el, count)` / `CAS.segSet(el, value)` | Build and write a seven-segment readout. `segInit` sets `aria-hidden`; the real value must live elsewhere. |
| `CAS.copy(text)` / `CAS.paste()` | Clipboard, with the toast already wired. |
| `CAS.download(blob, filename)` | Object URL revoked after **4000ms**. |
| `CAS.openInTab(blob)` | Object URL revoked after **60000ms** — "revoking synchronously races the new tab and blanks it." |
| `CAS.renderPreview(html, iframe)` | Sandboxed preview. Sandbox string is `allow-scripts allow-modals allow-forms allow-popups` — **never `allow-same-origin`.** |
| `CAS.debounce(fn, ms)` | House default 120ms. |
| `CAS.bootOnce(el)` | The 600ms `.crt-on` entrance, once per tab session (§8). |
| `CAS.pageTransition()` | Binds the delegated wipe handler. **Last statement in the script.** |
| `CAS.globe(canvas, opts)` | The header globe. Defaults `{ parallels: 5, meridians: 6, speed: 0.004, tilt: -0.42 }`. |
| `CAS.braille(text)` / `CAS.brailleAnnotate(el)` | Braille transliteration, driven by `data-braille`. Note the `.braille` span has **no CSS in either sheet** — it inherits, deliberately. |
| `CAS.registerSW()` | Service worker. Skipped on `file://`, failures swallowed — "offline support is optional." |

A `file://` link fixup rewrites directory hrefs to `index.html` only when the page is opened off disk, "so the authored HTML stays canonical."

### `SRCH` — `assets/console.js`

| Call | Does |
|---|---|
| `SRCH.clock(el)` | The header clock. |
| `SRCH.scope(el)` | The header trace. Returns a handle with `.repaint()`. |
| `SRCH.themeSwitch(input, onChange)` | Wires the rocker. Call it **after** `scope` so the callback can repaint. Legacy alias: `SRCH.phosphorSwitch`. |
| `SRCH.terminal(config)` | The whole query-terminal contract — see below. |

### `SRCH.terminal`

```js
SRCH.terminal({
  net: 'x',                      // documentation; console.js never reads it
  storeKey: 'isa.search.x',
  prefill: '',
  compile: function () { return { q: '…', url: '…', ops: 0 }; },
  onPaint: function () { /* runs after every repaint */ },
  emptyQuery: 'Fill anything in — the query assembles as you type.',
  emptyUrl: '—'
});
```

`onPaint` is the hook `search/threads/` uses to swap its entire rack set: "driven from onPaint so it stays in step no matter what moved the radio — a click, a restore from storage, or CLEAR."

**Restore order:** stored state is applied first, then `?q=` overrides it. "A shared link is a deliberate act; the last local session is not."

**Delegated listeners:** one `input` and one `change`, bound to `document.querySelector('main') || document.body`, so a rack added to the DOM later is live without rebinding.

**Keyboard contract:** `Ctrl/Cmd+Enter` fires from anywhere, textareas included. A bare `Enter` fires only from single-line inputs, so it stays a newline in a textarea and still toggles a focused checkbox.

### The value-reader idiom

Every `compile()` in the codebase is written with these. They are named for what they return, and **all of them are null-safe** — a page that omits a control gets the empty answer, not a TypeError. That is why three terminals can share one compile shape.

| Reader | Returns |
|---|---|
| `SRCH.el(id)` | The element, or null |
| `SRCH.v(id)` | Trimmed value, or `''` |
| `SRCH.n(id)` | A non-negative integer as a string, or `''` |
| `SRCH.c(id)` | Checked boolean |
| `SRCH.r(name)` | The selected radio's value |
| `SRCH.list(id)`, `SRCH.handles(id)`, `SRCH.tags(id)`, `SRCH.bareTags(id)`, `SRCH.phrase(id)` | Parsed multi-value forms |

---

## 17. What is free

The rest of this document records decisions. This section records what is still open, because a guide that only lists constraints reads as a fence.

**A new page may invent all of this outright, with no argument required:**

- **Its own devices.** Anything your page genuinely does that no other page does. `dice/`'s tray, `connect/`'s board, `docs/`'s ribbon, `cutout/`'s engine drawers, the halftone screen preview — none of these existed until a page needed them.
- **Its layout frame.** `.racks` is one answer. The tool pages' `.work` grid is another. `docs/`'s deck-and-rails is a third. If your content is not a column of control cards, do not force it into one.
- **Rack composition, count, order and naming** — beyond `01 SOURCE` on a tool page.
- **The strapline**, within the register.
- **The head-well's contents.** Clock and scope are a default, not a requirement.
- **Hint voice, note voice, empty-state copy, toast wording.** The register is fixed; the writing is yours, and the best writing in the codebase is in exactly these places.
- **Which band you take**, and what that channel means.
- **Instrument choice** — what the page displays about itself, and how.
- **Everything inside a canvas** except the seven contract items in §13.
- **Whether you load `console.css`**, and therefore how much of the console frame you keep.
- **Spacing**, within the 7/10/12/14 rhythm, including optical nudges.
- **Bar thicknesses, chip sizes, toolbar densities** — the ladders in §5 and §7 are what the pages happen to use, not a permit system.

**And with an argument in a comment, you may take on any of the rest of it.** `connect/` rounded every corner and dropped the display face. `docs/` put serif type on the page and stopped the paper re-theming. Both are still part of the site, because both wrote down what they were leaving and why.

The only things that are genuinely not yours are the FLOOR items — those are correctness — and the four sub-rules in §1, because those are what the word "vector" means here.

---

## 18. The short version

1. **Everything is drawn, not built.** 1px hairline, flat fill, no radius, no shadow, no glow.
2. **The stripe is the mark.** Six bands, fixed values, never re-tinted.
3. **One accent per page**, taken from the stripe, in one line — and focus is always `--s6`.
4. **Controls invert; they never travel.** 70ms linear.
5. **Uppercase tracked mono labels; sentence-case untracked mono prose.** The chrome is monospace; a document is not.
6. **Depth is which of three fills a region takes**, not a shadow.
7. **Say why in the comment**, and name the thing you rejected — that is also how you argue with any of the above.

---

## Appendix A — where everything is defined

Classes, tokens and calls, alphabetically, with the section that defines them.

**A–B** · `--accent` §2 §3 · `--alert` §2 · `--amber` §2 · `.bad` §5 · `.bay-ix` §9 §15 · `.bezel` §5 · `--bevel` §1 · `.blink` §5 · `.box` §5 · `.brand` §6 · `.brand-stripe` §4 · `CAS.bootOnce` §8 §16 · `CAS.braille` §16 · `break-inside` §6 · `.busy` §6 · `.busybar` §5 §7

**C** · `.canvas-wrap` §13 · `.chassis` §5 · `--chassis-hi`/`-lo` §1 · `.checks` §5 · `.chk` §5 · `#clock` §6 §9 · `color-mix` §14 §15 · `.conf-bar` §5 §7 · `.count` §6 · `CAS.copy` §16 · `.crt-on` §8

**D–E** · `data-braille` §11 §16 · `data-cmd` §11 §15 · `data-no-save` §6 §11 · `data-panel` §3 §11 · `data-theme` §6 §10 · `.designation` §9 · `.dock` §6 · `.dock-inner` §6 · `.dock-stripe` §4 · `CAS.download` §16 · `.drop-hint` §13 · `--ease` §8 §15 · `.empty` §5 · `.engraved` §9

**F–G** · `.field` §5 · `--f-display` §2 §9 · `--f-mono` §2 §9 · `--fld-ink` §2 §6 · `.fld` §6 · `forced-colors` §10 · `.foot-right` §6 · `.gridout` §9 · `--ground` §2 · `--ground-2` §2 · `.globe` §16

**H–I** · `--hair` §2 · `.hazard` §5 · `.head-ctl` §6 · `.head-row` §6 · `.head-well` §6 · `#headScreen` §6 §14 · `[hidden]` §6 §10 · `.hint` §6 §9 · `--hint-ink` §2 · `.hub-nets` — undocumented · `--ink` §2 · `--ink-faint` §2 · `--ink-soft` §2 · `-ix` §6 §11

**K–L** · `.key` §5 · `.key-danger` §5 · `.key-go` §5 · `.key-lbl` §5 §6 · `.key-sq` §5 · `.label` §9 · `--label-size` §2 §9 · `--label-track` §2 §9 · `.label-lite` §9 · `.lamp` §6 · `.latched` §5 · `.leaf` §15 · `.led` §5 · `.log-row` — undocumented

**M–N** · `mark-blink` §8 · `--m-fast`/`--m-base`/`--m-slow` §8 §15 · `.menu-sheet` §15 · `.meter` §5 · `.moved` §5 · `.net` §6 · `.net-card` — partly §6 · `.net-card-ix` §6 §9 · `.net-ix` §6 · `.net-nav` §6 · `.note` §6 · `.note-body` §6

**O–P** · `--ok` §2 · `.op` §6 §9 · `CAS.openInTab` §16 · `.page` §6 · `.page-foot` §6 · `.page-head` §6 · `.page-wipe` §8 · `CAS.pageTransition` §8 §16 · `.pair` §6 · `.panel` §2 · `.panel-modal` §5 · `--paper` §2 §5 · `.phos` §2 §5 · `--phos-dim` §2 · `--phos-faint` §2 · `--phos-glow` §1 · `.printout` §5 · `.prose` §9

**Q–R** · `.q-screen` §5 · `#qOut` §5 §14 · `--r` §2 §7 · `.rack` §6 · `.rack-body` §6 · `.rack-head` §6 · `.rack-ix` §6 · `.rack-name` §6 · `.racks` §6 · range inputs §5 · `.readout` §5 · `.readout-body` §5 · `.readout-row` §5 §7 · `.readout-toast` §5 · `CAS.registerSW` §16 · `.rock` §5 · `.rocker` §5 · `.row` §6 · `.row-tight` §6 · `--rule` §2 · `.rule` §5 · `--rule-hi`/`-lo` §2

**S** · `--s1`–`--s6` §4 · `CAS.segInit`/`segSet` §5 §16 · `.seg` §5 · `.seg-ctl` §5 · `.seg-digit` §5 · `--sheet-bg`/`--sheet-ink` §15 · `.sheet` §5 · `.sheet-head`/`-body`/`-foot` §5 · `sheet-in` §8 · `.sl` §5 · `--slide` §2 §8 · `--snap` §2 §8 · `--solid-lo`/`-hi` §2 §13 · `.spacer` §6 · `SRCH.clock` §16 · `SRCH.scope` §16 · `SRCH.terminal` §16 · `SRCH.themeSwitch` §16 · `.stack` §6 · `.stage` §6 · `.stage-bar` §13 · `.stage-foot` §13 · `.stat` §9 §13 · `.stepper` — undocumented · `.stripe` §4 · `.stripe-bar` §4 · `.sr-only` §6

**T–Z** · `.tape` §5 · `.tape-alt`/`-cool` §5 · `.theming` §15 · `.theme-ico` §6 · `#themeSw` §6 §14 · `.total` §9 · `CAS.toast` §5 §16 · `trace-in` §8 · `.tray` §7 · `.trio` §6 · `.u-screen` §5 · `.verdict` §9 · `.well` §2 · `.well-row` §6 · `.wide` §6 · `z-index ladder` §5

Entries marked *undocumented* are real, shipped devices this guide does not yet specify — `.hub-nets` and `.net-card` (the hub composition), `.stepper` (byte-identical in dice and coinflip), `.log-row` (the history row), `.tray` (named in §7's spacing table, spec'd nowhere), and the capability-matrix table conventions in `search/`. They are named here so you know to read the source rather than assume they do not exist.
