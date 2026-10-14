# Final workspace and new behavior review

Final workspace: `C:\Users\Dizzy\Documents\Github\isaiart\mac`. Reviewed implementation: **behavior-20261013-c1**, schema 15. No material implementation edits after the final score; delivery documentation was updated afterward.

The modular Downloads version remains the foundation. Its shared state, filesystem and separate components supported consistent fixes better than the original GitHub single-file version. Normal surfaces have no technician workspace, lessons or simulation instructions.

Apple's represented release is **macOS Golden Gate 27.0.1**, rechecked October 13, 2026 against [Apple security releases](https://support.apple.com/en-us/100100). Sources and original comparison are in RESEARCH.md.

## New critic loop

The user authorized additional Safari behavior, native control/dialog audit, visual refinements and folder restoration, plus a fresh independent review. Same critic across this new loop; macOS interface/front-end engineering lens. Target 8.5, budget 3 scored attempts. Weights: native fidelity 45%, behavior 35%, visual/usability 20%. Hard criteria: no technician/lesson UI in normal use; researched release; no false full-OS claim; no unexplained saved-file loss in changed flows.

| Version | Native | Behavior | Visual | Score | Verdict |
| --- | --- | --- | --- | --- | --- |
| A, a9 | 7.9 | 8.1 | 8.5 | 8.1 | Revise |
| B, b4 | 8.3 | 8.4 | 8.5 | 8.4 | Revise |
| C, c1 | 8.5 | 8.8 | 8.5 | **8.6** | **Pass for assessed browser recreation** |

The original-build review is historical and was not counted in this new loop. Scores are critic judgments within assessed evidence, not proof of native OS equivalence.

## Completed work

- Safari homepage editing survives control changes; window/tab defaults distinguish Homepage, Start Page and Empty Page. Saved windows retain selection and tab ages; history expiry and Clear History ranges work. Command-click honors tab/window and foreground/background choices.
- New Private Window opens a separate visibly marked private window, preserving regular windows and saved sessions. Explicit privacy/destination/window intent takes precedence over launch restoration. Native File commands and keyboard handling replace the toolbar privacy toggle.
- Compact toolbar retains selected title/favicon/close control. JavaScript/pop-up choices alter embedded-page sandbox permissions. Virtual downloads honor save destination/name and safe-file opening. Share to Mail opens prefilled compose without sending.
- Finder View Options persist sizing, spacing, text, sorting, info and defaults per folder. Selection preserves DOM elements, fixing actual double-click navigation.
- Time Machine restores nested folders with Cancel/Keep Both/Replace, preserves unrelated moved files, maps recreated parent paths without duplicate folders, and refuses file-blocked ancestors without filesystem changes. Scheduling runs due backups while the page is open and preserves the backup being browsed.
- Spotlight Search Privacy persists folder exclusions and filters descendant files. Focus Share across devices is a stored switch. Storage events synchronize open views before subsequent saves.

## Verification

**52 integration checks passed**, independently rerun by the critic. All 25 JavaScript modules syntax checked; final changed module rechecked. HTML assets resolve and 50 SVG assets parse. Final c1 browser flows had no current-version console errors.

Browser checks exercised Homepage defaults, compact layout, Finder sizing/navigation, backup folder selection/Keep Both, Spotlight exclusions, native File private opening and preferences-only private opening. Logical 1024×768 secondary viewport was used for final Safari evidence. Builder viewed saved images. Exact populated saved-session/private combination was model-tested; the live preferences-only case did not retain a populated session after manual document-window close. Original preferences were restored and virtual test backup disk ejected; main 8766 preview retained, temporary QA server stopped.

## Remaining gaps and not assessed

Compact selected tab and address field remain separate and short titles truncate. CONTROL-AUDIT.md records incomplete Screen Time, Keyboard input/dictation, Safari AutoFill/profiles/extensions/privacy services and hardware-dependent controls. Website Data is virtual metadata and does not clear host cookies. Virtual documents/downloads do not constitute full native binaries.

No direct native macOS pixel comparison; typography/artwork, screenshot softness and translucency remain approximations. Long-duration scheduling/expiry, actual hardware, native executables, kernel, Recovery, Apple services, host security/cookies and device synchronization are not assessed or implemented as full native services. This is a browser recreation, not full 1:1 OS emulation.
