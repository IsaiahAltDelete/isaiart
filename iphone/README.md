# iPhone

Browser recreation of an iPhone15 Pro running the current iOS27.0.1 reference. Open index.html with its scripts/styles folders, or serve this repository and visit /iphone/. No dependencies or build required. /emulator/ is the minimal directory linking /iphone/ and /mac/.

Profiles remain in the existing iphone-sim-v2 localStorage key. Existing notes, mail, installed apps and preferences are retained. The original emulator source was backed up before changing its landing page.

The phone retains native screens. An optional collapsible side drawer provides incoming-call, network, mail, login-code and device triggers, restored at the user’s request. Side buttons, Home indicator, touch gestures and native navigation operate the phone. Apple reference sources and limitations are documented in RESEARCH.md. This does not boot iOS or run native binaries; hardware/services and several secondary controls remain approximations. Fictional device/account fixtures must not be used as real credentials.

Verify: node tests/smoke.cjs, node tests/touch.cjs, node tests/surfaces.cjs and node tests/network.cjs. See REVIEW.md for bounded independent review evidence and remaining gaps.

Network troubleshooting uses a shared virtual fault model: unreachable manual DNS, proxy and manual IPv4 configurations affect Safari, Mail, app downloads and Software Update, with cellular fallback where available. Reserved documentation address ranges are unreachable DNS fixtures. The reachable proxy fixtures are proxy.spectrum.example:8080 and https://proxy.spectrum.example/proxy.pac. These are fictional browser fixtures; no real DNS or proxy connection is made. DNS/search-domain lists are staged until Save.
