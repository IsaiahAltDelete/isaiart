# Art assignment: Villages UI icons, buttons and frames

*How to use this (for Isaiah): paste everything from "ASSIGNMENT" down into ChatGPT. Work one phase at
a time. When Phase 0 comes back and you like it, save that image and attach it to every later request
with: "Match the attached style key exactly." Ask for ONE asset per image unless a phase says otherwise.
Save the files into `villages/art/incoming/` with the exact filenames listed, and Claude will check
and wire them in.*

---

## ASSIGNMENT

You are the UI artist for **Villages**, a cozy browser village-builder. It looks like a storybook
diorama: chunky low-poly cottages, round little villagers, soft pastel daylight, and a warm
parchment-and-wood interface with rounded type (Fredoka). Think *Animal Crossing* menus crossed with
a hand-painted board game. Your job is to produce game UI assets that sit on top of that 3D scene.
Follow every rule below exactly. Where a rule and your taste disagree, follow the rule.

### 1. Style lock (applies to every asset)

**Palette.** Use only these colours, plus lighter or darker steps of them (at most 15% lighter or darker):

| Role | Hex |
|---|---|
| Outline / ink (all outlines) | `#5b3a1e` |
| Secondary ink | `#8c6a48` |
| Parchment | `#fff8e8`, `#fbefd2` |
| Wood edge | `#c48a4a`, dark `#8a5a2b` |
| Leaf green | `#6cc04a`, dark `#3f8a2a` |
| Gold | `#f6c53f`, dark `#c48a1a` |
| Sky blue | `#4f9be0`, dark `#2f6aa8` |
| Berry red | `#e8665a`, dark `#a8392f` |
| Lavender | `#a66be0` |
| Stone grey | `#9a9d9f`, dark `#6e6a66` |
| Snow / highlight | `#ffffff` |

**Shape language.** Chunky, rounded, slightly squashed silhouettes. Soft corners everywhere and
no sharp spikes. Readable as a solid silhouette.

**Outline.** One continuous dark outline (`#5b3a1e`) around the whole silhouette, the same weight on
every asset: about **4% of the canvas width** (≈40 px on a 1024 canvas). Thin inner lines, if any, at
half that weight.

**Shading.** Flat colour with at most **one** shade and **one** highlight per surface. Light always comes
from the **top-left**. The highlight is a small soft shape on the top-left of each form. No gradients
across a whole shape, no glow, no bloom, no texture noise.

**Forbidden in every asset:**
- text, letters or numbers
- drop shadows outside the silhouette
- backgrounds or scenery
- perspective tilt or 3D camera angles (everything is a front-on, flat, sticker-like view)
- photorealism, metallic shine or glossy "app icon" bevels
- semi-transparent halos or fringes around the edge
- signatures or watermarks

### 2. Technical rules

- **PNG with a fully transparent background.** Only the asset itself is opaque.
- Icons: **1024 × 1024** canvas. The subject is centred and fits inside the middle **820 × 820**
  (leave ~100 px of clear space on every side). It must still be recognisable shrunk to **24 × 24 px**:
  test this before delivering, and simplify if it isn't.
- Frames and buttons: see Phase 3. Their middles must be **perfectly flat, even colour**, so they can
  be stretched (9-slice). All ornament goes in the corners and along the border only.
- Keep the filenames exactly as written.

### Phase 0: style key (one image, for approval)

**One 1536 × 1024** transparent PNG showing six icons in a 3 × 2 grid with generous spacing, all in
the style above: **a gold coin, a wood log bundle, a hammer, a little cottage, a heart, a folded map**.
Filename: `style_key.png`. Nothing else is produced until this is approved.

### Phase 1: the dock and top bar (one icon per image)

| Filename | Subject |
|---|---|
| `icon_build.png` | A wooden-handled hammer crossed with a small hand saw |
| `icon_people.png` | Two round villager heads side by side, one with a straw hat |
| `icon_town.png` | A heraldic shield with a tiny cottage on it |
| `icon_journal.png` | An open storybook with a red ribbon bookmark |
| `icon_world.png` | A folded paper map with a red pin |
| `icon_coin.png` | A gold coin with a simple leaf emblem |
| `icon_wood.png` | Three stacked logs, round ends showing rings |
| `icon_plank.png` | Two sawn planks crossed |
| `icon_stone.png` | A small pile of three rounded grey stones |
| `icon_apple.png` | A red apple with one leaf (this stands for food) |
| `icon_gem.png` | A chunky faceted lavender gem |
| `icon_brick.png` | Three terracotta-red bricks stacked |
| `icon_ore.png` | A grey rock with rusty-orange flecks |
| `icon_iron.png` | Two dark-grey iron ingots |

### Phase 2: status bubbles and weather (one icon per image)

| Filename | Subject |
|---|---|
| `icon_zzz.png` | Three "z" shapes drawn as **swirly curls** (no actual letters), stacked |
| `icon_alert.png` | A rounded red warning triangle containing a thick white teardrop-and-dot shape, not a letter |
| `icon_heart.png` | A plump red heart |
| `icon_smile.png` | A round yellow happy face |
| `icon_wish.png` | A gold star inside a little thought cloud |
| `icon_sick.png` | A green round face with a thermometer |
| `icon_mask.png` | A black domino bandit mask |
| `icon_snow.png` | A six-armed rounded snowflake |
| `icon_sun.png` | A round sun with short rounded rays |
| `icon_suncloud.png` | A sun half behind a fluffy cloud |
| `icon_cloud.png` | A fluffy white cloud |
| `icon_rain.png` | A grey cloud with three blue drops |
| `icon_storm.png` | A dark cloud with a gold lightning bolt |
| `icon_snowfall.png` | A cloud with three snowflakes |
| `icon_sword.png` | A short sword, blade up, gold crossguard |
| `icon_tent.png` | A cream ridge tent with a dark door flap and a little red pennant |

### Phase 3: buttons and frames (9-slice skins)

For each of these, keep the border the **same thickness all the way round**, make it **left-right
and top-bottom symmetrical**, and keep the **centre third perfectly flat**. The game will cut each
image into a 3 × 3 grid (corners stay fixed, edges and centre stretch), so anything in the middle
will smear.

| Filename | Canvas | Subject |
|---|---|---|
| `btn_green.png` | 1536 × 1024 | A rounded pill button, filling ~80% of the width and ~45% of the height. Leaf-green face (`#6cc04a`), dark-green border (`#3f8a2a`), a slightly darker strip along the bottom edge for depth, and a soft highlight band along the top edge. Flat centre. |
| `btn_green_pressed.png` | 1536 × 1024 | The same, pressed: no bottom depth strip, face 6% darker. |
| `btn_gold.png` / `btn_gold_pressed.png` | 1536 × 1024 | The same shapes in gold (`#f6c53f` / `#c48a1a`). |
| `btn_blue.png`, `btn_red.png`, `btn_cream.png` (+ `_pressed`) | 1536 × 1024 | The same shapes in sky blue, berry red, and parchment `#fbefd2` with wood-brown border `#c48a4a`. |
| `btn_round.png` | 1024 × 1024 | A round parchment button (circle ~60% of the canvas), wood-brown border. For icon-only buttons. |
| `frame_panel.png` | 1024 × 1024 | A panel: parchment interior `#fff8e8` (flat), 3–4% wood-brown border `#c48a4a` with a thin cream inner line just inside it, rounded corners (radius ~7% of width). Optional: a tiny leaf sprig in each corner, entirely inside the corner square. |
| `frame_modal.png` | 1024 × 1024 | A bigger dialog frame. As the panel, but a thicker border (~5%) that looks like carved wood with two tiny brass rivets in each corner. Flat parchment interior. |
| `ribbon_title.png` | 1536 × 1024 | A horizontal ribbon banner for dialog titles: flat green centre band (stretchable), folded tails at both ends. No text. |
| `bar_dock.png` | 1536 × 1024 | A long, low rounded tray (~85% wide, ~30% tall), parchment face, wood border. It holds the five bottom buttons. Flat centre. |
| `chip.png` | 1536 × 1024 | A small pill tag (~60% wide, ~30% tall), cream face, thin wood border. For counters like "150 coins". |
| `tooltip.png` | 1024 × 1024 | A rounded speech bubble with a small tail at bottom-centre, white face, ink outline. Flat centre. |

### 4. Before you send each image, check

1. Transparent background, with no white box and no halo.
2. Only palette colours, with the light from the top-left.
3. Outline weight matches the style key.
4. No text, letters or numbers anywhere.
5. Icons: readable at 24 × 24 px. Frames: flat centre, symmetrical, even border.
6. Exact filename from the tables.

If you can't meet a rule (for example the canvas size), say so plainly with the image rather than
quietly changing it.
