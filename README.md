# AMA FarmTech Offline

**Ama Farms Ltd — offline farm records for Android.**
Phase 1: foundation and offline engine · **Phase 2: crop production management** · Version 1.1.0.

An installable web app (PWA) that keeps your farm records **on your phone**, works with **no internet** after the first load, and moves records between phones with **password-encrypted backup files**. No account, no subscription, no cloud database. GitHub Pages only hosts the app's files.

> **Never upload farm records, backup files (`.amabackup`) or photographs to GitHub.**
> The GitHub repository must contain only the app files listed below. Your records stay on your phone and in backup files you keep yourself (Google Drive, email to yourself, another phone).

---

## 1. What the app contains

| Section | What it does |
|---|---|
| **Home** | Main farm, number of farms, fields and records, total field area, crop-production summary (only when you have crop records), recent activity, storage status, online/offline indicator, last backup date, backup reminder. Everything shown comes from the records on the phone. |
| **My Farm** | Create, edit and delete farms (several allowed) and the fields inside them. Default country Uganda, currency UGX, time zone Africa/Kampala. Areas in acres, hectares or quarter-acres, converted exactly. A field page now also lists the crop cycles planned on it. |
| **Crops** *(new in Phase 2)* | Crop catalogue, seed varieties, production cycles, planting batches, planting records, an overview and a calendar. See section 3. |
| **Records** | Search and filter farms, fields and the activity log. |
| **Backup** | Create an encrypted `.amabackup` file; restore it on this or another phone with a preview, merge or replace, and a safety backup. Phase 2 records are included. |
| **Settings** | Defaults, install instructions, storage protection, offline status, check for updates, erase all data. |

Not in the app (by design, later phases): inventory, finance, sales, reports, photos, task management, notifications.

---

## 2. Architecture

```
 Phone (Chrome)
 ┌────────────────────────────────────────────────────────────────────────┐
 │  index.html ─ loads ─►  db.js ► crops.js ► backup.js ► app.js ► crops-ui.js │
 │                                                                        │
 │  db.js        validation, exact unit maths, IndexedDB, transactions,   │
 │               numbered migrations (Phase 1 stores + Phase 2 stores)    │
 │  crops.js     crop rules: validation, field-area allocation, status    │
 │               rules, statistics, calendar events, safe delete rules    │
 │  backup.js    encrypt / decrypt, restore plan (merge / replace),       │
 │               relationship checks so a restore never leaves orphans    │
 │  app.js       Phase 1 screens, routing (#/ addresses), install,        │
 │               storage, update messages; offers AMA.ui to other files   │
 │  crops-ui.js  all Crops screens; adds its routes to the router         │
 │                                                                        │
 │  IndexedDB  ◄── all records live here (on the phone)                   │
 │  Cache      ◄── app files only (HTML, CSS, JS, icons)                  │
 │  service-worker.js  serves the app files from the cache, so the app    │
 │                     opens with no internet                             │
 └────────────────────────────────────────────────────────────────────────┘
        ▲ app files only (one-way, when online)
 GitHub Pages  (public, static hosting — never receives records)
```

**How Phase 2 was added without disturbing Phase 1**

* **Extension, not rebuild.** Phase 2 is two new files (`crops.js` data rules, `crops-ui.js` screens) plus small edits to the five existing code files. The database keeps its name (`ama-farmtech-offline`); its version goes from 1 to 2.
* **Safe, additive migration.** Version 2 only *creates* five new stores. It never reads, changes or deletes a farm, field, activity, setting or backup-history record. If an upgrade ever failed, the whole upgrade is cancelled and the records stay as they were.
* **Records never pass through the service worker.** It caches only the app's own files (now 13).
* **Exact area maths.** Areas are stored as typed *and* as an exact square-metre string (1 acre = 4046.8564224 m², 1 quarter-acre = 1011.7141056 m², 1 ha = 10,000 m²) using whole-number (BigInt) arithmetic. Field-area limits are checked with the same exact numbers, so "exactly the whole field" is allowed and one extra square millimetre is not.
* **Safe screens.** Text from forms or backup files is only ever put on screen as plain text. A Content-Security-Policy blocks outside scripts, fonts and connections.
* **Relative paths everywhere.** The app works at `https://name.github.io/ama-farmtech-offline/` or anywhere else.
* **Safe updates.** A new version downloads quietly into a new cache. The app shows "A new version is ready" and switches only when you tap **Update now**.

### Files (13 app files; Settings shows "All 13 app files are stored")

```
ama-farmtech-offline/
├── index.html              page shell, bottom navigation (6 items), security policy
├── styles.css              forest-green mobile design
├── app.js                  Phase 1 screens, routing, shared building blocks
├── db.js                   database, validation, unit conversion, migrations
├── crops.js                NEW  crop rules, allocation check, statistics, calendar events
├── crops-ui.js             NEW  every Crops screen and form
├── backup.js               encrypted backup and restore
├── service-worker.js       offline app files + safe updates
├── manifest.webmanifest    installation details (name, icons, colours)
├── README.md               this guide
└── icons/
    ├── icon.svg
    ├── icon-192.png
    ├── icon-512.png
    └── icon-maskable-512.png
```

### Database (IndexedDB `ama-farmtech-offline`, version 2)

| Store | Holds | Indexes |
|---|---|---|
| `farms`, `fields`, `settings`, `activities`, `backups` | Phase 1 — unchanged | as in Phase 1 |
| `crops` | crop catalogue | `nameLower`, `category`, `createdAt`, `updatedAt` |
| `varieties` | seed varieties of a crop | `cropId`, `dupKey`, `createdAt`, `updatedAt` |
| `cycles` | production cycles (farm, field, crop, variety, dates, area, population, status) | `farmId`, `fieldId`, `cropId`, `varietyId`, `status`, `createdAt`, `updatedAt` |
| `batches` | planting / transplanting batches of a cycle (planned *and* actual numbers) | `cycleId`, `createdAt`, `updatedAt` |
| `plantings` | dated planting records (seeding, nursery sowing, transplanting, gap filling, other) | `cycleId`, `batchId`, `date`, `createdAt`, `updatedAt` |

Every record has a UUID `id`, `createdAt` and `updatedAt`. Crops, varieties and cycles also have `archivedAt` (empty, or the date archived). Every save, edit and delete runs in **one transaction** together with its activity-log entry, so a failure leaves nothing half-written.

### Backup file format (`.amabackup`) — container unchanged, content extended

| Bytes | Content |
|---|---|
| 0–7 | `AMAFTBAK` |
| 8–9 | format version (1), flags |
| 10–13 | PBKDF2 iteration count (600,000) |
| 14–29 | random salt (new for every backup) |
| 30–41 | random IV (new for every backup) |
| 42–end | AES-256-GCM encrypted data + 16-byte authentication tag |

Inside (once decrypted): app version (1.1.0), database version (2), export date, counts, and every farm, field, **crop, variety, cycle, batch, planting record**, activity, backup history and portable settings. A backup made by version 1.0.0 (no crop stores) still restores in 1.1.0. An old 1.0.0 app refuses a 1.1.0 backup with a "made by a newer version" message instead of half-loading it. A restore that would leave a record pointing at something missing (a cycle without its field, a batch without its cycle, a field belonging to a different farm…) is blocked, and nothing is imported.

---

## 3. Phase 2 — the Crops module

Open **Crops** in the bottom menu. It has four tabs: **Overview · Cycles · Catalogue · Calendar**.

**Crop catalogue.** A crop has a name, category (Vegetables, Cereals and grains, Legumes, Root and tuber crops, Fruits, Other crops), optional scientific name, description, usual planting method (transplanting, direct seeding, other), optional typical growing days and notes. Crops can be added, edited, viewed and archived. Two crops cannot share a name (capitals ignored). Nothing is pre-loaded: you add your own crops.

**Varieties.** A variety belongs to a crop: name, supplier, seed type (hybrid, open-pollinated, other), packet size, quantity bought, purchase date, lot number, expiry date, seed cost (with currency), germination %, notes. Only the name is required. One crop can have many varieties, and a variety can be used by many cycles.

**Production cycles.** One cycle = one crop (and optionally a variety) on one field in one season: name (suggested for you), season, farm, field, crop, variety, planting method, production system (open field, greenhouse, …), water supply, planned and actual planting dates, planned harvest start, expected harvest end, area (acres, hectares or quarter-acres), target and actual plants, status (Planned → Land preparation → Nursery → Planted → Growing → Harvesting → Completed, or Cancelled), notes. The cycle page has seven numbered sections: **1 Production overview · 2 Farm and field allocation · 3 Crop and variety · 4 Planting information · 5 Population and spacing · 6 Production timeline · 7 Notes and records.**

**Field area rule.** Several cycles may share a field **only if the area in use at the same time does not exceed the field**. While you type, the form shows "Fits in the field" with the percentage. A single cycle larger than its whole field is refused. If several cycles *at the same time* would together exceed the field, the app shows "This field would be over-allocated" and lets you go back or "Save anyway" (for real situations such as intercropping). Archived and cancelled cycles use no area; completed cycles only use the area during their dated window. Cycles with no dates count as overlapping everything not finished, so the check errs on the side of warning you.

**Planting batches and records.** A cycle can have several **batches** (for example nursery sowing on one date, transplanting in two lots). Each batch keeps **planned** numbers (seed, seedlings, plants) and **actual** numbers side by side, plus nursery details, row spacing, plant spacing and rows. **Planting records** are a dated log (what was done, how many, where, which batch). Records and "actual" dates cannot be in the future.

**Overview.** Active cycles, crops being cultivated, cultivated area, active fields, upcoming plantings (with overdue flagged), what is growing and being harvested, recently added records. Every number is computed from saved records. With no data you see an explanation and a button to start, never invented numbers. *Active* means Planned to Harvesting (not archived). *In progress* means Land preparation to Harvesting; cultivated area, crops being cultivated and active fields count only in-progress cycles.

**Calendar.** An agenda built only from the dates you saved (planting, harvest start, expected harvest end, nursery start, transplanting, and your planting records), grouped by month, with Upcoming/Past tabs, a crop filter and Overdue/Today flags. It is not a task manager and sends no notifications.

**Careful deleting.** Archive is the normal way to hide something. Delete is blocked while something depends on a record: a farm or field with cycles cannot be deleted; a crop used by cycles cannot be deleted; a variety used by a cycle cannot be deleted. Deleting a cycle also deletes its batches and records, shows exactly what will go, and asks you to type `DELETE`.

### Try the example scenario (Ama Farms, tomatoes)
Nothing about it is built into the app. Enter it yourself:
1. **My Farm** → add farm *Ama Farms* (Arua, West Nile) and a field, for example *Block A*, 2 acres.
2. **Crops → Catalogue → Add crop**: *Tomato*, Vegetables, usual method Transplanting.
3. Open Tomato → **Add variety**: *Ansal F1*, Hybrid.
4. **Crops → New cycle**: farm *Ama Farms*, field *Block A*, crop *Tomato*, variety *Ansal F1*, production system *Open field*, water *Irrigated*, area unit *Quarter-acres*, area *1.5*, target plants *3500*. You will see "= 0.375 acres" and "Fits in the field". Save.
5. On the cycle page add a **planting batch** (planned seedlings, spacing), later edit it to add the actual numbers, and add a **planting record**.

---

## 4. Updating your phone to version 1.1.0

Your farms and fields are not touched by the update. **Before you start, make a backup** (Backup → Create encrypted backup) and check the file is in Downloads.

### A. Put the new files on GitHub (from your phone)
1. Download `ama-farmtech-offline.zip` from this chat. In **Files → Downloads**, tap it → **Extract**.
2. In Chrome open **your repository on GitHub** (the one you made for Phase 1). If a menu is missing, use Chrome's ⋮ → **Desktop site**.
3. Tap **Add file → Upload files**. Choose these **8 files** from the extracted folder (not the icons folder):

   | New (add) | Replaced (same name, uploading replaces the old one) |
   |---|---|
   | `crops.js` | `app.js` |
   | `crops-ui.js` | `backup.js` |
   | | `db.js` |
   | | `index.html` |
   | | `service-worker.js` |
   | | `styles.css` |

   You may also upload `README.md` (replaces the old guide). **Do not touch** `manifest.webmanifest` or the `icons` folder: they did not change.
4. Wait until all files show as uploaded, then tap **Commit changes**.
5. Wait 1–3 minutes. In the repository tap **Actions** and wait for the latest "pages build and deployment" to show a green tick.
6. Check the repository's top level now lists: `app.js  backup.js  crops-ui.js  crops.js  db.js  icons/  index.html  manifest.webmanifest  README.md  service-worker.js  styles.css`.

> **Never upload a `.amabackup` file, photos or exported records to this repository.**

### B. Update the installed app on your phone
1. Open the installed app **with internet on**.
2. Go to **Settings → Check for a new version**.
3. A banner says **"A new version is ready"**. Tap **Update now**. The app reloads. Settings should show **v1.1.0**, the bottom menu should now have **Crops**, and your farms and fields should look exactly as before.
4. Open **Settings** again and wait until it says **"All 13 app files are stored on this phone"**.
5. If the banner does not appear: swipe the app away in recent apps, open it again with internet, wait 10 seconds and repeat step 2. If it still does not, check that all 8 files were uploaded (step A6).

The app never changes its files while you are typing: it only switches when you tap **Update now**.

---

## 5. First-time install (new phone, nothing installed yet)

Use **Chrome** and a free GitHub account.

1. Create a **public** repository named exactly `ama-farmtech-offline`. Leave "Add a README" unticked.
2. **Uploading an existing file** → choose these **10 files** from the extracted folder: `index.html`, `styles.css`, `app.js`, `db.js`, `crops.js`, `crops-ui.js`, `backup.js`, `manifest.webmanifest`, `service-worker.js`, `README.md` → **Commit changes**.
3. GitHub's phone uploader cannot upload folders, so make the icons folder: **Add file → Create new file**, name `icons/icon.svg`, paste the icon text below, **Commit changes**.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="AMA FarmTech Offline">
  <rect width="512" height="512" rx="112" fill="#1e5c37"/>
  <path d="M120 388h272" stroke="#a9d3b4" stroke-width="22" stroke-linecap="round" fill="none"/>
  <path d="M256 388V232" stroke="#ffffff" stroke-width="26" stroke-linecap="round" fill="none"/>
  <path d="M256 250c0-62 38-100 112-100 0 70-40 100-112 100z" fill="#ffffff"/>
  <path d="M256 296c0-46-30-76-92-76 0 54 32 76 92 76z" fill="#d8efde"/>
</svg>
```

4. Open the new **icons** folder → **Add file → Upload files** → the three PNGs `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` → **Commit changes**.
5. **Settings → Pages → Deploy from a branch → main, / (root) → Save.** Wait 1–3 minutes. The address is `https://YOUR-USERNAME.github.io/ama-farmtech-offline/`.
6. Open it in Chrome, wait for it to load, open **Settings** in the app: it should say **All 13 app files are stored on this phone**. Then Chrome's ⋮ → **Install app**.

---

## 6. Backups and moving to another phone

**Make a backup:** Backup → Create encrypted backup. Choose a password (8+ characters; four easy words is strong), repeat it, tick the box, tap the button. Chrome saves `AMA-FarmTech-backup-YYYYMMDD-HHMM.amabackup` in **Downloads**. Check it is there, and copy it somewhere outside the phone (Drive, email to yourself, another phone). The backup holds farms, fields, crops, varieties, cycles, batches, planting records and the activity log.

> **The password cannot be recovered.** It is not stored anywhere. Lose it and nobody can open the backup.

**Restore:** Install the app, copy the file over, **Backup → Restore from backup**, choose the file, enter the password, **Open backup**. Read the preview (it now counts crops, varieties, cycles, batches and planting records). Choose **Merge** (adds what is missing, deletes nothing; if the same record differs the phone's copy is kept unless you choose otherwise) or **Replace everything** (the preview lists exactly what will be deleted, including crop records; it needs a safety backup first and you must type `REPLACE`).

The Home screen reminds you when records changed since your last backup and the last backup is older than the reminder period (Settings, default 7 days).

---

## 7. Testing

### Run by me — automated, in headless Chrome on a Linux server (259 checks, all passing on the final files)

These ran against a local web server that behaves like GitHub Pages (app in a sub-folder, 10-minute file caching, HTTPS with a test certificate). **They did not run on a phone and not on real GitHub Pages.** Records were entered through the app's own forms, in a phone-sized window (393 × 851).

| Your Phase 2 test | What was run | Result |
|---|---|---|
| 1 Create a crop | Tomato and six more crops across all six categories; empty/duplicate/absurd values refused | Passed (test file 1, 50 checks for items 1–7) |
| 2 Multiple varieties | Five varieties on two crops; seed details kept; duplicate names with different lot numbers allowed, exact duplicates refused | Passed |
| 3 Create a cycle | Your scenario: Tomato, Ansal F1, open field, irrigated, 3,500 plants, 1.5 quarter-acres (= 1517.5711584 m² exactly) | Passed |
| 4 Allocate to an existing field | Cycle attached to a Phase 1 field; conversion and "fits" check shown; farm/field/crop in-use protections | Passed |
| 5 Record planting information | Planned vs actual numbers kept apart; nursery vs direct seeding; planting records; future dates refused | Passed |
| 6 Edit records | Crops, varieties, cycles, batches, records edited; activity log written | Passed |
| 7 Archive a cycle | Archive and restore; archived cycles hidden from statistics and free their area; delete needs typing `DELETE` | Passed |
| 8 Accurate dashboard statistics | Every number compared with an independently known dataset (23 checks) | Passed |
| 9 Prevent invalid field allocations | Single cycle larger than field refused; peak overlap warned; "Save anyway"/"Go back"; exact boundary; mixed units; undated rules | Passed |
| 10 Close and reopen without data loss | Browser fully closed and reopened with the same profile: every record identical, including one saved a moment before closing | Passed (14 checks, shared with item 11) |
| 11 Use in airplane mode | **Simulated:** browser network switched off, then web server stopped. Crops screens open; crop, variety, cycle, batch and record created offline; area warning works; backup made offline; survives closing and reopening. *Real Airplane mode on your phone is not yet tested.* | Passed |
| 12 Export a backup with Phase 1 + 2 records | Opened with separate code (Node.js crypto): all stores equal the phone's, exact values kept, no farm or crop text visible in the file | Passed (29 checks, shared with item 13) |
| 13 Restore it | Into an empty second phone: identical records and identical screens; merge conflicts; safety backup; replace; old Phase 1 backups restore; old Phase 1 app refuses new backups; damaged, inconsistent, hostile (HTML/script text) and too-new backups blocked or shown safely, with nothing imported | Passed |
| 14 Upgrade without losing Phase 1 data | The genuine, unchanged Phase 1 v1.0.0 app installed with 2 farms, 3 fields; only the changed files uploaded; "Update now" tapped; every Phase 1 record byte-identical afterwards (only change: an internal database-version number and one "upgraded" log entry) | Passed (14 checks) |
| Extra: layout | Crops screens at 320, 360, 393, 412 px and landscape (28 screens and states each, with very long names): no sideways scroll, touch targets ≥ 44 px, text ≥ 12 px, contrast ≥ 4.5:1, six-item menu fits | Passed (5 checks) |
| Phase 1 regression | All 122 Phase 1 checks re-run on the final code (units, offline engine, farm/field forms, backup and restore, migration, update flow, layouts, settings, 1,000-field scale) | Passed |

Test counts: Phase 1 re-run 122 · Phase 2 core 50 · dashboard and field-area 23 · close/reopen and offline 14 · backup and restore 29 · upgrade 14 · layout 5 · shrinking a field that has crops 2.

During testing, these were found and fixed: the "Over-allocated" check wrongly compared an undated future plan with old past crops; calendar month labels were 11.5 px (now 12 px); links on the cycle page were only 20 px tall (now 44 px); several wording and label-width issues.

### Still needs your phone (not tested by me)
1. **Updating your real, installed 1.0.0 app** through GitHub (section 4), including the "A new version is ready" banner on your phone.
2. **Real Airplane mode**, then fully closing and reopening the app, with the Crops module.
3. Chrome on Android installing and showing the icon, and the Back button inside the Crops screens.
4. The on-screen keyboard with the new forms (date fields, number fields), and typing numbers with a comma such as 3,500.
5. Whether the calendar and overview feel right with *your* real dates and crops.
6. Moving a backup between **two real phones**.
7. Anything about real GitHub Pages timing or caching on your account.

### Your phone checklist
- [ ] Made a backup before updating; the file is in Downloads.
- [ ] Updated (section 4B). Settings shows v1.1.0 and "All 13 app files are stored".
- [ ] Farms and fields look exactly as before.
- [ ] Entered the example scenario (section 3). Cycle page shows 1.5 quarter-acres (= 0.375 acres) and 3,500 plants.
- [ ] Tried to make a second cycle bigger than the field: the app refuses or warns.
- [ ] Airplane mode on; closed the app completely; opened it from the home screen: Crops and the cycle are still there. Added a planting record in Airplane mode.
- [ ] Airplane mode off; made a new backup; erased nothing; checked the file is in Downloads.
- [ ] (Optional) restored that backup on a second phone: crops, cycle and planting record all there.

---

## 8. Known limitations

* **Chrome can delete the data.** Clearing Chrome's site data, uninstalling Chrome, resetting or losing the phone deletes the records. Only backups kept outside the phone protect you.
* **Records on the phone are not encrypted by the app.** Only backup files are. Use a screen lock.
* **Lost backup password = lost backup.** There is no reset.
* **Chrome does not tell the app whether a download finished**, so "Last backup" means "a backup file was created". Check Downloads.
* **No live sync between phones.** Move records with backups; if two phones edited the same record, you pick which copy wins when restoring.
* **The calendar only shows dates you saved.** It does not create tasks, reminders or notifications, and it does not predict dates.
* **Field-area check is date-based.** Cycles without dates count as overlapping everything unfinished, which can produce warnings you must override with "Save anyway". If you later make a field smaller in My Farm, cycles that no longer fit are flagged on the Crops overview instead of being blocked.
* **One planting method per batch, one variety per cycle.** Mixed plantings (intercropping) are recorded as separate cycles on the same field.
* **Cost fields on a variety are records only.** There is no finance module yet.
* **Photos are not part of Phase 2.** Never upload photographs to GitHub.
* **Help text uses "Tomato" as an example only.** The app contains no sample records and no Ama Farms data.
* **Incognito tabs and very old browsers are not supported.**
* **A public repository** is required for free GitHub Pages. It contains only code.
* The first load needs internet. Updates need internet. Everything else does not.

## 9. Troubleshooting

| Problem | What to do |
|---|---|
| Update banner never appears | Close the app from recent apps, reopen with internet, wait 10 seconds, Settings → Check for a new version. Confirm all 8 files were committed (section 4A) and the Actions run has a green tick. |
| Settings says "Only N of 13 app files are stored" | One of the files is missing on GitHub (usually `crops.js` or `crops-ui.js`). Upload it, wait, then Check for a new version. |
| Crops tab missing | You are still on 1.0.0. Update (section 4B). |
| Page is plain/unstyled or "could not start" | A file is missing or misnamed. File names are case-sensitive. |
| "This field would be over-allocated" | Other cycles on that field use area at the same time. Check their dates and areas, archive finished ones, or tap Save anyway if it is intended. |
| Cannot delete a crop, field or farm | Something uses it (a cycle, a variety). Archive it instead, or remove the dependent records first. |
| Backup cannot be opened | Check the password (capitals, spaces). If it keeps failing the file is damaged: copy it again from where you stored it. |
| GitHub shows 404 | Pages not enabled or not finished (Settings → Pages). Wait 3 minutes. |

## 10. For later phases

* New data type: add a store in a **new** migration function in `db.js` (never edit an old one), raise `SCHEMA_VERSION`, and add the store to `STORES` (and `RELATIONS`, if it points at other records) in `backup.js`.
* New screens: call `AMA.ui.addRoutes(...)` as `crops-ui.js` does, and add the file to `APP_SHELL` in `service-worker.js`.
* Raise the app version in `service-worker.js` (`VERSION`) and `db.js` (`AMA.APP_VERSION`) with every release.
* Phase 3 has not been started.

---

*AMA FarmTech Offline 1.1.0 · Ama Farms Ltd · Phase 2*
