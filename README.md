# Smart Spend

Track spending and income in Saudi Riyal (SAR) with live Indian Rupee (INR) conversion.

**Live site:** https://khajamohiddinsyed.github.io/smart-spend/

The landing page offers two ways to use it:

- **Android app:** download the APK from the [latest release](https://github.com/khajamohiddinsyed/smart-spend/releases/latest).
- **Web app** (`/app/`): runs in any browser, including iPhone Safari. Add it to the home screen to launch it like an app.

## Web app features (2.0)

- Installable app: full screen, works offline, bottom tabs, quick add, swipe to delete, pull to sync
- Insights: 6-month money in vs out, spending pace, where it went, and monthly budgets with warnings
- Profiles (Sharooq, Roshan, and any you add), each with its own ledger and a 4-digit PIN; locks after 5 minutes away
- Plain-language entry: "Got cash 450 on 24th sep and spent 40 on fuel"
- Calendar with inflow/outflow dots, activity log, category breakdown
- Smarter parsing: Arabic digits, amounts in words, INR converted to SAR, quantity × price, relative dates, typos
- Categories learn from your corrections
- JSON backup and restore per profile, plus optional encrypted online backups to a private GitHub repository
- Sync between the web app and the Android app (same profile, same passphrase); see [docs/SYNC_SPEC.md](docs/SYNC_SPEC.md)

Everything runs in the browser. The only network calls are optional online backups, which go straight to api.github.com and are encrypted (AES-256-GCM) before they leave the device. Data stays in each device's local storage and is never uploaded. The PIN is a privacy lock between people sharing a device; only a salted hash of it is stored, and the ledger itself is not encrypted.

## Code

`app/` is plain ES modules with no build step: `js/parser.js` and `js/categories.js` (free-text parsing), `js/ledger.js` (data), `js/sync.js` (encrypted GitHub backup and sync, contract in `docs/SYNC_SPEC.md`), and the screens in `js/views.js`, `js/sheets.js`, `js/gate.js`. `sw.js` provides offline support; bump its `VERSION` on every release.
