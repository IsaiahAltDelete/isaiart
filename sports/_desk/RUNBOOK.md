# Daily Sports Desk runbook

This is the full procedure for the scheduled Sports Desk runs (8:00, 9:00, 10:00, 11:00 AM Eastern).
Every run follows it top to bottom. The page lives at https://isaiart.com/sports and is served by
GitHub Pages from the `main` branch of `IsaiahAltDelete/isaiart` (CNAME `isaiart.com`, `.nojekyll` at root).

## Files (all under `sports/`)

| File | Role | Who edits it |
| --- | --- | --- |
| `_desk/template.html` | Locked page design (9/28 look: Arial, warm off-white, thin rules, white cards, muted 3px league borders, ESPN logos with bordered fallback). | Nobody, unless Isaiah asks for a design change. |
| `_desk/archive-template.html` | Locked archive index design. | Same. |
| `_desk/build.py` | Validates the day's data, archives yesterday, writes `index.html`, `status.json`, `archive/index.html`. | Only to fix a bug. |
| `_desk/check.mjs` | Headless browser checks (date, counts, filters, search, empty state, timezones, mobile, logo fallback). | Only to fix a bug. |
| `_desk/logos.json` | Allowlist of **verified** ESPN CDN logo URLs. | Each run may add newly verified logos. |
| `_desk/data/YYYY-MM-DD.json` | The day's researched events. **The only thing a run writes by hand.** | Each run. |
| `index.html`, `status.json`, `archive/*` | Generated output. | Never by hand. |
| `app.js`, `config.js`, `events-*.js` | Legacy files that `archive/2026-09-27.html` still loads. | Never touch or delete. |

Never modify anything outside `sports/`. Never touch DNS, `CNAME`, `.nojekyll` or Pages settings.

## Step 0: decide whether to run (every run, including 8:00)

1. Get today's Eastern date: `TZ=America/New_York date +%F`.
2. Clone fresh: `git clone https://github.com/IsaiahAltDelete/isaiart.git && cd isaiart`.
3. Read `sports/status.json` in the repo **and** fetch the live copy with WebFetch at
   `https://isaiart.com/sports/status.json?v=<unix-time>` (the query string beats caches). Also WebFetch
   `https://isaiart.com/sports/?v=<unix-time>` and confirm the header shows today's full date.
4. If the repo status is today's date AND the live page shows today's date and the same event count, the
   desk is already published. **Stop. Do nothing.** Report "Desk already live for <date>, no action."
   (Exception: the 8:00 run always builds if the repo desk is from an earlier day.)
5. If the repo already has today's desk but the live site does not show it yet, the problem is deployment,
   not content: skip to Step 5 (verify), waiting and re-checking before rebuilding anything.
6. If the repo's desk is dated **after** today (clock or timezone confusion), stop and report. Never replace a newer desk.

## Step 1: research

Cover the full Eastern calendar day, 12:00 AM through 11:59 PM ET. Convert every UTC/local listing to ET
to decide which day an event belongs to.

**In scope (only if in season):** NFL, NBA, MLB, NHL, WNBA, MLS; nationally televised or ranked NCAA
football and men's/women's basketball; U.S.-broadcast Premier League, Champions League, Liga MX, USMNT,
USWNT; major UFC and boxing cards; golf majors; tennis Grand Slams; Formula 1, NASCAR (Cup), IndyCar;
any championship, playoff or elimination game.

**Skip:** preseason, exhibitions, spring training, low-interest non-national regular-season games (unless
the day would otherwise be very light). USMNT/USWNT friendlies are marquee national-team games and count.

**Light days:** add significant international soccer with U.S. broadcast availability (UEFA Nations League,
major CONCACAF/CONMEBOL, major tournaments, marquee national-team games). Never pad with obscure matches.
Set `light_day_note` saying the day is light. Optionally add a few genuinely notable events in `next48`;
they render in a separate "Next 48 Hours" section and are not counted.

**Sources:** official league and team schedules, broadcaster pages, ESPN, Sports Media Watch, reputable
outlets. Confirm TV and streaming with a second source when reasonably possible. **Never guess.** Anything
you cannot confirm is the literal string `TBD`.

**Per event collect:** competitors; records/rankings/seeds/series state; start time (canonical ISO with
offset); TV network; exact streaming platform; National or Regional; RSN/local market info; venue and venue
timezone; short meaningful context; blackout restrictions; In Progress/Final status if it applies at build time.

**NFL Sunday afternoon:** CBS/FOX 1:00 and 4:05/4:25 games are `Regional`, not national. The coverage or
blackout text must say local assignment varies by ZIP code, Paramount+ follows the local CBS feed where
applicable, NFL Sunday Ticket is the out-of-market option, and NFL+ restrictions may apply. Only true
national windows (SNF, MNF, TNF, national doubleheader slot when confirmed) are `National`.

**MLB:** name the RSNs for regional games in `rsn` with territorial restrictions. Distinguish national
exclusives (FOX, FS1, TBS, ESPN, NBC/Peacock, Apple TV, Netflix, etc.), MLB Network windows (blacked out
in the teams' markets when an RSN has the game), and local/out-of-market (MLB.TV) games.

**Arizona/Hawaii:** keep the DST note accurate. During DST: Arizona (except the Navajo Nation) matches
Pacific; Hawaii is 6 hours behind Eastern. After DST ends: Arizona matches Mountain; Hawaii is 5 hours behind Eastern.

## Step 2: write `sports/_desk/data/<date>.json`

Copy the shape of the most recent data file. Fields:

```jsonc
{
  "date": "2026-09-29",                        // today's Eastern date
  "updated": "2026-09-29T08:04:00-04:00",      // now, Eastern, with offset
  "dst_note": "…",                             // Arizona/Hawaii wording for today
  "light_day_note": "",                        // non-empty only on light days
  "headlines": ["…", "…", "…"],                // 2–3 lines used in the run report + status.json
  "leagues": [                                 // one per league that has events today, in display order
    {"key": "NFL", "name": "NFL", "subtitle": "Week 4", "note": "short section note"}
  ],
  "events": [{
    "id": "nfl-phi-chi",                       // unique
    "league": "NFL",                           // must match a leagues[].key
    "label": "NFL • Week 4",                   // card kicker
    "flags": ["Wild Card • Game 1", "Elimination"],  // stage/series flags (coverage type flag is automatic)
    "status": "",                              // "", "In Progress", "Final", "Postponed", "Delayed", "Canceled"
    "score": "",                               // optional, e.g. "Final: PHI 24, CHI 17"
    "competitors": [
      {"name": "Philadelphia Eagles", "abbr": "PHI", "detail": "3–0", "logo": "nfl/phi"},
      {"name": "Chicago Bears", "abbr": "CHI", "detail": "1–2", "logo": "nfl/chi"}
    ],
    "separator": "at",                         // "at" for road/home, "vs." for neutral
    "start": "2026-10-04T13:00:00-04:00",      // canonical timestamp with offset; omit + set "time_tbd": true if unconfirmed
    "watch": "FOX",                            // TV network(s)
    "streaming": "FOX One",                    // exact streaming platform(s) or "TBD"
    "coverage_type": "Regional",               // National | Regional | National + Regional | Local | Streaming exclusive | TBD
    "coverage": "Regional FOX window. Local assignment varies by ZIP code …",
    "rsn": "",                                 // RSN/local market detail (required for regional MLB)
    "venue": "Soldier Field, Chicago",
    "venue_tz": "Central Daylight Time",
    "notes": "One or two sentences of real context.",
    "blackout": "Out-of-market: NFL Sunday Ticket. NFL+ restrictions may apply …"
  }],
  "next48": [],                                // optional, light days only, same event shape
  "footer_note": "Editorial scope sentence.",
  "sources": [{"label": "NFL schedule", "url": "https://…"}]
}
```

League keys with preset colors: NFL NBA MLB NHL WNBA MLS NCAAF NCAAM NCAAW EPL UCL LIGAMX USMNT USWNT
INTL NATIONS UFC BOXING GOLF TENNIS F1 NASCAR INDYCAR. Other keys work (gray accent) or pass `"color"`.

**Logos:** `competitors[].logo` must be a key in `logos.json`. To add one, WebFetch the ESPN URL
`https://a.espncdn.com/i/teamlogos/<league>/500/<abbr>.png`: the error "Image content is not supported"
means the image exists (verified); a 404 means it does not. Add only verified URLs to `logos.json`. If a
logo can't be verified (NCAA and soccer IDs are numeric and hard to confirm), leave `logo` out and the
bordered abbreviation shows instead.

## House style and conventions

These are the habits the desk has settled on since late September 2026. Follow them so the page reads the
same from day to day. Copy the most recent data file of the same weekday as your starting point.

**Schedule.** As of October 15, 2026 the routine runs Friday, Saturday, Sunday and Monday only (7:55, 8:55,
9:55, 10:55 AM ET). Tuesday through Thursday are skipped on purpose; the page keeps showing Monday's desk.
Isaiah may pause the routine entirely; a paused routine means no runs and no pushes.

**Headlines (2 to 3).** Format: `Away at Home, context (H:MM PM ET, Network)`. Examples:
`Rays at Guardians, ALCS Game 5 with the series tied 2–2 (5:08 PM ET, TBS)`,
`No. 2 Notre Dame at No. 8 BYU, both unbeaten (7:30 PM ET, ABC)`. Lead with the biggest game of the day
(elimination or clinch games, top-10 college matchups, prime-time NFL), then the most national windows.

**Notes.** One or two plain factual sentences: series state, last result with score, probable starters,
local kickoff time for far-off venues. No hype words, no predictions, nothing you could not confirm.
Bad examples from past runs: guessed RSN names, "every AP Top 25 team in action" when some had byes.

**Competitor `detail`.** Records with en dashes (`4–1`, `3–1–1`). Postseason: seed plus series state plus
probable starter (`AL No. 2 seed • leads 2–1 • Messick`). College: `No. 7 • 4–1` for ranked teams, record only otherwise.

**Footer.** Pattern: `<Spelled-out count> qualifying events fall inside <Weekday>'s Eastern calendar day.`
then what is excluded (`Regional NHL games, preseason and exhibition games are excluded.`) then at most one
look-ahead sentence (next series game, Finals or World Series opener). Make the spelled-out count match the
real event count; check it after every edit.

**Scope habits.**
- NFL Sunday: London game (National, NFL Network), every CBS/FOX regional game, SNF. Plus TNF and MNF on their days.
- MLB postseason: every game; label `MLB • ALDS/NLDS/ALCS/NLCS/World Series`, flags like `ALCS • Game 5`.
- College football Saturday: every game involving an AP Top 25 team (use the current AP poll; say which
  week's poll in the league note). Weeknights: national-TV games (ESPN, ESPN2, FOX, CBS Sports Network).
  Label `NCAAF • Week N`; no conference names unless verified. No logos (numeric ESPN IDs).
- NHL: include only games with a national U.S. exclusive (ESPN, ABC, TNT/truTV, or an ESPN+/Hulu national
  stream). NHL Network, Prime Video local, and team-network games are regional and excluded.
- WNBA: playoff games only once the regular season ends.
- NASCAR Cup: one card per race, label `NASCAR Cup • The Chase` during the playoffs, venue_tz from the track.
- Venue timezone for Arizona is `Mountain Standard Time (Arizona)`.

**Flags.** Never repeat the coverage type as a flag (the badge is automatic). A streaming-only game with
coverage_type `Streaming exclusive` should use a flag like `ESPN+ • Hulu`, not "Streaming exclusive".

**Reliable data sources** (all reachable with curl; prefer these over search snippets):
- MLB: `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=YYYY-MM-DD&hydrate=broadcasts,probablePitcher,seriesStatus,venue`
- NHL: `https://api-web.nhle.com/v1/schedule/YYYY-MM-DD` (national U.S. broadcasts have market `N`)
- ESPN scoreboards: `https://site.api.espn.com/apis/site/v2/sports/<football/nfl|football/college-football|basketball/wnba|racing/...>/scoreboard?dates=YYYYMMDD`
  (add `&groups=80&limit=200` for all FBS college games; `curatedRank` matches the AP poll)
- AP poll: `https://site.api.espn.com/apis/site/v2/sports/football/college-football/rankings`
- Logos: `curl -sS -o /dev/null -w '%{http_code}' https://a.espncdn.com/i/teamlogos/<league>/500/<abbr>.png`
  (200 = exists). WebFetch is often blocked; curl works.

**Rebuilding after a data fix.** `build.py` archives the current `index.html` every time it runs. If you
must rebuild before committing, first restore the generated files
(`git checkout -- sports/index.html sports/status.json sports/archive/index.html`) and delete the
just-created `sports/archive/<yesterday>.html`, then run the build again. Otherwise today's desk gets
archived as if it were yesterday's.

**Accuracy over completeness.** If a time, network or stream can't be confirmed from a primary source,
use `TBD` or drop the claim. When a past desk turns out wrong, the archive can't be edited; mention the
correction in the run report and get it right in the next desk.

## Step 3: build and validate

```bash
python3 sports/_desk/build.py sports/_desk/data/<date>.json --check     # validation only
python3 sports/_desk/build.py sports/_desk/data/<date>.json             # validate + build
NODE_PATH=$(npm root -g) node sports/_desk/check.mjs sports/index.html <date> /tmp/desk-shots
```

`build.py` refuses to build if the date isn't today (ET), an event falls outside the Eastern day, a field is
blank instead of `TBD`, a logo isn't verified, preseason/exhibition wording appears in a label, ids or games
repeat, a regional MLB game has no RSN info, or the live desk is newer. Fix the data and rerun; never
bypass validation (`--allow-date-mismatch` is for local testing only, never for publishing).

Also look at the screenshots in `/tmp/desk-shots/` (desktop + mobile) before committing. Then re-read the
data once more against the checklist: right date, every event on the ET day, count right, no preseason, no
duplicates, broadcasts and National/Regional labels right.

## Step 4: commit and push

```bash
git add sports/
git commit -m "Daily Sports Desk | September 29, 2026"
git push origin HEAD:main
```

If the push is rejected because `main` moved, `git pull --rebase origin main` and push again (then rebuild if
`sports/index.html` conflicted). If the push fails for auth/network reasons, retry up to 3 times over a few
minutes. Never claim a commit or push worked unless `git push` succeeded and `git ls-remote origin main` shows
your commit SHA.

## Step 5: verify deployment

GitHub Pages rebuilds after the push (usually 1–3 minutes). Poll up to ~10 minutes:

- If the GitHub API is reachable, check `GET /repos/IsaiahAltDelete/isaiart/pages/builds/latest` for
  `status: built` and your commit SHA.
- Always confirm the live result: WebFetch `https://isaiart.com/sports/status.json?v=<unix-time>` shows
  today's `date` and the new `updated` value, and `https://isaiart.com/sports/?v=<unix-time>` shows today's
  full date and "Updated … ET".

The run is only successful when the live page shows the new desk.

## Failure rules

- If validation or browser checks fail and you can't fix them, **do not commit**. Yesterday's page stays live.
- Never leave a half-built page live. If a bad commit went out, `git revert` it and push, then verify the
  previous page is back.
- If the GitHub connection is unavailable, retry; if it stays down, stop and report. The next recovery run retries.
- Never overwrite a newer valid desk with an older one (`build.py` enforces this; don't work around it).

## Report (final message of every run)

Success:
> Daily Sports Desk | <Weekday, Month D, YYYY> is live. <N> events. Headliners: <2–3 headlines>.
> Pages deploy verified (commit <sha>). https://isaiart.com/sports

No action needed: one line saying the desk is already live for today.

Failure: which stage failed (research / validation / browser checks / push / deploy), what was tried,
whether the previous page is still intact, and whether Isaiah needs to do anything. On the 11:00 run,
say this was the last automatic retry for the day.
