# AMA FarmTech Offline

**Ama Farms Ltd — offline farm records for Android.**
Phase 1: foundation and offline engine. Version 1.0.0.

An installable web app (PWA) that keeps your farm records **on your phone**, works with **no internet** after the first load, and moves records between phones with **password-encrypted backup files**. No account, no subscription, no cloud database. GitHub Pages only hosts the app's files.

> **Never upload farm records, backup files (`.amabackup`) or photographs to GitHub.**
> The GitHub repository must contain only the app files listed below. Your records stay on your phone and in backup files you keep yourself (Google Drive, email to yourself, another phone).

---

## 1. What Phase 1 contains

| Section | What it does |
|---|---|
| **Dashboard** | Farm name, number of farms, fields and records, total field area, recent activity, storage status, online/offline indicator, last backup date, backup reminder. Everything shown comes from the records on the phone. |
| **My Farm** | Create, edit and delete farms (several allowed) and the fields inside them. Default country Uganda, currency UGX, time zone Africa/Kampala. Areas in acres or hectares, converted exactly. |
| **Records** | Search and filter farms, fields and the activity log. |
| **Backup** | Create an encrypted `.amabackup` file; restore it on this or another phone with a preview, merge or replace, and a safety backup. |
| **Settings** | Defaults, install instructions, storage protection, offline status, check for updates, erase all data. |

Not in Phase 1 (by design): crops, inventory, finance, sales, reports, photos.

---

## 2. Architecture overview

```
 Phone (Chrome)
 ┌──────────────────────────────────────────────────────────────┐
 │  index.html  ── loads ──►  db.js  ►  backup.js  ►  app.js    │
 │                                                              │
 │  app.js     screens, forms, routing (#/ addresses),          │
 │             install + storage + update messages              │
 │  backup.js  encrypt / decrypt, restore plan (merge/replace)  │
 │  db.js      validation, exact unit maths, IndexedDB,         │
 │             transactions, migrations                         │
 │                                                              │
 │  IndexedDB  ◄── all farm records live here (on the phone)    │
 │  Cache      ◄── app files only (HTML, CSS, JS, icons)        │
 │                                                              │
 │  service-worker.js  serves the app files from the cache,     │
 │                     so the app opens with no internet        │
 └──────────────────────────────────────────────────────────────┘
        ▲ app files only (one-way, when online)
 GitHub Pages  (public, static hosting — never receives records)
```

**Key decisions**

* **Records never pass through the service worker.** The service worker caches only the app's own files. Records are in IndexedDB.
* **Exact area maths.** Areas are stored as the number you typed *and* as an exact square-metre string (1 acre = 4046.8564224 m² exactly, 1 ha = 10,000 m²), calculated with whole-number (BigInt) arithmetic. No floating-point rounding anywhere.
* **Safe screens.** Every piece of text from a form or a backup file is put on the screen as plain text. The app never builds HTML from data, and a Content-Security-Policy blocks outside scripts, fonts and connections.
* **Relative paths everywhere** (`./`, `icons/...`). The app works at `https://name.github.io/ama-farmtech-offline/`, in any other folder, or at a site root.
* **Safe updates.** A new version downloads quietly into a new cache. The app shows "A new version is ready" and only switches when you tap **Update now**, so files never change under you while you type.

### File structure

```
ama-farmtech-offline/
├── index.html              page shell, bottom navigation, security policy
├── styles.css              forest-green mobile design
├── app.js                  screens and behaviour
├── db.js                   database, validation, unit conversion, migrations
├── backup.js               encrypted backup and restore
├── service-worker.js       offline app files + safe updates
├── manifest.webmanifest    installation details (name, icons, colours)
├── README.md               this guide
└── icons/
    ├── icon.svg            app icon (source below)
    ├── icon-192.png        Android home-screen icon
    ├── icon-512.png        Android install icon
    └── icon-maskable-512.png   icon for round/squircle masks
```

The three PNG icons are the only additions to your required list. Chrome on Android needs 192 px and 512 px PNG icons to offer a proper install.

### Database (IndexedDB, name `ama-farmtech-offline`, version 1)

| Store | Holds | Indexes (for fast search) |
|---|---|---|
| `farms` | farm profiles | `nameLower`, `createdAt`, `updatedAt` |
| `fields` | fields of a farm | `farmId`, `farmId_codeLower`, `nameLower`, `status`, `createdAt`, `updatedAt` |
| `settings` | defaults, last backup date, schema version | (key lookup) |
| `activities` | log of what was done | `createdAt`, `entityType`, `entityId` |
| `backups` | history of backups, safety backups and restores (details only, never the files) | `createdAt`, `kind` |

Every record has a UUID `id`, `createdAt` and `updatedAt`. Every save, edit and delete runs in **one transaction** together with its log entry, so a failure leaves nothing half-written.

**Upgrades.** `db.js` has a list of numbered migrations. A new version adds one function (create a store, add an index, convert records). The rules are written beside the list: migrations must never delete data, and if one fails the whole upgrade is cancelled and your records stay exactly as they were.

### Backup file format (`.amabackup`)

| Bytes | Content |
|---|---|
| 0–7 | `AMAFTBAK` (identifies the file) |
| 8–9 | format version (1), flags |
| 10–13 | PBKDF2 iteration count (600,000) |
| 14–29 | random **salt** (new for every backup) |
| 30–41 | random **IV** (new for every backup) |
| 42–end | **AES-256-GCM** encrypted data + 16-byte authentication tag |

The key comes from your password with **PBKDF2-SHA-256**. The first 42 bytes are also authenticated, so changing any byte makes opening fail. Inside (once decrypted): app name and version, database version, export date and time, counts, and all farms, fields, activity, backup history and portable settings.
Nothing about the phone or browser is used in the key, so **the file plus the password is enough on any phone**. The password is never stored anywhere.

---

## 3. Put the app on GitHub (from your phone)

You need a free GitHub account. Use **Chrome** on your phone. Some GitHub pages show more options if you switch Chrome to **Desktop site** (⋮ menu → *Desktop site*).

### A. Get the files onto your phone
1. Download `ama-farmtech-offline.zip` from this chat.
2. Open the **Files** app → *Downloads* → tap the ZIP → **Extract**. You get a folder `ama-farmtech-offline`.

### B. Create the repository
1. Open **github.com**, sign in, tap **+** → **New repository**.
2. Repository name: `ama-farmtech-offline` (use exactly this, all lowercase).
3. Choose **Public**. (Free GitHub Pages needs a public repository. That is safe here, because the repository holds only the app's code and no farm data.)
4. Leave "Add a README file" **unticked**. Tap **Create repository**.

### C. Upload the main files
1. On the new empty repository page, tap **uploading an existing file**.
2. Tap **choose your files** and select these **8 files** from the extracted folder (not the `icons` folder):
   `index.html`, `styles.css`, `app.js`, `db.js`, `backup.js`, `manifest.webmanifest`, `service-worker.js`, `README.md`
3. Wait until all 8 show as uploaded, then tap **Commit changes**.

### D. Add the icons folder
GitHub's phone uploader cannot upload folders, so make the folder first:
1. In the repository tap **Add file → Create new file**.
2. In the name box type `icons/icon.svg` (typing the `/` creates the folder).
3. Paste the icon text below into the big box and tap **Commit changes**.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="AMA FarmTech Offline">
  <rect width="512" height="512" rx="112" fill="#1e5c37"/>
  <!-- soil line -->
  <path d="M120 388h272" stroke="#a9d3b4" stroke-width="22" stroke-linecap="round" fill="none"/>
  <!-- stem -->
  <path d="M256 388V232" stroke="#ffffff" stroke-width="26" stroke-linecap="round" fill="none"/>
  <!-- right leaf -->
  <path d="M256 250c0-62 38-100 112-100 0 70-40 100-112 100z" fill="#ffffff"/>
  <!-- left leaf -->
  <path d="M256 296c0-46-30-76-92-76 0 54 32 76 92 76z" fill="#d8efde"/>
</svg>
```

4. Open the new **icons** folder → **Add file → Upload files** → choose the three PNGs from the extracted `icons` folder: `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` → **Commit changes**.

### E. Check the file list
The repository's main page must show, in the **top level** (not inside another folder):
`app.js  backup.js  db.js  icons/  index.html  manifest.webmanifest  README.md  service-worker.js  styles.css`
File names are case-sensitive. `icons/` must contain the 4 icon files.

---

## 4. Turn on GitHub Pages

1. In your repository tap **Settings** (use *Desktop site* if you can't see it) → **Pages**.
2. Under **Build and deployment → Source** choose **Deploy from a branch**.
3. Branch: **main**, folder: **/ (root)** → **Save**.
4. Wait 1–3 minutes. Refresh the Pages screen until it says *"Your site is live at …"*.

Your address is:

```
https://YOUR-GITHUB-USERNAME.github.io/ama-farmtech-offline/
```

Open it in Chrome. You should see the dashboard with the welcome message. If you see GitHub's "404", see *Troubleshooting* at the end.

---

## 5. Install on Android (Chrome)

1. Open your address in **Google Chrome** (not inside WhatsApp or Facebook).
2. Let it load, then open **Settings** in the app. Under *Offline use and updates* you should read **"All 11 app files are stored on this phone"**. If it says "Saving…", keep the app open a few seconds and open Settings again.
3. Tap Chrome's **⋮** menu → **Install app** (or **Add to Home screen** → **Install**). On the Dashboard and in Settings the app also shows an **Install app** button when Chrome offers it.
4. Open **AMA FarmTech** from your home screen. It opens full screen like a normal app.

### Offline checklist (do this on your phone before trusting the app)
- [ ] Opened the address once with internet. Settings shows "All 11 app files are stored".
- [ ] Installed to the home screen.
- [ ] Created a test farm and a test field.
- [ ] Switched on **Airplane mode**. Fully closed the app (swipe it away in recent apps). Opened it again from the home screen: it opens, shows **Offline**, and the test farm is still there.
- [ ] Added another field while in Airplane mode: it saves.
- [ ] Made a backup in Airplane mode: the file appears in **Files → Downloads**.
- [ ] Switched Airplane mode off, restarted the phone, opened the app: all records still there.
- [ ] Opened the backup file on a **second phone** (see section 6) with the password: records match.
- [ ] Typed a **wrong password**: the app refuses it with a clear message.

---

## 6. Backups and moving to another phone

### Make a backup
**Backup → Create encrypted backup.** Choose a password (8+ characters; a short sentence of 4 words is strong and easy to remember), repeat it, tick the box and tap the button. Chrome saves `AMA-FarmTech-backup-YYYYMMDD-HHMM.amabackup` in **Downloads**.
Then **check that the file is in Downloads** (Chrome does not let the app confirm that), and copy it somewhere outside the phone: Google Drive, email to yourself, or another phone.

> **The password cannot be recovered.** It is not stored anywhere. If you lose it, nobody (including Ama Farms and the developers) can open the backup. Write it down and keep it apart from the file.

### Restore on another phone
1. Install the app on the new phone (section 5).
2. Copy the `.amabackup` file to it (Drive, email, WhatsApp as *document*, Bluetooth or cable).
3. **Backup → Restore from backup** → choose the file → enter the password → **Open backup**.
4. Read the preview (what is new, what is identical, what differs). Nothing is saved yet.
5. Choose **Merge** (adds what is missing, deletes nothing) or **Replace everything**.
   * If the same record exists on both phones with different contents, **Merge keeps the phone's copy by default**. You can instead choose "use the newest" or "use the backup's copy".
   * Anything that would overwrite or delete records first asks you to **save a safety backup of the phone's current records**. Replace also needs you to type `REPLACE`.

### Make backups a habit
The Dashboard reminds you when records changed since your last backup and the last backup is older than the reminder period (Settings, default 7 days). A backup is the **only** protection against a lost, stolen or reset phone, or Chrome's site data being cleared.

---

## 7. Updating the app later (also from your phone)

1. In GitHub open the file you want to change, tap the pencil ✎, edit, **Commit changes**. (Or upload a new copy of the file with the same name.)
2. **Every time you change any app file, raise the version number in two places**, for example `1.0.0` → `1.0.1`:
   * `service-worker.js`: the line `const VERSION = '1.0.0';`
   * `db.js`: the line `AMA.APP_VERSION = '1.0.0';`
3. Phones notice the new version when the app is opened online (at most about once an hour) or when you tap **Settings → Check for a new version**. A banner says **A new version is ready**. Tap **Update now**.

If you forget to raise the version, phones keep the old files.

---

## 8. Testing: what was actually run, and what still needs your phone

### Run by me — automated, in headless Chrome on a Linux server (122 checks, all passing on the final files)

These ran against a local web server that copies GitHub Pages' behaviour (app in a sub-folder, 10-minute file caching, HTTPS with a test certificate). **They did not run on a phone and not on real GitHub Pages.**

| Your test item | What was checked | Result |
|---|---|---|
| 1 Loads over HTTPS | Page, scripts and storage work in a secure (https) page; no failed requests; **no request to any outside site** | Passed |
| 2 Installs as PWA | Chrome's own installability check reports no errors. *(Tapping Install on a real phone is untested.)* The install button and "installed" message were tested with a simulated Chrome install event | Passed |
| 3 Manifest valid | Chrome's manifest parser reports no errors; all icons load at their declared sizes; start address and scope stay inside the app folder | Passed |
| 4 Service worker | Registers with the correct scope in the sub-folder, in a deeper folder and at a site root; all 11 files cached | Passed |
| 5 Works offline | Browser network off: reloads, all 5 sections open. **Web server stopped completely**: app still opens and saves a farm | Passed |
| 6 / 7 Farm and field creation | Through the real forms: UUIDs, timestamps, defaults, validation, duplicate names and codes refused, edit, delete (with cascade), search and filters | Passed |
| 8 Records survive closing | Chrome closed completely and reopened with the same profile: identical data | Passed |
| 9 Transactions | A failure half-way rolls everything back; six simultaneous saves of the same name create one farm; a failed farm delete restores its fields; "storage full" gives a clear message and saves nothing | Passed |
| 10 Backup export | Real file download; correct name and header | Passed |
| 11 Encryption | Salt and IV differ every time; file holds none of the farm text; **opened with separate code (Node.js crypto)**, so the format is a standard one, not only readable by the app; password found nowhere on the phone | Passed |
| 12 Backup import | Restore with preview, merge, replace, safety backup | Passed |
| 13 Wrong passwords | Wrong password, flipped bits in data/salt/IV/header, cut-off file, text file, picture, empty file, 105 MB file, newer format: all refused with clear messages; database unchanged afterwards | Passed |
| 14 Duplicate IDs | Identical records recognised; differing copies listed; default merge keeps the phone's copy; overwriting needs a safety backup; replace needs typing REPLACE; hostile files (bad IDs, HTML in names, `__proto__` keys, orphan fields) detected, nothing runs | Passed |
| 15 Transfer between installations | Three separate browsers, including one at a different web address: records arrive identical | Passed |
| 16 Migration | A test upgrade 1→2 keeps every record and adds a store and index; a deliberately broken upgrade is rolled back with records intact; old code refuses a newer database safely | Passed |
| 17 Phone layouts | 320, 360, 393, 412 px wide and landscape, 100 screens and states each (including very long unbroken names, restore preview, dialog): no sideways scroll, nothing off-screen, touch targets ≥ 44 px, text ≥ 12 px, inputs ≥ 16 px, contrast ≥ 4.5:1 | Passed |
| Extra | New-version banner, "Update now", old cache removed, works offline after update; exact unit conversion checked against 2,960 independent exact values; 1,000 fields: screens under 70 ms, backup/restore about a quarter of a second each | Passed |

### Still needs your phone (not tested by me)
1. Real **GitHub Pages** deployment (section 4) and that the address opens.
2. Chrome on Android actually offering and completing **Install app**, and the icon looking right on your home screen.
3. The **Offline checklist** in section 5 on the real phone, including after a restart.
4. Where Chrome puts the downloaded backup file, and that the **Share** button (if your phone offers it) works.
5. Moving a backup between **two real phones** and restoring it.
6. Whether Chrome grants **protected storage** on your phone (it decides, based on how you use the app; the app tells you honestly either way).
7. How fast the 600,000-step key calculation feels on your phone (about a quarter of a second on my test machine; older phones may take a few seconds. The app shows "Encrypting…").
8. The Android **Back button** (each screen is a history step, so Back should go to the previous screen), the on-screen keyboard with the forms, and general feel.

---

## 9. Limits and honest warnings

* **Chrome can delete the data.** Records live in the browser's storage for this app. Clearing Chrome's site data, uninstalling Chrome, resetting or losing the phone deletes them. "Protected storage" only lowers the chance that Chrome clears data when the phone runs low on space; it is never a guarantee. **Only backups kept outside the phone protect you.**
* **Records on the phone are not encrypted by the app.** Only backup files are. Protect your phone with a screen lock, and keep backup files somewhere you trust.
* **Lost password = lost backup.** There is no reset.
* **Chrome does not tell the app whether a download really finished**, so "Last backup" means "a backup file was created". Always check Downloads.
* **Incognito/private tabs and very old browsers are not supported** (no durable storage there). The app says so instead of failing silently.
* **No live sync between phones.** Phones are brought together by restoring a backup. If two phones both change the same record, you choose which copy wins at restore time.
* **Android and Chrome only** were designed for. Other browsers may work but were not considered.
* **A public repository** is required for free GitHub Pages. It contains only code. Do not add anything personal to it.
* The first load needs internet. Updates need internet. Everything else does not.

## 10. Troubleshooting

| Problem | What to do |
|---|---|
| GitHub shows **404** for your address | Pages not enabled or not finished: Settings → Pages (section 4). Wait 3 minutes. Check the name is exactly `ama-farmtech-offline` and the files are at the repository's top level. |
| Page opens but is plain/unstyled or "could not start" | A file is missing or misnamed. Compare with the list in section 3E. Names are case-sensitive. |
| Settings says "Only N of 11 app files are stored" | Usually the `icons` files are missing. Add them (section 3D), wait, reload the app online. |
| No **Install app** in Chrome's menu | Reload the page online, wait 10 seconds, try again. Use **Add to Home screen** instead. Open it in Chrome itself, not another app's browser. |
| App shows an old version | Settings → **Check for a new version**. Did you raise the version numbers (section 7)? |
| "Wrong password or damaged file" | Check the password carefully (capital letters, spaces). If it keeps failing with the right password the file is damaged: copy it again from where you stored it. |
| Backup file not in Downloads | Make another backup, then look in **Files → Downloads**; check Chrome's download permission for storage. |
| "No free storage" message | Free space on the phone (delete unused files/apps), then try again. Nothing was saved. |

## 11. Growing the app (for later phases)

* New data type: add a store in a new migration function in `db.js` (never edit the first one) and raise `SCHEMA_VERSION`.
* New screens: add a route in `app.js` (`ROUTES` + `VIEWS`) and, if records are involved, a list in `backup.js` (`STORES`) so backups include them.
* Records must keep their `id`, `createdAt`, `updatedAt` fields so merge and restore keep working.
* Raise the app version in `service-worker.js` and `db.js` with every release.
* Photos, when added, must be kept out of the repository and stored in IndexedDB; the backup format version should be raised when they are included.

---

*AMA FarmTech Offline 1.0.0 · Ama Farms Ltd · Phase 1*
