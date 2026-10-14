# Baseline research and source comparison

Checked October 12, 2026. Apple lists **macOS Golden Gate 27.0.1** as the latest macOS release, released September 28, 2026. macOS 27 supports Apple silicon; the recreation represents a fictional M4 Pro MacBook Pro. No Apple build identifier or serial number was verified; native About screens omit these values.

## Sources

| Apple source | Used for |
| --- | --- |
| [Apple security releases](https://support.apple.com/en-us/100100) | Current public version and release date |
| [Current macOS](https://www.apple.com/os/macos/) | Golden Gate identity and Liquid Glass design direction |
| [Enterprise changes in macOS 27](https://support.apple.com/en-us/148830) | 27.0.1 Platform SSO fix and current enterprise context |
| [macOS 27 compatibility](https://support.apple.com/en-ca/127255) | Apple silicon baseline |
| [Wi-Fi settings, macOS 27](https://support.apple.com/en-euro/guide/mac-help/mh11935/27/mac/27) | Details sections, auto-join, private address and forgetting a network |
| [DHCP or manual IP](https://support.apple.com/en-gb/guide/mac-help/mchlp2718/27/mac/27) | Network → service → Details → TCP/IP; DNS server entry |
| [Menu Bar settings](https://support.apple.com/en-euro/guide/mac-help/mchlad96d366/27/mac/27) | Current Menu Bar pane and controls |
| [Appearance settings](https://support.apple.com/en-euro/guide/mac-help/mchlp1225/27/mac/27) | Liquid Glass slider, icon/widget styles and appearance labels |
| [View and open apps](https://support.apple.com/en-by/guide/mac-help/mh35840/27/mac/27) | Apps icon in Dock opens Spotlight app browsing, replacing Launchpad |
| [Siri settings](https://support.apple.com/guide/mac-help/siri-settings-on-mac-mchl3fd7fc15/27/mac/27) | Separate Siri pane, Requests and Siri AI/Classic distinction |
| [Screen and system audio recording](https://support.apple.com/guide/mac-help/control-access-screen-system-audio-recording-mchld6aa7d23/mac) | Privacy & Security → Screen & System Audio Recording |
| [Login Items & Extensions](https://support.apple.com/en-euro/guide/mac-help/mtusr003/27/mac/27) | General → Login Items & Extensions; Open at Login and App Background Activity |
| [Upgrade to macOS 27](https://support.apple.com/en-us/127455) | General → Software Update and version verification |

Navigation labels are based on Apple’s current English documentation. Rendering on Windows uses local fallback fonts, original vector icon approximations, and a vector wallpaper reconstruction based on Apple’s current Apps reference image. It is not claimed to be a pixel-identical screenshot reconstruction. Apple’s own wording, regions, hardware, account state, management policy, and point updates can change which controls a caller sees.

## Comparison

| Area | Downloads/Claude-main/Claude-main/mac | Original isaiart/mac/index.html |
| --- | --- | --- |
| Structure | Small HTML plus numbered JavaScript/CSS modules and local assets | One approximately 375 KB self-contained HTML file |
| Core desktop | Window manager, Dock, menus, Spotlight and Finder | Extensive desktop/window handling and custom inline icons |
| Network depth | Shared network failure model used across apps; diagnostics and scripted faults | Detailed Wi-Fi join/known-network dialogs and polished control construction |
| Training | Five original scenarios with checkable goals and action logging | General simulator interactions; no comparable scenario manager found |
| Maintenance | Individual modules and centralized fictional persona/state | Large global state and functions in a single file |
| Baseline | Tahoe 26.6, with several older settings/Launchpad paths | Tahoe 26, with older combined settings and Launchpad patterns |
| Portability | Entire folder works offline | Single HTML convenient to distribute |

**Selected foundation: the downloaded modular version.** Its shared state and modular interface support consistent interactions and maintainable release-specific corrections. The original GitHub version was preserved before replacement and compared for window, control and network UI details. The improved result stays buildless and usable offline, but requires its adjacent asset folders. Live Wikipedia browsing requires an internet connection.

## Changes based on the research

- Current release identity across About, Software Update, seed data, and Recovery; upgrade practice uses 27.0 → 27.0.1 rather than inventing a future release.
- Separate Menu Bar, Siri, Spotlight and Touch ID & Password settings; Family label; Apps/Spotlight replacing the old Launchpad entry point.
- Network Details tabs: Wi-Fi, TCP/IP, DNS, WINS, 802.1X, Proxies, Hardware. Core IPv4/DNS/proxy changes are staged and validated before OK. IPv6, WINS and 802.1X are not fully implemented.
- Interactive per-app microphone, camera, screen/audio recording, accessibility and disk-access preferences. Firewall is reached from Network.
- Editable Open at Login and App Background Activity.
- Technician workspace, call guides, default training content, desktop widgets, and non-native Safari toolbar controls removed. Normal use presents only the macOS desktop and native navigation. Developer scenario fixtures are hidden from normal navigation.
- US Trash labels, complete scenario baseline resets, and full-disk space reclaimed by deleting a large fictional obsolete backup.

## Deliberate fidelity boundaries

The target is the native interface without teaching overlays. The available implementations recreate browser interfaces rather than a macOS kernel, so complete OS emulation is not achieved. The wallpaper and icons are original approximations. Native authentication/permission prompts, Touch ID, Siri responses, management restrictions, full IPv6/802.1X networking, actual automatic launches at login, and live hardware cannot be verified in this browser simulator. Finder, Safari, account, utility, and Recovery content cover selected states rather than complete native applications.

Additional reference: [Privacy & Security settings, macOS 27](https://support.apple.com/en-au/guide/mac-help/mchl211c911f/27/mac/27), used for the current privacy category labels. [Apple’s Apps screenshot](https://ipcdn-web.apple.com/assets/v2/web/0f1cbbf2-4b57-4ed8-9dc0-330f630b3581) informed the translucent Apps panel, icon grid, category browsing, and wallpaper materials.

Final secondary-screen research: [Trackpad settings](https://support.apple.com/en-gb/guide/mac-help/mchlp1226/mac) and [Safari Search settings](https://support.apple.com/en-ca/guide/safari/sfria1042d31/27.0/mac/27) informed native gesture preferences and search labels. Time Machine now stores independent versions of virtual files and restores selected versions through a file/date browser. This operates only on the browser's virtual filesystem; it is not a native disk backup. Safari search routes to the selected public engine, subject to embedding restrictions.

Safari native preferences use Apple’s current pane names and the General, Tabs, and Search options described in its Safari 27 guide. The preferences open in a separate Safari window, preserving the document tabs. Some preferences are stored reference controls; native browser engine enforcement, automatic tab organization, AutoFill services, profiles and extensions are incomplete.

- [Safari settings panes](https://support.apple.com/en-mt/guide/safari/ibrwcd8bc28e/mac)
- [General settings](https://support.apple.com/guide/safari/general-ibrw1072/27.0/mac/27)
- [Tabs settings](https://support.apple.com/guide/safari/tabs-ibrw1045/27.0/mac/27)

October 13 behavior revision: [Safari Tabs](https://support.apple.com/guide/safari/tabs-ibrw1045/27.0/mac/27), [Finder views](https://support.apple.com/en-my/guide/mac-help/mchldaafb302/mac) and [Time Machine item/folder restoration](https://support.apple.com/en-az/guide/mac-help/mh11422/mac) informed the new behaviors. Saved state is merged without a schema reset. Backup scheduling runs only while this browser page is open. Folder Replace restores the backed-up tree; Keep Both creates a separate tree with fresh node IDs. Settings affecting browser engine services outside the embedded page remain approximations.
