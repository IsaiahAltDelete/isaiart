> October 14 Mac icon follow-up: current identity is `mac-icons-a`. 31 icons now use locally stored publisher artwork, Calendar retains live date text, and empty Trash has a distinct vector wastebasket. This follow-up is verified with browser and regression checks but has not been independently rescored. The 8.6/10 review below applies to the earlier frozen `suite-review-b3` build.

# Emulator suite — independent critic review

**PASS: 8.1 → 8.6/10.** Reviewed October 13, 2026. Final application identity: **suite-review-b3**.

Scope: the current iPhone and Mac browser recreations, minimal emulator directory, and their integration with the root homepage in `C:\Users\Dizzy\Documents\Github\isaiart`. This is a representative interface and troubleshooting review, not certification of every control or literal native OS equivalence. No deployment, commit or push was performed.

## Contract and reviewer

Independent critic: `/root/suite_critic`, started without the builder's conversation history and reused for both attempts. Perspective: Apple interface design and frontend engineering. Threshold **8.5/10**, maximum **three scored attempts**. The loop stopped after attempt two passed.

Stable rubric: native/current fidelity **45%**, working behavior **35%**, visual/usability **20%**. The optional phone trigger drawer, circle cursor, charcoal page background, buildless browser implementation and minimal directory were deliberate user choices. Mac normal surfaces must exclude technician/lesson overlays. Required routes, saved-data preservation in changed flows, requested phone controls and current release identity were assessed as hard criteria. Neither attempt demonstrated a hard-criterion failure.

| Attempt | Identity | Fidelity | Behavior | Visual | Weighted result | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | iPhone suite-review-a / Mac suite-review-a1 | 8.0 | 7.9 | 8.7 | 8.1 | Revise |
| 2 | suite-review-b3 | 8.5 | 8.7 | 8.7 | **8.6** | **Pass** |

Final weighted result: 8.61, rounded to 8.6. Scores express this critic's judgment against the stated rubric; they are not proof of universal correctness. Earlier component scores came from different review contracts and are historical.

## Changes reviewed

Before the first score, fresh evidence exposed contrast defects. The builder corrected iPhone call status/Home indicators, added meaningful call button names and hid underlying controls from accessibility while a full-screen call is visible. Drawer helper text became readable. Mac native form controls now follow the represented appearance; Safari private address text and placeholders remain readable in light appearance.

The first score identified five material defects. The critic marked all five **FIXED** in the final source:

1. **iPhone network configuration affects the shared connectivity model.** Saved DNS, proxy and manual IPv4 settings now produce virtual failure reasons used by Safari, Mail, downloads and Software Update. Cellular fallback remains available when permitted. Fault and recovery tests cover unreachable resolvers, proxies, link-local addressing and mismatched routers. Displayed manual IP values agree with saved settings while preserving the device MAC.
2. **Mac known-network auto-join is independent of Ask to join.** Enabling Wi-Fi selects the strongest available saved network with auto-join enabled. Off, Notify and Ask are covered by independent tests. Browser evidence confirms a saved network rejoined with Ask set to Off.
3. **Mac DNS accepts IPv4 and IPv6.** DNS validation is separate from IPv4 address/router/subnet validation. Invalid input retains the saved configuration; a valid IPv6 resolver survives OK and reopening Details.
4. **iPhone joining works by keyboard.** Network join and information actions are sibling semantic buttons. Other Network is a semantic button. Return completed a saved-network join and opened Other Network. Popped pages leave the focus tree immediately, before their departure animation finishes.
5. **DNS and search domains use individual rows.** The phone has add/remove DNS server and search-domain rows. Mac search domains now use a list with add/remove controls. Edits remain staged until Save or OK; leaving without saving preserves existing settings. Mac domain storage remains compatible with its previous string representation. Network dropdowns have compact themed styling, and the phone summary reflects saved domains.

The phone fault model uses explicit fictional fixtures rather than real DNS/proxy connections. Reserved documentation address ranges represent unreachable resolvers. The reachable proxy fixtures are `proxy.spectrum.example:8080` and `https://proxy.spectrum.example/proxy.pac`. This does not configure the host network or establish protocol-level equivalence.

## Verification

The builder and critic independently ran all five scripts: **93 checks passed**.

| Script | Passing checks |
| --- | ---: |
| iphone/tests/smoke.cjs | 18 |
| iphone/tests/touch.cjs | 11 |
| iphone/tests/surfaces.cjs | 3 |
| iphone/tests/network.cjs | 6 |
| mac/tests/smoke.cjs | 55 |

JavaScript syntax and local HTML asset references were checked. The critic independently verified all **112 frozen file hashes**, inspected nine revision screenshots and retained earlier evidence only for explicitly unchanged surfaces.

Live browser checks used a separate localhost origin so the user's main saved profile was not reset by QA. They verified directory routes and homepage links, swipe unlock, Settings scrolling without activating rows, phone call/answer/end controls, keyboard joining and Other Network, DNS list persistence, and failure/recovery in Software Update with cellular disabled. Mac checks verified Wi-Fi off/on rejoining with Ask off, IPv6 DNS/search-domain persistence through OK and reopening, compact native controls, and separate private Safari windows. No console errors were captured in the assessed Mac flows.

Primary layouts: desktop 1280×720, smaller Mac 1024×768, phone/directory 390×844, and phone 320×568. Fresh DNS and fault/recovery captures support the revision. Unchanged earlier call/drawer/touch/private-window evidence is labeled as such in the evidence notes.

Evidence and manifest originals are in the chat's `work` directory: `SUITE-EVIDENCE-A.md`, `SUITE-EVIDENCE-B.md`, `suite-a-manifest.json`, `suite-b-manifest.json`, and both test transcripts. Application assets were frozen during each independent review. After the passing verdict, only review documentation and downloadable packaging were finalized; no application implementation changes followed the score.

## Remaining notes and limits

- **Minor native layout polish:** Mac DNS/domain remove buttons sit beside individual inputs. Apple describes selecting list items and using bottom-mounted add/remove controls. The current lists are functional and understandable, but consolidating the controls would improve correspondence. [Apple DNS settings](https://support.apple.com/guide/mac-help/change-dns-settings-on-mac-mh14127/mac)
- **Secondary coverage remains incomplete:** Screen Time, Text Input/Dictation, several Safari services and other documented application features remain outside readiness claims. The Mac control audit and phone research document preserve those boundaries.

Not assessed: exhaustive every-app/control coverage, physical touchscreen/multitouch, actual speaker output, exact native pixels/fonts/artwork, native binaries/kernel/hardware/Recovery/Apple services, host cookie/privacy isolation, long-duration scheduling and production deployment. The critic's extra interaction reprobes used isolated state harnesses; live browser evidence was captured by the builder. Still images were not treated as proof of interaction or audio.

The current release reference was independently rechecked: Apple lists iOS **27.0.1** and macOS **Golden Gate 27.0.1**. [Apple security releases](https://support.apple.com/en-us/100100) [Apple Wi-Fi settings](https://support.apple.com/guide/mac-help/wi-fi-settings-on-mac-mh11935/mac)

Final readiness: iPhone passes for assessed navigation, touch/call and virtual network paths; Mac passes for assessed desktop, network, session and virtual-file workflows; directory/homepage routing passes at the inspected sizes. This pass does not claim full native OS emulation.
