# Windows 11 desktop

A browser recreation of the current Windows 11 interface. It sits beside the Mac and iPhone recreations and serves the same purpose: practising familiar Windows screens when a Windows PC isn't available. The reference is **Windows 11 Home, version 26H2** (OS build 26300). That was the fall 2026 enablement-package release when this was built on October 28, 2026.

Open `index.html` in a modern desktop browser. Keep the adjacent `assets`, `scripts` and `styles` folders. No build step or package installation is needed. The default view is the signed-in desktop. Query options:

| Query | Effect |
| --- | --- |
| `?lock` | Opens on the lock screen |
| `?login` | Opens on the sign-in screen |
| `?boot` | Plays the startup sequence |
| `?reset` | Discards the saved PC and starts fresh |
| `?app=<id>` | Opens an app, for example `?app=settings&page=wifi` |

Preferences, files, Wi-Fi profiles, mail and app data persist in local browser storage. The fictional account PIN is `1234`. The fictional Sablewave Home Wi-Fi key is `sablewave` (it is also in *Wi-Fi password.txt* on the desktop).

## What's included

- **Shell.** Centered or left taskbar with live running indicators, hover previews, jump lists and pinning. It also has Widgets, a hidden-icons tray, Quick Settings (Wi-Fi joining, Bluetooth, airplane mode, brightness, volume, Night light, accessibility, cast and project), and Notification Center with a calendar and Focus. The Start menu has the 26H2 layout: Pinned, Recommended, and All apps by category, grid or list. There is also Search with filters and a preview pane, Task View, and the Win+X menu.
- **Windows.** Drag, resize from any edge, double-click to maximize, Snap by dragging to an edge or corner, Snap Layouts on the maximize button, Win+Arrow snapping and Show desktop.
- **Desktop.** Icons for the Recycle Bin, Edge and the Desktop folder, with drag-to-arrange, marquee selection, inline rename and cut/copy/paste. Dropping items on folders or the Recycle Bin moves them. Desktop context menus include View, Sort by, New, Display settings and Personalize.
- **Session.** Lock screen, Windows Hello PIN sign-in, sign out, sleep, restart and shut down. Pending Windows updates install on restart with the "Working on updates" screen. There is also a User Account Control prompt.
- **Apps.** Settings, File Explorer, Notepad, Photos, Paint, Microsoft Edge, Terminal (PowerShell and Command Prompt), Task Manager, Calculator, Clock, Control Panel, Run, About Windows, Microsoft Store, Outlook, Weather, Copilot and Snipping Tool (Print Screen works too).

## Shared network model

`scripts/04-network.js` answers one question for every surface: is this PC online, and if not, why? The tray icon, Quick Settings, Settings, Control Panel, Edge, Store, Outlook and the command line all read it. They always agree. A wrong manual DNS server, for example, shows "No internet" in the tray, `DNS_PROBE_FINISHED_NO_INTERNET` in Edge, a failed `ping google.com` (while `ping 8.8.8.8` still replies) and a detectable problem in Windows Network Diagnostics.

Modeled faults include airplane mode, Wi-Fi off, a disabled adapter, no connection, wrong-subnet static addresses, APIPA, networks without internet access, unreachable DNS servers and a bad manual proxy. A proxy fault affects web traffic only. Reachable resolvers are the well-known public ones; the documentation ranges (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`) time out. The only proxy that works is `proxy.support.example`. Everything here is a fictional fixture. Nothing touches the host network.

## Limits

This runs in a browser. It does not boot Windows or run Windows programs, and it changes no real device settings. Edge shows local pages and live Wikipedia articles; other sites are limited by browser embedding rules. Hardware, Microsoft services, Windows Hello biometrics, virtual desktops and many secondary controls are approximated or omitted. App, shell and Control Panel icons and the default wallpapers are unaltered Windows 11 artwork copied from a Windows install or Microsoft Store listings; `assets/icons/sources.json` and `assets/wallpapers/sources.json` record where each came from. File-type icons and the extra wallpapers are original vector drawings. Segoe UI Variable is used when the host has it; otherwise the bundled Inter font stands in. The person, accounts, networks and files are fictional, and every address uses the reserved `.example` domain.

## Development

The code is buildless: classic scripts hang off one global, `Win`, in numbered modules.

| Range | Contents |
| --- | --- |
| `01–07` | Core helpers, icons, state and file system, network, dialogs and menus, window manager, appearance |
| `08–12` | Taskbar, Start and Search, flyouts, desktop, session |
| `20–23` | File Explorer, Notepad, Photos, Paint |
| `30` | Settings |
| `40–44` | Edge, Terminal, Task Manager, Calculator, Clock |
| `50` | Smaller apps |
| `99` | Boot |

Apps register with `Win.apps.register` (documented at the top of `06-wm.js`) and render into their window body.

To run the checks:

```bash
node tests/smoke.cjs
```

The other files in `tests/` cover individual app groups.
