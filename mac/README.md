# macOS Golden Gate desktop

A browser recreation of the current macOS interface, built for accessing familiar Mac screens when a Mac is unavailable. The reference is **macOS Golden Gate 27.0.1**, verified against Apple documentation on October 13, 2026.

Open `index.html` in a modern desktop browser. Keep the adjacent `assets`, `scripts`, and `styles` folders. No build or package installation is required. The default view is the desktop; `?login` opens the sign-in screen. Preferences and the virtual file system persist in local browser storage. The fictional account password is `support`; the fictional Sablewave Home Wi-Fi password is `sablewave`.

The interface includes the menu bar, Dock, Control Center, Notification Center, Spotlight and Apps, window movement/resizing/tiling, Finder and Trash, System Settings, and representative native applications and utilities. Settings include Wi-Fi Details, DHCP/manual IPv4, DNS, proxies, privacy categories, login items, current Software Update, Appearance, Menu Bar, Siri, Spotlight, and Touch ID & Password. Trackpad has native gesture preference tabs. Time Machine saves virtual file and folder versions, supports Replace/Keep Both and runs due backups while the page is open. Finder View Options and Spotlight folder exclusions persist. Safari homepage, new-window/new-tab choices, private sessions, history retention, compact tabs, JavaScript/pop-up sandbox choices and virtual download preferences affect their associated behaviors.

There is no technician workspace, lesson panel, walkthrough overlay, or training widget. Reference paths and limitations are documented here rather than inserted into the desktop.

This runs in a browser; it does not boot the macOS kernel or execute native Mac binaries. Local hardware, Apple services, Siri AI, Touch ID, authentication, full networking protocols, Recovery, and some secondary application behavior are approximated. Safari includes a small local Apple page catalogue and live Wikipedia articles through its public API. Other web destinations are limited by browser embedding restrictions; this is not unrestricted native Safari. Artwork and Windows font rendering are approximations; this is not a claim of pixel-identical or complete OS emulation. The represented computer, accounts, and files are fictional. No real device settings are changed.

The downloaded modular implementation was selected over the original single-file GitHub implementation because its shared state and separate components support consistent behavior and maintainable corrections. See `RESEARCH.md` for the comparison and Apple references, and `REVIEW.md` for the independent critic’s findings and verification evidence.

Developer verification: `node tests/smoke.cjs`. There are no production dependencies. Original scenario fixtures remain available to the test harness/developer API but are not part of the visible desktop.

New behavior work was audited October 13, 2026. Some secondary controls remain incomplete, including Screen Time restrictions, Keyboard input/dictation services, Safari AutoFill, profiles/extensions and native browser privacy services. See CONTROL-AUDIT.md for the control audit and the latest review report for assessed evidence.
