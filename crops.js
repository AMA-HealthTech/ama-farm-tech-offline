/*!
 * AMA FarmTech Offline - crops.js (Phase 2: crop production)
 * Ama Farms Ltd
 *
 * The data side of crop production: option lists, validation, saving and reading
 * crops, varieties, production cycles, planting batches and planting records,
 * the field-area overlap check, dashboard statistics and calendar events.
 * No screens here (see crops-ui.js). No network access. No external libraries.
 *
 * Exposed as AMA.crops. Loads after db.js and before backup.js.
 */
(function (global) {
  'use strict';

  const AMA = global.AMA;
  const db = AMA.db;
  const U = AMA.util;
  const units = AMA.units;
  const V = AMA.validate;
  const r = db.r;
  const withTx = db.withTx;
  const STORE = db.STORE;
  const AppError = AMA.AppError;
  const ValidationError = AMA.ValidationError;
  const cleanText = V.cleanText;
  const checkLen = V.checkLen;
  const MAX = V.MAX;

  /* ------------------------------------------------------------------ */
  /* Option lists                                                        */
  /* ------------------------------------------------------------------ */

  const OPTIONS = {
    category: [
      ['vegetables', 'Vegetables'],
      ['cereals_grains', 'Cereals and grains'],
      ['legumes', 'Legumes'],
      ['roots_tubers', 'Root and tuber crops'],
      ['fruits', 'Fruits'],
      ['other', 'Other crops'],
    ],
    method: [
      ['direct_seeding', 'Direct seeding'],
      ['transplanting', 'Nursery and transplanting'],
      ['other', 'Other (cuttings, suckers, bulbs...)'],
    ],
    defaultMethod: [
      ['', 'Not specified'],
      ['direct_seeding', 'Direct seeding'],
      ['transplanting', 'Nursery and transplanting'],
      ['other', 'Other (cuttings, suckers, bulbs...)'],
    ],
    seedType: [
      ['', 'Not specified'],
      ['hybrid', 'Hybrid'],
      ['open_pollinated', 'Open-pollinated'],
      ['other', 'Other'],
    ],
    status: [
      ['planned', 'Planned'],
      ['land_preparation', 'Land preparation'],
      ['nursery', 'Nursery'],
      ['planted', 'Planted'],
      ['growing', 'Growing'],
      ['harvesting', 'Harvesting'],
      ['completed', 'Completed'],
      ['cancelled', 'Cancelled'],
    ],
    productionSystem: [
      ['', 'Not specified'],
      ['open_field', 'Open field'],
      ['greenhouse', 'Greenhouse or tunnel'],
      ['screenhouse', 'Net house or screenhouse'],
      ['other', 'Other'],
    ],
    irrigation: [
      ['', 'Not specified'],
      ['irrigated', 'Irrigated'],
      ['rain_fed', 'Rain-fed'],
      ['supplementary', 'Rain-fed with extra irrigation'],
    ],
    seedUnit: [
      ['seeds', 'Seeds'],
      ['g', 'Grams (g)'],
      ['kg', 'Kilograms (kg)'],
      ['packets', 'Packets'],
    ],
    recordType: [
      ['seeding', 'Seeding in the field'],
      ['nursery_sowing', 'Nursery sowing'],
      ['transplanting', 'Transplanting'],
      ['gap_filling', 'Gap filling or replanting'],
      ['other', 'Other planting activity'],
    ],
    recordUnit: [
      ['seeds', 'Seeds'],
      ['seedlings', 'Seedlings'],
      ['plants', 'Plants'],
      ['g', 'Grams (g)'],
      ['kg', 'Kilograms (kg)'],
    ],
  };

  function optionLabel(list, value) {
    const hit = (OPTIONS[list] || []).find((o) => o[0] === value);
    return hit ? hit[1] : value || '';
  }

  /** Cycles that still count as "active": not finished, not cancelled, not archived. */
  const ACTIVE_STATUSES = ['planned', 'land_preparation', 'nursery', 'planted', 'growing', 'harvesting'];
  /** Cycles where land is actually in use right now (everything active except "planned"). */
  const IN_PROGRESS_STATUSES = ['land_preparation', 'nursery', 'planted', 'growing', 'harvesting'];

  /* ------------------------------------------------------------------ */
  /* Dates                                                               */
  /* ------------------------------------------------------------------ */

  const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  function isDate(s) {
    if (typeof s !== 'string') return false;
    const m = DATE_RE.exec(s);
    if (!m) return false;
    const y = +m[1];
    const mo = +m[2];
    const d = +m[3];
    if (y < 2000 || y > 2100) return false;
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
  }

  /** Today's date (YYYY-MM-DD) in the given time zone. */
  function todayYmd(timeZone) {
    let tz = timeZone;
    if (!U.isValidTimeZone(tz)) tz = 'UTC';
    const p = {};
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date()).forEach((x) => { p[x.type] = x.value; });
    return p.year + '-' + p.month + '-' + p.day;
  }

  function addDays(ymd, n) {
    const m = DATE_RE.exec(ymd);
    const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n));
    return dt.getUTCFullYear().toString().padStart(4, '0') + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' + String(dt.getUTCDate()).padStart(2, '0');
  }

  /* ------------------------------------------------------------------ */
  /* Field readers used by the validators                                */
  /* ------------------------------------------------------------------ */

  function text(errors, key, raw, max, label) {
    const s = cleanText(raw);
    checkLen(errors, key, s, max, label);
    return s;
  }

  function choice(errors, key, raw, list, message) {
    const s = cleanText(raw);
    if (!OPTIONS[list].some((o) => o[0] === s)) errors[key] = message;
    return s;
  }

  function dateOf(errors, key, raw, label) {
    const s = cleanText(raw);
    if (s === '') return '';
    if (!isDate(s)) {
      errors[key] = label + ': choose a valid date.';
      return '';
    }
    return s;
  }

  /** Whole number. Accepts 3500 and 3,500 (comma groups of three digits). Empty -> null. */
  function whole(errors, key, raw, label, min, max) {
    let s = cleanText(raw);
    if (s === '') return null;
    if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, '');
    if (!/^\d{1,10}$/.test(s)) {
      errors[key] = label + ': enter a whole number such as 3500.';
      return null;
    }
    const n = Number(s);
    if (n < min || n > max) {
      errors[key] = label + ' must be between ' + units.group(String(min)) + ' and ' + units.group(String(max)) + '.';
      return null;
    }
    return n;
  }

  /** Decimal number with a dot. Commas are refused (unless groups=true and the commas are thousand separators). Empty -> null. */
  function decimal(errors, key, raw, label, min, max, dp, groups) {
    let s = cleanText(raw);
    if (s === '') return null;
    if (groups && /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
    if (s.charAt(0) === '.') s = '0' + s;
    if (/^\d+\.$/.test(s)) s = s.slice(0, -1);
    const re = new RegExp('^\\d{1,12}(\\.\\d{1,' + dp + '})?$');
    if (!re.test(s)) {
      errors[key] = label + ': enter a number such as 2.5 (use a dot for decimals, no commas, up to ' + dp + ' decimal place' + (dp === 1 ? '' : 's') + ').';
      return null;
    }
    const n = Number(s);
    if (n < min || n > max) {
      errors[key] = label + ' must be between ' + units.group(String(min)) + ' and ' + units.group(String(max)) + '.';
      return null;
    }
    return n;
  }

  function uuidField(errors, key, raw, message, optional) {
    const s = typeof raw === 'string' ? raw : '';
    if (optional && s === '') return '';
    if (!U.isUuid(s)) {
      errors[key] = message;
      return '';
    }
    return s;
  }

  function result(errors, value) {
    return { ok: Object.keys(errors).length === 0, errors, value };
  }

  /* ------------------------------------------------------------------ */
  /* Validators                                                          */
  /* ------------------------------------------------------------------ */

  function validateCrop(input) {
    const i = input || {};
    const errors = {};
    const v = {};
    v.name = text(errors, 'name', i.name, MAX.name, 'Crop name');
    if (!v.name) errors.name = 'Enter the crop name.';
    v.category = choice(errors, 'category', i.category, 'category', 'Choose a crop category.');
    v.scientificName = text(errors, 'scientificName', i.scientificName, MAX.name, 'Scientific name');
    v.description = text(errors, 'description', i.description, MAX.text, 'Description');
    v.defaultMethod = choice(errors, 'defaultMethod', i.defaultMethod, 'defaultMethod', 'Choose a planting method from the list.');
    v.growingDays = whole(errors, 'growingDays', i.growingDays, 'Growing duration', 1, 1500);
    v.notes = text(errors, 'notes', i.notes, MAX.notes, 'Notes');
    return result(errors, v);
  }

  function validateVariety(input) {
    const i = input || {};
    const errors = {};
    const v = {};
    v.cropId = uuidField(errors, 'cropId', i.cropId, 'Choose the crop this variety belongs to.');
    v.name = text(errors, 'name', i.name, MAX.name, 'Variety name');
    if (!v.name) errors.name = 'Enter the variety name.';
    v.supplier = text(errors, 'supplier', i.supplier, MAX.name, 'Seed company or supplier');
    v.seedType = choice(errors, 'seedType', i.seedType, 'seedType', 'Choose a seed type from the list.');
    v.packetSize = text(errors, 'packetSize', i.packetSize, 40, 'Packet size');
    v.quantityPurchased = decimal(errors, 'quantityPurchased', i.quantityPurchased, 'Quantity purchased', 0, 1000000000, 3, false);
    v.purchaseDate = dateOf(errors, 'purchaseDate', i.purchaseDate, 'Purchase date');
    v.batchNumber = text(errors, 'batchNumber', i.batchNumber, 40, 'Batch or lot number');
    v.expiryDate = dateOf(errors, 'expiryDate', i.expiryDate, 'Expiry date');
    v.seedCost = decimal(errors, 'seedCost', i.seedCost, 'Seed cost', 0, 1000000000000, 2, true);
    let cur = cleanText(i.costCurrency).toUpperCase();
    if (v.seedCost === null) cur = cur && /^[A-Z]{3}$/.test(cur) ? cur : '';
    else if (!/^[A-Z]{3}$/.test(cur)) errors.costCurrency = 'Use a 3-letter currency code such as UGX.';
    v.costCurrency = cur;
    v.germinationPercent = decimal(errors, 'germinationPercent', i.germinationPercent, 'Germination', 0, 100, 1, false);
    v.germinationNotes = text(errors, 'germinationNotes', i.germinationNotes, MAX.text, 'Germination notes');
    v.notes = text(errors, 'notes', i.notes, MAX.notes, 'Notes');
    return result(errors, v);
  }

  /** opts.strictFuture: refuse an actual planting date that is more than a day ahead (used when saving from forms). */
  function validateCycle(input, opts) {
    const i = input || {};
    const errors = {};
    const v = {};
    v.farmId = uuidField(errors, 'farmId', i.farmId, 'Choose the farm.');
    v.fieldId = uuidField(errors, 'fieldId', i.fieldId, 'Choose the field.');
    v.cropId = uuidField(errors, 'cropId', i.cropId, 'Choose the crop.');
    v.varietyId = uuidField(errors, 'varietyId', i.varietyId, 'Invalid variety.', true);
    v.name = text(errors, 'name', i.name, MAX.name, 'Production name');
    if (!v.name) errors.name = 'Enter a name for this production cycle.';
    v.season = text(errors, 'season', i.season, 60, 'Season');
    v.productionSystem = choice(errors, 'productionSystem', i.productionSystem, 'productionSystem', 'Choose a production method from the list.');
    v.irrigation = choice(errors, 'irrigation', i.irrigation, 'irrigation', 'Choose an irrigation option from the list.');
    v.plantingMethod = choice(errors, 'plantingMethod', i.plantingMethod, 'method', 'Choose a planting method.');
    v.plannedPlantingDate = dateOf(errors, 'plannedPlantingDate', i.plannedPlantingDate, 'Planned planting date');
    v.actualPlantingDate = dateOf(errors, 'actualPlantingDate', i.actualPlantingDate, 'Actual planting date');
    v.plannedHarvestStart = dateOf(errors, 'plannedHarvestStart', i.plannedHarvestStart, 'Planned harvest start');
    v.expectedHarvestEnd = dateOf(errors, 'expectedHarvestEnd', i.expectedHarvestEnd, 'Expected harvest end');

    v.areaUnit = cleanText(i.areaUnit);
    if (!V.OPTIONS.areaUnit.some((o) => o[0] === v.areaUnit)) errors.areaUnit = 'Choose acres, hectares or quarter-acres.';
    const rawArea = cleanText(i.areaValue);
    const normalized = units.normalizeInput(rawArea);
    if (!rawArea) errors.areaValue = 'Enter the area used by this crop.';
    else if (normalized === null) errors.areaValue = 'Enter a number such as 0.5. Use a dot for decimals and no commas (up to 6 decimal places).';
    else if (!units.isPositiveWithin(normalized, 1000000)) errors.areaValue = 'The area must be more than 0 and at most 1,000,000.';
    v.areaValue = normalized === null ? rawArea : normalized;
    v.areaSqm = !errors.areaValue && !errors.areaUnit ? units.toSqm(normalized, v.areaUnit) : '';

    v.targetPopulation = whole(errors, 'targetPopulation', i.targetPopulation, 'Target plant population', 0, 1000000000);
    v.actualPopulation = whole(errors, 'actualPopulation', i.actualPopulation, 'Actual plant population', 0, 1000000000);
    v.status = choice(errors, 'status', i.status, 'status', 'Choose a production status.');
    v.notes = text(errors, 'notes', i.notes, MAX.notes, 'Notes');

    const firstPlanting = [v.plannedPlantingDate, v.actualPlantingDate].filter(Boolean).sort()[0] || '';
    if (v.plannedHarvestStart && v.expectedHarvestEnd && v.expectedHarvestEnd < v.plannedHarvestStart && !errors.expectedHarvestEnd) {
      errors.expectedHarvestEnd = 'The harvest cannot end before it starts.';
    }
    if (firstPlanting && v.plannedHarvestStart && v.plannedHarvestStart < firstPlanting && !errors.plannedHarvestStart) {
      errors.plannedHarvestStart = 'The harvest cannot start before the planting date.';
    }
    if (opts && opts.strictFuture && v.actualPlantingDate && !errors.actualPlantingDate) {
      if (v.actualPlantingDate > addDays(new Date().toISOString().slice(0, 10), 1)) {
        errors.actualPlantingDate = 'The actual planting date is in the future. Use "Planned planting date" for planting that has not happened yet.';
      }
    }
    return result(errors, v);
  }

  function validateBatch(input, opts) {
    const i = input || {};
    const errors = {};
    const v = {};
    v.cycleId = uuidField(errors, 'cycleId', i.cycleId, 'This batch must belong to a production cycle.');
    v.name = text(errors, 'name', i.name, 60, 'Batch name');
    if (!v.name) errors.name = 'Enter a name for this batch, for example "Batch 1".';
    v.method = choice(errors, 'method', i.method, 'method', 'Choose a planting method.');
    const nursery = v.method === 'transplanting';
    v.plannedDate = dateOf(errors, 'plannedDate', i.plannedDate, 'Planned date');
    v.plantingDate = nursery ? '' : dateOf(errors, 'plantingDate', i.plantingDate, 'Planting date');
    v.nurseryStartDate = nursery ? dateOf(errors, 'nurseryStartDate', i.nurseryStartDate, 'Nursery start date') : '';
    v.nurseryLocation = nursery ? text(errors, 'nurseryLocation', i.nurseryLocation, 120, 'Nursery location') : '';
    v.transplantDate = nursery ? dateOf(errors, 'transplantDate', i.transplantDate, 'Transplanting date') : '';
    v.seedUnit = choice(errors, 'seedUnit', i.seedUnit || 'seeds', 'seedUnit', 'Choose a seed unit.');
    v.plannedSeedQuantity = decimal(errors, 'plannedSeedQuantity', i.plannedSeedQuantity, 'Planned seed quantity', 0, 1000000000, 3, false);
    v.seedQuantityUsed = decimal(errors, 'seedQuantityUsed', i.seedQuantityUsed, 'Seed quantity used', 0, 1000000000, 3, false);
    v.plannedSeedlings = nursery ? whole(errors, 'plannedSeedlings', i.plannedSeedlings, 'Planned seedlings', 0, 1000000000) : null;
    v.seedlingsTransplanted = nursery ? whole(errors, 'seedlingsTransplanted', i.seedlingsTransplanted, 'Seedlings transplanted', 0, 1000000000) : null;
    v.rowSpacingCm = decimal(errors, 'rowSpacingCm', i.rowSpacingCm, 'Row spacing', 1, 1000, 1, false);
    v.plantSpacingCm = decimal(errors, 'plantSpacingCm', i.plantSpacingCm, 'Plant spacing', 1, 1000, 1, false);
    v.numberOfRows = whole(errors, 'numberOfRows', i.numberOfRows, 'Number of rows', 1, 1000000);
    v.estimatedPopulation = whole(errors, 'estimatedPopulation', i.estimatedPopulation, 'Estimated plant population', 0, 1000000000);
    v.actualPopulation = whole(errors, 'actualPopulation', i.actualPopulation, 'Actual plant population', 0, 1000000000);
    v.notes = text(errors, 'notes', i.notes, MAX.notes, 'Notes');
    if (nursery && v.nurseryStartDate && v.transplantDate && v.transplantDate < v.nurseryStartDate && !errors.transplantDate) {
      errors.transplantDate = 'Transplanting cannot be before the nursery start date.';
    }
    if (opts && opts.strictFuture) {
      const limit = addDays(new Date().toISOString().slice(0, 10), 1);
      ['plantingDate', 'nurseryStartDate', 'transplantDate'].forEach((k) => {
        if (v[k] && !errors[k] && v[k] > limit) errors[k] = 'This date is in the future. Use "Planned date" for work that has not happened yet.';
      });
    }
    return result(errors, v);
  }

  function validatePlanting(input, opts) {
    const i = input || {};
    const errors = {};
    const v = {};
    v.cycleId = uuidField(errors, 'cycleId', i.cycleId, 'This record must belong to a production cycle.');
    v.batchId = uuidField(errors, 'batchId', i.batchId, 'Invalid batch.', true);
    v.type = choice(errors, 'type', i.type, 'recordType', 'Choose what was done.');
    v.date = dateOf(errors, 'date', i.date, 'Date');
    if (!v.date && !errors.date) errors.date = 'Choose the date.';
    v.quantity = decimal(errors, 'quantity', i.quantity, 'Quantity', 0, 1000000000, 3, false);
    const unit = cleanText(i.quantityUnit);
    if (v.quantity !== null) {
      if (!OPTIONS.recordUnit.some((o) => o[0] === unit)) errors.quantityUnit = 'Choose what the quantity counts.';
      v.quantityUnit = unit;
    } else {
      v.quantityUnit = OPTIONS.recordUnit.some((o) => o[0] === unit) ? unit : '';
    }
    v.location = text(errors, 'location', i.location, 120, 'Location');
    v.notes = text(errors, 'notes', i.notes, MAX.text, 'Notes');
    if (opts && opts.strictFuture && v.date && !errors.date && v.date > addDays(new Date().toISOString().slice(0, 10), 1)) {
      errors.date = 'This date is in the future. Planting records are for work that has already happened.';
    }
    return result(errors, v);
  }

  /* ------------------------------------------------------------------ */
  /* Entities: how each kind of record is built, labelled and compared   */
  /* ------------------------------------------------------------------ */

  const ENT = {
    crops: {
      store: STORE.CROPS, entity: 'crop', validate: validateCrop, archive: true,
      derive: (v) => ({ nameLower: v.name.toLowerCase() }),
      label: (rec) => rec.name,
    },
    varieties: {
      store: STORE.VARIETIES, entity: 'variety', validate: validateVariety, archive: true,
      derive: (v) => ({ dupKey: v.cropId + '|' + v.name.toLowerCase() + '|' + v.batchNumber.toLowerCase() }),
      label: (rec) => rec.name,
    },
    cycles: {
      store: STORE.CYCLES, entity: 'cycle', validate: validateCycle, archive: true,
      derive: () => ({}),
      label: (rec) => rec.name,
    },
    batches: {
      store: STORE.BATCHES, entity: 'batch', validate: validateBatch, archive: false,
      derive: () => ({}),
      label: (rec) => rec.name,
    },
    plantings: {
      store: STORE.PLANTINGS, entity: 'planting', validate: validatePlanting, archive: false,
      derive: () => ({}),
      label: (rec) => optionLabel('recordType', rec.type) + ' on ' + rec.date,
    },
  };

  function sanitizeRecord(kind, rec) {
    const e = ENT[kind];
    if (!U.isUuid(rec.id)) return { ok: false, error: 'missing or invalid id' };
    if (!U.isIso(rec.createdAt)) return { ok: false, error: 'missing or invalid creation date' };
    if (!U.isIso(rec.updatedAt)) return { ok: false, error: 'missing or invalid modification date' };
    let archivedAt = '';
    if (e.archive) {
      archivedAt = rec.archivedAt == null ? '' : rec.archivedAt;
      if (archivedAt !== '' && !U.isIso(archivedAt)) return { ok: false, error: 'invalid archive date' };
    }
    const v = e.validate(rec, { strictFuture: false });
    if (!v.ok) return { ok: false, error: Object.values(v.errors)[0] };
    const out = Object.assign({ id: rec.id }, v.value, e.derive(v.value), { createdAt: rec.createdAt, updatedAt: rec.updatedAt });
    if (e.archive) out.archivedAt = archivedAt;
    return { ok: true, record: out };
  }
  Object.keys(ENT).forEach((kind) => V.registerSanitizer(kind, (rec) => sanitizeRecord(kind, rec)));

  /* ------------------------------------------------------------------ */
  /* Field-area allocation                                               */
  /* ------------------------------------------------------------------ */

  const MIN_DATE = '0000-01-01';
  const MAX_DATE = '9999-12-31';

  /**
   * The dates during which a cycle occupies its area.
   *  - archived and cancelled cycles occupy nothing
   *  - completed cycles occupy their planting-to-harvest period (nothing if they have no dates)
   *  - every other cycle occupies from planting to harvest end (or "until completed" when there is no end date)
   *  - with no planting date: a cycle that has not started yet (Planned, Land preparation, Nursery) is assumed
   *    to start today; one that is already in the ground (Planted, Growing, Harvesting) is assumed to have
   *    started "always ago". Such cycles are marked `open`.
   */
  function nowYmd() {
    return new Date().toISOString().slice(0, 10);
  }

  function cycleWindow(c, today) {
    if (c.archivedAt || c.status === 'cancelled') return null;
    const start = c.actualPlantingDate || c.plannedPlantingDate || '';
    const end = c.expectedHarvestEnd || c.plannedHarvestStart || '';
    if (c.status === 'completed') {
      if (!start) return null;
      return { start, end: end && end >= start ? end : start, open: false };
    }
    const notStarted = c.status === 'planned' || c.status === 'land_preparation' || c.status === 'nursery';
    return { start: start || (notStarted ? today || nowYmd() : MIN_DATE), end: end || MAX_DATE, open: !start || !end };
  }

  /**
   * Does `candidate` plus the other cycles of the same field, at any one moment, use more area than the field has?
   * Exact arithmetic on square metres. Returns { exceeds, peakSqm, fieldSqm, overBySqm, conflicts, atDate, open }.
   */
  function findOverAllocation(candidate, others, fieldSqm) {
    const none = { exceeds: false, peakSqm: candidate.areaSqm || '0', fieldSqm, overBySqm: '0', conflicts: [], atDate: '', open: false };
    const w0 = cycleWindow(candidate);
    if (!w0 || !candidate.areaSqm) return none;
    const list = others
      .filter((c) => c.id !== candidate.id && c.fieldId === candidate.fieldId)
      .map((c) => ({ c, w: cycleWindow(c) }))
      .filter((x) => x.w && x.w.start <= w0.end && x.w.end >= w0.start);
    if (!list.length) return none;
    const times = [w0.start].concat(list.map((x) => x.w.start).filter((t) => t > w0.start && t <= w0.end));
    let best = null;
    times.forEach((t) => {
      const active = list.filter((x) => x.w.start <= t && x.w.end >= t);
      const sum = units.sumSqm([candidate.areaSqm].concat(active.map((x) => x.c.areaSqm)));
      if (!best || units.cmpSqm(sum, best.sum) > 0) best = { t, sum, active };
    });
    const exceeds = best.active.length > 0 && units.cmpSqm(best.sum, fieldSqm) > 0;
    return {
      exceeds,
      peakSqm: best.sum,
      fieldSqm,
      overBySqm: exceeds ? units.minusSqm(best.sum, fieldSqm) : '0',
      conflicts: best.active.map((x) => x.c),
      atDate: best.t === MIN_DATE ? '' : best.t,
      open: w0.open || best.active.some((x) => x.w.open),
    };
  }

  class OverAllocationError extends AppError {
    constructor(info) {
      super('overallocated',
        'Together with other crops in this field at the same time, this would use ' + units.group(units.fromSqm(info.peakSqm, 'acres', 3)) +
        ' acres, but the field is only ' + units.group(units.fromSqm(info.fieldSqm, 'acres', 3)) + ' acres.');
      this.name = 'OverAllocationError';
      this.info = info;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Saving and reading                                                  */
  /* ------------------------------------------------------------------ */

  const byCreated = (a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);

  function fail(errors) {
    throw new ValidationError(errors);
  }

  /** Extra checks that need the database (run inside the same transaction as the save). */
  const CHECKS = {
    crops: async (s, rec, existing) => {
      const clash = await r(s.crops.index('nameLower').getKey(rec.nameLower));
      if (clash !== undefined && clash !== rec.id) fail({ name: 'A crop with this name already exists.' });
    },
    varieties: async (s, rec, existing) => {
      const crop = await r(s.crops.get(rec.cropId));
      if (!crop) fail({ cropId: 'Choose a crop from the catalogue.' });
      const clash = await r(s.varieties.index('dupKey').getKey(rec.dupKey));
      if (clash !== undefined && clash !== rec.id) {
        fail({ name: rec.batchNumber ? 'This crop already has a variety with this name and batch number.' : 'This crop already has a variety with this name. If you bought it again, add the new batch or lot number to tell them apart.' });
      }
    },
    cycles: async (s, rec, existing, opts) => {
      const farm = await r(s.farms.get(rec.farmId));
      if (!farm) fail({ farmId: 'Choose a registered farm.' });
      const field = await r(s.fields.get(rec.fieldId));
      if (!field || field.farmId !== rec.farmId) fail({ fieldId: 'Choose a field that belongs to this farm.' });
      const crop = await r(s.crops.get(rec.cropId));
      if (!crop) fail({ cropId: 'Choose a crop from the catalogue.' });
      if (rec.varietyId) {
        const variety = await r(s.varieties.get(rec.varietyId));
        if (!variety || variety.cropId !== rec.cropId) fail({ varietyId: 'Choose a variety of this crop.' });
      }
      if (units.cmpSqm(rec.areaSqm, field.areaSqm) > 0) {
        fail({ areaValue: 'This is more than the whole field (' + units.group(field.areaValue) + ' ' + units.label(field.areaUnit) + '). Enter a smaller area, or correct the field size first.' });
      }
      if (!(opts && opts.allowOverAllocation)) {
        const others = await r(s.cycles.index('fieldId').getAll(rec.fieldId));
        const res = findOverAllocation(rec, others, field.areaSqm);
        if (res.exceeds) throw new OverAllocationError(res);
      }
    },
    batches: async (s, rec) => {
      const cycle = await r(s.cycles.get(rec.cycleId));
      if (!cycle) fail({ cycleId: 'This production cycle no longer exists.' });
    },
    plantings: async (s, rec) => {
      const cycle = await r(s.cycles.get(rec.cycleId));
      if (!cycle) fail({ cycleId: 'This production cycle no longer exists.' });
      if (rec.batchId) {
        const batch = await r(s.batches.get(rec.batchId));
        if (!batch || batch.cycleId !== rec.cycleId) fail({ batchId: 'Choose a batch of this production cycle.' });
      }
    },
  };

  const ACTIVITY_NOUN = { crop: 'Crop', variety: 'Variety', cycle: 'Crop cycle', batch: 'Planting batch', planting: 'Planting record' };

  function txStores(kind) {
    const base = [ENT[kind].store, STORE.ACTIVITIES, STORE.SETTINGS];
    if (kind === 'varieties') base.push(STORE.CROPS);
    if (kind === 'cycles') base.push(STORE.FARMS, STORE.FIELDS, STORE.CROPS, STORE.VARIETIES);
    if (kind === 'batches') base.push(STORE.CYCLES);
    if (kind === 'plantings') base.push(STORE.CYCLES, STORE.BATCHES);
    return base;
  }

  async function createRecord(kind, input, opts) {
    const e = ENT[kind];
    const v = e.validate(input, { strictFuture: true });
    if (!v.ok) throw new ValidationError(v.errors);
    const ts = U.now();
    const rec = Object.assign({ id: U.uuid() }, v.value, e.derive(v.value), { createdAt: ts, updatedAt: ts });
    if (e.archive) rec.archivedAt = '';
    await withTx(txStores(kind), 'readwrite', async (s) => {
      await CHECKS[kind](s, rec, null, opts || {});
      await r(s[e.store].add(rec));
      await r(s.activities.add(db.newActivity(e.entity + '.create', e.entity, rec.id, ACTIVITY_NOUN[e.entity] + ' added: ' + e.label(rec), ts)));
      await db.touchChange(s.settings, ts);
    });
    return rec;
  }

  async function updateRecord(kind, id, input, opts) {
    const e = ENT[kind];
    const v = e.validate(input, { strictFuture: true });
    if (!v.ok) throw new ValidationError(v.errors);
    return withTx(txStores(kind), 'readwrite', async (s) => {
      const existing = await r(s[e.store].get(id));
      if (!existing) throw new AppError('notfound', 'This record no longer exists.');
      const value = Object.assign({}, v.value);
      // A variety always stays with its crop, and a batch or record with its cycle.
      if (kind === 'varieties') value.cropId = existing.cropId;
      if (kind === 'batches' || kind === 'plantings') value.cycleId = existing.cycleId;
      const next = Object.assign({}, existing, value, e.derive(value));
      const changed = Object.keys(value).some((k) => existing[k] !== next[k]);
      if (!changed) return { record: existing, changed: false };
      await CHECKS[kind](s, next, existing, opts || {});
      next.updatedAt = U.now();
      await r(s[e.store].put(next));
      await r(s.activities.add(db.newActivity(e.entity + '.update', e.entity, id, ACTIVITY_NOUN[e.entity] + ' updated: ' + e.label(next), next.updatedAt)));
      await db.touchChange(s.settings, next.updatedAt);
      return { record: next, changed: true };
    });
  }

  async function setArchived(kind, id, archived) {
    const e = ENT[kind];
    return withTx([e.store, STORE.ACTIVITIES, STORE.SETTINGS], 'readwrite', async (s) => {
      const existing = await r(s[e.store].get(id));
      if (!existing) throw new AppError('notfound', 'This record no longer exists.');
      const ts = U.now();
      const next = Object.assign({}, existing, { archivedAt: archived ? ts : '', updatedAt: ts });
      await r(s[e.store].put(next));
      await r(s.activities.add(db.newActivity(e.entity + (archived ? '.archive' : '.restore'), e.entity, id,
        ACTIVITY_NOUN[e.entity] + (archived ? ' archived: ' : ' restored from archive: ') + e.label(next), ts)));
      await db.touchChange(s.settings, ts);
      return next;
    });
  }

  function inUse(what, parts) {
    return new AppError('in_use', 'This ' + what + ' cannot be deleted because ' + parts + '. Archive it instead, or remove those first. Nothing was deleted.');
  }

  async function deleteCrop(id) {
    return withTx([STORE.CROPS, STORE.VARIETIES, STORE.CYCLES, STORE.ACTIVITIES, STORE.SETTINGS], 'readwrite', async (s) => {
      const crop = await r(s.crops.get(id));
      if (!crop) throw new AppError('notfound', 'This crop no longer exists.');
      const cycles = await r(s.cycles.index('cropId').count(id));
      if (cycles) throw inUse('crop', 'it is used by ' + cycles + ' production cycle' + (cycles === 1 ? '' : 's'));
      const varietyKeys = await r(s.varieties.index('cropId').getAllKeys(id));
      await Promise.all(varietyKeys.map((k) => r(s.varieties.delete(k))));
      await r(s.crops.delete(id));
      const ts = U.now();
      await r(s.activities.add(db.newActivity('crop.delete', 'crop', id,
        'Crop deleted: ' + crop.name + (varietyKeys.length ? ' and ' + varietyKeys.length + ' variet' + (varietyKeys.length === 1 ? 'y' : 'ies') : ''), ts)));
      await db.touchChange(s.settings, ts);
      return { deletedVarieties: varietyKeys.length };
    });
  }

  async function deleteVariety(id) {
    return withTx([STORE.VARIETIES, STORE.CYCLES, STORE.ACTIVITIES, STORE.SETTINGS], 'readwrite', async (s) => {
      const variety = await r(s.varieties.get(id));
      if (!variety) throw new AppError('notfound', 'This variety no longer exists.');
      const cycles = await r(s.cycles.index('varietyId').count(id));
      if (cycles) throw inUse('variety', 'it is used by ' + cycles + ' production cycle' + (cycles === 1 ? '' : 's'));
      await r(s.varieties.delete(id));
      const ts = U.now();
      await r(s.activities.add(db.newActivity('variety.delete', 'variety', id, 'Variety deleted: ' + variety.name, ts)));
      await db.touchChange(s.settings, ts);
    });
  }

  async function deleteCycle(id) {
    return withTx([STORE.CYCLES, STORE.BATCHES, STORE.PLANTINGS, STORE.ACTIVITIES, STORE.SETTINGS], 'readwrite', async (s) => {
      const cycle = await r(s.cycles.get(id));
      if (!cycle) throw new AppError('notfound', 'This production cycle no longer exists.');
      const batchKeys = await r(s.batches.index('cycleId').getAllKeys(id));
      const plantingKeys = await r(s.plantings.index('cycleId').getAllKeys(id));
      await Promise.all(batchKeys.map((k) => r(s.batches.delete(k))));
      await Promise.all(plantingKeys.map((k) => r(s.plantings.delete(k))));
      await r(s.cycles.delete(id));
      const ts = U.now();
      const extra = (batchKeys.length ? ', ' + batchKeys.length + ' batch' + (batchKeys.length === 1 ? '' : 'es') : '') +
        (plantingKeys.length ? ', ' + plantingKeys.length + ' planting record' + (plantingKeys.length === 1 ? '' : 's') : '');
      await r(s.activities.add(db.newActivity('cycle.delete', 'cycle', id, 'Crop cycle deleted: ' + cycle.name + (extra ? ' (with ' + extra.slice(2) + ')' : ''), ts)));
      await db.touchChange(s.settings, ts);
      return { deletedBatches: batchKeys.length, deletedPlantings: plantingKeys.length };
    });
  }

  async function deleteBatch(id) {
    return withTx([STORE.BATCHES, STORE.PLANTINGS, STORE.ACTIVITIES, STORE.SETTINGS], 'readwrite', async (s) => {
      const batch = await r(s.batches.get(id));
      if (!batch) throw new AppError('notfound', 'This batch no longer exists.');
      // Planting records that mentioned this batch are kept, just no longer linked to it.
      const linked = await r(s.plantings.index('batchId').getAll(id));
      const ts = U.now();
      await Promise.all(linked.map((p) => r(s.plantings.put(Object.assign({}, p, { batchId: '', updatedAt: ts })))));
      await r(s.batches.delete(id));
      await r(s.activities.add(db.newActivity('batch.delete', 'batch', id, 'Planting batch deleted: ' + batch.name, ts)));
      await db.touchChange(s.settings, ts);
      return { unlinkedRecords: linked.length };
    });
  }

  async function deletePlanting(id) {
    return withTx([STORE.PLANTINGS, STORE.ACTIVITIES, STORE.SETTINGS], 'readwrite', async (s) => {
      const rec = await r(s.plantings.get(id));
      if (!rec) throw new AppError('notfound', 'This record no longer exists.');
      await r(s.plantings.delete(id));
      const ts = U.now();
      await r(s.activities.add(db.newActivity('planting.delete', 'planting', id, 'Planting record deleted: ' + ENT.plantings.label(rec), ts)));
      await db.touchChange(s.settings, ts);
    });
  }

  /** Everything the crop screens need, read in one consistent transaction. */
  async function loadAll() {
    return withTx([STORE.FARMS, STORE.FIELDS, STORE.CROPS, STORE.VARIETIES, STORE.CYCLES, STORE.BATCHES, STORE.PLANTINGS], 'readonly', async (s) => {
      const out = {};
      const names = { farms: s.farms, fields: s.fields, crops: s.crops, varieties: s.varieties, cycles: s.cycles, batches: s.batches, plantings: s.plantings };
      await Promise.all(Object.keys(names).map(async (k) => {
        out[k] = (await r(names[k].getAll())).sort(byCreated);
      }));
      return out;
    });
  }

  async function getOne(store, id) {
    return withTx([store], 'readonly', (s) => r(s[store].get(id)));
  }

  /* ------------------------------------------------------------------ */
  /* Calculations                                                        */
  /* ------------------------------------------------------------------ */

  /** Rough plant count from an area and spacing: area / (row spacing x plant spacing). Border rows are ignored. */
  function estimatePopulation(areaSqm, rowSpacingCm, plantSpacingCm) {
    const a = Number(areaSqm);
    const row = Number(rowSpacingCm);
    const plant = Number(plantSpacingCm);
    if (!isFinite(a) || !(a > 0) || !(row > 0) || !(plant > 0)) return null;
    return Math.floor(a / ((row / 100) * (plant / 100)));
  }

  /** A short suggested name such as "Tomato - Hybrid F1 - North Plot (2026 Season B)". */
  function suggestCycleName(parts) {
    const base = [parts.crop, parts.variety, parts.field].filter(Boolean).join(' - ');
    return (base + (parts.season ? ' (' + parts.season + ')' : '')).slice(0, MAX.name);
  }

  const isActive = (c) => !c.archivedAt && ACTIVE_STATUSES.indexOf(c.status) !== -1;
  const isInProgress = (c) => !c.archivedAt && IN_PROGRESS_STATUSES.indexOf(c.status) !== -1;

  /**
   * Numbers for the crop overview, all derived from the saved records.
   * `today` is a YYYY-MM-DD string in the farm's time zone.
   */
  function summarise(data, today) {
    const cycles = data.cycles;
    const active = cycles.filter(isActive);
    const inProgress = cycles.filter(isInProgress);
    const cropIds = new Set(inProgress.map((c) => c.cropId));
    const fieldIds = new Set(inProgress.map((c) => c.fieldId));
    const upcoming = active
      .filter((c) => c.status === 'planned' || c.status === 'land_preparation' || c.status === 'nursery')
      .filter((c) => c.plannedPlantingDate && !c.actualPlantingDate)
      .sort((a, b) => (a.plannedPlantingDate < b.plannedPlantingDate ? -1 : a.plannedPlantingDate > b.plannedPlantingDate ? 1 : 0))
      .map((c) => ({ cycle: c, date: c.plannedPlantingDate, overdue: c.plannedPlantingDate < today }));
    const recent = []
      .concat(cycles.map((c) => ({ kind: 'cycle', rec: c })))
      .concat(data.batches.map((b) => ({ kind: 'batch', rec: b })))
      .concat(data.plantings.map((p) => ({ kind: 'planting', rec: p })))
      .sort((a, b) => (a.rec.createdAt < b.rec.createdAt ? 1 : a.rec.createdAt > b.rec.createdAt ? -1 : 0));
    return {
      activeCycles: active.length,
      inProgressCycles: inProgress.length,
      cropsInProduction: cropIds.size,
      activeFields: fieldIds.size,
      areaSqm: units.sumSqm(inProgress.map((c) => c.areaSqm)),
      upcoming,
      growing: active.filter((c) => c.status === 'planted' || c.status === 'growing'),
      harvesting: active.filter((c) => c.status === 'harvesting'),
      recent,
    };
  }

  /**
   * Calendar events from saved records. Each event: { date, endDate, kind, cycleId, title, detail }
   * kinds: planned, planted, nursery, transplanted, harvest, note
   */
  function buildEvents(data) {
    const cropName = new Map(data.crops.map((c) => [c.id, c.name]));
    const events = [];
    const live = new Map();
    data.cycles.forEach((c) => {
      if (c.archivedAt || c.status === 'cancelled') return;
      live.set(c.id, c);
      const crop = cropName.get(c.cropId) || 'Crop';
      const add = (date, kind, title, endDate) => events.push({ date, endDate: endDate || date, kind, cycleId: c.id, title, detail: c.name, crop, cropId: c.cropId, status: c.status });
      if (c.plannedPlantingDate) add(c.plannedPlantingDate, 'planned', 'Planned planting');
      if (c.actualPlantingDate) add(c.actualPlantingDate, 'planted', 'Planted');
      if (c.plannedHarvestStart || c.expectedHarvestEnd) {
        const start = c.plannedHarvestStart || c.expectedHarvestEnd;
        const end = c.expectedHarvestEnd && c.expectedHarvestEnd >= start ? c.expectedHarvestEnd : start;
        add(start, 'harvest', 'Expected harvest', end);
      }
    });
    data.batches.forEach((b) => {
      const c = live.get(b.cycleId);
      if (!c) return;
      const crop = cropName.get(c.cropId) || 'Crop';
      const add = (date, kind, title) => events.push({ date, endDate: date, kind, cycleId: c.id, title: title + ' (' + b.name + ')', detail: c.name, crop, cropId: c.cropId, status: c.status });
      if (b.plannedDate) add(b.plannedDate, 'planned', 'Planned planting');
      if (b.plantingDate) add(b.plantingDate, 'planted', 'Planted');
      if (b.nurseryStartDate) add(b.nurseryStartDate, 'nursery', 'Nursery started');
      if (b.transplantDate) add(b.transplantDate, 'transplanted', 'Transplanted');
    });
    data.plantings.forEach((p) => {
      const c = live.get(p.cycleId);
      if (!c) return;
      const crop = cropName.get(c.cropId) || 'Crop';
      const kind = p.type === 'nursery_sowing' ? 'nursery' : p.type === 'transplanting' ? 'transplanted' : p.type === 'other' ? 'note' : 'planted';
      events.push({ date: p.date, endDate: p.date, kind, cycleId: c.id, title: optionLabel('recordType', p.type), detail: c.name, crop, cropId: c.cropId, status: c.status });
    });
    return events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.title < b.title ? -1 : 1));
  }

  /** For each active cycle: is it part of an over-allocation of its field? Returns Map(cycleId -> info). */
  function allocationProblems(cycles, fields) {
    const fieldSqm = new Map(fields.map((f) => [f.id, f.areaSqm]));
    const out = new Map();
    cycles.forEach((c) => {
      if (!cycleWindow(c)) return;
      const sqm = fieldSqm.get(c.fieldId);
      if (!sqm) return;
      const res = findOverAllocation(c, cycles, sqm);
      if (res.exceeds || units.cmpSqm(c.areaSqm, sqm) > 0) out.set(c.id, res);
    });
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                          */
  /* ------------------------------------------------------------------ */

  AMA.crops = {
    OPTIONS,
    optionLabel,
    ACTIVE_STATUSES,
    IN_PROGRESS_STATUSES,
    OverAllocationError,
    validate: { crop: validateCrop, variety: validateVariety, cycle: validateCycle, batch: validateBatch, planting: validatePlanting },
    isDate,
    todayYmd,
    addDays,
    isActive,
    isInProgress,
    cycleWindow,
    findOverAllocation,
    allocationProblems,
    estimatePopulation,
    suggestCycleName,
    summarise,
    buildEvents,
    loadAll,
    getCrop: (id) => getOne(STORE.CROPS, id),
    getVariety: (id) => getOne(STORE.VARIETIES, id),
    getCycle: (id) => getOne(STORE.CYCLES, id),
    getBatch: (id) => getOne(STORE.BATCHES, id),
    getPlanting: (id) => getOne(STORE.PLANTINGS, id),
    createCrop: (i) => createRecord('crops', i),
    updateCrop: (id, i) => updateRecord('crops', id, i),
    setCropArchived: (id, a) => setArchived('crops', id, a),
    deleteCrop,
    createVariety: (i) => createRecord('varieties', i),
    updateVariety: (id, i) => updateRecord('varieties', id, i),
    setVarietyArchived: (id, a) => setArchived('varieties', id, a),
    deleteVariety,
    createCycle: (i, o) => createRecord('cycles', i, o),
    updateCycle: (id, i, o) => updateRecord('cycles', id, i, o),
    setCycleArchived: (id, a) => setArchived('cycles', id, a),
    deleteCycle,
    createBatch: (i) => createRecord('batches', i),
    updateBatch: (id, i) => updateRecord('batches', id, i),
    deleteBatch,
    createPlanting: (i) => createRecord('plantings', i),
    updatePlanting: (id, i) => updateRecord('plantings', id, i),
    deletePlanting,
  };
})(window);
