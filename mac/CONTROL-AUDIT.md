# Native control audit — October 13, 2026

Scope: the shared desktop, native Settings navigation, Safari preferences/dialogs, Finder view options, Spotlight exclusions and virtual Time Machine. This audit distinguishes working browser behaviors from native services that remain approximated; it is not a claim that every macOS control is fully emulated.

| Area | Corrected behavior | Verification |
| --- | --- | --- |
| Safari General | Homepage editing, new windows/tabs, blank page, reopening saved windows, separate private opening and explicit intent precedence | Model regressions and browser interaction |
| Safari Tabs | Compact toolbar layout, automatic expiry with persisted tab ages, Command-click tab/window choice and foreground/background selection | Model regressions; browser layout/interaction |
| Safari History | Age-based retention and native Clear History range dialog | Boundary regressions and browser dialog |
| Safari Security/Websites | JavaScript and pop-up choices change the embedded page sandbox | Generated iframe permission regressions; not full native engine security |
| Safari Downloads | Ask-before-save folder/name choice; safe-file opening preference | Virtual filesystem regressions; actual binary/network downloads not assessed |
| Safari Share | Mail opens a prefilled native compose dialog; no send occurs | Compose-field regression and browser dialog |
| Finder View Options | Per-folder icon size, spacing, text size, sort, item information, always-open view and defaults | Persistence/independence regression and browser controls |
| Spotlight Search Privacy | Add/remove folders, persist exclusions, remove descendant files from results | Chooser staging, recursive exclusion and persistence regressions |
| Time Machine | Restore folder trees, Replace/Keep Both, preserve unrelated moved files and resolve recreated parent paths without duplicates and refuse blocked ancestors | Nested-tree, collision, ID uniqueness and storage regressions |
| Time Machine scheduling | Due automatic backups run once; Manual/absent disk prevent them | Due-time and re-entrant rendering regression; page must remain open |
| Focus | Share across devices is a persistent native switch | Browser preference; actual multi-device sync remains unavailable |

The active-pane audit rendered Settings controls from the current module order. Remaining visible placeholder actions include Screen Time App Limits/Downtime/Content & Privacy, Keyboard Text Input/Dictation, and hardware-dependent Screen Mirroring. The legacy combined Siri & Spotlight pane remains in source but is absent from the current sidebar. Additional secondary application coverage and native services remain incomplete.

Safari AutoFill, profiles/extensions, search-engine suggestion services, anti-tracking/IP hiding and other native engine features are not complete. Website Data is virtual cache metadata; clearing it does not clear the host browser’s cookies/cache. Some seeded downloads and documents are representative virtual files rather than native binaries. Actual permissions, Apple services, native executables, networking hardware and Recovery remain outside the implemented browser behavior. These limitations must remain explicit in review and delivery claims.

Suite review revision: saved-network auto-join follows its own preference independently of Ask to join; the strongest available saved network is chosen. Native Details supports IPv4/IPv6 DNS and add/remove search-domain rows, with staged OK/Cancel. Native form color schemes follow the represented appearance and private Safari address text remains readable in light appearance.
