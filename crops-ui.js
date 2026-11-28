/*!
 * AMA FarmTech Offline - crops-ui.js (Phase 2: crop production screens)
 * Ama Farms Ltd
 *
 * Every crop screen: overview, production cycles, crop catalogue, varieties,
 * planting batches, planting records and the production calendar. It plugs into
 * the Phase 1 app through AMA.ui (see the end of app.js) and reads and writes
 * data only through AMA.crops (crops.js). No network access. No external libraries.
 * All text is placed with textContent (never innerHTML).
 *
 * Loads after app.js. Exposes AMA.cropsUi.dashboardCard() and AMA.cropsUi.fieldSection(field)
 * for the Home screen and the field page.
 */
(function (global) {
  'use strict';

  const AMA = global.AMA;
  if (!AMA || !AMA.ui || !AMA.crops) return; // the main app did not start: nothing to extend

  const UI = AMA.ui;
  const C = AMA.crops;
  const units = AMA.units;
  const V = AMA.validate;
  const OPT = C.OPTIONS;
  const h = UI.h;
  const icon = UI.icon;
  const link = UI.link;
  const button = UI.button;
  const plural = UI.plural;
  const toast = UI.toast;
  const goto = UI.goto;
  const notice = UI.notice;
  const pageHead = UI.pageHead;
  const kvList = UI.kvList;
  const formControl = UI.formControl;
  const confirmDialog = UI.confirmDialog;
  const notFoundView = UI.notFoundView;
  const friendlyError = UI.friendlyError;
  const UUID = '([0-9a-f-]{36})';

  Object.assign(UI.ICONS, {
    crops: 'M12 21V8M12 8c-2-.5-3.5-2-3.5-4 2 .5 3.5 2 3.5 4zM12 8c2-.5 3.5-2 3.5-4-2 .5-3.5 2-3.5 4zM12 13c-2-.5-3.5-2-3.5-4M12 13c2-.5 3.5-2 3.5-4M12 18c-2-.5-3.5-2-3.5-4M12 18c2-.5 3.5-2 3.5-4',
    calendar: 'M4 6h16v14H4zM4 10h16M8 3v5M16 3v5',
    seed: 'M12 3c4 3 6 6 6 9a6 6 0 0 1-12 0c0-3 2-6 6-9zM12 21v-8',
    cycle: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4',
    archive: 'M3 5h18v4H3zM5 9v10h14V9M10 13h4',
    restore: 'M4 12a8 8 0 1 1 2.3 5.7M4 20v-4h4',
  });

  /* ================================================================== */
  /* Small helpers                                                       */
  /* ================================================================== */

  /** 'YYYY-MM-DD' -> '3 Dec 2026'. Dates are calendar days, so no time zone shifting. */
  function fmtYmd(ymd, opts) {
    if (!C.isDate(ymd)) return '';
    return new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }, opts || {}))
      .format(new Date(ymd + 'T00:00:00Z'));
  }

  const num = (n) => (n == null || n === '' ? '' : units.group(String(n)));
  const byName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
  const MAXLEN = V.MAX;

  function acres(sqm, dp) {
    return units.group(units.fromSqm(sqm, 'acres', dp == null ? 2 : dp));
  }

  /** "1.5 quarter-acres (= 0.375 acres)" */
  function areaLine(rec) {
    const other = units.other(rec.areaUnit);
    const eq = units.fromSqm(rec.areaSqm, other, 4);
    return UI.areaText(rec) + (eq ? ' (= ' + units.group(eq) + ' ' + units.label(other) + ')' : '');
  }

  function showErrors(F, errors) {
    UI.applyErrors(F, errors, Object.values(errors)[0]);
  }

  /** Everything the crop screens need, in one read, plus look-up maps and today's date. */
  async function load() {
    const settings = await UI.refreshSettings();
    const data = await C.loadAll();
    data.settings = settings;
    data.today = C.todayYmd(settings.defaultTimezone);
    data.maps = {};
    ['farms', 'fields', 'crops', 'varieties', 'cycles', 'batches', 'plantings'].forEach((k) => {
      data.maps[k] = new Map(data[k].map((x) => [x.id, x]));
    });
    data.problems = C.allocationProblems(data.cycles, data.fields);
    return data;
  }

  const statusChip = (s) => h('span', { class: 'chip cs-' + s, text: C.optionLabel('status', s) });
  const archivedChip = () => h('span', { class: 'chip chip-archived', text: 'Archived' });
  const overChip = () => h('span', { class: 'chip chip-over', text: 'Over field area' });

  function expiryChip(variety, today) {
    if (!variety.expiryDate) return null;
    if (variety.expiryDate < today) return h('span', { class: 'chip chip-over', text: 'Seed expired' });
    if (variety.expiryDate <= C.addDays(today, 60)) return h('span', { class: 'chip chip-late', text: 'Expires soon' });
    return null;
  }

  function chips(list) {
    const items = list.filter(Boolean);
    return items.length ? h('div', { class: 'chips' }, items) : null;
  }

  function row(href, title, sub, chipNodes) {
    return h('li', null, h('a', { class: 'row', href },
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title', text: title }),
        (Array.isArray(sub) ? sub : [sub]).filter(Boolean).map((t) => h('div', { class: 'small muted', text: t })),
        chips(chipNodes || [])),
      icon('chevron', 'row-chevron')));
  }

  function section(title, iconName, children, extra) {
    return h('section', { class: 'card' },
      h('div', { class: 'card-row' }, h('h2', { class: 'card-title' }, iconName ? icon(iconName) : null, title), extra || null),
      children);
  }

  const crumb = (href, text) => h('p', { class: 'crumb' }, h('a', { href, text: '‹ ' + text }));
  const pre = (text) => (text ? h('span', { class: 'pre', text }) : '');
  const anchor = (href, text) => h('a', { href, text });

  function topTabs(active) {
    const items = [['overview', '#/crops', 'Overview'], ['cycles', '#/crops/cycles', 'Cycles'], ['catalogue', '#/crops/catalogue', 'Catalogue'], ['calendar', '#/crops/calendar', 'Calendar']];
    return h('div', { class: 'tabs tabs-4', role: 'tablist' }, items.map(([k, href, label]) =>
      h('a', { href, role: 'tab', 'aria-selected': String(k === active), class: 'tab' + (k === active ? ' active' : ''), text: label })));
  }

  /** A "Planned | Actual" pair so the two are never mixed up. */
  function pairBlock(title, planned, actual) {
    const cell = (label, v) => h('div', null,
      h('div', { class: 'pair-label', text: label }),
      h('div', { class: 'pair-value' + (v ? '' : ' is-empty'), text: v || 'Not recorded' }));
    return h('div', { class: 'stack-tight' },
      h('div', { class: 'small muted', text: title }),
      h('div', { class: 'pair' }, cell('Planned', planned), cell('Actual', actual)));
  }

  function progressBar(percent, over, label) {
    const bar = h('div', { class: 'bar' + (over ? ' bar-over' : ''), role: 'img', 'aria-label': label });
    const fill = h('div', { class: 'bar-fill' });
    fill.style.width = Math.max(1, Math.min(100, percent)) + '%';
    bar.appendChild(fill);
    return bar;
  }

  /** Crop - variety - field - area, for list rows. */
  function cycleSub(c, d) {
    const crop = d.maps.crops.get(c.cropId);
    const variety = c.varietyId ? d.maps.varieties.get(c.varietyId) : null;
    const field = d.maps.fields.get(c.fieldId);
    return [crop && crop.name, variety && variety.name, field && field.name, UI.areaText(c)].filter(Boolean).join(' · ');
  }

  function cycleDatesLine(c) {
    if (c.actualPlantingDate) return 'Planted ' + fmtYmd(c.actualPlantingDate);
    if (c.plannedPlantingDate) return 'Planting planned for ' + fmtYmd(c.plannedPlantingDate);
    return '';
  }

  function cycleRow(c, d) {
    const sub = [cycleSub(c, d), c.season].filter(Boolean).join(' · ');
    const dates = cycleDatesLine(c);
    return row('#/crops/cycle/' + c.id, c.name, [sub, dates], [
      statusChip(c.status), c.archivedAt ? archivedChip() : null, d.problems.has(c.id) && !c.archivedAt ? overChip() : null,
    ]);
  }

  /**
   * Shared form wrapper: collects the control values, validates, saves, then moves on.
   * o: { F, fields, saveText, cancelHref, validate(input), save(input) -> record | false, savedText, afterHref(record), extra() }
   */
  function formPage(o) {
    const save = button(o.saveText, 'btn btn-primary btn-block', null, null, { type: 'submit' });
    const form = h('form', { class: 'form', novalidate: true }, o.fields,
      h('div', { class: 'actions' }, save, link(o.cancelHref, 'Cancel', 'btn btn-secondary')));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (save.disabled) return;
      const input = {};
      Object.keys(o.F).forEach((k) => { input[k] = o.F[k].el.value; });
      if (o.extra) Object.assign(input, o.extra());
      const check = o.validate(input);
      if (!check.ok) {
        showErrors(o.F, check.errors);
        return;
      }
      UI.applyErrors(o.F, {});
      save.disabled = true;
      try {
        const rec = await o.save(input);
        if (rec === false) {
          save.disabled = false;
          return;
        }
        toast(o.savedText);
        goto(o.afterHref(rec), true);
      } catch (e) {
        save.disabled = false;
        if (e instanceof AMA.ValidationError) showErrors(o.F, e.errors);
        else toast(friendlyError(e), 'error');
      }
    });
    return form;
  }

  const group = (title, children) => h('fieldset', { class: 'group' }, h('legend', { text: title }), children);

  function fillSelect(sel, options, value) {
    sel.replaceChildren.apply(sel, options.map((o) => h('option', { value: o[0], text: o[1] })));
    sel.value = value;
    if (sel.value !== value) sel.value = '';
  }

  /** Archive (after a short confirmation) or restore. */
  function archiveButton(rec, noun, setFn, message) {
    if (rec.archivedAt) {
      return button('Restore', 'btn btn-secondary', async () => {
        try {
          await setFn(rec.id, false);
          toast(noun + ' restored.');
          UI.render();
        } catch (e) {
          toast(friendlyError(e), 'error');
        }
      }, 'restore');
    }
    return button('Archive', 'btn btn-secondary', async () => {
      const ok = await confirmDialog({
        title: 'Archive "' + rec.name + '"?',
        message: message || 'It is hidden from new choices but kept, with all its records. You can restore it at any time.',
        confirmText: 'Archive',
      });
      if (!ok) return;
      try {
        await setFn(rec.id, true);
        toast(noun + ' archived.');
        UI.render();
      } catch (e) {
        toast(friendlyError(e), 'error');
      }
    }, 'archive');
  }

  /* ================================================================== */
  /* Overview                                                            */
  /* ================================================================== */

  function emptyIntro(d) {
    const noFarm = !d.farms.length;
    const noField = d.farms.length && !d.fields.length;
    const actions = h('div', { class: 'actions' });
    const steps = h('ol', { class: 'steps' },
      h('li', null, h('strong', { text: 'Add a crop' }), ' to your catalogue, for example Tomato.'),
      h('li', null, h('strong', { text: 'Add its seed varieties' }), ' (optional), for example the variety you bought.'),
      h('li', null, h('strong', { text: 'Create a production cycle' }), ': choose the field, the area, the plant count and the planting dates.'));
    if (!d.crops.length) actions.appendChild(link('#/crops/crop/new', 'Add first crop', 'btn btn-primary', 'plus'));
    if (!noFarm && !noField) {
      actions.appendChild(link('#/crops/cycle/new', d.crops.length ? 'Plan first production cycle' : 'Plan a cycle', d.crops.length ? 'btn btn-primary' : 'btn btn-secondary', 'plus'));
    }
    const card = h('section', { class: 'card empty' },
      h('div', { class: 'empty-icon' }, icon('crops')),
      h('h2', { class: 'card-title', text: 'No crop production recorded yet' }),
      h('p', { class: 'muted', text: 'Everything on this screen is calculated from the crops and production cycles you save on this phone. Nothing is made up.' }),
      steps, actions);
    const out = [card];
    if (noFarm) out.unshift(notice('warn', 'You need a farm first.', 'A production cycle is planted in a field of one of your farms.'), link('#/farm/new', 'Create a farm', 'btn btn-secondary', 'plus'));
    else if (noField) out.unshift(notice('warn', 'You need a field first.', 'A production cycle is planted in a field. Add a field to your farm.'), link('#/farm', 'Open My Farm', 'btn btn-secondary', 'farm'));
    return out;
  }

  async function viewOverview() {
    const d = await load();
    const wrap = h('div', { class: 'stack' });
    wrap.appendChild(pageHead('Crop production', 'Crops, seeds and production cycles',
      d.farms.length && d.fields.length && d.crops.length ? link('#/crops/cycle/new', 'New cycle', 'btn btn-primary btn-small', 'plus') : null));
    wrap.appendChild(topTabs('overview'));
    if (!d.cycles.length) {
      emptyIntro(d).forEach((n) => wrap.appendChild(n));
      return wrap;
    }

    const sum = C.summarise(d, d.today);
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const added = [].concat(d.crops, d.varieties, d.cycles, d.batches, d.plantings).filter((x) => x.createdAt >= weekAgo).length;
    const overdue = sum.upcoming.filter((u) => u.overdue).length;
    wrap.appendChild(h('section', { class: 'stats', 'aria-label': 'Crop production totals' },
      UI.statCard('Active cycles', sum.activeCycles, 'planned to harvesting', 'cycle'),
      UI.statCard('Crops being cultivated', sum.cropsInProduction, 'in the field or nursery', 'crops'),
      UI.statCard('Cultivated area', acres(sum.areaSqm, 2) + ' ac', units.group(units.fromSqm(sum.areaSqm, 'hectares', 2)) + ' ha', 'field'),
      UI.statCard('Active fields', sum.activeFields, 'with a crop in progress', 'field'),
      UI.statCard('Upcoming plantings', sum.upcoming.length, overdue ? overdue + ' overdue' : 'planned, not yet planted', 'calendar'),
      UI.statCard('Growing', sum.growing.length, 'planted or growing', 'seed'),
      UI.statCard('Harvesting', sum.harvesting.length, 'cycles', 'crops'),
      UI.statCard('New records', added, 'added in the last 7 days', 'records')));
    wrap.appendChild(h('details', { class: 'details' },
      h('summary', { text: 'How these numbers are counted' }),
      h('p', { class: 'small muted', text: 'Active cycles are those that are Planned, in Land preparation, Nursery, Planted, Growing or Harvesting (not archived). Cultivated area, crops being cultivated and active fields count only cycles that are past "Planned". Completed, cancelled and archived cycles are left out.' })));

    if (d.problems.size) {
      const list = d.cycles.filter((c) => d.problems.has(c.id) && !c.archivedAt);
      wrap.appendChild(h('section', { class: 'card card-danger' },
        h('h2', { class: 'card-title' }, icon('warn'), 'Field area warning'),
        notice('warn', '', plural(list.length, 'crop cycle') + (list.length === 1 ? ' uses' : ' use') + ' more area than its field has when they overlap in time. Open each one to see why, then change the area or the dates.'),
        h('ul', { class: 'list' }, list.slice(0, 5).map((c) => cycleRow(c, d)))));
    }

    const up = sum.upcoming.slice(0, 5);
    wrap.appendChild(section('Upcoming plantings', 'calendar', [
      up.length
        ? h('ul', { class: 'list' }, up.map((u) => row('#/crops/cycle/' + u.cycle.id, u.cycle.name, [cycleSub(u.cycle, d), 'Planned for ' + fmtYmd(u.date)],
          [u.overdue ? h('span', { class: 'chip chip-late', text: 'Overdue' }) : null, statusChip(u.cycle.status)])))
        : h('p', { class: 'muted', text: 'No planned planting dates. Add a planned planting date to a cycle and it will appear here.' }),
      link('#/crops/calendar', 'Open calendar', 'btn btn-secondary btn-small', 'calendar')]));

    if (sum.growing.length) {
      wrap.appendChild(section('Growing now', 'seed', h('ul', { class: 'list' }, sum.growing.slice(0, 6).map((c) => cycleRow(c, d)))));
    }
    if (sum.harvesting.length) {
      wrap.appendChild(section('Harvesting now', 'crops', h('ul', { class: 'list' }, sum.harvesting.slice(0, 6).map((c) => cycleRow(c, d)))));
    }

    const recent = sum.recent.slice(0, 6).map((x) => {
      const rec = x.rec;
      if (x.kind === 'cycle') return row('#/crops/cycle/' + rec.id, 'Crop cycle: ' + rec.name, UI.fmtRelative(rec.createdAt));
      const cycle = d.maps.cycles.get(rec.cycleId);
      const cname = cycle ? cycle.name : 'a production cycle';
      if (x.kind === 'batch') return row('#/crops/cycle/' + rec.cycleId, 'Planting batch: ' + rec.name, [cname, UI.fmtRelative(rec.createdAt)]);
      return row('#/crops/cycle/' + rec.cycleId, 'Planting record: ' + C.optionLabel('recordType', rec.type) + ' · ' + fmtYmd(rec.date), [cname, UI.fmtRelative(rec.createdAt)]);
    });
    wrap.appendChild(section('Recently added', 'records', recent.length ? h('ul', { class: 'list' }, recent) : h('p', { class: 'muted', text: 'Nothing added yet.' })));
    return wrap;
  }

  /* ================================================================== */
  /* Cycles list                                                         */
  /* ================================================================== */

  async function viewCycles() {
    const d = await load();
    const wrap = h('div', { class: 'stack' });
    wrap.appendChild(pageHead('Production cycles', d.cycles.length ? plural(d.cycles.length, 'cycle') + ' saved' : null,
      d.farms.length && d.fields.length && d.crops.length ? link('#/crops/cycle/new', 'New cycle', 'btn btn-primary btn-small', 'plus') : null));
    wrap.appendChild(topTabs('cycles'));
    if (!d.cycles.length) {
      emptyIntro(d).forEach((n) => wrap.appendChild(n));
      return wrap;
    }
    const search = h('input', { type: 'search', class: 'search', placeholder: 'Search cycles', 'aria-label': 'Search production cycles', autocomplete: 'off', maxlength: '100' });
    const statusSel = h('select', { 'aria-label': 'Filter by status' },
      [['active', 'Active cycles'], ['all', 'All (not archived)']].concat(OPT.status, [['archived', 'Archived']]).map((o) => h('option', { value: o[0], text: o[1] })));
    const cropSel = h('select', { 'aria-label': 'Filter by crop' }, h('option', { value: '', text: 'All crops' }),
      d.crops.slice().sort(byName).map((c) => h('option', { value: c.id, text: c.name })));
    wrap.appendChild(h('div', { class: 'filters' }, search, h('div', { class: 'grid-2' }, statusSel, cropSel)));
    const results = h('div', { 'aria-live': 'polite' });
    wrap.appendChild(results);

    const draw = () => {
      const q = search.value.trim().toLowerCase();
      const f = statusSel.value;
      const match = (c) => {
        if (f === 'archived') return !!c.archivedAt;
        if (c.archivedAt) return false;
        if (f === 'active') return C.isActive(c);
        if (f === 'all') return true;
        return c.status === f;
      };
      let rows = d.cycles.filter((c) => match(c) && (!cropSel.value || c.cropId === cropSel.value));
      if (q) {
        rows = rows.filter((c) => {
          const crop = d.maps.crops.get(c.cropId);
          const v = c.varietyId ? d.maps.varieties.get(c.varietyId) : null;
          const fld = d.maps.fields.get(c.fieldId);
          const farm = d.maps.farms.get(c.farmId);
          return [c.name, c.season, c.notes, crop && crop.name, v && v.name, fld && fld.name, farm && farm.name].filter(Boolean).join(' ').toLowerCase().includes(q);
        });
      }
      const key = (c) => c.actualPlantingDate || c.plannedPlantingDate || '';
      if (f === 'active') {
        rows.sort((a, b) => (key(a) && key(b) ? (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) : key(a) ? -1 : key(b) ? 1 : 0));
      } else {
        rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      }
      results.replaceChildren(rows.length
        ? h('ul', { class: 'list card-list' }, rows.map((c) => cycleRow(c, d)))
        : h('p', { class: 'muted pad', text: 'No production cycles match these filters.' }));
    };
    search.addEventListener('input', draw);
    statusSel.addEventListener('change', draw);
    cropSel.addEventListener('change', draw);
    draw();
    return wrap;
  }

  /* ================================================================== */
  /* Catalogue (crops and varieties)                                     */
  /* ================================================================== */

  async function viewCatalogue(route) {
    const tab = route.match[1] === 'varieties' ? 'varieties' : 'crops';
    const d = await load();
    const wrap = h('div', { class: 'stack' });
    wrap.appendChild(pageHead('Crop catalogue', 'The crops you grow and the seed varieties you buy',
      tab === 'crops' ? link('#/crops/crop/new', 'Add crop', 'btn btn-primary btn-small', 'plus')
        : d.crops.length ? link('#/crops/variety/new', 'Add variety', 'btn btn-primary btn-small', 'plus') : null));
    wrap.appendChild(topTabs('catalogue'));
    wrap.appendChild(h('div', { class: 'tabs tabs-2', role: 'tablist' },
      [['crops', 'Crops (' + d.crops.length + ')'], ['varieties', 'Varieties (' + d.varieties.length + ')']].map(([k, label]) =>
        h('a', { href: '#/crops/catalogue/' + k, role: 'tab', 'aria-selected': String(tab === k), class: 'tab' + (tab === k ? ' active' : ''), text: label }))));

    if (tab === 'varieties' && !d.crops.length) {
      wrap.appendChild(UI.emptyState('Add a crop first', 'A variety belongs to a crop, for example a seed variety of Tomato belongs to the crop Tomato.', link('#/crops/crop/new', 'Add crop', 'btn btn-primary', 'plus')));
      return wrap;
    }
    if (tab === 'crops' && !d.crops.length) {
      wrap.appendChild(UI.emptyState('No crops yet', 'Add the crops you grow, such as tomatoes, cabbage, onions, maize, beans, soybeans or cassava.', link('#/crops/crop/new', 'Add first crop', 'btn btn-primary', 'plus')));
      return wrap;
    }
    if (tab === 'varieties' && !d.varieties.length) {
      wrap.appendChild(UI.emptyState('No varieties yet', 'Record the seed you buy: variety, supplier, batch number and expiry date. Each variety can be used in many production cycles.', link('#/crops/variety/new', 'Add first variety', 'btn btn-primary', 'plus')));
      return wrap;
    }

    const search = h('input', { type: 'search', class: 'search', placeholder: 'Search ' + tab, 'aria-label': 'Search ' + tab, autocomplete: 'off', maxlength: '100' });
    const showArchived = h('input', { type: 'checkbox' });
    wrap.appendChild(h('div', { class: 'filters' }, search, h('label', { class: 'check' }, showArchived, h('span', { text: 'Show archived' }))));
    const results = h('div', { 'aria-live': 'polite' });
    wrap.appendChild(results);

    const draw = () => {
      const q = search.value.trim().toLowerCase();
      let node;
      if (tab === 'crops') {
        const rows = d.crops.slice().sort(byName)
          .filter((c) => (showArchived.checked || !c.archivedAt) && (!q || [c.name, c.scientificName, c.description, c.notes, C.optionLabel('category', c.category)].filter(Boolean).join(' ').toLowerCase().includes(q)))
          .map((c) => {
            const nv = d.varieties.filter((v) => v.cropId === c.id).length;
            const nc = d.cycles.filter((x) => x.cropId === c.id).length;
            return row('#/crops/crop/' + c.id, c.name, [C.optionLabel('category', c.category), plural(nv, 'variety', 'varieties') + ' · ' + plural(nc, 'cycle')], [c.archivedAt ? archivedChip() : null]);
          });
        node = rows.length ? h('ul', { class: 'list card-list' }, rows) : h('p', { class: 'muted pad', text: 'No crops match your search.' });
      } else {
        const rows = d.varieties.slice().sort(byName)
          .filter((v) => {
            const crop = d.maps.crops.get(v.cropId);
            return (showArchived.checked || !v.archivedAt) && (!q || [v.name, v.supplier, v.batchNumber, v.notes, crop && crop.name].filter(Boolean).join(' ').toLowerCase().includes(q));
          })
          .map((v) => {
            const crop = d.maps.crops.get(v.cropId);
            return row('#/crops/variety/' + v.id, v.name, [[crop && crop.name, v.supplier, C.optionLabel('seedType', v.seedType)].filter(Boolean).join(' · '), v.batchNumber ? 'Batch/lot ' + v.batchNumber : ''],
              [v.archivedAt ? archivedChip() : null, expiryChip(v, d.today)]);
          });
        node = rows.length ? h('ul', { class: 'list card-list' }, rows) : h('p', { class: 'muted pad', text: 'No varieties match your search.' });
      }
      results.replaceChildren(node);
    };
    search.addEventListener('input', draw);
    showArchived.addEventListener('change', draw);
    draw();
    return wrap;
  }

  /* ================================================================== */
  /* Calendar                                                            */
  /* ================================================================== */

  async function viewCalendar(route) {
    const tab = route.match[1] === 'past' ? 'past' : 'upcoming';
    const d = await load();
    const today = d.today;
    const wrap = h('div', { class: 'stack' });
    wrap.appendChild(pageHead('Production calendar', 'Planting, transplanting and harvest dates from your saved records'));
    wrap.appendChild(topTabs('calendar'));
    const events = C.buildEvents(d);
    if (!events.length) {
      wrap.appendChild(UI.emptyState('Nothing on the calendar yet', 'Dates appear here when you save planned or actual planting dates, planting batches, planting records or expected harvest dates in a production cycle.',
        d.crops.length && d.fields.length ? link('#/crops/cycle/new', 'Plan a production cycle', 'btn btn-primary', 'plus') : link('#/crops', 'Open crop overview', 'btn btn-secondary', 'chevron')));
      return wrap;
    }
    const isOverdue = (e) => {
      if (e.kind !== 'planned' || e.date >= today) return false;
      const c = d.maps.cycles.get(e.cycleId);
      return !!c && !c.actualPlantingDate && ['planned', 'land_preparation', 'nursery'].indexOf(c.status) !== -1;
    };
    const upcoming = events.filter((e) => e.endDate >= today || isOverdue(e));
    const past = events.filter((e) => e.endDate < today && !isOverdue(e)).reverse();
    wrap.appendChild(h('div', { class: 'tabs tabs-2', role: 'tablist' },
      [['upcoming', 'Upcoming (' + upcoming.length + ')', '#/crops/calendar'], ['past', 'Past (' + past.length + ')', '#/crops/calendar/past']].map(([k, label, href]) =>
        h('a', { href, role: 'tab', 'aria-selected': String(tab === k), class: 'tab' + (tab === k ? ' active' : ''), text: label }))));
    const cropIds = Array.from(new Set(events.map((e) => e.cropId)));
    const cropSel = h('select', { 'aria-label': 'Filter by crop' }, h('option', { value: '', text: 'All crops' }),
      cropIds.map((id) => d.maps.crops.get(id)).filter(Boolean).sort(byName).map((c) => h('option', { value: c.id, text: c.name })));
    wrap.appendChild(h('div', { class: 'filters' }, cropSel));
    wrap.appendChild(h('div', { class: 'legend', 'aria-hidden': 'true' },
      h('span', null, h('i', { class: 'lg-planned' }), 'Planned'), h('span', null, h('i', { class: 'lg-planted' }), 'Planted or transplanted'),
      h('span', null, h('i', { class: 'lg-nursery' }), 'Nursery'), h('span', null, h('i', { class: 'lg-harvest' }), 'Harvest')));
    const results = h('div', { class: 'stack', 'aria-live': 'polite' });
    wrap.appendChild(results);

    const draw = () => {
      const list = (tab === 'past' ? past : upcoming).filter((e) => !cropSel.value || e.cropId === cropSel.value);
      if (!list.length) {
        results.replaceChildren(h('p', { class: 'muted pad', text: tab === 'past' ? 'No past dates for this selection.' : 'No upcoming dates for this selection.' }));
        return;
      }
      const months = [];
      list.slice(0, 200).forEach((e) => {
        const key = e.date.slice(0, 7);
        let m = months[months.length - 1];
        if (!m || m.key !== key) {
          m = { key, date: e.date, items: [] };
          months.push(m);
        }
        m.items.push(e);
      });
      results.replaceChildren.apply(results, months.map((m) => h('div', { class: 'stack-tight' },
        h('div', { class: 'month-head', text: fmtYmd(m.date, { day: undefined, month: 'long', year: 'numeric' }) }),
        h('ul', { class: 'list card-list' }, m.items.map((e) => {
          const range = e.endDate !== e.date ? ' · until ' + fmtYmd(e.endDate) : '';
          const late = isOverdue(e);
          const now = e.date <= today && e.endDate >= today;
          return h('li', null, h('a', { class: 'ev ev-' + e.kind + (now ? ' ev-today' : ''), href: '#/crops/cycle/' + e.cycleId },
            h('div', { class: 'ev-date' }, h('div', { class: 'ev-day', text: String(+e.date.slice(8)) }), h('div', { class: 'ev-mon', text: fmtYmd(e.date, { day: undefined, month: 'short', year: undefined }) })),
            h('div', { class: 'row-main' }, h('div', { class: 'row-title', text: e.title }), h('div', { class: 'small muted', text: e.crop + ' · ' + e.detail + range })),
            late ? h('span', { class: 'chip chip-late', text: 'Overdue' }) : now ? h('span', { class: 'chip chip-ok', text: 'Today' }) : null));
        })))));
    };
    cropSel.addEventListener('change', draw);
    draw();
    return wrap;
  }

  /* ================================================================== */
  /* Crops                                                               */
  /* ================================================================== */

  async function viewCropForm(id) {
    const existing = id ? await C.getCrop(id) : null;
    if (id && !existing) return notFoundView('crop');
    const data = existing || { name: '', category: 'vegetables', scientificName: '', description: '', defaultMethod: '', growingDays: '', notes: '' };
    const F = {
      name: formControl({ name: 'name', label: 'Crop name', required: true, max: MAXLEN.name, hint: 'For example Tomato, Cabbage, Onion, Maize, Beans, Soybeans, Cassava' }, data.name),
      category: formControl({ name: 'category', label: 'Crop category', type: 'select', required: true, options: OPT.category }, data.category),
      scientificName: formControl({ name: 'scientificName', label: 'Scientific name (optional)', max: MAXLEN.name, capitalize: 'none' }, data.scientificName),
      description: formControl({ name: 'description', label: 'Description', type: 'textarea', max: MAXLEN.text }, data.description),
      defaultMethod: formControl({ name: 'defaultMethod', label: 'Usual planting method', type: 'select', options: OPT.defaultMethod }, data.defaultMethod),
      growingDays: formControl({ name: 'growingDays', label: 'Typical growing duration in days (optional)', inputmode: 'numeric', max: 4, hint: 'Days from planting to the end of harvest, if you know it' }, data.growingDays),
      notes: formControl({ name: 'notes', label: 'General notes', type: 'textarea', rows: 4, max: MAXLEN.notes }, data.notes),
    };
    const form = formPage({
      F,
      fields: [F.name.wrap, F.category.wrap, F.scientificName.wrap, F.description.wrap, F.defaultMethod.wrap, F.growingDays.wrap, F.notes.wrap],
      saveText: existing ? 'Save changes' : 'Save crop',
      cancelHref: existing ? '#/crops/crop/' + id : '#/crops/catalogue',
      validate: (input) => C.validate.crop(input),
      save: async (input) => (existing ? (await C.updateCrop(id, input)).record : C.createCrop(input)),
      savedText: existing ? 'Crop saved.' : 'Crop saved. You can now add its varieties.',
      afterHref: (rec) => '#/crops/crop/' + rec.id,
    });
    return h('div', { class: 'stack' },
      crumb(existing ? '#/crops/crop/' + id : '#/crops/catalogue', 'Back'),
      pageHead(existing ? 'Edit crop' : 'New crop'),
      h('section', { class: 'card' }, form));
  }

  async function viewCropDetail(route) {
    const id = route.match[1];
    const d = await load();
    const crop = d.maps.crops.get(id);
    if (!crop) return notFoundView('crop');
    const varieties = d.varieties.filter((v) => v.cropId === id).sort(byName);
    const cycles = d.cycles.filter((c) => c.cropId === id).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const wrap = h('div', { class: 'stack' });
    wrap.appendChild(crumb('#/crops/catalogue', 'Catalogue'));
    wrap.appendChild(pageHead(crop.name, C.optionLabel('category', crop.category)));
    if (crop.archivedAt) wrap.appendChild(chips([archivedChip()]));
    wrap.appendChild(h('div', { class: 'actions' },
      link('#/crops/crop/' + id + '/edit', 'Edit crop', 'btn btn-secondary', 'edit'),
      !crop.archivedAt ? link('#/crops/cycle/new/crop/' + id, 'Plan a cycle', 'btn btn-secondary', 'plus') : null,
      archiveButton(crop, 'Crop', C.setCropArchived, 'The crop is hidden from new choices but kept, with its varieties and cycles. You can restore it at any time.'),
      button('Delete', 'btn btn-danger-outline', async () => {
        if (cycles.length) {
          toast('This crop is used by ' + plural(cycles.length, 'production cycle') + ' (archived ones count too), so it cannot be deleted. Archive it instead.', 'error');
          return;
        }
        const ok = await confirmDialog({
          title: 'Delete "' + crop.name + '"?',
          message: [varieties.length ? 'This also deletes its ' + plural(varieties.length, 'variety', 'varieties') + '.' : '', 'This cannot be undone. Archiving keeps the record instead.'].filter(Boolean),
          confirmText: 'Delete crop',
          danger: true,
        });
        if (!ok) return;
        try {
          await C.deleteCrop(id);
          toast('Crop deleted.');
          goto('#/crops/catalogue', true);
        } catch (e) {
          toast(friendlyError(e), 'error');
        }
      }, 'trash')));
    wrap.appendChild(section('Crop details', null, kvList([
      ['Category', C.optionLabel('category', crop.category)],
      ['Scientific name', crop.scientificName],
      ['Usual planting method', C.optionLabel('defaultMethod', crop.defaultMethod) === 'Not specified' ? '' : C.optionLabel('defaultMethod', crop.defaultMethod)],
      ['Typical growing duration', crop.growingDays ? crop.growingDays + ' days' : ''],
      ['Description', pre(crop.description)],
      ['Notes', pre(crop.notes)],
      ['Created', UI.fmtDate(crop.createdAt, true)], ['Last changed', UI.fmtDate(crop.updatedAt, true)],
    ])));
    wrap.appendChild(section('Varieties (' + varieties.length + ')', 'seed',
      varieties.length
        ? h('ul', { class: 'list' }, varieties.map((v) => row('#/crops/variety/' + v.id, v.name, [[v.supplier, C.optionLabel('seedType', v.seedType)].filter(Boolean).join(' · '), v.batchNumber ? 'Batch/lot ' + v.batchNumber : ''],
          [v.archivedAt ? archivedChip() : null, expiryChip(v, d.today)])))
        : h('p', { class: 'muted', text: 'No varieties yet. Add the seed varieties you buy or plant.' }),
      link('#/crops/crop/' + id + '/variety/new', 'Add variety', 'btn btn-primary btn-small', 'plus')));
    wrap.appendChild(section('Production cycles (' + cycles.length + ')', 'cycle',
      cycles.length ? h('ul', { class: 'list' }, cycles.map((c) => cycleRow(c, d))) : h('p', { class: 'muted', text: 'This crop has not been planned in any field yet.' })));
    return wrap;
  }

  /* ================================================================== */
  /* Varieties                                                           */
  /* ================================================================== */

  /** id: edit this variety. preCropId: new variety for this crop. */
  async function viewVarietyForm(id, preCropId) {
    const d = await load();
    const existing = id ? d.maps.varieties.get(id) : null;
    if (id && !existing) return notFoundView('variety');
    if (preCropId && !d.maps.crops.get(preCropId)) return notFoundView('crop');
    if (!d.crops.length) {
      return h('div', { class: 'stack' }, pageHead('New variety'),
        UI.emptyState('Add a crop first', 'A variety belongs to a crop.', link('#/crops/crop/new', 'Add crop', 'btn btn-primary', 'plus')));
    }
    const data = existing || {
      cropId: preCropId || '', name: '', supplier: '', seedType: '', packetSize: '', quantityPurchased: '', purchaseDate: '', batchNumber: '', expiryDate: '',
      seedCost: '', costCurrency: d.settings.defaultCurrency || 'UGX', germinationPercent: '', germinationNotes: '', notes: '',
    };
    const cropOptions = d.crops.filter((c) => !c.archivedAt || c.id === data.cropId).sort(byName).map((c) => [c.id, c.name + (c.archivedAt ? ' (archived)' : '')]);
    const suppliers = Array.from(new Set(d.varieties.map((v) => v.supplier).filter(Boolean))).sort();
    const F = {
      cropId: formControl({ name: 'cropId', label: 'Crop', type: 'select', required: true, options: [['', 'Choose a crop']].concat(cropOptions), hint: existing ? 'A variety stays with its crop.' : null }, data.cropId),
      name: formControl({ name: 'name', label: 'Variety name', required: true, max: MAXLEN.name, hint: 'The name printed on the seed packet' }, data.name),
      supplier: formControl({ name: 'supplier', label: 'Seed company or supplier', list: 'supplier-list', max: MAXLEN.name }, data.supplier),
      seedType: formControl({ name: 'seedType', label: 'Seed type', type: 'select', options: OPT.seedType }, data.seedType),
      packetSize: formControl({ name: 'packetSize', label: 'Seed packet size', max: 40, hint: 'For example 10 g, 1,000 seeds or 25 kg' }, data.packetSize),
      quantityPurchased: formControl({ name: 'quantityPurchased', label: 'Quantity purchased', inputmode: 'decimal', max: 18, hint: 'How many packets or how much you bought' }, data.quantityPurchased),
      purchaseDate: formControl({ name: 'purchaseDate', label: 'Purchase date', type: 'date' }, data.purchaseDate),
      batchNumber: formControl({ name: 'batchNumber', label: 'Batch or lot number', max: 40, capitalize: 'characters', hint: 'Printed on the seed packet' }, data.batchNumber),
      expiryDate: formControl({ name: 'expiryDate', label: 'Expiry date', type: 'date' }, data.expiryDate),
      seedCost: formControl({ name: 'seedCost', label: 'Seed cost (total paid)', inputmode: 'decimal', max: 20, placeholder: 'e.g. 45,000' }, data.seedCost),
      costCurrency: formControl({ name: 'costCurrency', label: 'Currency', max: 3, capitalize: 'characters', list: 'currency-list-v' }, data.costCurrency),
      germinationPercent: formControl({ name: 'germinationPercent', label: 'Germination rate in % (optional)', inputmode: 'decimal', max: 5, hint: 'From the packet label or your own test' }, data.germinationPercent),
      germinationNotes: formControl({ name: 'germinationNotes', label: 'Germination notes (optional)', type: 'textarea', max: MAXLEN.text }, data.germinationNotes),
      notes: formControl({ name: 'notes', label: 'Notes', type: 'textarea', rows: 4, max: MAXLEN.notes }, data.notes),
    };
    if (existing) F.cropId.el.disabled = true;
    const back = existing ? '#/crops/variety/' + id : preCropId ? '#/crops/crop/' + preCropId : '#/crops/catalogue/varieties';
    const form = formPage({
      F,
      fields: [
        F.cropId.wrap, F.name.wrap,
        group('Seed source', [F.supplier.wrap, F.seedType.wrap, F.packetSize.wrap, F.batchNumber.wrap, F.expiryDate.wrap]),
        group('Purchase', [F.quantityPurchased.wrap, F.purchaseDate.wrap, h('div', { class: 'grid-area' }, F.seedCost.wrap, F.costCurrency.wrap)]),
        group('Germination', [F.germinationPercent.wrap, F.germinationNotes.wrap]),
        F.notes.wrap,
        UI.datalist('supplier-list', suppliers), UI.datalist('currency-list-v', ['UGX', 'USD', 'KES', 'TZS', 'RWF', 'EUR', 'GBP']),
      ],
      saveText: existing ? 'Save changes' : 'Save variety',
      cancelHref: back,
      validate: (input) => C.validate.variety(input),
      save: async (input) => (existing ? (await C.updateVariety(id, input)).record : C.createVariety(input)),
      savedText: existing ? 'Variety saved.' : 'Variety saved.',
      afterHref: (rec) => '#/crops/variety/' + rec.id,
    });
    return h('div', { class: 'stack' },
      crumb(back, 'Back'),
      pageHead(existing ? 'Edit variety' : 'New variety', 'Seed you buy and plant'),
      h('section', { class: 'card' }, form));
  }

  async function viewVarietyDetail(route) {
    const id = route.match[1];
    const d = await load();
    const v = d.maps.varieties.get(id);
    if (!v) return notFoundView('variety');
    const crop = d.maps.crops.get(v.cropId);
    const cycles = d.cycles.filter((c) => c.varietyId === id).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const wrap = h('div', { class: 'stack' });
    wrap.appendChild(crumb(crop ? '#/crops/crop/' + crop.id : '#/crops/catalogue/varieties', crop ? crop.name : 'Catalogue'));
    wrap.appendChild(pageHead(v.name, crop ? crop.name : ''));
    const vChips = chips([v.archivedAt ? archivedChip() : null, expiryChip(v, d.today)]);
    if (vChips) wrap.appendChild(vChips);
    wrap.appendChild(h('div', { class: 'actions' },
      link('#/crops/variety/' + id + '/edit', 'Edit variety', 'btn btn-secondary', 'edit'),
      !v.archivedAt ? link('#/crops/cycle/new/crop/' + v.cropId, 'Plan a cycle', 'btn btn-secondary', 'plus') : null,
      archiveButton(v, 'Variety', C.setVarietyArchived),
      button('Delete', 'btn btn-danger-outline', async () => {
        if (cycles.length) {
          toast('This variety is used by ' + plural(cycles.length, 'production cycle') + ' (archived ones count too), so it cannot be deleted. Archive it instead.', 'error');
          return;
        }
        const ok = await confirmDialog({ title: 'Delete "' + v.name + '"?', message: 'This cannot be undone. Archiving keeps the record instead.', confirmText: 'Delete variety', danger: true });
        if (!ok) return;
        try {
          await C.deleteVariety(id);
          toast('Variety deleted.');
          goto(crop ? '#/crops/crop/' + crop.id : '#/crops/catalogue/varieties', true);
        } catch (e) {
          toast(friendlyError(e), 'error');
        }
      }, 'trash')));
    wrap.appendChild(section('Seed details', null, kvList([
      ['Crop', crop ? anchor('#/crops/crop/' + crop.id, crop.name) : ''],
      ['Supplier', v.supplier],
      ['Seed type', C.optionLabel('seedType', v.seedType) === 'Not specified' ? '' : C.optionLabel('seedType', v.seedType)],
      ['Packet size', v.packetSize],
      ['Quantity purchased', v.quantityPurchased != null ? num(v.quantityPurchased) : ''],
      ['Purchase date', fmtYmd(v.purchaseDate)],
      ['Batch or lot number', v.batchNumber],
      ['Expiry date', fmtYmd(v.expiryDate)],
      ['Seed cost', v.seedCost != null ? num(v.seedCost) + ' ' + v.costCurrency : ''],
      ['Germination', v.germinationPercent != null ? v.germinationPercent + '%' : ''],
      ['Germination notes', pre(v.germinationNotes)],
      ['Notes', pre(v.notes)],
      ['Created', UI.fmtDate(v.createdAt, true)], ['Last changed', UI.fmtDate(v.updatedAt, true)],
    ])));
    wrap.appendChild(section('Used in production cycles (' + cycles.length + ')', 'cycle',
      cycles.length ? h('ul', { class: 'list' }, cycles.map((c) => cycleRow(c, d))) : h('p', { class: 'muted', text: 'This variety is not used in any production cycle yet.' })));
    return wrap;
  }

  /* ================================================================== */
  /* Production cycles: form                                             */
  /* ================================================================== */

  /**
   * Saves a cycle. If it would use more of the field than the field has (together with other crops
   * at the same time), the farmer is told exactly why and may still choose "Save anyway".
   * Returns the saved record, or false if the farmer went back.
   */
  async function saveCycle(existing, input) {
    const run = (opts) => (existing ? C.updateCycle(existing.id, input, opts).then((r) => r.record) : C.createCycle(input, opts));
    try {
      return await run();
    } catch (e) {
      if (!(e instanceof C.OverAllocationError)) throw e;
      const names = e.info.conflicts.map((x) => x.name);
      const ok = await confirmDialog({
        title: 'This field would be over-allocated',
        message: [
          e.message,
          names.length ? 'Crops at the same time: ' + names.join(', ') + '.' : '',
          e.info.open ? 'Some of these cycles have no planting or harvest dates, so they are treated as using the field the whole time. Adding dates can remove this warning.' : '',
          'You can go back and change the area or the dates, or save anyway if you know the plan will work.',
        ].filter(Boolean),
        confirmText: 'Save anyway',
        cancelText: 'Go back',
        danger: true,
      });
      if (!ok) return false;
      return run({ allowOverAllocation: true });
    }
  }

  /** preKind 'field' or 'crop' with preId: start a new cycle for that field or crop. */
  async function viewCycleForm(id, preKind, preId) {
    const d = await load();
    const existing = id ? d.maps.cycles.get(id) : null;
    if (id && !existing) return notFoundView('crop cycle');
    const preField = preKind === 'field' ? d.maps.fields.get(preId) : null;
    const preCrop = preKind === 'crop' ? d.maps.crops.get(preId) : null;
    if (preKind === 'field' && !preField) return notFoundView('field');
    if (preKind === 'crop' && !preCrop) return notFoundView('crop');
    const title = existing ? 'Edit production cycle' : 'New production cycle';
    if (!d.farms.length || !d.fields.length) {
      return h('div', { class: 'stack' }, pageHead(title),
        UI.emptyState(d.farms.length ? 'Add a field first' : 'Add a farm first', 'A production cycle is planted in a field of one of your farms.',
          link(d.farms.length ? '#/farm/' + d.farms[0].id + '/field/new' : '#/farm/new', d.farms.length ? 'Add a field' : 'Create a farm', 'btn btn-primary', 'plus')));
    }
    if (!existing && !d.crops.some((c) => !c.archivedAt)) {
      return h('div', { class: 'stack' }, pageHead(title),
        UI.emptyState('Add a crop first', 'Choose or add the crop you are going to plant, for example Tomato.', link('#/crops/crop/new', 'Add crop', 'btn btn-primary', 'plus')));
    }

    const hasFields = (f) => d.fields.some((x) => x.farmId === f.id);
    const primary = d.farms.find((f) => f.id === d.settings.primaryFarmId) || d.farms[0];
    const startFarm = existing ? existing.farmId : preField ? preField.farmId : hasFields(primary) ? primary.id : d.farms.find(hasFields).id;
    const data = existing || {
      farmId: startFarm, fieldId: preField ? preField.id : '', cropId: preCrop ? preCrop.id : '', varietyId: '', name: '', season: '',
      productionSystem: '', irrigation: '', plantingMethod: preCrop && preCrop.defaultMethod ? preCrop.defaultMethod : 'direct_seeding',
      plannedPlantingDate: '', actualPlantingDate: '', plannedHarvestStart: '', expectedHarvestEnd: '',
      areaValue: '', areaUnit: preField ? preField.areaUnit : 'acres', targetPopulation: '', actualPopulation: '', status: 'planned', notes: '',
    };

    const fieldOptionsFor = (farmId) => [['', 'Choose a field']].concat(d.fields.filter((f) => f.farmId === farmId).sort(byName).map((f) => [f.id, f.name + ' (' + UI.areaText(f) + ')']));
    const cropOptions = [['', 'Choose a crop']].concat(d.crops.filter((c) => !c.archivedAt || (existing && c.id === existing.cropId)).sort(byName).map((c) => [c.id, c.name + (c.archivedAt ? ' (archived)' : '')]));
    const varietyOptionsFor = (cropId, keep) => [['', 'No variety chosen']].concat(d.varieties
      .filter((v) => v.cropId === cropId && (!v.archivedAt || v.id === keep))
      .sort(byName).map((v) => [v.id, v.name + (v.batchNumber ? ' (lot ' + v.batchNumber + ')' : '') + (v.archivedAt ? ' (archived)' : '')]));
    const seasons = Array.from(new Set(d.cycles.map((c) => c.season).filter(Boolean))).sort();

    const F = {
      farmId: formControl({ name: 'farmId', label: 'Farm', type: 'select', required: true, options: d.farms.map((f) => [f.id, f.name]) }, data.farmId),
      fieldId: formControl({ name: 'fieldId', label: 'Field', type: 'select', required: true, options: fieldOptionsFor(data.farmId) }, data.fieldId),
      cropId: formControl({ name: 'cropId', label: 'Crop', type: 'select', required: true, options: cropOptions }, data.cropId),
      varietyId: formControl({ name: 'varietyId', label: 'Variety (optional)', type: 'select', options: varietyOptionsFor(data.cropId, data.varietyId) }, data.varietyId),
      name: formControl({ name: 'name', label: 'Production name', required: true, max: MAXLEN.name, hint: 'A name you will recognise. It is suggested for you, and you can change it.' }, data.name),
      season: formControl({ name: 'season', label: 'Production season (optional)', list: 'season-list', max: 60, hint: 'For example 2026 Season B' }, data.season),
      productionSystem: formControl({ name: 'productionSystem', label: 'Production method', type: 'select', options: OPT.productionSystem }, data.productionSystem),
      irrigation: formControl({ name: 'irrigation', label: 'Water supply', type: 'select', options: OPT.irrigation }, data.irrigation),
      plantingMethod: formControl({ name: 'plantingMethod', label: 'Planting method', type: 'select', required: true, options: OPT.method }, data.plantingMethod),
      areaValue: formControl({ name: 'areaValue', label: 'Cultivated area', required: true, inputmode: 'decimal', max: 17, placeholder: 'e.g. 1.5' }, data.areaValue),
      areaUnit: formControl({ name: 'areaUnit', label: 'Unit', type: 'select', required: true, options: V.OPTIONS.areaUnit }, data.areaUnit),
      targetPopulation: formControl({ name: 'targetPopulation', label: 'Target plant population (planned)', inputmode: 'numeric', max: 13, hint: 'How many plants you plan to grow, for example 3,500' }, data.targetPopulation),
      actualPopulation: formControl({ name: 'actualPopulation', label: 'Actual plant population (counted)', inputmode: 'numeric', max: 13, hint: 'Fill this in after planting, when you know how many plants really went in' }, data.actualPopulation),
      plannedPlantingDate: formControl({ name: 'plannedPlantingDate', label: 'Planned planting date', type: 'date' }, data.plannedPlantingDate),
      actualPlantingDate: formControl({ name: 'actualPlantingDate', label: 'Actual planting date', type: 'date', hint: 'Only after planting has happened' }, data.actualPlantingDate),
      plannedHarvestStart: formControl({ name: 'plannedHarvestStart', label: 'Planned harvest start date', type: 'date' }, data.plannedHarvestStart),
      expectedHarvestEnd: formControl({ name: 'expectedHarvestEnd', label: 'Expected harvest end date', type: 'date' }, data.expectedHarvestEnd),
      status: formControl({ name: 'status', label: 'Production status', type: 'select', required: true, options: OPT.status }, data.status),
      notes: formControl({ name: 'notes', label: 'Notes', type: 'textarea', rows: 4, max: MAXLEN.notes }, data.notes),
    };

    const fieldHint = h('p', { class: 'hint', 'aria-live': 'polite' });
    const varietyNote = h('p', { class: 'hint' });
    const conv = h('p', { class: 'conversion', 'aria-live': 'polite' });
    const allocBox = h('div', { class: 'stack-tight', 'aria-live': 'polite' });
    const currentInput = () => {
      const o = {};
      Object.keys(F).forEach((k) => { o[k] = F[k].el.value; });
      return o;
    };

    let nameTouched = !!(existing && existing.name);
    let methodTouched = !!existing || !!preCrop;
    let unitTouched = !!existing;
    F.name.el.addEventListener('input', () => { nameTouched = F.name.el.value.trim() !== ''; });
    F.plantingMethod.el.addEventListener('change', () => { methodTouched = true; });
    F.areaUnit.el.addEventListener('change', () => { unitTouched = true; });

    function suggest() {
      if (nameTouched) return;
      const crop = d.maps.crops.get(F.cropId.el.value);
      const variety = d.maps.varieties.get(F.varietyId.el.value);
      const field = d.maps.fields.get(F.fieldId.el.value);
      F.name.el.value = C.suggestCycleName({ crop: crop && crop.name, variety: variety && variety.name, field: field && field.name, season: F.season.el.value.trim() });
    }

    function updateConv() {
      const n = units.normalizeInput(F.areaValue.el.value);
      const unit = F.areaUnit.el.value;
      if (n && units.isPositiveWithin(n, 1000000)) {
        const o = units.other(unit);
        conv.textContent = units.group(n) + ' ' + units.label(unit) + ' = ' + units.group(units.fromSqm(units.toSqm(n, unit), o, 4)) + ' ' + units.label(o);
      } else {
        conv.textContent = '';
      }
    }

    /** Live check of the field area while the form is being filled in. */
    function updateAlloc() {
      allocBox.replaceChildren();
      const field = d.maps.fields.get(F.fieldId.el.value);
      if (!field) return;
      const probe = C.validate.cycle(currentInput(), {});
      const v = probe.value;
      if (probe.errors.areaValue || probe.errors.areaUnit || !v.areaSqm) return;
      if (units.cmpSqm(v.areaSqm, field.areaSqm) > 0) {
        allocBox.appendChild(notice('danger', 'Too large.', 'This is more than the whole field (' + areaLine(field) + '). Enter a smaller area.'));
        return;
      }
      const cand = {
        id: existing ? existing.id : 'new-cycle', fieldId: field.id, areaSqm: v.areaSqm, status: v.status, archivedAt: existing ? existing.archivedAt : '',
        plannedPlantingDate: v.plannedPlantingDate, actualPlantingDate: v.actualPlantingDate, plannedHarvestStart: v.plannedHarvestStart, expectedHarvestEnd: v.expectedHarvestEnd,
      };
      const res = C.findOverAllocation(cand, d.cycles, field.areaSqm);
      if (res.exceeds) {
        const names = [F.name.el.value.trim() || 'this cycle'].concat(res.conflicts.map((x) => x.name));
        allocBox.appendChild(notice('warn', 'Over-allocated.',
          'At the busiest time' + (res.atDate ? ' (from ' + fmtYmd(res.atDate) + ')' : '') + ', ' + names.join(', ') + ' would use ' + acres(res.peakSqm, 3) +
          ' acres, but the field is only ' + acres(field.areaSqm, 3) + ' acres.' + (res.open ? ' Some cycles have no dates, so they count as using the field the whole time.' : '')));
        return;
      }
      const pct = Math.round((Number(v.areaSqm) / Number(field.areaSqm)) * 100);
      let text = 'Uses about ' + pct + '% of this field.';
      if (res.conflicts.length) {
        text += ' Other crops at the same time use ' + acres(units.minusSqm(res.peakSqm, v.areaSqm), 3) + ' acres (' + res.conflicts.map((x) => x.name).join(', ') + ').';
      }
      allocBox.appendChild(notice('ok', 'Fits in the field.', text));
    }

    function onFieldChange() {
      const f = d.maps.fields.get(F.fieldId.el.value);
      fieldHint.textContent = f ? 'Field size: ' + areaLine(f) : '';
      if (f && !unitTouched) F.areaUnit.el.value = f.areaUnit;
      updateConv();
      updateAlloc();
      suggest();
    }
    function onCropChange(resetVariety) {
      const crop = d.maps.crops.get(F.cropId.el.value);
      if (resetVariety) fillSelect(F.varietyId.el, varietyOptionsFor(F.cropId.el.value, ''), '');
      if (resetVariety && crop && crop.defaultMethod && !methodTouched) F.plantingMethod.el.value = crop.defaultMethod;
      varietyNote.textContent = crop && !d.varieties.some((v) => v.cropId === crop.id && !v.archivedAt)
        ? 'This crop has no varieties yet. You can add them later from the crop page in the Catalogue.' : '';
      suggest();
    }

    F.farmId.el.addEventListener('change', () => {
      fillSelect(F.fieldId.el, fieldOptionsFor(F.farmId.el.value), '');
      onFieldChange();
    });
    F.fieldId.el.addEventListener('change', onFieldChange);
    F.cropId.el.addEventListener('change', () => onCropChange(true));
    F.varietyId.el.addEventListener('change', suggest);
    F.season.el.addEventListener('input', suggest);
    ['areaValue', 'areaUnit', 'status', 'plannedPlantingDate', 'actualPlantingDate', 'plannedHarvestStart', 'expectedHarvestEnd'].forEach((k) => {
      ['input', 'change'].forEach((ev) => F[k].el.addEventListener(ev, () => {
        if (k === 'areaValue' || k === 'areaUnit') updateConv();
        updateAlloc();
      }));
    });
    onFieldChange();
    onCropChange(false);

    const back = existing ? '#/crops/cycle/' + id : preField ? '#/field/' + preField.id : '#/crops/cycles';
    const form = formPage({
      F,
      fields: [
        group('What and where', [F.farmId.wrap, F.fieldId.wrap, fieldHint, F.cropId.wrap, F.varietyId.wrap, varietyNote, F.name.wrap, F.season.wrap]),
        group('How it is grown', [F.productionSystem.wrap, F.irrigation.wrap, F.plantingMethod.wrap]),
        group('Area and plants', [h('div', { class: 'grid-area' }, F.areaValue.wrap, F.areaUnit.wrap), conv, allocBox, F.targetPopulation.wrap, F.actualPopulation.wrap]),
        group('Dates', [F.plannedPlantingDate.wrap, F.actualPlantingDate.wrap, F.plannedHarvestStart.wrap, F.expectedHarvestEnd.wrap]),
        group('Status and notes', [F.status.wrap, F.notes.wrap]),
        UI.datalist('season-list', seasons),
      ],
      saveText: existing ? 'Save changes' : 'Save production cycle',
      cancelHref: back,
      validate: (input) => C.validate.cycle(input, { strictFuture: true }),
      save: (input) => saveCycle(existing, input),
      savedText: existing ? 'Production cycle saved.' : 'Production cycle saved. Add planting details when you plant.',
      afterHref: (rec) => '#/crops/cycle/' + rec.id,
    });
    return h('div', { class: 'stack' },
      crumb(back, 'Back'),
      pageHead(title, existing ? null : 'Choose where and what you are planting'),
      h('section', { class: 'card' }, form));
  }

  /* ================================================================== */
  /* Production cycles: detail screen (7 sections)                       */
  /* ================================================================== */

  function overlapsWith(c, d) {
    const w = C.cycleWindow(c);
    if (!w) return [];
    return d.cycles.filter((o) => o.id !== c.id && o.fieldId === c.fieldId).filter((o) => {
      const ow = C.cycleWindow(o);
      return ow && ow.start <= w.end && ow.end >= w.start;
    });
  }

  const SEED_UNIT = { seeds: 'seeds', g: 'g', kg: 'kg', packets: 'packets' };
  const seedQty = (v, unit) => (v == null ? '' : num(v) + ' ' + (SEED_UNIT[unit] || unit || ''));

  function batchState(b) {
    if (b.method === 'transplanting') return b.transplantDate ? 'Transplanted' : b.nurseryStartDate ? 'In nursery' : 'Planned';
    return b.plantingDate ? 'Planted' : 'Planned';
  }

  function batchCard(b) {
    const nursery = b.method === 'transplanting';
    const state = batchState(b);
    const parts = [
      pairBlock(nursery ? 'Transplanting date' : 'Planting date', fmtYmd(b.plannedDate), fmtYmd(nursery ? b.transplantDate : b.plantingDate)),
      pairBlock('Seed quantity', seedQty(b.plannedSeedQuantity, b.seedUnit), seedQty(b.seedQuantityUsed, b.seedUnit)),
    ];
    if (nursery) parts.push(pairBlock('Seedlings', num(b.plannedSeedlings), num(b.seedlingsTransplanted)));
    parts.push(pairBlock('Plants', num(b.estimatedPopulation), num(b.actualPopulation)));
    if (nursery && (b.nurseryStartDate || b.nurseryLocation)) {
      parts.push(h('p', { class: 'small', text: 'Nursery' + (b.nurseryStartDate ? ' started ' + fmtYmd(b.nurseryStartDate) : '') + (b.nurseryLocation ? ' at ' + b.nurseryLocation : '') + '.' }));
    }
    return h('div', { class: 'sub-card' },
      h('div', { class: 'sub-card-head' },
        h('div', null, h('div', { class: 'sub-card-title', text: b.name }), h('div', { class: 'small muted', text: C.optionLabel('method', b.method) })),
        h('span', { class: 'chip ' + (state === 'Planned' ? 'cs-planned' : state === 'In nursery' ? 'cs-nursery' : 'cs-planted'), text: state })),
      parts,
      b.notes ? h('p', { class: 'small pre', text: b.notes }) : null,
      link('#/crops/batch/' + b.id + '/edit', 'Edit batch', 'btn btn-secondary btn-small', 'edit'));
  }

  function allocationSection(c, d, farm, field) {
    const nodes = [kvList([
      ['Farm', farm ? anchor('#/farm/' + farm.id, farm.name) : 'Not found'],
      ['Field', field ? anchor('#/field/' + field.id, field.name) : 'Not found'],
      ['Field area', field ? areaLine(field) : ''],
      ['Area used by this cycle', areaLine(c)],
    ])];
    if (!field) return section('2. Farm and field allocation', 'field', nodes);
    if (units.cmpSqm(c.areaSqm, field.areaSqm) > 0) {
      nodes.push(notice('danger', 'Larger than the field.', 'This cycle is bigger than the whole field. Correct the cycle area, or the field size if it was entered wrongly.'));
    }
    const w = C.cycleWindow(c);
    if (!w) {
      nodes.push(h('p', { class: 'muted', text: c.archivedAt ? 'This cycle is archived, so it does not use any of the field area.'
        : c.status === 'cancelled' ? 'This cycle is cancelled, so it does not use any of the field area.'
          : 'This completed cycle has no dates, so it is not counted against the field area.' }));
      return section('2. Farm and field allocation', 'field', nodes);
    }
    const res = C.findOverAllocation(c, d.cycles, field.areaSqm);
    const own = Math.round((Number(c.areaSqm) / Number(field.areaSqm)) * 100);
    const peak = Math.round((Number(res.peakSqm) / Number(field.areaSqm)) * 100);
    nodes.push(progressBar(res.exceeds ? peak : own, res.exceeds, 'Share of the field in use'));
    nodes.push(h('p', { class: 'small', text: 'This cycle uses about ' + own + '% of the field.' + (res.conflicts.length ? ' Together with overlapping crops, up to ' + acres(res.peakSqm, 3) + ' of ' + acres(field.areaSqm, 3) + ' acres (' + peak + '%) is in use.' : '') }));
    if (res.exceeds) {
      nodes.push(notice('warn', 'Over-allocated.', 'At the busiest time' + (res.atDate ? ' (from ' + fmtYmd(res.atDate) + ')' : '') + ', these crops need ' + acres(res.peakSqm, 3) + ' acres but the field has only ' + acres(field.areaSqm, 3) +
        ' acres. Reduce an area or move a date.' + (res.open ? ' Some cycles have no dates, so they count as using the field the whole time.' : '')));
    }
    const others = overlapsWith(c, d);
    nodes.push(h('div', { class: 'section-title', text: 'Other crops in this field at the same time' }));
    nodes.push(others.length ? h('ul', { class: 'list' }, others.map((o) => cycleRow(o, d))) : h('p', { class: 'muted', text: 'None. This cycle has the field to itself.' }));
    return section('2. Farm and field allocation', 'field', nodes);
  }

  function populationSection(c, batches) {
    const nodes = [pairBlock('Plants in this cycle', num(c.targetPopulation), num(c.actualPopulation))];
    const sumOf = (key) => {
      const vals = batches.map((b) => b[key]).filter((x) => x != null);
      return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
    };
    const est = sumOf('estimatedPopulation');
    const act = sumOf('actualPopulation');
    if (batches.length) {
      nodes.push(pairBlock('Total of all planting batches', est != null ? num(est) : '', act != null ? num(act) : ''));
      if (c.targetPopulation != null && est != null && est !== c.targetPopulation) {
        nodes.push(h('p', { class: 'small muted', text: 'The batches add up to ' + num(est) + ' planned plants, but the cycle target is ' + num(c.targetPopulation) + '.' }));
      }
      if (c.actualPopulation != null && act != null && act !== c.actualPopulation) {
        nodes.push(h('p', { class: 'small muted', text: 'The batches add up to ' + num(act) + ' counted plants, but the cycle count is ' + num(c.actualPopulation) + '.' }));
      }
    }
    if (c.targetPopulation) {
      const perAcre = Math.round(c.targetPopulation / (Number(c.areaSqm) / 4046.8564224));
      nodes.push(h('p', { class: 'small', text: 'Target density: about ' + num(perAcre) + ' plants per acre.' }));
    }
    const spaced = batches.filter((b) => b.rowSpacingCm != null || b.plantSpacingCm != null || b.numberOfRows != null);
    nodes.push(h('div', { class: 'section-title', text: 'Spacing' }));
    if (spaced.length) {
      nodes.push(h('ul', { class: 'list' }, spaced.map((b) => h('li', { class: 'pad' },
        h('div', { class: 'row-title', text: b.name }),
        h('div', { class: 'small muted', text: [b.rowSpacingCm != null ? 'Between rows: ' + b.rowSpacingCm + ' cm' : '', b.plantSpacingCm != null ? 'Between plants: ' + b.plantSpacingCm + ' cm' : '', b.numberOfRows != null ? num(b.numberOfRows) + ' rows' : ''].filter(Boolean).join(' · ') })))));
      const guide = spaced.find((b) => b.rowSpacingCm != null && b.plantSpacingCm != null);
      if (guide) {
        const n = C.estimatePopulation(c.areaSqm, guide.rowSpacingCm, guide.plantSpacingCm);
        if (n) nodes.push(h('p', { class: 'small muted', text: 'Rough guide: at ' + guide.rowSpacingCm + ' × ' + guide.plantSpacingCm + ' cm about ' + num(n) + ' plants fit in ' + UI.areaText(c) + ' (paths and borders not counted).' }));
      }
    } else {
      nodes.push(h('p', { class: 'muted', text: 'No spacing recorded yet. Row spacing, plant spacing and number of rows are saved in a planting batch.' }));
    }
    return section('5. Population and spacing', 'seed', nodes);
  }

  function timelineSection(c, d, batches, records) {
    const evs = C.buildEvents({ crops: d.crops, cycles: [Object.assign({}, c, { archivedAt: '', status: 'planned' })], batches, plantings: records });
    const nodes = [];
    nodes.push(h('p', { class: 'small', text: 'Current status: ' + C.optionLabel('status', c.status) + '.' }));
    if (!evs.length) {
      nodes.push(h('p', { class: 'muted', text: 'No dates yet. Add planting and harvest dates with Edit cycle, or add planting batches and records.' }));
      return section('6. Production timeline', 'calendar', nodes);
    }
    const items = [];
    let placed = false;
    evs.forEach((e) => {
      if (!placed && e.date >= d.today) {
        items.push({ today: true });
        placed = true;
      }
      items.push(e);
    });
    if (!placed) items.push({ today: true });
    nodes.push(h('ul', { class: 'timeline' }, items.map((e) => {
      if (e.today) {
        return h('li', null, h('span', { class: 'tl-dot is-today', 'aria-hidden': 'true' }), h('div', null, h('div', { class: 'tl-title', text: 'Today · ' + fmtYmd(d.today) })));
      }
      const range = e.endDate !== e.date ? ' to ' + fmtYmd(e.endDate) : '';
      return h('li', null,
        h('span', { class: 'tl-dot' + (e.kind === 'planned' ? ' is-plan' : e.kind === 'harvest' ? ' is-harvest' : ''), 'aria-hidden': 'true' }),
        h('div', null, h('div', { class: 'tl-title', text: e.title }), h('div', { class: 'small muted', text: fmtYmd(e.date) + range })));
    })));
    return section('6. Production timeline', 'calendar', nodes);
  }

  async function viewCycleDetail(route) {
    const id = route.match[1];
    const d = await load();
    const c = d.maps.cycles.get(id);
    if (!c) return notFoundView('crop cycle');
    const farm = d.maps.farms.get(c.farmId);
    const field = d.maps.fields.get(c.fieldId);
    const crop = d.maps.crops.get(c.cropId);
    const variety = c.varietyId ? d.maps.varieties.get(c.varietyId) : null;
    const batches = d.batches.filter((b) => b.cycleId === id);
    const records = d.plantings.filter((p) => p.cycleId === id).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.createdAt < b.createdAt ? 1 : -1));
    const problem = d.problems.get(id);
    const batchName = new Map(batches.map((b) => [b.id, b.name]));

    const wrap = h('div', { class: 'stack' });
    wrap.appendChild(crumb('#/crops/cycles', 'Cycles'));
    wrap.appendChild(pageHead(c.name, cycleSub(c, d)));
    wrap.appendChild(chips([statusChip(c.status), c.archivedAt ? archivedChip() : null, problem && !c.archivedAt ? overChip() : null]));
    wrap.appendChild(h('div', { class: 'actions' },
      link('#/crops/cycle/' + id + '/edit', 'Edit cycle', 'btn btn-secondary', 'edit'),
      archiveButton(c, 'Production cycle', C.setCycleArchived, 'It is hidden from the active lists and from the field area check, but kept with all its records. You can restore it at any time.'),
      button('Delete', 'btn btn-danger-outline', async () => {
        const extra = [batches.length ? plural(batches.length, 'planting batch', 'planting batches') : '', records.length ? plural(records.length, 'planting record') : ''].filter(Boolean);
        const ok = await confirmDialog({
          title: 'Delete "' + c.name + '" permanently?',
          message: [
            extra.length ? 'This also permanently deletes its ' + extra.join(' and ') + '.' : 'This production cycle has no planting batches or records.',
            'This cannot be undone. If you only want to hide it, choose Archive instead.',
            'Tip: make a backup first.',
          ],
          confirmText: 'Delete permanently',
          danger: true,
          requireText: extra.length ? 'DELETE' : undefined,
        });
        if (!ok) return;
        try {
          await C.deleteCycle(id);
          toast('Production cycle deleted.');
          goto('#/crops/cycles', true);
        } catch (e) {
          toast(friendlyError(e), 'error');
        }
      }, 'trash')));

    // 1. Production overview
    const statusSel = h('select', { 'aria-label': 'Change production status' }, OPT.status.map((o) => h('option', { value: o[0], text: o[1] })));
    statusSel.value = c.status;
    const statusBtn = button('Update status', 'btn btn-primary btn-small', async () => {
      if (statusSel.value === c.status) {
        toast('The status is already "' + C.optionLabel('status', c.status) + '".');
        return;
      }
      statusBtn.disabled = true;
      try {
        const rec = await saveCycle(c, Object.assign({}, c, { status: statusSel.value }));
        if (rec === false) {
          statusBtn.disabled = false;
          statusSel.value = c.status;
          return;
        }
        toast('Status changed to ' + C.optionLabel('status', rec.status) + '.');
        UI.render();
      } catch (e) {
        statusBtn.disabled = false;
        toast(e instanceof AMA.ValidationError ? Object.values(e.errors)[0] : friendlyError(e), 'error');
      }
    });
    wrap.appendChild(section('1. Production overview', 'cycle', [
      kvList([
        ['Status', statusChip(c.status)],
        ['Season', c.season],
        ['Production method', C.optionLabel('productionSystem', c.productionSystem) === 'Not specified' ? '' : C.optionLabel('productionSystem', c.productionSystem)],
        ['Water supply', C.optionLabel('irrigation', c.irrigation) === 'Not specified' ? '' : C.optionLabel('irrigation', c.irrigation)],
        ['Cultivated area', areaLine(c)],
        ['Target plants', c.targetPopulation != null ? num(c.targetPopulation) : ''],
        ['Actual plants', c.actualPopulation != null ? num(c.actualPopulation) : ''],
        ['Cycle ID', h('span', { class: 'small', text: c.id })],
      ]),
      problem && !c.archivedAt ? notice('warn', 'Field area warning.', 'This cycle is part of an over-allocation of its field. See section 2 below.') : null,
      h('div', { class: 'stack-tight' }, h('div', { class: 'small muted', text: 'Change status' }), h('div', { class: 'grid-area' }, statusSel, statusBtn)),
    ]));

    // 2. Farm and field allocation
    wrap.appendChild(allocationSection(c, d, farm, field));

    // 3. Crop and variety
    wrap.appendChild(section('3. Crop and variety', 'crops', kvList([
      ['Crop', crop ? anchor('#/crops/crop/' + crop.id, crop.name) : 'Not found'],
      ['Category', crop ? C.optionLabel('category', crop.category) : ''],
      ['Variety', variety ? anchor('#/crops/variety/' + variety.id, variety.name) : 'No variety chosen'],
      ['Seed supplier', variety ? variety.supplier : ''],
      ['Seed type', variety && variety.seedType ? C.optionLabel('seedType', variety.seedType) : ''],
      ['Batch or lot number', variety ? variety.batchNumber : ''],
      ['Seed expiry', variety && variety.expiryDate ? fmtYmd(variety.expiryDate) : ''],
      ['Germination', variety && variety.germinationPercent != null ? variety.germinationPercent + '%' : ''],
    ])));

    // 4. Planting information
    wrap.appendChild(section('4. Planting information', 'seed', [
      kvList([
        ['Planting method', C.optionLabel('method', c.plantingMethod)],
        ['Planned planting date', fmtYmd(c.plannedPlantingDate)],
        ['Actual planting date', fmtYmd(c.actualPlantingDate)],
        ['Planned harvest start', fmtYmd(c.plannedHarvestStart)],
        ['Expected harvest end', fmtYmd(c.expectedHarvestEnd)],
      ]),
      h('div', { class: 'section-title', text: 'Planting batches (' + batches.length + ')' }),
      batches.length ? batches.map(batchCard) : h('p', { class: 'muted', text: 'No planting batches yet. Add one to record seed used, nursery work, transplanting and spacing, with planned and actual numbers side by side.' }),
      link('#/crops/cycle/' + id + '/batch/new', 'Add planting batch', 'btn btn-primary btn-small', 'plus'),
    ]));

    // 5. Population and spacing
    wrap.appendChild(populationSection(c, batches));

    // 6. Production timeline
    wrap.appendChild(timelineSection(c, d, batches, records));

    // 7. Notes and records
    wrap.appendChild(section('7. Notes and records', 'records', [
      c.notes ? kvList([['Notes', pre(c.notes)]]) : h('p', { class: 'muted', text: 'No notes yet. Add notes with Edit cycle.' }),
      h('div', { class: 'section-title', text: 'Planting records (' + records.length + ')' }),
      records.length
        ? h('ul', { class: 'list' }, records.map((p) => row('#/crops/record/' + p.id + '/edit', C.optionLabel('recordType', p.type) + ' · ' + fmtYmd(p.date),
          [[p.quantity != null ? num(p.quantity) + ' ' + C.optionLabel('recordUnit', p.quantityUnit).toLowerCase().replace(/ \(.*\)$/, '') : '', p.batchId && batchName.get(p.batchId) ? batchName.get(p.batchId) : '', p.location].filter(Boolean).join(' · '), p.notes])))
        : h('p', { class: 'muted', text: 'No planting records yet. A record is one dated entry, such as "Transplanted 1,200 seedlings".' }),
      link('#/crops/cycle/' + id + '/record/new', 'Add planting record', 'btn btn-primary btn-small', 'plus'),
      kvList([['Created', UI.fmtDate(c.createdAt, true)], ['Last changed', UI.fmtDate(c.updatedAt, true)]]),
    ]));
    return wrap;
  }

  /* ================================================================== */
  /* Planting batches                                                    */
  /* ================================================================== */

  async function viewBatchForm(id, cycleIdFromRoute) {
    const d = await load();
    const existing = id ? d.maps.batches.get(id) : null;
    if (id && !existing) return notFoundView('planting batch');
    const cycle = d.maps.cycles.get(existing ? existing.cycleId : cycleIdFromRoute);
    if (!cycle) return notFoundView('crop cycle');
    const siblings = d.batches.filter((b) => b.cycleId === cycle.id);
    const data = existing || {
      name: 'Batch ' + (siblings.length + 1), method: cycle.plantingMethod, plannedDate: cycle.plannedPlantingDate || '', plantingDate: '', nurseryStartDate: '', nurseryLocation: '',
      transplantDate: '', seedUnit: 'seeds', plannedSeedQuantity: '', seedQuantityUsed: '', plannedSeedlings: '', seedlingsTransplanted: '', rowSpacingCm: '', plantSpacingCm: '',
      numberOfRows: '', estimatedPopulation: '', actualPopulation: '', notes: '',
    };
    const F = {
      name: formControl({ name: 'name', label: 'Batch name', required: true, max: 60, hint: 'For example Batch 1, or the date you sowed it' }, data.name),
      method: formControl({ name: 'method', label: 'Planting method', type: 'select', required: true, options: OPT.method }, data.method),
      seedUnit: formControl({ name: 'seedUnit', label: 'Seed quantity is counted in', type: 'select', options: OPT.seedUnit }, data.seedUnit),
      plannedDate: formControl({ name: 'plannedDate', label: 'Planned date', type: 'date' }, data.plannedDate),
      plannedSeedQuantity: formControl({ name: 'plannedSeedQuantity', label: 'Planned seed quantity', inputmode: 'decimal', max: 18 }, data.plannedSeedQuantity),
      plannedSeedlings: formControl({ name: 'plannedSeedlings', label: 'Planned seedlings to transplant', inputmode: 'numeric', max: 13 }, data.plannedSeedlings),
      estimatedPopulation: formControl({ name: 'estimatedPopulation', label: 'Estimated plant population', inputmode: 'numeric', max: 13 }, data.estimatedPopulation),
      nurseryStartDate: formControl({ name: 'nurseryStartDate', label: 'Nursery start date', type: 'date' }, data.nurseryStartDate),
      nurseryLocation: formControl({ name: 'nurseryLocation', label: 'Nursery location', max: 120, hint: 'For example behind the store, or Nursery bed 2' }, data.nurseryLocation),
      plantingDate: formControl({ name: 'plantingDate', label: 'Actual planting date', type: 'date', hint: 'Only after planting has happened' }, data.plantingDate),
      transplantDate: formControl({ name: 'transplantDate', label: 'Actual transplanting date', type: 'date' }, data.transplantDate),
      seedQuantityUsed: formControl({ name: 'seedQuantityUsed', label: 'Seed quantity actually used', inputmode: 'decimal', max: 18 }, data.seedQuantityUsed),
      seedlingsTransplanted: formControl({ name: 'seedlingsTransplanted', label: 'Seedlings actually transplanted', inputmode: 'numeric', max: 13 }, data.seedlingsTransplanted),
      actualPopulation: formControl({ name: 'actualPopulation', label: 'Actual plant population (counted)', inputmode: 'numeric', max: 13 }, data.actualPopulation),
      rowSpacingCm: formControl({ name: 'rowSpacingCm', label: 'Row spacing (cm)', inputmode: 'decimal', max: 7, hint: 'Distance between rows' }, data.rowSpacingCm),
      plantSpacingCm: formControl({ name: 'plantSpacingCm', label: 'Plant spacing (cm)', inputmode: 'decimal', max: 7, hint: 'Distance between plants in a row' }, data.plantSpacingCm),
      numberOfRows: formControl({ name: 'numberOfRows', label: 'Number of rows', inputmode: 'numeric', max: 7 }, data.numberOfRows),
      notes: formControl({ name: 'notes', label: 'Notes', type: 'textarea', rows: 4, max: MAXLEN.notes }, data.notes),
    };

    const estLine = h('p', { class: 'hint', 'aria-live': 'polite' });
    let estNow = null;
    const useBtn = button('Use as estimated plants', 'btn btn-secondary btn-small', () => {
      if (estNow) F.estimatedPopulation.el.value = String(estNow);
    });
    useBtn.hidden = true;
    function updateEst() {
      estNow = C.estimatePopulation(cycle.areaSqm, F.rowSpacingCm.el.value, F.plantSpacingCm.el.value);
      if (estNow) {
        estLine.textContent = 'If the whole cycle area (' + UI.areaText(cycle) + ') were planted at this spacing, about ' + num(estNow) + ' plants would fit. Paths and borders are not counted.';
        useBtn.hidden = false;
      } else {
        estLine.textContent = 'Enter row spacing and plant spacing to see a rough plant count for the cycle area.';
        useBtn.hidden = true;
      }
    }
    F.rowSpacingCm.el.addEventListener('input', updateEst);
    F.plantSpacingCm.el.addEventListener('input', updateEst);
    updateEst();

    const nurseryGroup = group('Nursery', [F.nurseryStartDate.wrap, F.nurseryLocation.wrap]);
    const nurseryOnly = [F.plannedSeedlings.wrap, nurseryGroup, F.transplantDate.wrap, F.seedlingsTransplanted.wrap];
    const directOnly = [F.plantingDate.wrap];
    const sync = () => {
      const nursery = F.method.el.value === 'transplanting';
      nurseryOnly.forEach((el) => { el.hidden = !nursery; });
      directOnly.forEach((el) => { el.hidden = nursery; });
    };
    F.method.el.addEventListener('change', sync);
    sync();

    const back = '#/crops/cycle/' + cycle.id;
    const form = formPage({
      F,
      fields: [
        h('p', { class: 'small muted', text: 'For production cycle: ' + cycle.name }),
        F.name.wrap, F.method.wrap, F.seedUnit.wrap,
        group('Planned (what you intend to do)', [F.plannedDate.wrap, F.plannedSeedQuantity.wrap, F.plannedSeedlings.wrap, F.estimatedPopulation.wrap]),
        nurseryGroup,
        group('Actual (what really happened)', [F.plantingDate.wrap, F.transplantDate.wrap, F.seedQuantityUsed.wrap, F.seedlingsTransplanted.wrap, F.actualPopulation.wrap]),
        group('Spacing', [h('div', { class: 'grid-2' }, F.rowSpacingCm.wrap, F.plantSpacingCm.wrap), F.numberOfRows.wrap, estLine, useBtn]),
        F.notes.wrap,
      ],
      extra: () => ({ cycleId: cycle.id }),
      saveText: existing ? 'Save changes' : 'Save planting batch',
      cancelHref: back,
      validate: (input) => C.validate.batch(input, { strictFuture: true }),
      save: async (input) => (existing ? (await C.updateBatch(id, input)).record : C.createBatch(input)),
      savedText: existing ? 'Planting batch saved.' : 'Planting batch saved.',
      afterHref: () => back,
    });
    const wrap = h('div', { class: 'stack' },
      crumb(back, 'Back'),
      pageHead(existing ? 'Edit planting batch' : 'New planting batch', 'Planned and actual numbers are kept apart'),
      h('section', { class: 'card' }, form));
    if (existing) {
      wrap.appendChild(h('section', { class: 'card card-danger' },
        h('h2', { class: 'card-title', text: 'Delete this batch' }),
        h('p', { class: 'muted', text: 'Planting records that mention this batch are kept, but they will no longer be linked to it.' }),
        button('Delete batch', 'btn btn-danger-outline', async () => {
          const ok = await confirmDialog({ title: 'Delete "' + existing.name + '"?', message: 'This cannot be undone.', confirmText: 'Delete batch', danger: true });
          if (!ok) return;
          try {
            await C.deleteBatch(id);
            toast('Planting batch deleted.');
            goto(back, true);
          } catch (e) {
            toast(friendlyError(e), 'error');
          }
        }, 'trash')));
    }
    return wrap;
  }

  /* ================================================================== */
  /* Planting records                                                    */
  /* ================================================================== */

  const UNIT_FOR = { seeding: 'seeds', nursery_sowing: 'seeds', transplanting: 'seedlings', gap_filling: 'seedlings', other: '' };

  async function viewPlantingForm(id, cycleIdFromRoute) {
    const d = await load();
    const existing = id ? d.maps.plantings.get(id) : null;
    if (id && !existing) return notFoundView('planting record');
    const cycle = d.maps.cycles.get(existing ? existing.cycleId : cycleIdFromRoute);
    if (!cycle) return notFoundView('crop cycle');
    const batches = d.batches.filter((b) => b.cycleId === cycle.id);
    const firstType = cycle.plantingMethod === 'transplanting' ? 'transplanting' : 'seeding';
    const data = existing || { type: firstType, date: d.today, quantity: '', quantityUnit: UNIT_FOR[firstType], batchId: '', location: '', notes: '' };
    const F = {
      type: formControl({ name: 'type', label: 'What was done', type: 'select', required: true, options: OPT.recordType }, data.type),
      date: formControl({ name: 'date', label: 'Date', type: 'date', required: true }, data.date),
      quantity: formControl({ name: 'quantity', label: 'Quantity (optional)', inputmode: 'decimal', max: 18 }, data.quantity),
      quantityUnit: formControl({ name: 'quantityUnit', label: 'Counted in', type: 'select', options: [['', 'Choose']].concat(OPT.recordUnit) }, data.quantityUnit),
      batchId: formControl({ name: 'batchId', label: 'Planting batch (optional)', type: 'select', options: [['', 'Not linked to a batch']].concat(batches.map((b) => [b.id, b.name])) }, data.batchId),
      location: formControl({ name: 'location', label: 'Location (optional)', max: 120 }, data.location),
      notes: formControl({ name: 'notes', label: 'Notes', type: 'textarea', rows: 4, max: MAXLEN.text }, data.notes),
    };
    let unitTouched = !!existing;
    F.quantityUnit.el.addEventListener('change', () => { unitTouched = true; });
    F.type.el.addEventListener('change', () => {
      if (!unitTouched) F.quantityUnit.el.value = UNIT_FOR[F.type.el.value] || '';
    });
    const back = '#/crops/cycle/' + cycle.id;
    const form = formPage({
      F,
      fields: [
        h('p', { class: 'small muted', text: 'For production cycle: ' + cycle.name }),
        F.type.wrap, F.date.wrap, h('div', { class: 'grid-area' }, F.quantity.wrap, F.quantityUnit.wrap), F.batchId.wrap, F.location.wrap, F.notes.wrap,
      ],
      extra: () => ({ cycleId: cycle.id }),
      saveText: existing ? 'Save changes' : 'Save planting record',
      cancelHref: back,
      validate: (input) => C.validate.planting(input, { strictFuture: true }),
      save: async (input) => (existing ? (await C.updatePlanting(id, input)).record : C.createPlanting(input)),
      savedText: 'Planting record saved.',
      afterHref: () => back,
    });
    const wrap = h('div', { class: 'stack' },
      crumb(back, 'Back'),
      pageHead(existing ? 'Edit planting record' : 'New planting record', 'One dated entry of planting work already done'),
      h('section', { class: 'card' }, form));
    if (existing) {
      wrap.appendChild(h('section', { class: 'card card-danger' },
        h('h2', { class: 'card-title', text: 'Delete this record' }),
        button('Delete record', 'btn btn-danger-outline', async () => {
          const ok = await confirmDialog({ title: 'Delete this planting record?', message: 'This cannot be undone.', confirmText: 'Delete record', danger: true });
          if (!ok) return;
          try {
            await C.deletePlanting(id);
            toast('Planting record deleted.');
            goto(back, true);
          } catch (e) {
            toast(friendlyError(e), 'error');
          }
        }, 'trash')));
    }
    return wrap;
  }

  /* ================================================================== */
  /* Hooks into the Home screen and the field page                       */
  /* ================================================================== */

  async function dashboardCard() {
    const d = await load();
    if (!d.farms.length) return null;
    const sum = C.summarise(d, d.today);
    const card = h('section', { class: 'card' }, h('h2', { class: 'card-title' }, icon('crops'), 'Crop production'));
    if (!d.cycles.length) {
      const ready = d.crops.length && d.fields.length;
      card.appendChild(h('p', { class: 'muted', text: ready ? 'No production cycles yet. Plan the first one for a field.' : 'Record the crops you grow, then plan a production cycle for a field.' }));
      card.appendChild(link(ready ? '#/crops/cycle/new' : '#/crops', ready ? 'Plan a production cycle' : 'Open crop production', 'btn btn-primary', 'crops'));
      return card;
    }
    const next = sum.upcoming[0];
    card.appendChild(kvList([
      ['Active cycles', String(sum.activeCycles)],
      ['Crops being cultivated', String(sum.cropsInProduction)],
      ['Cultivated area', acres(sum.areaSqm, 2) + ' acres'],
      ['Growing / harvesting', sum.growing.length + ' / ' + sum.harvesting.length],
      ['Next planting', next ? next.cycle.name + ' · ' + fmtYmd(next.date) + (next.overdue ? ' (overdue)' : '') : 'None planned'],
    ]));
    if (d.problems.size) card.appendChild(notice('warn', 'Field area warning.', 'Some crops overlap and use more area than their field has. Open Crops to see which.'));
    card.appendChild(link('#/crops', 'Open crop production', 'btn btn-secondary', 'chevron'));
    return card;
  }

  async function fieldSection(field) {
    const d = await load();
    const cycles = d.cycles.filter((c) => c.fieldId === field.id && !c.archivedAt && c.status !== 'cancelled')
      .sort((a, b) => ((a.actualPlantingDate || a.plannedPlantingDate || '9999') < (b.actualPlantingDate || b.plannedPlantingDate || '9999') ? -1 : 1));
    const inUse = units.sumSqm(cycles.filter(C.isInProgress).map((c) => c.areaSqm));
    const nodes = [];
    if (cycles.length) {
      const pct = Math.round((Number(inUse) / Number(field.areaSqm)) * 100);
      nodes.push(h('p', { class: 'small', text: 'In use now (past "Planned"): ' + acres(inUse, 3) + ' of ' + acres(field.areaSqm, 3) + ' acres (' + pct + '%).' }));
      nodes.push(progressBar(pct, pct > 100, 'Share of the field in use now'));
      nodes.push(h('ul', { class: 'list' }, cycles.map((c) => cycleRow(c, d))));
    } else {
      nodes.push(h('p', { class: 'muted', text: 'No crops planned or planted in this field yet.' }));
    }
    const canPlan = d.crops.some((c) => !c.archivedAt);
    nodes.push(link(canPlan ? '#/crops/cycle/new/field/' + field.id : '#/crops/crop/new', canPlan ? 'Plan a crop here' : 'Add a crop first', 'btn btn-primary btn-small', 'plus'));
    return section('Crops in this field (' + cycles.length + ')', 'crops', nodes);
  }

  /* ================================================================== */
  /* Routes                                                              */
  /* ================================================================== */

  const rx = (path) => new RegExp('^' + path + '$', 'i');
  const ROUTES = [
    [rx('/crops/?'), 'crops', 'cropsOverview'],
    [rx('/crops/cycles/?'), 'crops', 'cropsCycles'],
    [rx('/crops/catalogue(?:/(crops|varieties))?/?'), 'crops', 'cropsCatalogue'],
    [rx('/crops/calendar(?:/(past))?/?'), 'crops', 'cropsCalendar'],
    [rx('/crops/crop/new/?'), 'crops', 'cropNew'],
    [rx('/crops/crop/' + UUID + '/?'), 'crops', 'cropDetail'],
    [rx('/crops/crop/' + UUID + '/edit/?'), 'crops', 'cropEdit'],
    [rx('/crops/crop/' + UUID + '/variety/new/?'), 'crops', 'varietyNewForCrop'],
    [rx('/crops/variety/new/?'), 'crops', 'varietyNew'],
    [rx('/crops/variety/' + UUID + '/?'), 'crops', 'varietyDetail'],
    [rx('/crops/variety/' + UUID + '/edit/?'), 'crops', 'varietyEdit'],
    [rx('/crops/cycle/new(?:/(field|crop)/' + UUID + ')?/?'), 'crops', 'cycleNew'],
    [rx('/crops/cycle/' + UUID + '/?'), 'crops', 'cycleDetail'],
    [rx('/crops/cycle/' + UUID + '/edit/?'), 'crops', 'cycleEdit'],
    [rx('/crops/cycle/' + UUID + '/batch/new/?'), 'crops', 'batchNew'],
    [rx('/crops/batch/' + UUID + '/edit/?'), 'crops', 'batchEdit'],
    [rx('/crops/cycle/' + UUID + '/record/new/?'), 'crops', 'recordNew'],
    [rx('/crops/record/' + UUID + '/edit/?'), 'crops', 'recordEdit'],
  ];

  const VIEWS = {
    cropsOverview: viewOverview,
    cropsCycles: viewCycles,
    cropsCatalogue: viewCatalogue,
    cropsCalendar: viewCalendar,
    cropNew: () => viewCropForm(null),
    cropDetail: viewCropDetail,
    cropEdit: (r) => viewCropForm(r.match[1]),
    varietyNew: () => viewVarietyForm(null, null),
    varietyNewForCrop: (r) => viewVarietyForm(null, r.match[1]),
    varietyDetail: viewVarietyDetail,
    varietyEdit: (r) => viewVarietyForm(r.match[1], null),
    cycleNew: (r) => viewCycleForm(null, r.match[1], r.match[2]),
    cycleDetail: viewCycleDetail,
    cycleEdit: (r) => viewCycleForm(r.match[1], null, null),
    batchNew: (r) => viewBatchForm(null, r.match[1]),
    batchEdit: (r) => viewBatchForm(r.match[1], null),
    recordNew: (r) => viewPlantingForm(null, r.match[1]),
    recordEdit: (r) => viewPlantingForm(r.match[1], null),
  };

  UI.addRoutes(ROUTES, VIEWS);
  AMA.cropsUi = { dashboardCard, fieldSection };
})(window);
