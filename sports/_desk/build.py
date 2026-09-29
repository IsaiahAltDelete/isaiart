#!/usr/bin/env python3
"""Daily Sports Desk builder.

Renders sports/index.html from sports/_desk/data/<date>.json using the locked
template at sports/_desk/template.html. Stdlib only.

Usage:
  python3 sports/_desk/build.py sports/_desk/data/2026-09-29.json            # validate + build
  python3 sports/_desk/build.py sports/_desk/data/2026-09-29.json --check    # validate only
  python3 sports/_desk/build.py DATA --allow-date-mismatch                    # testing/backfill only

What a build does, in order:
  1. Validates the data file (exits non-zero with a list of problems if anything fails).
  2. Refuses to replace a live desk that is dated AFTER the new one.
  3. If the live desk is for an EARLIER date, archives it to sports/archive/<date>.html
     (never overwrites an existing archive file).
  4. Writes sports/index.html, sports/status.json and regenerates sports/archive/index.html.
"""
import argparse, datetime as dt, html, json, re, sys
from pathlib import Path
from zoneinfo import ZoneInfo

TEMPLATE_VERSION = "2026-09-29.1"
ET = ZoneInfo("America/New_York")
HERE = Path(__file__).resolve().parent
SPORTS = HERE.parent
ARCHIVE = SPORTS / "archive"
INDEX = SPORTS / "index.html"
STATUS = SPORTS / "status.json"
LOGOS = HERE / "logos.json"
TEMPLATE = HERE / "template.html"
ARCHIVE_TEMPLATE = HERE / "archive-template.html"

# Muted league accents (3px left border + filter swatch). Data may override per league.
DEFAULT_COLORS = {
    "NFL": "#4a6572", "NBA": "#7a5f4e", "MLB": "#6d7f91", "NHL": "#56636b", "WNBA": "#956f82",
    "MLS": "#617b6a", "NCAAF": "#7b6a4f", "NCAAM": "#6f6a8a", "NCAAW": "#86697a",
    "EPL": "#6a5f7d", "UCL": "#4f5f7d", "LIGAMX": "#6b7a55", "USMNT": "#617b6a", "USWNT": "#617b6a",
    "INTL": "#765b6f", "NATIONS": "#765b6f", "UFC": "#7a5252", "BOXING": "#7a5252",
    "GOLF": "#5f7a5a", "TENNIS": "#7c7a4f", "F1": "#8a5a5a", "NASCAR": "#66696b", "INDYCAR": "#5a6a8a",
}
COVERAGE_TYPES = {"National", "Regional", "National + Regional", "Local", "Streaming exclusive", "TBD"}
STATUSES = {None, "", "Scheduled", "In Progress", "Final", "Postponed", "Delayed", "Canceled"}
REQUIRED_EVENT = ["id", "league", "label", "competitors", "watch", "streaming", "coverage_type",
                  "coverage", "venue", "venue_tz", "notes", "blackout"]
BANNED_WORDS = re.compile(r"\b(preseason|pre-season|exhibition|spring training|scrimmage)\b", re.I)
ESPN_LOGO = re.compile(r"^https://a\.espncdn\.com/i/teamlogos/[a-z0-9_-]+/500/[a-z0-9_-]+\.png$")

esc = lambda s: html.escape(str(s if s is not None else ""), quote=True)


def et_now():
    return dt.datetime.now(ET)


def parse_iso(s):
    d = dt.datetime.fromisoformat(s)
    if d.tzinfo is None:
        raise ValueError(f"timestamp without offset: {s}")
    return d


def long_date(d):
    return d.strftime("%A, %B ") + str(d.day) + d.strftime(", %Y")


def title_date(d):
    return d.strftime("%B ") + str(d.day) + d.strftime(", %Y")


def clock(d):
    return d.strftime("%I:%M %p").lstrip("0")


# ---------------------------------------------------------------- validation
def validate(data, logos, allow_mismatch=False):
    errs, warns = [], []
    try:
        desk = dt.date.fromisoformat(data["date"])
    except Exception:
        return [f"bad or missing date: {data.get('date')!r}"], warns
    today = et_now().date()
    if desk != today and not allow_mismatch:
        errs.append(f"desk date {desk} is not today's Eastern date {today}")
    try:
        upd = parse_iso(data["updated"]).astimezone(ET)
        if upd.date() != desk and not allow_mismatch:
            errs.append(f"updated timestamp {upd} is not on the desk date")
    except Exception as e:
        errs.append(f"bad updated timestamp: {e}")
    if not data.get("dst_note"):
        errs.append("dst_note missing")

    leagues = {l["key"]: l for l in data.get("leagues", [])}
    if not leagues:
        errs.append("no leagues defined")
    used_leagues = set()
    ids, fingerprints = set(), set()
    events = data.get("events", [])

    def check_event(ev, upcoming=False):
        where = f"event {ev.get('id', '?')}"
        for f in REQUIRED_EVENT:
            v = ev.get(f)
            if v is None or (isinstance(v, str) and not v.strip()) or (isinstance(v, list) and not v):
                errs.append(f"{where}: missing '{f}' (write TBD if it cannot be confirmed)")
        if ev.get("id") in ids:
            errs.append(f"{where}: duplicate id")
        ids.add(ev.get("id"))
        if ev.get("league") not in leagues:
            errs.append(f"{where}: league '{ev.get('league')}' not in leagues list")
        if ev.get("coverage_type") not in COVERAGE_TYPES:
            errs.append(f"{where}: coverage_type must be one of {sorted(COVERAGE_TYPES)}")
        if ev.get("status") not in STATUSES:
            errs.append(f"{where}: status must be one of {sorted(s for s in STATUSES if s)}")
        stage_text = " ".join([ev.get("label", "")] + [str(f) for f in ev.get("flags", [])])
        if BANNED_WORDS.search(stage_text):
            errs.append(f"{where}: preseason/exhibition wording in label/flags")
        names = []
        for c in ev.get("competitors", []):
            if not c.get("name"):
                errs.append(f"{where}: competitor without name")
            if not c.get("abbr"):
                errs.append(f"{where}: competitor '{c.get('name')}' needs abbr for logo fallback")
            if c.get("logo"):
                url = logos.get(c["logo"])
                if not url:
                    errs.append(f"{where}: logo key '{c['logo']}' is not in logos.json (verify it first, or omit logo)")
                elif not ESPN_LOGO.match(url):
                    errs.append(f"{where}: logo '{c['logo']}' is not an ESPN CDN teamlogos URL")
            names.append((c.get("name") or "").lower())
        start = ev.get("start")
        if start:
            try:
                s = parse_iso(start).astimezone(ET)
                if upcoming:
                    end_of_desk = dt.datetime.combine(desk, dt.time(23, 59, 59), ET)
                    if not (end_of_desk < s <= end_of_desk + dt.timedelta(hours=48)):
                        errs.append(f"{where}: Next 48 Hours event must start after the desk day and within 48h ({s})")
                elif s.date() != desk:
                    errs.append(f"{where}: starts {s:%Y-%m-%d %I:%M %p} ET, outside the desk's Eastern calendar day")
            except Exception as e:
                errs.append(f"{where}: bad start: {e}")
        elif not ev.get("time_tbd"):
            errs.append(f"{where}: no start time (set time_tbd: true if the time is unconfirmed)")
        fp = (ev.get("league"), tuple(sorted(names)), (start or "")[:13])
        if fp in fingerprints:
            errs.append(f"{where}: duplicate of another event (same league, competitors, start hour)")
        fingerprints.add(fp)
        if not upcoming:
            used_leagues.add(ev.get("league"))
        if ev.get("league") == "NFL" and ev.get("coverage_type") == "Regional":
            txt = (ev.get("coverage", "") + " " + ev.get("blackout", "")).lower()
            for needle in ("zip", "sunday ticket"):
                if needle not in txt:
                    warns.append(f"{where}: regional NFL game should mention {needle!r} in coverage/blackout")
        if ev.get("league") == "MLB" and ev.get("coverage_type") in ("Regional", "National + Regional") and not ev.get("rsn"):
            errs.append(f"{where}: regional MLB game needs 'rsn' (RSNs + territorial restrictions)")

    for ev in events:
        check_event(ev)
    for ev in data.get("next48", []):
        check_event(ev, upcoming=True)

    unused = set(leagues) - used_leagues
    if unused:
        errs.append(f"leagues with no events today (remove them): {sorted(unused)}")
    if not events and not data.get("light_day_note"):
        errs.append("no events: set light_day_note to explain the empty day")
    if data.get("next48") and not data.get("light_day_note"):
        warns.append("next48 is meant for light days; add light_day_note or drop next48")
    if len(events) < 4 and not data.get("light_day_note"):
        warns.append("fewer than 4 events: consider a light_day_note")
    if not data.get("sources"):
        errs.append("sources list is empty")
    return errs, warns


# ------------------------------------------------------------------ render
def render_card(ev, lg, logos, desk, upcoming=False):
    flags = []
    status = ev.get("status") or ""
    if status == "In Progress":
        flags.append('<span class="flag live">In progress</span>')
    elif status == "Final":
        flags.append('<span class="flag final">Final</span>')
    elif status in ("Postponed", "Delayed", "Canceled"):
        flags.append(f'<span class="flag elim">{esc(status)}</span>')
    cov = ev["coverage_type"]
    flags.append(f'<span class="flag{" regional" if "Regional" in cov or cov == "Local" else ""}">{esc(cov)}</span>')
    for f in ev.get("flags", []):
        cls = " elim" if re.search(r"elimination|championship|final|game 7|decider", f, re.I) else ""
        flags.append(f'<span class="flag{cls}">{esc(f)}</span>')

    teams = []
    comps = ev["competitors"]
    for i, c in enumerate(comps):
        url = logos.get(c.get("logo") or "")
        ab = esc(c["abbr"])
        if url:
            logo = (f'<img src="{esc(url)}" alt="" loading="lazy" width="26" height="26" '
                    f'onerror="this.style.display=\'none\';this.nextElementSibling.classList.add(\'show\')">'
                    f'<span class="fallback" aria-hidden="true">{ab}</span>')
        else:
            logo = f'<span class="fallback show" aria-hidden="true">{ab}</span>'
        rec = f' <span class="record">{esc(c["detail"])}</span>' if c.get("detail") else ""
        teams.append(f'<div class="team">{logo}<span>{esc(c["name"])}{rec}</span></div>')
        if i == 0 and len(comps) == 2 and ev.get("separator"):
            teams.append(f'<div class="sep">{esc(ev["separator"])}</div>')

    if ev.get("start"):
        s = parse_iso(ev["start"]).astimezone(ET)
        base = esc(ev["start"])
        if upcoming:
            txt = s.strftime("%a, %b ") + str(s.day) + " • " + clock(s) + " ET"
            time_html = f'<div class="time" data-base="{base}" data-upcoming="1">{txt}</div>'
        else:
            time_html = f'<div class="time" data-base="{base}">{clock(s)} ET</div>'
    else:
        time_html = '<div class="time">Time TBD</div>'
    score = f'<div class="score">{esc(ev["score"])}</div>' if ev.get("score") else ""

    st = ev["streaming"]
    watch = ev["watch"] if st in ev["watch"] else (f'{ev["watch"]} • Streaming TBD' if st == "TBD" else f'{ev["watch"]} • {st}')
    rows = [("Watch", watch),
            ("Venue", f'{ev["venue"]} • {ev["venue_tz"]}'),
            ("Coverage", ev["coverage"])]
    if ev.get("rsn"):
        rows.append(("Local/RSN", ev["rsn"]))
    dl = "".join(f"<dt>{esc(k)}</dt><dd>{esc(v)}</dd>" for k, v in rows)

    search_bits = [ev["league"], lg["name"], ev["label"], ev["watch"], ev["streaming"], ev["venue"], ev.get("rsn", ""),
                   ev["coverage_type"], ev.get("search_extra", "")] + [c["name"] for c in comps] + [c["abbr"] for c in comps] + ev.get("flags", [])
    search = esc(" ".join(str(b) for b in search_bits if b).lower())
    counted = "" if upcoming else " data-counted"
    return f'''      <article class="card lg-{esc(ev["league"])}"{counted} data-league="{esc(ev["league"])}" data-search="{search}">
        <div class="topline"><span class="label">{esc(ev["label"])}</span><div class="flags">{"".join(flags)}</div></div>
        <div class="teams">{"".join(teams)}</div>
        {time_html}{score}
        <dl>{dl}</dl>
        <p class="notes"><strong>Notes:</strong> {esc(ev["notes"])}</p>
        <p class="blackout"><strong>Blackout / regional:</strong> {esc(ev["blackout"])}</p>
      </article>'''


def render(data, logos, archived=False):
    desk = dt.date.fromisoformat(data["date"])
    upd = parse_iso(data["updated"]).astimezone(ET)
    leagues = data["leagues"]
    lmap = {l["key"]: l for l in leagues}
    events = sorted(data["events"], key=lambda e: (e.get("start") is None, e.get("start") or ""))

    css = []
    for l in leagues:
        color = l.get("color") or DEFAULT_COLORS.get(l["key"], "#7d8582")
        css.append(f'    .lg-{l["key"]}{{--accent:{color}}}')

    filters = ['<button class="filter active" type="button" data-league="all" aria-pressed="true">All</button>']
    sections = []
    for l in leagues:
        evs = [e for e in events if e["league"] == l["key"]]
        if not evs:
            continue
        filters.append(f'<button class="filter lg-{esc(l["key"])}" type="button" data-league="{esc(l["key"])}" aria-pressed="false"><span class="swatch"></span>{esc(l["name"])}</button>')
        n = len(evs)
        head = f'{l["name"]} • {n} event{"s" if n != 1 else ""}'
        if l.get("subtitle"):
            head = f'{l["name"]} • {l["subtitle"]} • {n} event{"s" if n != 1 else ""}'
        note = f'<p>{esc(l["note"])}</p>' if l.get("note") else ""
        cards = "\n".join(render_card(e, l, logos, desk) for e in evs)
        sections.append(f'''  <section class="league-section" data-section="{esc(l["key"])}">
    <div class="summary"><div><div class="section-title">{esc(head)}</div>{note}</div></div>
    <div class="grid">
{cards}
    </div>
  </section>''')

    light = f'  <div class="notice"><strong>Light day:</strong> {esc(data["light_day_note"])}</div>' if data.get("light_day_note") else ""
    next48 = ""
    if data.get("next48"):
        cards = "\n".join(render_card(e, lmap.get(e["league"], {"name": e["league"]}), logos, desk, upcoming=True)
                          for e in sorted(data["next48"], key=lambda e: e.get("start") or ""))
        extra_css = {e["league"] for e in data["next48"]} - set(lmap)
        for k in extra_css:
            css.append(f'    .lg-{k}{{--accent:{DEFAULT_COLORS.get(k, "#7d8582")}}}')
        next48 = f'''  <section class="next48" aria-label="Next 48 Hours">
    <div class="summary"><div><div class="section-title">Next 48 Hours • not counted in today's total</div><p>A few notable upcoming events, shown with their own date.</p></div></div>
    <div class="grid">
{cards}
    </div>
  </section>'''

    src = " · ".join(f'<a href="{esc(s["url"])}" rel="noopener">{esc(s["label"])}</a>' for s in data["sources"])
    footer = ""
    if data.get("footer_note"):
        footer += f"<p>{esc(data['footer_note'])}</p>"
    footer += f"<p><strong>Sources checked {esc(title_date(desk))}:</strong> {src}</p>"
    footer += "<p>Broadcast and streaming access can vary by provider and plan. Anything that could not be confirmed is marked TBD.</p>"

    if archived:
        nav = '<a class="archive-button" href="/sports/">Current desk</a><a class="archive-button" href="/sports/archive/">Archive</a>'
    else:
        nav = '<a class="archive-button" href="/sports/archive/">Archive</a>'
    rep = {
        "DATE_TITLE": esc(title_date(desk)), "DATE_LONG": esc(long_date(desk)), "DESK_DATE": desk.isoformat(),
        "UPDATED_ISO": upd.isoformat(), "UPDATED_TEXT": esc(upd.strftime("%b ") + str(upd.day) + ", " + clock(upd) + " ET"),
        "EVENT_COUNT": str(len(events)), "TEMPLATE_VERSION": TEMPLATE_VERSION, "WEEKDAY": desk.strftime("%A"),
        "ARCHIVE_KICKER": " • Archived edition" if archived else "", "NAV": nav, "FILTERS": "".join(filters),
        "DST_NOTE": esc(data["dst_note"]), "LIGHT_NOTE": light, "SECTIONS": "\n\n".join(sections),
        "NEXT48": next48, "FOOTER": footer, "LEAGUE_CSS": "\n".join(css),
    }
    out = TEMPLATE.read_text()
    for k, v in rep.items():
        out = out.replace("{{" + k + "}}", v)
    left = re.findall(r"\{\{[A-Z_0-9]+\}\}", out)
    if left:
        raise SystemExit(f"unfilled template slots: {left}")
    return out


# ----------------------------------------------------------------- archive
def live_desk_date(text):
    m = re.search(r'<meta name="desk-date" content="(\d{4}-\d{2}-\d{2})"', text)
    if m:
        return dt.date.fromisoformat(m.group(1))
    m = re.search(r"<title>Daily Sports Desk \| (?:[A-Za-z]+, )?([A-Za-z]+ \d{1,2}, \d{4})</title>", text)
    if m:
        return dt.datetime.strptime(m.group(1), "%B %d, %Y").date()
    return None


def count_events_in_html(text):
    m = re.search(r'<meta name="desk-events" content="(\d+)"', text)
    if m:
        return int(m.group(1))
    return len(re.findall(r'<article class="card', text)) or None


def archive_live_page(logos, desk):
    """Move the current live page into the archive if it is for an earlier day."""
    if not INDEX.exists():
        return None
    text = INDEX.read_text()
    d = live_desk_date(text)
    if d is None or d >= desk:
        return None
    dest = ARCHIVE / f"{d.isoformat()}.html"
    if dest.exists():
        return d
    data_file = HERE / "data" / f"{d.isoformat()}.json"
    if data_file.exists():
        out = render(json.loads(data_file.read_text()), logos, archived=True)
    else:
        # Legacy hand-built page: keep it as-is, just add a Current desk button.
        out = text
        if 'href="/sports/">Current desk' not in out:
            out = out.replace('<a class="archive-button" href="/sports/archive/">',
                              '<a class="archive-button" href="/sports/">Current desk</a><a class="archive-button" href="/sports/archive/">', 1)
    ARCHIVE.mkdir(exist_ok=True)
    dest.write_text(out)
    return d


def rebuild_archive_index():
    old = (ARCHIVE / "index.html").read_text() if (ARCHIVE / "index.html").exists() else ""
    old_counts = dict(re.findall(r'href="\./(\d{4}-\d{2}-\d{2})\.html".*?class="archive-meta">(\d+) events?<', old, re.S))
    items = []
    for f in sorted(ARCHIVE.glob("????-??-??.html"), reverse=True):
        d = dt.date.fromisoformat(f.stem)
        data_file = HERE / "data" / f"{f.stem}.json"
        if data_file.exists():
            n = len(json.loads(data_file.read_text()).get("events", []))
        elif f.stem in old_counts:
            n = int(old_counts[f.stem])
        else:
            n = count_events_in_html(f.read_text())
        meta = f'{n} event{"s" if n != 1 else ""}' if n is not None else ""
        items.append(f'''      <a class="archive-card" href="./{f.stem}.html">
        <span><span class="label">Daily Sports Desk</span><time class="archive-date" datetime="{f.stem}">{esc(long_date(d))}</time></span>
        <span class="archive-meta">{meta}</span>
      </a>''')
    out = ARCHIVE_TEMPLATE.read_text().replace("{{ITEMS}}", "\n".join(items))
    (ARCHIVE / "index.html").write_text(out)
    return len(items)


# -------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("data")
    ap.add_argument("--check", action="store_true", help="validate only")
    ap.add_argument("--allow-date-mismatch", action="store_true", help="testing/backfill only")
    ap.add_argument("--out", help="write the page here instead of publishing (no archive/status changes)")
    a = ap.parse_args()

    data = json.loads(Path(a.data).read_text())
    logos = {k: v for k, v in (json.loads(LOGOS.read_text()) if LOGOS.exists() else {}).items() if not k.startswith("_")}
    errs, warns = validate(data, logos, a.allow_date_mismatch)
    for w in warns:
        print("WARN:", w)
    if errs:
        print(f"FAILED validation ({len(errs)} problems):")
        for e in errs:
            print("  -", e)
        sys.exit(1)
    print(f"OK: {data['date']} • {len(data['events'])} events • {len(data.get('next48', []))} next-48")
    if a.check:
        return
    page = render(data, logos)
    if a.out:
        Path(a.out).write_text(page)
        print("wrote", a.out)
        return

    desk = dt.date.fromisoformat(data["date"])
    if INDEX.exists():
        live = live_desk_date(INDEX.read_text())
        if live and live > desk:
            sys.exit(f"REFUSING: live desk is dated {live}, newer than {desk}. Nothing changed.")
        if live and live == desk:
            m = re.search(r'<meta name="desk-updated" content="([^"]+)"', INDEX.read_text())
            if m and parse_iso(m.group(1)) > parse_iso(data["updated"]):
                sys.exit(f"REFUSING: live desk for {desk} was updated at {m.group(1)}, later than this data. Nothing changed.")
    archived = archive_live_page(logos, desk)
    if archived and archived < desk:
        print("archived previous desk:", archived)
    INDEX.write_text(page)
    STATUS.write_text(json.dumps({
        "date": data["date"], "updated": data["updated"], "events": len(data["events"]),
        "headlines": data.get("headlines", []),
        "template": TEMPLATE_VERSION,
    }, indent=2) + "\n")
    n = rebuild_archive_index()
    print(f"wrote sports/index.html, sports/status.json, archive index ({n} editions)")


if __name__ == "__main__":
    main()
