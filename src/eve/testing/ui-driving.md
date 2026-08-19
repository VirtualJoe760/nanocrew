# Driving the app — taps, deep links, and eyes

Voice gets Eve talking; it does not press buttons. Anything with a modal — the product picker,
enhance-or-as-is, placement, publish — needs a real tap. This is how to get one.

## Eyes (works today, no permission)

```bash
xcrun simctl io booted screenshot /tmp/s.png     # framebuffer grab, straight from the Simulator
sips -Z 620 /tmp/s.png --out /tmp/s-small.png    # shrink before reading it
```

Then read the PNG. The framebuffer is **3× device points** on an iPhone 16e (1206×2622 ⇒ 402×874
points), so divide screenshot pixel coordinates by 3 before tapping.

> `screencapture` (the macOS one) returns **only the desktop wallpaper** on this machine — the
> process has no Screen Recording permission. Don't waste time on it; use the simctl grab.

## Taps — pick the first that's available

| Option | Command | Notes |
|---|---|---|
| **computer-use MCP** | its own `left_click` | Best if your session has it. Coordinates are *screen* pixels; front the Simulator first. |
| **idb** (recommended fallback) | `idb ui tap X Y` | Talks to the Simulator directly, **no Accessibility permission needed**, coordinates are *device points*. Install: `brew tap facebook/fb && brew install idb-companion && pipx install fb-idb` |
| **cliclick** | `cliclick c:X,Y` | `brew install cliclick`; needs Accessibility granted to your terminal; *screen* coordinates |
| **AppleScript** | `osascript -e 'tell application "System Events" to click at {x, y}'` | **Currently fails with `-25204`** — Accessibility isn't granted. Reading window geometry works; clicking doesn't. |

Window geometry, when you need screen coordinates:

```bash
osascript -e 'tell application "System Events" to tell process "Simulator" to get {position, size} of window 1'
# → 629, 73, 452, 950   (x, y, w, h; the device screen sits inside, below a ~28px title bar)
```

## Deep links — the parts you can reach without tapping

```bash
xcrun simctl openurl booted "nanocrew://studio?talk=1"                    # DEV: open a voice session
xcrun simctl openurl booted "nanocrew://design?panel=web"                 # Design tab, dock open
xcrun simctl openurl booted "nanocrew://design?action=generate&prompt=neon%20bulldog"
xcrun simctl openurl booted "nanocrew://design?action=generate&prompt=mondays&meme=1"
xcrun simctl openurl booted "nanocrew://design?edit=<designId>"           # open the editor on a design
xcrun simctl openurl booted "nanocrew://market?store=night-circuit"       # open a brand store
xcrun simctl openurl booted "nanocrew://studio?reviewSlug=<slug>&reviewName=<name>"
```

If a link seems ignored, the app is probably already on that route: bounce through another one
(`nanocrew://market`) and back. If a code change seems ignored, Fast Refresh didn't take —
`xcrun simctl terminate booted com.nanocrew.app && xcrun simctl launch booted com.nanocrew.app`.

## The API layer — the flows, without the UI

`getUserFromRequest` accepts a shared internal key, so a script can act as a creator:

```bash
set -a; . ./.env.local; set +a
curl -s http://localhost:8081/api/me \
  -H "x-internal-key: $INTERNAL_API_KEY" \
  -H "x-internal-creator: c60f23f8-f804-4ecb-8018-36e90433a96e"
```

Two things follow from this, and both matter:

1. **It runs as `internal@nanocrew`, which is exempt from credit charges** — API-driven runs are
   free. UI-driven runs spend Joe's real credits (generate 8 · edit 8 · model shots 25).
2. It is the deterministic way to set up state (a brand, a design, a composition) so a UI test can
   start from a known place instead of ten minutes of tapping.

Use it for setup and verification; use the UI for what you're actually testing.
