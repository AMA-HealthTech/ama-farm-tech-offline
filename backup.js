/*!
 * AMA FarmTech Offline - backup.js
 * Ama Farms Ltd
 *
 * Encrypted backup files and safe restore.
 *
 * File format (".amabackup", all integers big-endian):
 *    offset  size  field
 *    0       8     magic "AMAFTBAK"
 *    8       1     format version (1)
 *    9       1     flags (0)
 *    10      4     PBKDF2 iteration count
 *    14      16    random salt (new for every backup)
 *    30      12    random AES-GCM initialisation vector (new for every backup)
 *    42      ...   AES-256-GCM ciphertext + 16-byte authentication tag
 *
 * The whole 42-byte header is passed to AES-GCM as additional authenticated data,
 * so changing any header byte makes decryption fail.
 * The key is derived from the password with PBKDF2-HMAC-SHA-256. Nothing about the
 * phone, the browser or its stored keys is used, so a backup can be opened on any
 * phone that knows the password. The password itself is never stored.
 */
(function (global) {
  'use strict';

  const AMA = global.AMA;
  const db = AMA.db;
  const util = AMA.util;
  const V = AMA.validate;
  const r = db.r;

  const MAGIC = [0x41, 0x4d, 0x41, 0x46, 0x54, 0x42, 0x41, 0x4b]; // "AMAFTBAK"
  const FORMAT = 'ama-farmtech-backup';
  const FORMAT_VERSION = 1;
  const HEADER_LEN = 42;
  const KDF_ITERATIONS = 600000;
  const KDF_MIN = 100000;
  const KDF_MAX = 5000000;
  const MAX_FILE_BYTES = 100 * 1024 * 1024;
  const MIN_PASSWORD = 8;
  // Every store that goes into a backup file. The Phase 2 stores are optional when reading,
  // so a backup made by version 1.0.0 (farms and fields only) can still be restored.
  const STORES = ['farms', 'fields', 'crops', 'varieties', 'cycles', 'batches', 'plantings', 'activities', 'settings', 'backups'];
  const OPTIONAL_STORES = ['crops', 'varieties', 'cycles', 'batches', 'plantings', 'settings', 'backups'];
  // Records that are counted in previews and replaced by a "Replace everything" restore.
  const DATA_STORES = ['farms', 'fields', 'crops', 'varieties', 'cycles', 'batches', 'plantings', 'activities'];

  // Which record points at which other record (child store, field, parent store, optional).
  // A restore is blocked if it would leave a record pointing at something that does not exist.
  const RELATIONS = [
    ['fields', 'farmId', 'farms', false, 'field', 'farm'],
    ['varieties', 'cropId', 'crops', false, 'variety', 'crop'],
    ['cycles', 'farmId', 'farms', false, 'crop cycle', 'farm'],
    ['cycles', 'fieldId', 'fields', false, 'crop cycle', 'field'],
    ['cycles', 'cropId', 'crops', false, 'crop cycle', 'crop'],
    ['cycles', 'varietyId', 'varieties', true, 'crop cycle', 'variety'],
    ['batches', 'cycleId', 'cycles', false, 'planting batch', 'crop cycle'],
    ['plantings', 'cycleId', 'cycles', false, 'planting record', 'crop cycle'],
    ['plantings', 'batchId', 'batches', true, 'planting record', 'planting batch'],
  ];

  class BackupError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'BackupError';
      this.code = code;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Encryption                                                          */
  /* ------------------------------------------------------------------ */

  function requireCrypto() {
    if (!global.crypto || !global.crypto.subtle) {
      throw new BackupError('no_crypto',
        'Encryption is not available here. Open the app from its https:// address in Chrome (not from a file or an insecure address).');
    }
  }

  async function deriveKey(password, salt, iterations, usage) {
    const material = new TextEncoder().encode(String(password).normalize('NFKC'));
    const base = await global.crypto.subtle.importKey('raw', material, 'PBKDF2', false, ['deriveKey']);
    return global.crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      [usage]
    );
  }

  function passwordStrength(pw) {
    const s = String(pw || '');
    if (s.length < MIN_PASSWORD) return { ok: false, level: 0, label: 'Too short - use at least ' + MIN_PASSWORD + ' characters' };
    if (/^(.)\1+$/.test(s)) return { ok: false, level: 0, label: 'Too easy to guess' };
    const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(s)).length;
    const words = s.split(/\s+/).filter((w) => w.length >= 3).length;
    if (s.length >= 16 || (words >= 4 && s.length >= 14)) return { ok: true, level: 3, label: 'Strong' };
    if (s.length >= 12 && classes >= 2) return { ok: true, level: 2, label: 'Good' };
    return { ok: true, level: 1, label: 'Fair - a longer password is safer' };
  }

  async function encryptBackup(snapshot, password) {
    requireCrypto();
    const salt = global.crypto.getRandomValues(new Uint8Array(16));
    const iv = global.crypto.getRandomValues(new Uint8Array(12));
    const header = new Uint8Array(HEADER_LEN);
    header.set(MAGIC, 0);
    header[8] = FORMAT_VERSION;
    header[9] = 0;
    new DataView(header.buffer).setUint32(10, KDF_ITERATIONS, false);
    header.set(salt, 14);
    header.set(iv, 30);
    const key = await deriveKey(password, salt, KDF_ITERATIONS, 'encrypt');
    const plain = new TextEncoder().encode(JSON.stringify(snapshot));
    const cipher = new Uint8Array(await global.crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: header, tagLength: 128 }, key, plain));
    const out = new Uint8Array(HEADER_LEN + cipher.length);
    out.set(header, 0);
    out.set(cipher, HEADER_LEN);
    return out;
  }

  function inspectHeader(bytes) {
    if (bytes.length < MAGIC.length || !MAGIC.every((b, i) => bytes[i] === b)) {
      throw new BackupError('not_backup',
        'This is not an AMA FarmTech backup file. Choose the .amabackup file you exported from this app.');
    }
    if (bytes.length < HEADER_LEN + 17) {
      throw new BackupError('truncated',
        'This backup file is incomplete (it was probably cut short while copying or downloading). Copy or download it again.');
    }
    const version = bytes[8];
    if (version !== FORMAT_VERSION) {
      throw new BackupError('too_new',
        'This backup uses file format version ' + version + ', which this version of the app cannot read. Update the app and try again.');
    }
    const iterations = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(10, false);
    if (iterations < KDF_MIN || iterations > KDF_MAX) {
      throw new BackupError('damaged', 'The backup file header is damaged, so the file cannot be opened.');
    }
    return {
      iterations,
      salt: bytes.slice(14, 30),
      iv: bytes.slice(30, 42),
      header: bytes.slice(0, HEADER_LEN),
      body: bytes.slice(HEADER_LEN),
    };
  }

  async function decryptBackup(buffer, password) {
    requireCrypto();
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const h = inspectHeader(bytes);
    const key = await deriveKey(password, h.salt, h.iterations, 'decrypt');
    let plain;
    try {
      plain = await global.crypto.subtle.decrypt({ name: 'AES-GCM', iv: h.iv, additionalData: h.header, tagLength: 128 }, key, h.body);
    } catch (e) {
      throw new BackupError('decrypt_failed',
        'Could not open the backup. Either the password is wrong, or the file is damaged or has been changed. Check the password and try again.');
    }
    let snapshot;
    try {
      snapshot = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain));
    } catch (e) {
      throw new BackupError('damaged', 'The backup was decrypted but its contents are damaged and cannot be read.');
    }
    return snapshot;
  }

  /* ------------------------------------------------------------------ */
  /* Snapshot / validation                                               */
  /* ------------------------------------------------------------------ */

  const byCreated = (a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);

  async function buildSnapshot() {
    const data = await db.readAll();
    const stores = {
      farms: data.farms.sort(byCreated),
      fields: data.fields.sort(byCreated),
      crops: data.crops.sort(byCreated),
      varieties: data.varieties.sort(byCreated),
      cycles: data.cycles.sort(byCreated),
      batches: data.batches.sort(byCreated),
      plantings: data.plantings.sort(byCreated),
      activities: data.activities.sort(byCreated),
      settings: data.settings.filter((x) => V.PORTABLE_SETTINGS.indexOf(x.key) !== -1),
      backups: data.backups.sort(byCreated),
    };
    const counts = {};
    STORES.forEach((n) => {
      counts[n] = stores[n].length;
    });
    return {
      format: FORMAT,
      formatVersion: FORMAT_VERSION,
      appName: AMA.APP_NAME,
      brand: AMA.BRAND,
      appVersion: AMA.APP_VERSION,
      dbSchemaVersion: db.SCHEMA_VERSION,
      exportedAt: util.now(),
      counts,
      stores,
    };
  }

  /** Validate a decrypted snapshot and return only sanitised records. */
  function parseSnapshot(obj) {
    if (!obj || typeof obj !== 'object' || obj.format !== FORMAT) {
      throw new BackupError('not_backup', 'The decrypted file is not an AMA FarmTech backup.');
    }
    if (!Number.isInteger(obj.formatVersion) || obj.formatVersion < 1 || obj.formatVersion > FORMAT_VERSION) {
      throw new BackupError('too_new', 'This backup was made by a newer version of the app. Update the app and try again.');
    }
    if (!Number.isInteger(obj.dbSchemaVersion) || obj.dbSchemaVersion < 1) {
      throw new BackupError('damaged', 'The backup does not say which database version it uses, so it cannot be restored safely.');
    }
    if (obj.dbSchemaVersion > db.SCHEMA_VERSION) {
      throw new BackupError('too_new',
        'This backup was made by a newer version of the app (database version ' + obj.dbSchemaVersion + '). Update the app and try again.');
    }
    if (!util.isIso(obj.exportedAt)) throw new BackupError('damaged', 'The backup has no valid export date.');
    if (!obj.stores || typeof obj.stores !== 'object') throw new BackupError('damaged', 'The backup contains no records section.');

    const records = {};
    const invalid = [];
    STORES.forEach((name) => {
      let list = obj.stores[name];
      if (list === undefined && OPTIONAL_STORES.indexOf(name) !== -1) list = [];
      if (!Array.isArray(list) || list.length > 500000) {
        throw new BackupError('damaged', 'The backup is damaged: the "' + name + '" records are missing or unreadable.');
      }
      const seen = new Set();
      records[name] = [];
      list.forEach((raw, index) => {
        const res = V.sanitizeRecord(name, raw);
        if (!res.ok) {
          if (!res.skip) invalid.push({ store: name, index, error: res.error });
          return;
        }
        const key = name === 'settings' ? res.record.key : res.record.id;
        if (seen.has(key)) {
          invalid.push({ store: name, index, error: 'the same id appears twice in the file' });
          return;
        }
        seen.add(key);
        records[name].push(res.record);
      });
    });
    return {
      meta: {
        appName: String(obj.appName || '').slice(0, 60),
        appVersion: String(obj.appVersion || '').slice(0, 20),
        dbSchemaVersion: obj.dbSchemaVersion,
        formatVersion: obj.formatVersion,
        exportedAt: obj.exportedAt,
      },
      records,
      invalid,
    };
  }

  /** Decrypt + validate a chosen file. */
  async function openBackupFile(file, password) {
    if (!file) throw new BackupError('no_file', 'Choose a backup file first.');
    if (file.size > MAX_FILE_BYTES) throw new BackupError('too_big', 'This file is too large to be an AMA FarmTech backup.');
    if (file.size === 0) throw new BackupError('truncated', 'This file is empty.');
    let buffer;
    try {
      buffer = await file.arrayBuffer();
    } catch (e) {
      throw new BackupError('read_failed', 'The file could not be read. Move it to your phone storage and choose it again.');
    }
    const snapshot = await decryptBackup(buffer, password);
    const parsed = parseSnapshot(snapshot);
    parsed.fileName = file.name || '';
    parsed.sizeBytes = file.size;
    return parsed;
  }

  /* ------------------------------------------------------------------ */
  /* Restore analysis and plan                                           */
  /* ------------------------------------------------------------------ */

  function keyOf(name) {
    return name === 'settings' ? 'key' : 'id';
  }
  function stamp(rec) {
    return rec.updatedAt || rec.createdAt || '';
  }

  function analyze(parsed, current) {
    const stores = {};
    STORES.forEach((name) => {
      const key = keyOf(name);
      const map = new Map((current[name] || []).map((x) => [x[key], x]));
      const out = { newItems: [], identical: [], different: [] };
      parsed.records[name].forEach((rec) => {
        const cur = map.get(rec[key]);
        // Preferences are compared by value only (their modification time is not a real difference).
        const same = name === 'settings' ? cur && util.stable(cur.value) === util.stable(rec.value) : cur && util.stable(cur) === util.stable(rec);
        if (!cur) out.newItems.push(rec);
        else if (same) out.identical.push(rec);
        else out.different.push({ backup: rec, current: cur, newer: stamp(rec) > stamp(cur) ? 'backup' : stamp(rec) < stamp(cur) ? 'current' : 'same' });
      });
      stores[name] = out;
    });
    return stores;
  }

  /**
   * Work out exactly what a restore would do, without touching the database.
   * options.mode:   'merge' | 'replace'
   * options.policy: what to do when the same id exists in both places (merge only):
   *                 'keep_existing' (default) | 'keep_newer' | 'use_backup'
   */
  function makePlan(parsed, current, options) {
    const mode = options && options.mode === 'replace' ? 'replace' : 'merge';
    // options.skipInvalid: restore only the valid records of a partly damaged backup.
    const policy = options && ['keep_existing', 'keep_newer', 'use_backup'].indexOf(options.policy) !== -1 ? options.policy : 'keep_existing';
    const skipInvalid = !!(options && options.skipInvalid);
    const analysis = analyze(parsed, current);
    const ops = {};
    const summary = { added: 0, updated: 0, unchanged: 0, kept: 0, removed: 0 };
    const detail = {};

    // Preferences (country, currency, reminder days...) are not counted as records.
    // Merge only adds preferences that are missing here (or all of them if "use the backup's copy").
    const settingsPut = parsed.records.settings.filter((rec) => {
      if (mode === 'replace') return true;
      const a = analysis.settings;
      return a.newItems.indexOf(rec) !== -1 || (policy === 'use_backup' && a.different.some((d) => d.backup === rec));
    });
    ops.settings = { put: settingsPut };

    DATA_STORES.forEach((name) => {
      const a = analysis[name];
      const put = [];
      const d = { added: 0, updated: 0, unchanged: a.identical.length, kept: 0, removed: 0 };
      if (mode === 'replace') {
        parsed.records[name].forEach((rec) => put.push(rec));
        d.added = a.newItems.length;
        d.updated = a.different.length;
        const key = keyOf(name);
        const ids = new Set(parsed.records[name].map((x) => x[key]));
        d.removed = (current[name] || []).filter((x) => !ids.has(x[key])).length;
      } else {
        a.newItems.forEach((rec) => {
          put.push(rec);
          d.added++;
        });
        a.different.forEach((x) => {
          const take = policy === 'use_backup' || (policy === 'keep_newer' && x.newer === 'backup');
          if (take) {
            put.push(x.backup);
            d.updated++;
          } else {
            d.kept++;
          }
        });
      }
      ops[name] = { put };
      detail[name] = d;
      Object.keys(summary).forEach((k) => {
        summary[k] += d[k];
      });
    });
    // Backup history is device-specific: only add entries that are missing.
    ops.backups = { put: analysis.backups.newItems.slice() };
    detail.backups = { added: analysis.backups.newItems.length };

    // Integrity: work out what the phone would hold after the restore, then check that every record
    // points at records that will exist (a field at its farm, a crop cycle at its farm, field and crop...).
    const finalRecords = {};
    DATA_STORES.forEach((name) => {
      const map = new Map();
      if (mode === 'merge') (current[name] || []).forEach((x) => map.set(x.id, x));
      ops[name].put.forEach((x) => map.set(x.id, x));
      finalRecords[name] = map;
    });
    const problems = [];
    let orphans = 0;
    RELATIONS.forEach(([child, key, parent, optional, childLabel, parentLabel]) => {
      let bad = 0;
      finalRecords[child].forEach((rec) => {
        const ref = rec[key];
        if (optional && !ref) return;
        if (!finalRecords[parent].has(ref)) bad++;
      });
      if (bad) {
        orphans += bad;
        problems.push(bad + ' ' + childLabel + (bad === 1 ? '' : 's') + ' in the result would not belong to any ' + parentLabel +
          '. The restore was blocked to protect your data.');
      }
    });
    // A crop cycle's field must belong to the cycle's farm, and its variety to its crop.
    let mismatched = 0;
    finalRecords.cycles.forEach((c) => {
      const f = finalRecords.fields.get(c.fieldId);
      if (f && f.farmId !== c.farmId) mismatched++;
      if (c.varietyId) {
        const v = finalRecords.varieties.get(c.varietyId);
        if (v && v.cropId !== c.cropId) mismatched++;
      }
    });
    finalRecords.plantings.forEach((p) => {
      if (!p.batchId) return;
      const b = finalRecords.batches.get(p.batchId);
      if (b && b.cycleId !== p.cycleId) mismatched++;
    });
    if (mismatched) {
      orphans += mismatched;
      problems.push(mismatched + ' record' + (mismatched === 1 ? '' : 's') + ' in the result would point at records that do not match each other (for example a crop cycle whose field belongs to a different farm). The restore was blocked to protect your data.');
    }
    if (parsed.invalid.length && !skipInvalid) {
      problems.push(parsed.invalid.length + ' record' + (parsed.invalid.length === 1 ? ' in the backup is' : 's in the backup are') +
        ' damaged or invalid. The restore was blocked so that nothing is silently lost.');
    }

    const hadData = DATA_STORES.some((n) => (current[n] || []).length > 0);
    const changesExisting = (mode === 'replace' && hadData) || summary.updated > 0;

    return { mode, policy, ops, summary, detail, analysis, problems, changesExisting, orphans };
  }

  async function applyPlan(plan, info) {
    if (plan.problems.length) throw new BackupError('blocked', plan.problems[0]);
    const ts = util.now();
    const s0 = plan.summary;
    await db.withTx(db.ALL_STORES, 'readwrite', async (s) => {
      if (plan.mode === 'replace') {
        await Promise.all(DATA_STORES.map((name) => r(s[name].clear())));
      }
      const jobs = [];
      DATA_STORES.concat(['backups', 'settings']).forEach((name) => {
        plan.ops[name].put.forEach((rec) => jobs.push(r(s[name].put(rec))));
      });
      await Promise.all(jobs);

      // Drop a "primary farm" preference that points at a farm which no longer exists.
      const primary = await r(s.settings.get('primaryFarmId'));
      if (primary && !(await r(s.farms.get(primary.value)))) await r(s.settings.delete('primaryFarmId'));

      const text = (plan.mode === 'replace' ? 'Backup restored (all data replaced): ' : 'Backup merged: ') +
        s0.added + ' added, ' + s0.updated + ' updated' + (plan.mode === 'replace' ? ', ' + s0.removed + ' removed' : '');
      await r(s.backups.add({
        id: util.uuid(),
        kind: 'restore',
        createdAt: ts,
        fileName: (info && info.fileName) || '',
        sizeBytes: (info && info.sizeBytes) || 0,
        appVersion: (info && info.appVersion) || '',
        dbSchemaVersion: (info && info.dbSchemaVersion) || 0,
        counts: DATA_STORES.reduce((o, name) => {
          o[name] = plan.detail[name].added + plan.detail[name].updated;
          return o;
        }, {}),
        note: text,
      }));
      await r(s.activities.add(db.newActivity('backup.restore', 'backup', '', text, ts)));
      await r(s.settings.put({ key: 'lastRestoreAt', value: ts, updatedAt: ts }));
      await db.touchChange(s.settings, ts);
    });
    return plan.summary;
  }

  /* ------------------------------------------------------------------ */
  /* Creating backup files                                               */
  /* ------------------------------------------------------------------ */

  function fileStamp(iso, timeZone) {
    let tz = timeZone;
    if (!util.isValidTimeZone(tz)) tz = 'UTC';
    const parts = {};
    new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(iso)).forEach((p) => {
      parts[p.type] = p.value;
    });
    return parts.year + parts.month + parts.day + '-' + parts.hour + parts.minute;
  }

  function makeFileName(kind, iso, timeZone) {
    const prefix = kind === 'safety' ? 'AMA-FarmTech-SAFETY-before-restore-' : 'AMA-FarmTech-backup-';
    return prefix + fileStamp(iso, timeZone) + '.amabackup';
  }

  /** Builds and encrypts a backup. Does not touch the database or start a download. */
  async function createBackupFile(password, options) {
    const kind = options && options.kind === 'safety' ? 'safety' : 'export';
    const pw = String(password || '');
    if (pw.length < MIN_PASSWORD) throw new BackupError('weak_password', 'Use a password of at least ' + MIN_PASSWORD + ' characters.');
    const snapshot = await buildSnapshot();
    const bytes = await encryptBackup(snapshot, pw);
    return {
      kind,
      bytes,
      snapshot,
      sizeBytes: bytes.length,
      fileName: makeFileName(kind, snapshot.exportedAt, options && options.timeZone),
    };
  }

  /** Call after the file has been handed to the browser's download manager. */
  async function recordBackup(file) {
    const c = file.snapshot.counts;
    const ts = file.snapshot.exportedAt;
    await db.withTx([db.STORE.BACKUPS, db.STORE.ACTIVITIES, db.STORE.SETTINGS], 'readwrite', async (s) => {
      await r(s.backups.add({
        id: util.uuid(),
        kind: file.kind,
        createdAt: ts,
        fileName: file.fileName,
        sizeBytes: file.sizeBytes,
        appVersion: AMA.APP_VERSION,
        dbSchemaVersion: db.SCHEMA_VERSION,
        counts: DATA_STORES.reduce((o, name) => {
          o[name] = c[name] || 0;
          return o;
        }, {}),
        note: '',
      }));
      const label = file.kind === 'safety' ? 'Safety backup created' : 'Encrypted backup created';
      const cropPart = (c.cycles || 0) + (c.crops || 0) ? ', ' + (c.crops || 0) + ' crops, ' + (c.cycles || 0) + ' crop cycles' : '';
      await r(s.activities.add(db.newActivity(file.kind === 'safety' ? 'backup.safety' : 'backup.export', 'backup', '',
        label + ' (' + c.farms + ' farms, ' + c.fields + ' fields' + cropPart + ')', util.now())));
      await r(s.settings.put({ key: 'lastBackupAt', value: ts, updatedAt: ts }));
    });
  }

  function downloadBytes(bytes, fileName) {
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const url = global.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    a.hidden = true;
    document.body.appendChild(a);
    a.click();
    global.setTimeout(() => {
      a.remove();
      global.URL.revokeObjectURL(url);
    }, 60000);
  }

  function canShareFiles() {
    try {
      if (!global.navigator || typeof global.navigator.canShare !== 'function' || typeof global.navigator.share !== 'function') return false;
      return global.navigator.canShare({ files: [new File([new Uint8Array(1)], 'test.amabackup', { type: 'application/octet-stream' })] });
    } catch (e) {
      return false;
    }
  }

  async function shareBytes(bytes, fileName) {
    const file = new File([bytes], fileName, { type: 'application/octet-stream' });
    await global.navigator.share({ files: [file], title: 'AMA FarmTech backup' });
  }

  AMA.backup = {
    BackupError,
    FORMAT_VERSION,
    HEADER_LEN,
    KDF_ITERATIONS,
    MIN_PASSWORD,
    STORES,
    DATA_STORES,
    passwordStrength,
    buildSnapshot,
    encryptBackup,
    decryptBackup,
    parseSnapshot,
    openBackupFile,
    analyze,
    makePlan,
    applyPlan,
    createBackupFile,
    recordBackup,
    makeFileName,
    downloadBytes,
    canShareFiles,
    shareBytes,
  };
})(window);
