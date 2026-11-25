/*!
 * AMA FarmTech Offline - db.js
 * Ama Farms Ltd
 *
 * Shared utilities, input validation, exact unit conversion and the IndexedDB layer.
 * No network access. No external libraries.
 *
 * Everything is exposed on the global `AMA` namespace:
 *   AMA.util, AMA.units, AMA.validate, AMA.db
 */
(function (global) {
  'use strict';

  const AMA = (global.AMA = global.AMA || {});

  AMA.APP_NAME = 'AMA FarmTech Offline';
  AMA.BRAND = 'Ama Farms Ltd';
  // Displayed in the app and written into every backup file.
  // Keep in step with VERSION in service-worker.js whenever you publish a change.
  AMA.APP_VERSION = '1.0.0';

  /* ------------------------------------------------------------------ */
  /* Errors                                                              */
  /* ------------------------------------------------------------------ */

  class AppError extends Error {
    constructor(code, message, cause) {
      super(message);
      this.name = 'AppError';
      this.code = code;
      this.cause = cause;
    }
  }

  class ValidationError extends AppError {
    constructor(errors) {
      super('validation', 'Please fix the highlighted fields.');
      this.name = 'ValidationError';
      this.errors = errors;
    }
  }

  function normalizeError(e) {
    if (e instanceof AppError) return e;
    const name = e && e.name;
    if (name === 'QuotaExceededError') {
      return new AppError('quota',
        'This phone has no free storage left for the app, so nothing was saved. Free up space (delete unused files or apps) and try again.', e);
    }
    if (name === 'VersionError') {
      return new AppError('version',
        'The data on this phone was created by a newer version of AMA FarmTech Offline, so this older copy of the app will not open it. Your records are safe and unchanged. Reload the app while online to get the newest version.', e);
    }
    if (name === 'SecurityError' || name === 'UnknownError' || name === 'NotAllowedError') {
      return new AppError('unavailable',
        'Local storage is not available in this browser mode (for example private or incognito browsing). Open the app in a normal Chrome tab.', e);
    }
    if (name === 'AbortError') {
      return new AppError('aborted', 'The database operation was cancelled. No changes were made.', e);
    }
    return new AppError('db', 'Database error' + (e && e.message ? ': ' + e.message : '.'), e);
  }

  /* ------------------------------------------------------------------ */
  /* Utilities                                                           */
  /* ------------------------------------------------------------------ */

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

  const util = {
    uuid() {
      if (global.crypto && typeof global.crypto.randomUUID === 'function') {
        return global.crypto.randomUUID();
      }
      const b = new Uint8Array(16);
      global.crypto.getRandomValues(b);
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
      return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
    },
    now() {
      return new Date().toISOString();
    },
    isUuid(v) {
      return typeof v === 'string' && UUID_RE.test(v);
    },
    isIso(v) {
      return typeof v === 'string' && ISO_RE.test(v) && !isNaN(Date.parse(v));
    },
    isValidTimeZone(tz) {
      if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
      try {
        new Intl.DateTimeFormat('en-GB', { timeZone: tz });
        return true;
      } catch (e) {
        return false;
      }
    },
    /** Deterministic JSON (sorted keys) used to compare records. */
    stable(value) {
      if (Array.isArray(value)) return '[' + value.map(util.stable).join(',') + ']';
      if (value && typeof value === 'object') {
        return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + util.stable(value[k])).join(',') + '}';
      }
      return JSON.stringify(value);
    },
  };

  /* ------------------------------------------------------------------ */
  /* Exact unit conversion (BigInt decimal arithmetic, no float rounding) */
  /* ------------------------------------------------------------------ */

  const units = (function () {
    // The international acre is defined as exactly 4046.8564224 square metres.
    // Stored as an integer scaled by 10^7 so no precision is ever lost.
    const ACRE_SCALED = 40468564224n;
    const ACRE_SCALE = 7;
    const HA_IN_SQM = 10000n;
    const p10 = (n) => 10n ** BigInt(n);

    function parseDecimal(str, maxInt, maxFrac) {
      if (typeof str !== 'string') return null;
      const m = new RegExp('^(\\d{1,' + maxInt + '})(?:\\.(\\d{1,' + maxFrac + '}))?$').exec(str.trim());
      if (!m) return null;
      const frac = m[2] || '';
      return { n: BigInt(m[1] + frac), s: frac.length };
    }

    /**
     * Parse what a person typed: digits with an optional dot and up to 6 decimals.
     * Commas are rejected on purpose: "1,000" could mean one thousand or one point zero,
     * and guessing wrong would silently store the wrong area.
     */
    function parseInput(str) {
      if (typeof str !== 'string') return null;
      let t = str.trim();
      if (t.charAt(0) === '.') t = '0' + t; // ".5" -> "0.5"
      if (/^\d+\.$/.test(t)) t = t.slice(0, -1); // "2." -> "2"
      return parseDecimal(t, 9, 6);
    }

    function parseStored(str) {
      return parseDecimal(str, 20, 20);
    }

    /** BigInt scaled by 10^s -> shortest decimal string. */
    function toStr(n, s) {
      let digits = n.toString();
      if (s <= 0) return digits;
      digits = digits.padStart(s + 1, '0');
      const intPart = digits.slice(0, digits.length - s);
      const frac = digits.slice(digits.length - s).replace(/0+$/, '');
      return frac ? intPart + '.' + frac : intPart;
    }

    function normalizeInput(str) {
      const d = parseInput(str);
      return d ? toStr(d.n, d.s) : null;
    }

    /** value in acres/hectares (decimal string) -> exact square metres (decimal string). */
    function toSqm(valueStr, unit) {
      const d = parseInput(valueStr);
      if (!d) return null;
      if (unit === 'hectares') return toStr(d.n * HA_IN_SQM, d.s);
      if (unit === 'acres') return toStr(d.n * ACRE_SCALED, d.s + ACRE_SCALE);
      return null;
    }

    /** exact square metres -> acres/hectares, rounded half-up to `dp` decimals. */
    function fromSqm(sqmStr, unit, dp) {
      const d = parseStored(sqmStr);
      if (!d) return null;
      let num;
      let den;
      if (unit === 'hectares') {
        num = d.n * p10(dp);
        den = p10(d.s) * HA_IN_SQM;
      } else if (unit === 'acres') {
        num = d.n * p10(ACRE_SCALE + dp);
        den = p10(d.s) * ACRE_SCALED;
      } else {
        return null;
      }
      const q = (2n * num + den) / (2n * den);
      return toStr(q, dp);
    }

    /** Exact sum of square-metre decimal strings. */
    function sumSqm(list) {
      const parsed = list.map(parseStored).filter(Boolean);
      if (!parsed.length) return '0';
      const maxScale = parsed.reduce((m, p) => Math.max(m, p.s), 0);
      let total = 0n;
      parsed.forEach((p) => {
        total += p.n * p10(maxScale - p.s);
      });
      return toStr(total, maxScale);
    }

    /** "12345.5" -> "12,345.5" (display only). */
    function group(str) {
      if (typeof str !== 'string') return '';
      const parts = str.split('.');
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return parts.join('.');
    }

    function isPositiveWithin(valueStr, maxUnits) {
      const d = parseInput(valueStr);
      if (!d) return false;
      return d.n > 0n && d.n <= BigInt(maxUnits) * p10(d.s);
    }

    return {
      ACRE_IN_SQM: '4046.8564224',
      HECTARE_IN_SQM: '10000',
      parseInput,
      normalizeInput,
      toSqm,
      fromSqm,
      sumSqm,
      group,
      isPositiveWithin,
      label(unit) {
        return unit === 'hectares' ? 'ha' : 'acres';
      },
      labelLong(unit) {
        return unit === 'hectares' ? 'hectares' : 'acres';
      },
      other(unit) {
        return unit === 'hectares' ? 'acres' : 'hectares';
      },
    };
  })();

  /* ------------------------------------------------------------------ */
  /* Option lists                                                        */
  /* ------------------------------------------------------------------ */

  const OPTIONS = {
    areaUnit: [['acres', 'Acres'], ['hectares', 'Hectares']],
    status: [
      ['planned', 'Planned'],
      ['preparing', 'Being prepared'],
      ['active', 'Active'],
      ['fallow', 'Fallow'],
      ['resting', 'Resting'],
      ['archived', 'Archived'],
    ],
    soilType: [
      ['', 'Not specified'],
      ['clay', 'Clay'],
      ['clay_loam', 'Clay loam'],
      ['loam', 'Loam'],
      ['sandy_loam', 'Sandy loam'],
      ['sandy', 'Sandy'],
      ['silty', 'Silty'],
      ['peat', 'Peaty'],
      ['gravelly', 'Gravelly / stony'],
      ['other', 'Other'],
    ],
    waterSource: [
      ['', 'Not specified'],
      ['none', 'None'],
      ['rain_fed', 'Rain-fed only'],
      ['river_stream', 'River or stream'],
      ['borehole', 'Borehole'],
      ['well', 'Well'],
      ['spring', 'Spring'],
      ['dam_pond', 'Dam or pond'],
      ['piped', 'Piped / tap water'],
      ['rain_harvest', 'Rainwater harvesting'],
      ['canal', 'Irrigation canal'],
      ['other', 'Other'],
    ],
  };

  function optionLabel(list, value) {
    const hit = OPTIONS[list].find((o) => o[0] === value);
    return hit ? hit[1] : value || '';
  }

  /* ------------------------------------------------------------------ */
  /* Validation                                                          */
  /* ------------------------------------------------------------------ */

  const MAX = { name: 120, short: 100, location: 200, text: 1000, notes: 2000, contact: 300 };
  const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/;
  const MAX_AREA_UNITS = 1000000;

  /** Trim, drop control characters (keeps new lines), normalise line endings. */
  function cleanText(v) {
    if (v == null) return '';
    let s = typeof v === 'string' ? v : String(v);
    s = s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    return s.trim();
  }

  function checkLen(errors, key, value, max, label) {
    if (value.length > max) errors[key] = label + ' must be ' + max + ' characters or fewer.';
  }

  const FARM_FIELDS = ['name', 'location', 'district', 'region', 'country', 'description', 'currency', 'timezone', 'contact', 'notes'];
  const FIELD_FIELDS = ['farmId', 'name', 'code', 'areaValue', 'areaUnit', 'areaSqm', 'soilType', 'soilDescription', 'waterSource', 'drainage', 'notes', 'status'];

  function validateFarm(input) {
    const i = input || {};
    const errors = {};
    const v = {};
    v.name = cleanText(i.name);
    if (!v.name) errors.name = 'Enter the farm name.';
    checkLen(errors, 'name', v.name, MAX.name, 'Farm name');
    v.location = cleanText(i.location);
    checkLen(errors, 'location', v.location, MAX.location, 'Location');
    v.district = cleanText(i.district);
    checkLen(errors, 'district', v.district, MAX.short, 'District');
    v.region = cleanText(i.region);
    checkLen(errors, 'region', v.region, MAX.short, 'Region');
    v.country = cleanText(i.country);
    if (!v.country) errors.country = 'Enter the country.';
    checkLen(errors, 'country', v.country, MAX.short, 'Country');
    v.description = cleanText(i.description);
    checkLen(errors, 'description', v.description, MAX.text, 'Description');
    v.currency = cleanText(i.currency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(v.currency)) errors.currency = 'Use a 3-letter currency code such as UGX.';
    v.timezone = cleanText(i.timezone);
    if (!util.isValidTimeZone(v.timezone)) errors.timezone = 'Use a valid time zone such as Africa/Kampala.';
    v.contact = cleanText(i.contact);
    checkLen(errors, 'contact', v.contact, MAX.contact, 'Contact information');
    v.notes = cleanText(i.notes);
    checkLen(errors, 'notes', v.notes, MAX.notes, 'Notes');
    return { ok: Object.keys(errors).length === 0, errors, value: v };
  }

  function validateField(input) {
    const i = input || {};
    const errors = {};
    const v = {};
    v.farmId = typeof i.farmId === 'string' ? i.farmId : '';
    if (!util.isUuid(v.farmId)) errors.farmId = 'Choose the farm this field belongs to.';
    v.name = cleanText(i.name);
    if (!v.name) errors.name = 'Enter the field name.';
    checkLen(errors, 'name', v.name, MAX.name, 'Field name');
    v.code = cleanText(i.code);
    if (v.code && !CODE_RE.test(v.code)) errors.code = 'Use letters, numbers, dot, dash or underscore (up to 20 characters).';
    v.areaUnit = cleanText(i.areaUnit);
    if (v.areaUnit !== 'acres' && v.areaUnit !== 'hectares') errors.areaUnit = 'Choose acres or hectares.';
    const rawArea = cleanText(i.areaValue);
    const normalized = units.normalizeInput(rawArea);
    if (!rawArea) {
      errors.areaValue = 'Enter the field area.';
    } else if (normalized === null) {
      errors.areaValue = 'Enter a number such as 2.5. Use a dot for decimals and no commas (up to 6 decimal places).';
    } else if (!units.isPositiveWithin(normalized, MAX_AREA_UNITS)) {
      errors.areaValue = 'The area must be more than 0 and at most 1,000,000.';
    }
    v.areaValue = normalized === null ? rawArea : normalized;
    v.areaSqm = !errors.areaValue && !errors.areaUnit ? units.toSqm(normalized, v.areaUnit) : '';
    v.soilType = cleanText(i.soilType);
    if (!OPTIONS.soilType.some((o) => o[0] === v.soilType)) errors.soilType = 'Choose a soil type from the list.';
    v.soilDescription = cleanText(i.soilDescription);
    checkLen(errors, 'soilDescription', v.soilDescription, MAX.text, 'Soil description');
    v.waterSource = cleanText(i.waterSource);
    if (!OPTIONS.waterSource.some((o) => o[0] === v.waterSource)) errors.waterSource = 'Choose a water source from the list.';
    v.drainage = cleanText(i.drainage);
    checkLen(errors, 'drainage', v.drainage, MAX.text, 'Drainage description');
    v.notes = cleanText(i.notes);
    checkLen(errors, 'notes', v.notes, MAX.notes, 'Notes');
    v.status = cleanText(i.status);
    if (!OPTIONS.status.some((o) => o[0] === v.status)) errors.status = 'Choose a field status.';
    return { ok: Object.keys(errors).length === 0, errors, value: v };
  }

  /* Settings ------------------------------------------------------------ */

  const DEFAULT_SETTINGS = Object.freeze({
    defaultCountry: 'Uganda',
    defaultCurrency: 'UGX',
    defaultTimezone: 'Africa/Kampala',
    backupReminderDays: 7,
  });

  // Preferences that travel inside a backup. Everything else in the settings
  // store (last backup date, change marker, schema marker...) is specific to one phone.
  const PORTABLE_SETTINGS = ['defaultCountry', 'defaultCurrency', 'defaultTimezone', 'backupReminderDays', 'primaryFarmId'];

  function validateSetting(key, value) {
    switch (key) {
      case 'defaultCountry': {
        const s = cleanText(value);
        return s && s.length <= MAX.short ? { ok: true, value: s } : { ok: false, error: 'Enter a country (up to 100 characters).' };
      }
      case 'defaultCurrency': {
        const s = cleanText(value).toUpperCase();
        return /^[A-Z]{3}$/.test(s) ? { ok: true, value: s } : { ok: false, error: 'Use a 3-letter currency code such as UGX.' };
      }
      case 'defaultTimezone': {
        const s = cleanText(value);
        return util.isValidTimeZone(s) ? { ok: true, value: s } : { ok: false, error: 'Use a valid time zone such as Africa/Kampala.' };
      }
      case 'backupReminderDays': {
        const n = typeof value === 'number' ? value : Number(cleanText(value));
        return Number.isInteger(n) && n >= 1 && n <= 365 ? { ok: true, value: n } : { ok: false, error: 'Enter a whole number of days from 1 to 365.' };
      }
      case 'primaryFarmId':
        return util.isUuid(value) ? { ok: true, value } : { ok: false, error: 'Invalid farm id.' };
      default:
        return { ok: false, error: 'Unknown setting.' };
    }
  }

  /* Sanitising records that come from a backup file --------------------- */

  const ACTIVITY_TYPE_RE = /^[a-z]{2,20}(\.[a-z]{2,20})?$/;
  const ENTITY_TYPES = ['farm', 'field', 'backup', 'system'];
  const BACKUP_KINDS = ['export', 'restore', 'safety'];

  function baseRecord(rec) {
    if (!util.isUuid(rec.id)) return 'missing or invalid id';
    if (!util.isIso(rec.createdAt)) return 'missing or invalid creation date';
    if (!util.isIso(rec.updatedAt)) return 'missing or invalid modification date';
    return null;
  }

  function sanitizeRecord(kind, rec) {
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return { ok: false, error: 'not an object' };
    if (kind === 'farms') {
      const bad = baseRecord(rec);
      if (bad) return { ok: false, error: bad };
      const v = validateFarm(rec);
      if (!v.ok) return { ok: false, error: Object.values(v.errors)[0] };
      return { ok: true, record: Object.assign({ id: rec.id }, v.value, { nameLower: v.value.name.toLowerCase(), createdAt: rec.createdAt, updatedAt: rec.updatedAt }) };
    }
    if (kind === 'fields') {
      const bad = baseRecord(rec);
      if (bad) return { ok: false, error: bad };
      const v = validateField(rec);
      if (!v.ok) return { ok: false, error: Object.values(v.errors)[0] };
      return {
        ok: true,
        record: Object.assign({ id: rec.id }, v.value, {
          nameLower: v.value.name.toLowerCase(),
          codeLower: v.value.code.toLowerCase(),
          createdAt: rec.createdAt,
          updatedAt: rec.updatedAt,
        }),
      };
    }
    if (kind === 'activities') {
      if (!util.isUuid(rec.id)) return { ok: false, error: 'missing or invalid id' };
      if (!util.isIso(rec.createdAt)) return { ok: false, error: 'missing or invalid date' };
      if (typeof rec.type !== 'string' || !ACTIVITY_TYPE_RE.test(rec.type)) return { ok: false, error: 'invalid activity type' };
      if (ENTITY_TYPES.indexOf(rec.entityType) === -1) return { ok: false, error: 'invalid activity target' };
      const entityId = rec.entityId === '' || rec.entityId == null ? '' : rec.entityId;
      if (entityId !== '' && !util.isUuid(entityId)) return { ok: false, error: 'invalid activity target id' };
      const summary = cleanText(rec.summary);
      if (!summary || summary.length > 300) return { ok: false, error: 'invalid activity summary' };
      return { ok: true, record: { id: rec.id, type: rec.type, entityType: rec.entityType, entityId, summary, createdAt: rec.createdAt } };
    }
    if (kind === 'settings') {
      if (PORTABLE_SETTINGS.indexOf(rec.key) === -1) return { ok: false, error: 'device-specific setting', skip: true };
      const v = validateSetting(rec.key, rec.value);
      if (!v.ok) return { ok: false, error: v.error };
      return { ok: true, record: { key: rec.key, value: v.value, updatedAt: util.isIso(rec.updatedAt) ? rec.updatedAt : util.now() } };
    }
    if (kind === 'backups') {
      if (!util.isUuid(rec.id)) return { ok: false, error: 'missing or invalid id' };
      if (!util.isIso(rec.createdAt)) return { ok: false, error: 'missing or invalid date' };
      if (BACKUP_KINDS.indexOf(rec.kind) === -1) return { ok: false, error: 'invalid backup kind' };
      const counts = {};
      ['farms', 'fields', 'activities'].forEach((k) => {
        const n = rec.counts && rec.counts[k];
        counts[k] = Number.isInteger(n) && n >= 0 && n < 1e9 ? n : 0;
      });
      return {
        ok: true,
        record: {
          id: rec.id,
          kind: rec.kind,
          createdAt: rec.createdAt,
          fileName: cleanText(rec.fileName).slice(0, 200),
          sizeBytes: Number.isInteger(rec.sizeBytes) && rec.sizeBytes >= 0 ? rec.sizeBytes : 0,
          appVersion: cleanText(rec.appVersion).slice(0, 20),
          dbSchemaVersion: Number.isInteger(rec.dbSchemaVersion) ? rec.dbSchemaVersion : 0,
          counts,
          note: cleanText(rec.note).slice(0, 300),
        },
      };
    }
    return { ok: false, error: 'unknown store' };
  }

  /* ------------------------------------------------------------------ */
  /* IndexedDB layer                                                     */
  /* ------------------------------------------------------------------ */

  const DB_NAME = 'ama-farmtech-offline';
  const SCHEMA_VERSION = 1;
  const STORE = Object.freeze({
    FARMS: 'farms',
    FIELDS: 'fields',
    SETTINGS: 'settings',
    ACTIVITIES: 'activities',
    BACKUPS: 'backups',
  });
  const ALL_STORES = Object.freeze(Object.values(STORE));

  function ensureStore(db, tx, name, options) {
    return db.objectStoreNames.contains(name) ? tx.objectStore(name) : db.createObjectStore(name, options);
  }
  function ensureIndex(store, name, keyPath, options) {
    if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, options || {});
  }

  /**
   * MIGRATIONS[n - 1] upgrades a database to schema version n.
   *
   * Rules for every future migration:
   *  - Be additive and idempotent: create missing stores/indexes with ensureStore/ensureIndex.
   *  - Never delete a store or a record. To reshape records, read them with a cursor
   *    inside the upgrade transaction and write the converted copy back.
   *  - If a migration throws, the whole upgrade transaction is aborted and the
   *    previous database (with all its records) is left exactly as it was.
   */
  const MIGRATIONS = [
    function toVersion1(db, tx) {
      const farms = ensureStore(db, tx, STORE.FARMS, { keyPath: 'id' });
      ensureIndex(farms, 'nameLower', 'nameLower');
      ensureIndex(farms, 'createdAt', 'createdAt');
      ensureIndex(farms, 'updatedAt', 'updatedAt');

      const fields = ensureStore(db, tx, STORE.FIELDS, { keyPath: 'id' });
      ensureIndex(fields, 'farmId', 'farmId');
      ensureIndex(fields, 'farmId_codeLower', ['farmId', 'codeLower']);
      ensureIndex(fields, 'nameLower', 'nameLower');
      ensureIndex(fields, 'status', 'status');
      ensureIndex(fields, 'createdAt', 'createdAt');
      ensureIndex(fields, 'updatedAt', 'updatedAt');

      ensureStore(db, tx, STORE.SETTINGS, { keyPath: 'key' });

      const activities = ensureStore(db, tx, STORE.ACTIVITIES, { keyPath: 'id' });
      ensureIndex(activities, 'createdAt', 'createdAt');
      ensureIndex(activities, 'entityType', 'entityType');
      ensureIndex(activities, 'entityId', 'entityId');

      const backups = ensureStore(db, tx, STORE.BACKUPS, { keyPath: 'id' });
      ensureIndex(backups, 'createdAt', 'createdAt');
      ensureIndex(backups, 'kind', 'kind');
    },
  ];

  const listeners = [];
  function notify(type) {
    listeners.forEach((fn) => {
      try {
        fn(type);
      } catch (e) {
        /* ignore listener errors */
      }
    });
  }

  let dbPromise = null;
  let upgradeError = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!global.indexedDB) {
        reject(new AppError('unavailable', 'This browser does not support local database storage (IndexedDB).'));
        return;
      }
      let req;
      try {
        req = global.indexedDB.open(DB_NAME, SCHEMA_VERSION);
      } catch (e) {
        reject(normalizeError(e));
        return;
      }
      req.onupgradeneeded = (ev) => {
        const database = req.result;
        const tx = req.transaction;
        const from = ev.oldVersion;
        const to = ev.newVersion || SCHEMA_VERSION;
        try {
          for (let v = from + 1; v <= to; v++) {
            if (typeof MIGRATIONS[v - 1] !== 'function') throw new Error('Missing migration to version ' + v);
            MIGRATIONS[v - 1](database, tx, from);
            const ts = util.now();
            const settings = tx.objectStore(STORE.SETTINGS);
            settings.put({ key: 'schemaVersion', value: v, updatedAt: ts });
            if (from === 0 && v === 1) settings.put({ key: 'dbCreatedAt', value: ts, updatedAt: ts });
            if (from > 0) {
              tx.objectStore(STORE.ACTIVITIES).put({
                id: util.uuid(),
                type: 'system.migrate',
                entityType: 'system',
                entityId: '',
                summary: 'Database upgraded to version ' + v + ' (existing records kept)',
                createdAt: ts,
              });
            }
          }
        } catch (e) {
          upgradeError = e;
          try {
            tx.abort();
          } catch (e2) {
            /* already aborted */
          }
        }
      };
      req.onsuccess = () => {
        const database = req.result;
        database.onversionchange = () => {
          database.close();
          dbPromise = null;
          notify('versionchange');
        };
        resolve(database);
      };
      req.onerror = () => {
        if (upgradeError) {
          reject(new AppError('migration',
            'The database upgrade failed (' + (upgradeError.message || 'unknown error') + '). Your existing records were not changed.', upgradeError));
        } else {
          reject(normalizeError(req.error));
        }
      };
      req.onblocked = () => notify('blocked');
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
    return dbPromise;
  }

  /** Promise wrapper for a single IDBRequest. */
  function r(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Run `work(stores, tx)` inside one transaction.
   *  - `stores` maps store names to IDBObjectStore objects.
   *  - The promise resolves only after the transaction has committed.
   *  - If `work` throws (or any request fails) the whole transaction is rolled back.
   *  - `work` may only await IndexedDB requests (not timers or fetches), otherwise the
   *    transaction would commit early.
   */
  async function withTx(storeNames, mode, work) {
    const database = await open();
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = database.transaction(storeNames, mode);
      } catch (e) {
        reject(normalizeError(e));
        return;
      }
      let result;
      let reason = null;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(reason ? normalizeError(reason) : normalizeError(tx.error));
      tx.onerror = () => {
        /* handled by onabort */
      };
      const stores = {};
      storeNames.forEach((n) => {
        stores[n] = tx.objectStore(n);
      });
      Promise.resolve()
        .then(() => work(stores, tx))
        .then((value) => {
          result = value;
        })
        .catch((e) => {
          reason = e;
          try {
            tx.abort();
          } catch (e2) {
            /* transaction already finished */
          }
        });
    });
  }

  function newActivity(type, entityType, entityId, summary, ts) {
    return { id: util.uuid(), type, entityType, entityId: entityId || '', summary: String(summary).slice(0, 300), createdAt: ts };
  }

  /** Marks "records changed" so the backup reminder knows a new backup is useful (also covers deletions). */
  function touchChange(settingsStore, ts) {
    return r(settingsStore.put({ key: 'lastChangeAt', value: ts, updatedAt: ts }));
  }

  /* Farms --------------------------------------------------------------- */

  async function createFarm(input) {
    const v = validateFarm(input);
    if (!v.ok) throw new ValidationError(v.errors);
    const ts = util.now();
    const rec = Object.assign({ id: util.uuid() }, v.value, { nameLower: v.value.name.toLowerCase(), createdAt: ts, updatedAt: ts });
    await withTx([STORE.FARMS, STORE.ACTIVITIES, STORE.SETTINGS], 'readwrite', async (s) => {
      const clash = await r(s.farms.index('nameLower').getKey(rec.nameLower));
      if (clash !== undefined) throw new ValidationError({ name: 'A farm with this name already exists.' });
      await r(s.farms.add(rec));
      await r(s.activities.add(newActivity('farm.create', 'farm', rec.id, 'Farm created: ' + rec.name, ts)));
      await touchChange(s.settings, ts);
    });
    return rec;
  }

  async function updateFarm(id, input) {
    const v = validateFarm(input);
    if (!v.ok) throw new ValidationError(v.errors);
    return withTx([STORE.FARMS, STORE.ACTIVITIES, STORE.SETTINGS], 'readwrite', async (s) => {
      const existing = await r(s.farms.get(id));
      if (!existing) throw new AppError('notfound', 'This farm no longer exists.');
      const nameLower = v.value.name.toLowerCase();
      if (nameLower !== existing.nameLower) {
        const clash = await r(s.farms.index('nameLower').getKey(nameLower));
        if (clash !== undefined && clash !== id) throw new ValidationError({ name: 'A farm with this name already exists.' });
      }
      const next = Object.assign({}, existing, v.value, { nameLower });
      const changed = FARM_FIELDS.some((k) => existing[k] !== next[k]);
      if (!changed) return { record: existing, changed: false };
      next.updatedAt = util.now();
      await r(s.farms.put(next));
      await r(s.activities.add(newActivity('farm.update', 'farm', id, 'Farm updated: ' + next.name, next.updatedAt)));
      await touchChange(s.settings, next.updatedAt);
      return { record: next, changed: true };
    });
  }

  async function deleteFarm(id) {
    return withTx([STORE.FARMS, STORE.FIELDS, STORE.ACTIVITIES, STORE.SETTINGS], 'readwrite', async (s) => {
      const farm = await r(s.farms.get(id));
      if (!farm) throw new AppError('notfound', 'This farm no longer exists.');
      const fieldKeys = await r(s.fields.index('farmId').getAllKeys(id));
      await Promise.all(fieldKeys.map((k) => r(s.fields.delete(k))));
      await r(s.farms.delete(id));
      const primary = await r(s.settings.get('primaryFarmId'));
      if (primary && primary.value === id) await r(s.settings.delete('primaryFarmId'));
      const ts = util.now();
      const extra = fieldKeys.length ? ' and ' + fieldKeys.length + ' field' + (fieldKeys.length === 1 ? '' : 's') : '';
      await r(s.activities.add(newActivity('farm.delete', 'farm', id, 'Farm deleted: ' + farm.name + extra, ts)));
      await touchChange(s.settings, ts);
      return { deletedFields: fieldKeys.length };
    });
  }

  /* Fields -------------------------------------------------------------- */

  async function createField(input) {
    const v = validateField(input);
    if (!v.ok) throw new ValidationError(v.errors);
    const ts = util.now();
    const rec = Object.assign({ id: util.uuid() }, v.value, {
      nameLower: v.value.name.toLowerCase(),
      codeLower: v.value.code.toLowerCase(),
      createdAt: ts,
      updatedAt: ts,
    });
    await withTx([STORE.FARMS, STORE.FIELDS, STORE.ACTIVITIES, STORE.SETTINGS], 'readwrite', async (s) => {
      const farm = await r(s.farms.get(rec.farmId));
      if (!farm) throw new ValidationError({ farmId: 'Choose a registered farm.' });
      if (rec.code) {
        const clash = await r(s.fields.index('farmId_codeLower').getKey([rec.farmId, rec.codeLower]));
        if (clash !== undefined) throw new ValidationError({ code: 'Another field on this farm already uses this code.' });
      }
      await r(s.fields.add(rec));
      await r(s.activities.add(newActivity('field.create', 'field', rec.id, 'Field created: ' + rec.name + ' (' + farm.name + ')', ts)));
      await touchChange(s.settings, ts);
    });
    return rec;
  }

  async function updateField(id, input) {
    const v = validateField(input);
    if (!v.ok) throw new ValidationError(v.errors);
    return withTx([STORE.FARMS, STORE.FIELDS, STORE.ACTIVITIES, STORE.SETTINGS], 'readwrite', async (s) => {
      const existing = await r(s.fields.get(id));
      if (!existing) throw new AppError('notfound', 'This field no longer exists.');
      const farm = await r(s.farms.get(v.value.farmId));
      if (!farm) throw new ValidationError({ farmId: 'Choose a registered farm.' });
      const codeLower = v.value.code.toLowerCase();
      if (v.value.code && (codeLower !== existing.codeLower || v.value.farmId !== existing.farmId)) {
        const clash = await r(s.fields.index('farmId_codeLower').getKey([v.value.farmId, codeLower]));
        if (clash !== undefined && clash !== id) throw new ValidationError({ code: 'Another field on this farm already uses this code.' });
      }
      const next = Object.assign({}, existing, v.value, { nameLower: v.value.name.toLowerCase(), codeLower });
      const changed = FIELD_FIELDS.some((k) => existing[k] !== next[k]);
      if (!changed) return { record: existing, changed: false };
      next.updatedAt = util.now();
      await r(s.fields.put(next));
      await r(s.activities.add(newActivity('field.update', 'field', id, 'Field updated: ' + next.name + ' (' + farm.name + ')', next.updatedAt)));
      await touchChange(s.settings, next.updatedAt);
      return { record: next, changed: true };
    });
  }

  async function deleteField(id) {
    return withTx([STORE.FIELDS, STORE.ACTIVITIES, STORE.SETTINGS], 'readwrite', async (s) => {
      const field = await r(s.fields.get(id));
      if (!field) throw new AppError('notfound', 'This field no longer exists.');
      await r(s.fields.delete(id));
      const ts = util.now();
      await r(s.activities.add(newActivity('field.delete', 'field', id, 'Field deleted: ' + field.name, ts)));
      await touchChange(s.settings, ts);
    });
  }

  /* Reads --------------------------------------------------------------- */

  const byCreated = (a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);

  async function listFarms() {
    const rows = await withTx([STORE.FARMS], 'readonly', (s) => r(s.farms.getAll()));
    return rows.sort(byCreated);
  }
  async function getFarm(id) {
    return withTx([STORE.FARMS], 'readonly', (s) => r(s.farms.get(id)));
  }
  async function listFields(farmId) {
    const rows = await withTx([STORE.FIELDS], 'readonly', (s) => (farmId ? r(s.fields.index('farmId').getAll(farmId)) : r(s.fields.getAll())));
    return rows.sort(byCreated);
  }
  async function getField(id) {
    return withTx([STORE.FIELDS], 'readonly', (s) => r(s.fields.get(id)));
  }
  async function listActivities(limit) {
    return withTx([STORE.ACTIVITIES], 'readonly', (s) => new Promise((resolve, reject) => {
      const out = [];
      const req = s.activities.index('createdAt').openCursor(null, 'prev');
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur || (limit && out.length >= limit)) {
          resolve(out);
          return;
        }
        out.push(cur.value);
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    }));
  }
  async function listBackups(limit) {
    const rows = await withTx([STORE.BACKUPS], 'readonly', (s) => r(s.backups.getAll()));
    rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return limit ? rows.slice(0, limit) : rows;
  }
  async function getCounts() {
    return withTx([STORE.FARMS, STORE.FIELDS, STORE.ACTIVITIES, STORE.BACKUPS], 'readonly', async (s) => ({
      farms: await r(s.farms.count()),
      fields: await r(s.fields.count()),
      activities: await r(s.activities.count()),
      backups: await r(s.backups.count()),
    }));
  }
  /** One consistent read of every store (used by backup and restore). */
  async function readAll() {
    return withTx(ALL_STORES, 'readonly', async (s) => {
      const out = {};
      await Promise.all(ALL_STORES.map(async (n) => {
        out[n] = await r(s[n].getAll());
      }));
      return out;
    });
  }

  /* Settings ------------------------------------------------------------ */

  async function getAllSettingRecords() {
    return withTx([STORE.SETTINGS], 'readonly', (s) => r(s.settings.getAll()));
  }
  /** Returns defaults merged with stored values, plus device-specific markers. */
  async function getSettings() {
    const rows = await getAllSettingRecords();
    const out = Object.assign({}, DEFAULT_SETTINGS);
    rows.forEach((row) => {
      out[row.key] = row.value;
    });
    return out;
  }
  async function saveSettings(partial) {
    const errors = {};
    const clean = {};
    Object.keys(partial).forEach((key) => {
      const v = validateSetting(key, partial[key]);
      if (v.ok) clean[key] = v.value;
      else errors[key] = v.error;
    });
    if (Object.keys(errors).length) throw new ValidationError(errors);
    const ts = util.now();
    await withTx([STORE.SETTINGS], 'readwrite', async (s) => {
      await Promise.all(Object.keys(clean).map((key) => r(s.settings.put({ key, value: clean[key], updatedAt: ts }))));
    });
    return clean;
  }
  async function setSetting(key, value) {
    const ts = util.now();
    await withTx([STORE.SETTINGS], 'readwrite', (s) => r(s.settings.put({ key, value, updatedAt: ts })));
  }
  async function deleteSetting(key) {
    await withTx([STORE.SETTINGS], 'readwrite', (s) => r(s.settings.delete(key)));
  }

  /* Maintenance --------------------------------------------------------- */

  async function eraseAllData() {
    const ts = util.now();
    await withTx(ALL_STORES, 'readwrite', async (s) => {
      await Promise.all([r(s.farms.clear()), r(s.fields.clear()), r(s.activities.clear()), r(s.backups.clear())]);
      const keys = await r(s.settings.getAllKeys());
      await Promise.all(keys.filter((k) => k !== 'schemaVersion' && k !== 'dbCreatedAt').map((k) => r(s.settings.delete(k))));
      await r(s.activities.add(newActivity('system.erase', 'system', '', 'All data on this phone was erased', ts)));
    });
  }

  async function getSchemaInfo() {
    const database = await open();
    const rows = await getAllSettingRecords();
    const map = {};
    rows.forEach((x) => {
      map[x.key] = x.value;
    });
    return {
      name: DB_NAME,
      version: database.version,
      appSchemaVersion: SCHEMA_VERSION,
      storedSchemaVersion: map.schemaVersion || null,
      createdAt: map.dbCreatedAt || null,
      stores: Array.from(database.objectStoreNames),
    };
  }

  function closeConnection() {
    if (!dbPromise) return Promise.resolve();
    return dbPromise.then((d) => {
      d.close();
      dbPromise = null;
    }, () => {});
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                          */
  /* ------------------------------------------------------------------ */

  AMA.util = util;
  AMA.units = units;
  AMA.AppError = AppError;
  AMA.ValidationError = ValidationError;
  AMA.validate = {
    farm: validateFarm,
    field: validateField,
    setting: validateSetting,
    sanitizeRecord,
    cleanText,
    OPTIONS,
    optionLabel,
    MAX,
    DEFAULT_SETTINGS,
    PORTABLE_SETTINGS,
  };
  AMA.db = {
    DB_NAME,
    SCHEMA_VERSION,
    STORE,
    ALL_STORES,
    open,
    withTx,
    r,
    normalizeError,
    onNotice(fn) {
      listeners.push(fn);
    },
    newActivity,
    touchChange,
    createFarm,
    updateFarm,
    deleteFarm,
    listFarms,
    getFarm,
    createField,
    updateField,
    deleteField,
    listFields,
    getField,
    listActivities,
    listBackups,
    getCounts,
    readAll,
    getSettings,
    saveSettings,
    setSetting,
    deleteSetting,
    eraseAllData,
    getSchemaInfo,
    closeConnection,
  };
})(window);
