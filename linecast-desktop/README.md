# linecast desktop

A desktop window, and a Home Assistant feed, for
[linecast](https://github.com/ashuttl/linecast): weather, the sun, the moon,
tides and the sky, drawn as a proper graphical dashboard instead of in a
terminal.

linecast itself does all the work: it fetches the forecasts and computes the
sun, moon, sky and tides. linecast desktop is a small local web server that
runs linecast for its `--json` data and its colored drawings, then shows them
in a window. It uses only the Python standard library besides linecast.

What you get:

- **A dashboard** with the current weather, an hourly chart and a seven-day
  outlook, the sun's path today, the moon's phase, a tide chart, and a map of
  the sky overhead. Hover over a chart for exact values.
- **linecast's own drawings**, including radar and maps, shown in color in a
  panel of their own.
- **Single-card windows**, such as just the moon, for a small widget-style
  window or a Home Assistant card.
- **A Home Assistant feed**: one URL with every value Home Assistant needs for
  sensors, and ready-made YAML.

## Windows 11 setup

You need either [uv](https://docs.astral.sh/uv/) or Python 3.10 or newer.
uv is the easiest. Open a terminal and run:

```powershell
winget install astral-sh.uv
```

Then put this `linecast-desktop` folder anywhere you like, open its `windows`
folder, and double-click **Start-Linecast-Desktop.bat**. The first start takes
a minute while it installs linecast. After that, the dashboard opens in its own
window, with no tabs or address bar.

A console window stays open alongside it. That is the server; closing it stops
linecast desktop.

### Choosing the place and units

linecast uses its saved location if you have set one with `linecast location`.
Otherwise it finds you from your network address. To fix a place, type it in
the box at the top of the dashboard, or start with options:

```bat
Start-Linecast-Desktop.bat --location "Portland, Maine" --imperial
Start-Linecast-Desktop.bat --location "43.66,-70.25" --metric
```

### Start it when you sign in

Run this once from the `windows` folder:

```powershell
powershell -ExecutionPolicy Bypass -File Install-Startup.ps1
```

Add `-Arguments '--location "Portland, Maine"'` to start with options, or run
it with `-Remove` to undo it.

### Ways to keep it on your desktop

- **Its own window.** Right-click its taskbar icon and pin it. In Edge you can
  also use the menu's **Apps**, then **Install this site as an app**, to add it
  to the Start menu.
- **One card as a small widget window.** Start with `--view moon`, or `sun`,
  `weather`, `tides`, `sky` or `art`. Add `&bare=1` to the address to hide the
  header.
- **As your wallpaper.** The free [Lively Wallpaper](https://www.rocksdanister.com/lively/)
  app can show a web page as a live wallpaper. Give it the address
  `http://127.0.0.1:8765/?bare=1`, or a single card such as
  `http://127.0.0.1:8765/?view=art&app=sky&bare=1`. This route has not been
  tested yet.

## Home Assistant

Home Assistant reads linecast desktop over your home network, so the PC must
be on and linecast desktop running.

1. Start linecast desktop with `--lan` so other devices can reach it:

   ```bat
   Start-Linecast-Desktop.bat --lan
   ```

   Windows asks whether to allow Python through the firewall. Allow it on
   **private** networks only.

2. Find your PC's address with `ipconfig`. It looks like `192.168.1.50`.
   Check it from another device by opening `http://192.168.1.50:8765/`.

3. **Sensors.** Copy `homeassistant/linecast.yaml` to Home Assistant's
   `config/packages/` folder, replace the address in it, and restart Home
   Assistant. This adds sensors for temperature, conditions, sunrise and
   sunset, moon phase, the next tide and more, all from one request every five
   minutes.

4. **Cards.** `homeassistant/dashboard-cards.yaml` has cards to paste into a
   dashboard: the linecast desktop cards themselves, and a plain list of the
   sensors.

The webpage cards load over plain `http`. They only show when you open Home
Assistant over `http` on your home network. Over `https`, such as remote
access through Nabu Casa, the browser blocks them, so use the sensor list
there.

## Options

| Option | What it does |
| --- | --- |
| `--location PLACE` | A place name or `lat,lon`. |
| `--metric`, `--imperial` | Units for weather and tides. |
| `--lang CODE` | linecast's display language, such as `fr` or `ja`. |
| `--lan` | Listen on your network too, for Home Assistant. |
| `--port N` | The port to use. The default is 8765. |
| `--open` | Open the dashboard window once the server is up. |
| `--view CARD` | With `--open`, show one card. |

The same settings can come from the environment variables
`LINECAST_LOCATION`, `LINECAST_UNITS`, `LINECAST_LANG`,
`LINECAST_DESKTOP_PORT` and `LINECAST_DESKTOP_LAN`.

### Page addresses

| Address | Shows |
| --- | --- |
| `/` | The whole dashboard. |
| `/?view=moon` | One card: `weather`, `sun`, `moon`, `tides`, `sky` or `art`. |
| `/?view=art&app=radar` | One of linecast's drawings: `radar`, `weather`, `sunshine`, `moon`, `sky`, `tides` or `maps`. |
| `&bare=1` | Hides the header and footer. |
| `&theme=dark` | Forces the dark or light theme. |
| `&location=Reykjavik` | Overrides the place for this page. |

### Data addresses

| Address | Returns |
| --- | --- |
| `/api/summary` | Flat values for Home Assistant. |
| `/api/weather`, `/api/sunshine`, `/api/moon`, `/api/tides`, `/api/sky` | linecast's own `--json` output. |
| `/api/art/<app>?cols=100&rows=30` | One colored linecast drawing as HTML. |

## How it works

Each request runs `python -m linecast <app> --json` or `--print`, with no
shell, and caches the result: ten minutes for weather and tides, one to five
minutes for the sun, moon and sky. If a refresh fails, the last good result is
shown with a "last good data" tag. By default the server listens only on this
computer. `--lan` opens it to your network. It serves only its own files and
linecast's output, and passes a requested place to linecast as a single
argument.

Colored drawings are converted from terminal colors to HTML. Block characters
are painted as colored cells rather than drawn with a font, so pictures tile
the same in any browser.

## Development

```sh
uv run --with pytest python -m pytest
uv run linecast-desktop --open
```

The tests run the real linecast for the moon, sun and tides, which work
without network access. Weather, radar and maps need linecast's public data
sources to be reachable.
