# iPhone touchscreen fixes

Current source revision: **iphone-touch-b1** (October 13, 2026).

Vertical dragging works over Mail rows. Horizontal Mail swipes still reveal actions; direction and thresholds use actual screen coordinates. Screen-edge and Home indicator gestures also use the actual scaled screen dimensions. One pointer owns each gesture, with pointer cancellation and focus-loss cleanup. Browser panning no longer competes with the phone surface's custom dragging.

New contact stops existing momentum. Paused or canceled drags do not fling. Horizontal scroll-snap is restored after animation or interruption. A drag's delayed click is blocked until the next intentional contact, while keyboard activation and editable fields retain their behavior. The circle cursor remains enabled and follows the contact.

Validation: JavaScript syntax check; 18 existing integration checks plus 11 new touch interaction checks pass. Real browser mouse drags verified unlock, Settings scrolling without opening rows, swipe home, Control Center pull-down, Mail vertical scrolling and horizontal actions, and reverse Mail scrolling at a 390×844 viewport. Touch pointer ownership/cancellation was exercised in the event regression harness; physical touchscreen hardware and every app-specific gesture were not tested.

This follow-up is not independently scored. The earlier 8.7 critic score applies to iphone-controls-review-b1, not this newer revision. Its report remains below as historical evidence. No deployment, commit or push was performed.

---

## Historical critic report

# iPhone — restored-controls critic review

Current reviewed artifact: **iphone-controls-review-b1** in `C:\Users\Dizzy\Documents\Github\isaiart\iphone`. The minimal `emulator` directory and root phone/directory routes remain in the same repository. No publication performed.

## Review contract and result

The user explicitly requested a fresh critic loop after restoring the optional side popout and circle cursor. The same independent iOS interface/frontend engineering critic reviewed both attempts. Target8.5/10, maximum3 attempts; native/current fidelity45%, working behavior35%, visual/usability20%. Retaining the drawer and circle is an explicit user constraint, so their presence is not treated as a fidelity defect. Hard criteria include working requested controls/cursor, preserved saved data in changed flows, accessible phone/directory, and no false native OS claim.

| Attempt | Native | Behavior | Visual | Weighted score | Verdict |
| --- | --- | --- | --- | --- | --- |
| A — iphone-cursor-1 | 8.5 | 8.0 | 8.4 | 8.3 | Revise |
| B — iphone-controls-review-b1 | 8.5 | 8.9 | 8.7 | **8.7** | **Pass** |

Loop stopped when attempt2 passed. No material implementation changes followed the verdict. Earlier phone-building scores are historical and do not replace this current score.

## Fixes confirmed by critic

Silent Mode previously changed its displayed state without suppressing generated incoming-call audio. A shared setter now serves the Action button and drawer. Ring generation checks Silent, Focus/DND and zero volume; it stops an existing audio context/interval, avoids duplicate contexts, and rechecks preferences in queued callbacks.

The circle previously nearly disappeared over the dark incoming-call screen while appearance was Light. It now uses a white border, dark outer outline and translucent neutral fill across themes. Accurate positioning relative to the actual scaled screen remains intact.

The restored collapsible drawer retains call, mail, network, code and device triggers. It provides expanded-state labels, a close button, inaccessible hidden contents, stored open/closed preference and a mobile overlay. Circle restoration preserves existing notes/mail and honors subsequent explicit disabling.

## Verification

**18 integration checks passed**, independently rerun by the critic, plus syntax validation. Meaningful actual-function checks cover cursor scaling, profile migration, drawer geometry, networking forms, erase/save ordering, Safari private groups and ringtone generation. AudioContext stubs verify silent suppression, ordinary ringing, stopping, queued callbacks, duplicate requests, DND and zero volume.

Browser checks used an isolated localhost8770 QA origin to avoid altering the user's active8769 phone profile. Silent drawer state, incoming call, Answer/End and cursor on/tap feedback were observed. Actual speaker output was not assessed. Fresh390×844 and320×568 screenshots show drawer open/closed and current phone framing. Measured phone sizes were326×707 at390×844 and247×536 at320×568; drawer270px wide, close control accessible. Desktop dark-call and light Settings evidence establishes cursor visibility, not uninterrupted hover.

Implementation and evidence were inspected directly by the critic. Current release references and earlier phone behavior remain documented in RESEARCH.md; represented software is iOS27.0.1, checked October13,2026 against Apple documentation. No native OS equivalence is claimed.

## Remaining limitations

Minor nonblocking note: small drawer helper/log text has weak contrast over its translucent dark background, especially on a320px host. Primary labels and close control remain legible. This note remains unfixed in the scored artifact.

Not assessed: actual speaker output, uninterrupted hover, exhaustive trigger/application coverage, exact native pixels/fonts/artwork, OS/kernel/hardware/Apple services, cookie/security isolation and production deployment. Secondary app placeholders, multiline DNS editing and browser embedding boundaries remain documented. This score assesses the browser recreation, not full1:1 iOS emulation.
