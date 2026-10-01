# a1mobile Competitor Tracker

An internal tool that watches competitors' public websites, docs, changelogs, pricing and product pages, and shows **what changed, when, and who changed it**. Styling comes from a1mobile.com.

## Competitors tracked

| Group | Competitor | Site | What they do | Pages watched |
|---|---|---|---|---|
| AI-native phone systems | **Quo** (formerly OpenPhone) | quo.com | SMB phone system with the bundled Sona AI agent | home, pricing, Sona, integrations |
| | **Allo** | withallo.com | Business phone system with AI agents, IVR and routing | home, pricing, AI receptionist, integrations, changelog |
| | **Beside** | beside.com | "AI operating system" for local business: phone line + AI receptionist | home, pricing, integrations |
| Restaurant & hospitality AI | **Hostie** | hostie.ai | Restaurant voice + text concierge | home, pricing, features |
| | **Slang AI** | slang.ai | "AI Superhost" for restaurants, enterprise groups | home, pricing, product, integrations |
| | **Loman AI** | loman.ai | Restaurant phone answering with POS ordering | home, pricing |
| | **Maple** | maple.inc | Voice AI phone ordering for restaurants | home, pricing, product, integrations, docs |
| | **VOICEplug** | voiceplug.ai | Voice AI food ordering for chains (phone + drive-thru) | home |
| SMB AI receptionists | **Goodcall** | goodcall.com | AI phone agent priced by unique callers | home, pricing |
| | **Rosie** | heyrosie.com | AI answering for trades and home services | home, pricing |
| | **Frontdesk AI** | myaifrontdesk.com | AI receptionist with texting and CRM workflows | home, pricing, features |
| | **Smith.ai** | smith.ai | Hybrid AI + live human receptionists | home, pricing, AI receptionist, integrations |
| | **Upfirst** | upfirst.ai | AI answering service with a public changelog and MCP server | home, pricing, features, integrations, changelog, docs |
| | **Newo** | newo.ai | Ready-to-deploy voice AI receptionists | home, pricing |

The quickest ones to check for the call benchmark are Quo, Allo and Beside, since they also sell the phone line the way a1mobile does, plus Hostie, Slang and Maple in restaurants. To add or remove a competitor, edit [`competitors.json`](competitors.json).

## Running it

Needs Node 20 or newer. There are no dependencies.

**Fastest way to look at it:** open `dashboard.html`. It's a single self-contained file (styles and data included) that's regenerated on every scan or build, and it opens straight from Finder or can be shared. Don't open `public/index.html` directly. That page needs the local server below.

```bash
npm run serve        # dashboard + live watcher at http://localhost:4321
npm run scan         # one-off check of every page
npm run backfill     # pull 12 months of history from the Internet Archive (one-time)
npm run build        # recompute all change events from stored snapshots
npm run check-links  # verify every Internet Archive link on the dashboard opens the right capture
```

## Real-time monitoring

`npm run serve` runs a watcher alongside the dashboard:

- **Every page is re-checked every ~2 minutes** (`WATCH_INTERVAL=120`, in seconds). Checks are staggered so overall it's about one request every 2.6 seconds, and no site gets hit hard.
- **When content changes, the page is fetched again 20 seconds later.** The change is recorded only if it held. This filters out rotating testimonials and A/B tests.
- **New changes appear on any open dashboard immediately** over Server-Sent Events: a toast, a NEW badge, and a count in the tab title, with no refresh needed. Changes detected while you were away are marked NEW on your next visit.
- **Alerts (optional):** `NOTIFY=1` sends a macOS notification. `SLACK_WEBHOOK_URL=…` posts high-signal and A1-relevant changes to Slack.

Worst-case latency from a competitor publishing to it showing on the dashboard is about 2½ minutes: up to one check interval plus the 20-second confirmation. Competitors don't push their changes anywhere, so polling is the limit. Lowering `WATCH_INTERVAL` shortens the delay at the cost of more requests.

### Hosted on GitHub (no laptop needed)

[`.github/workflows/watch.yml`](.github/workflows/watch.yml) runs `tracker/scan.mjs` every 5 minutes on GitHub Actions:

- New versions are committed back to the repo, so the full history lives in git.
- The dashboard is published to GitHub Pages. Any open tab checks for new data every minute and shows the same toast and NEW badges.
- The **Run a check** button opens the workflow so you can trigger a run by hand.
- **Slack alerts:** add a repo secret `SLACK_WEBHOOK_URL`, and optionally a repo variable `DASHBOARD_URL` so alerts link back to the dashboard.

Expected delay is 5–10 minutes. GitHub doesn't guarantee schedule timing, and runs can start 10–30 minutes late when it's busy. For true 2-minute checks, run `npm run serve` on an always-on server instead.

One-time setup: push the repo, then go to **Settings → Pages → Source** and choose **GitHub Actions**.

## How it works

1. **Snapshot.** Each page is fetched and reduced to readable text blocks (navigation, footers, cookie banners and scripts are removed). A new snapshot is saved only when the text changes (`data/snapshots/<competitor>/<page>/<timestamp>.json`).
2. **Extract facts.** Keyword lists in [`tracker/lib/vocab.mjs`](tracker/lib/vocab.mjs) turn the copy into structured facts: price points, integrations, industries, capabilities and languages.
3. **Diff.** Consecutive snapshots are compared ([`tracker/lib/diff.mjs`](tracker/lib/diff.mjs)) and produce typed events:
   - **Pricing**: price points added, removed or changed
   - **Feature / Docs**: newly mentioned capabilities, new changelog entries, new languages
   - **Integration**: new partners mentioned
   - **Industry**: verticals added to or dropped from the copy
   - **Positioning**: changes to the title, headline or meta description
   - **Messaging**: copy rewrites and new sections

   Each event gets a significance score. Numbers that change on every visit (for example "12,481 calls answered") are ignored.
4. **A1 relevance.** Events are flagged when a competitor adds a capability a1mobile doesn't list (`self.capabilities` in `competitors.json`), lists a monthly price below $99, moves into an a1mobile vertical, or starts describing itself as a carrier or AI-native line.
5. **Rebuild.** Events are always recomputed from the stored snapshots, so improving the keyword lists or diff rules re-scores the whole history.

## Caveats

- Facts come from keyword matching on marketing copy. They show what a competitor *claims*, not what the product does. Use the "Show diff" and "Before ↗" links to check before acting on something.
- An event's date is when the change was *detected*. The actual change happened somewhere between the "Before" date and that date. For backfilled history, the gap is at most about a month.
- Pages that render with JavaScript only show the text in their initial HTML. Hostie's pricing page, for example, doesn't publish a price that way.
