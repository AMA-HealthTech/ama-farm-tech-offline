/*!
 * AMA FarmTech Offline - app.js
 * Ama Farms Ltd
 *
 * User interface, routing, service worker registration and storage status.
 * All user data is drawn with textContent / DOM nodes (never innerHTML), so
 * text typed by a person or read from a backup file can never run as code.
 */
(function () {
  'use strict';

  const AMA = window.AMA;
  const db = AMA.db;
  const U = AMA.util;
  const units = AMA.units;
  const V = AMA.validate;
  const B = AMA.backup;
  const OPT = V.OPTIONS;

  /* ================================================================== */
  /* DOM helpers                                                         */
  /* ================================================================== */

  const $ = (sel, root) => (root || document).querySelector(sel);

  function append(el, child) {
    if (child == null || child === false) return;
    if (Array.isArray(child)) {
      child.forEach((c) => append(el, c));
    } else if (child instanceof Node) {
      el.appendChild(child);
    } else {
      el.appendChild(document.createTextNode(String(child)));
    }
  }

  /** h('div', {class: 'x', onclick: fn, text: 'plain text'}, child, child...) */
  function h(tag, attrs) {
    const el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        const v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v);
        else if (/^on/i.test(k) || k === 'style' || k === 'srcdoc') return; // never allow inline code or styles
        else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled' || k === 'hidden' || k === 'required') el[k] = v === true ? true : v;
        else el.setAttribute(k, v === true ? '' : String(v));
      });
    }
    for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ICONS = {
    home: 'M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10M10 19.5v-5h4v5',
    farm: 'M12 21v-8M12 13c0-4 2.5-6.5 7-6.5 0 4.5-2.5 6.5-7 6.5zM12 15c0-3-2-5-6-5 0 3.5 2 5 6 5z',
    records: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
    backup: 'M4 7h16v4H4zM5.5 11v8h13v-8M10 15h4',
    settings: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6',
    field: 'M3 5h18v14H3zM3 10h18M3 15h18M9 5v14',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    warn: 'M12 4 2.5 20h19zM12 10v5M12 17.5h.01',
    info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01',
    plus: 'M12 5v14M5 12h14',
    chevron: 'M9 6l6 6-6 6',
    database: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
    wifi: 'M2.5 9a15 15 0 0 1 19 0M5.5 12.5a10.5 10.5 0 0 1 13 0M8.7 16a6 6 0 0 1 6.6 0M12 19.5h.01',
    download: 'M12 4v11M7.5 11 12 15.5 16.5 11M5 20h14',
    upload: 'M12 16V5M7.5 9 12 4.5 16.5 9M5 20h14',
    share: 'M12 15V4M8 8l4-4 4 4M6 12v8h12v-8',
    trash: 'M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13M10 11v6M14 11v6',
    edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
    lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
    install: 'M12 3v11M7.5 10 12 14.5 16.5 10M4 15v5h16v-5',
  };

  function icon(name, cls) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'icon' + (cls ? ' ' + cls : ''));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', ICONS[name] || ICONS.info);
    svg.appendChild(p);
    return svg;
  }

  let uidCounter = 0;
  const uid = (p) => (p || 'id') + '-' + ++uidCounter;

  /* ================================================================== */
  /* Formatting                                                          */
  /* ================================================================== */

  let settings = Object.assign({}, V.DEFAULT_SETTINGS);

  function fmtDate(iso, withTime) {
    if (!iso) return '';
    const opts = { day: 'numeric', month: 'short', year: 'numeric' };
    if (withTime) {
      opts.hour = '2-digit';
      opts.minute = '2-digit';
      opts.hourCycle = 'h23';
    }
    try {
      return new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: settings.defaultTimezone }, opts)).format(new Date(iso));
    } catch (e) {
      return new Date(iso).toLocaleString('en-GB', opts);
    }
  }

  function fmtRelative(iso) {
    const ms = Date.now() - Date.parse(iso);
    if (!isFinite(ms)) return '';
    if (ms < 0 || ms < 60000) return 'just now';
    const m = Math.floor(ms / 60000);
    if (m < 60) return m + (m === 1 ? ' minute ago' : ' minutes ago');
    const hr = Math.floor(m / 60);
    if (hr < 24) return hr + (hr === 1 ? ' hour ago' : ' hours ago');
    const d = Math.floor(hr / 24);
    if (d < 60) return d + (d === 1 ? ' day ago' : ' days ago');
    return fmtDate(iso);
  }

  function fmtBytes(n) {
    if (typeof n !== 'number' || !isFinite(n)) return 'unknown';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }

  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');

  function locationLine(farm) {
    return [farm.location, farm.district, farm.region, farm.country].filter(Boolean).join(', ');
  }

  function areaText(field) {
    return units.group(field.areaValue) + ' ' + units.label(field.areaUnit);
  }

  /* ================================================================== */
  /* UI primitives: toast, banners, dialogs                              */
  /* ================================================================== */

  let toastTimer = null;
  function toast(message, kind) {
    const el = $('#toast');
    el.textContent = message;
    el.className = 'toast show' + (kind ? ' toast-' + kind : '');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => el.classList.remove('show'), kind === 'error' ? 8000 : 3800);
  }

  function setBanner(id, node) {
    const host = $('#banners');
    const old = host.querySelector('[data-banner="' + id + '"]');
    if (old) old.remove();
    if (node) {
      node.setAttribute('data-banner', id);
      host.appendChild(node);
    }
  }

  function confirmDialog(o) {
    return new Promise((resolve) => {
      let result = false;
      const titleId = uid('dlg');
      const dlg = h('dialog', { class: 'dialog', 'aria-labelledby': titleId });
      let input = null;
      const okBtn = h('button', {
        class: 'btn ' + (o.danger ? 'btn-danger' : 'btn-primary'),
        type: 'button',
        text: o.confirmText || 'Confirm',
        disabled: !!o.requireText,
        onclick() {
          result = true;
          dlg.close();
        },
      });
      const cancelBtn = h('button', { class: 'btn btn-secondary', type: 'button', text: o.cancelText || 'Cancel', onclick: () => dlg.close() });
      if (o.requireText) {
        input = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'characters', 'aria-label': 'Type ' + o.requireText + ' to confirm', class: 'dialog-input' });
        input.addEventListener('input', () => {
          okBtn.disabled = input.value.trim().toUpperCase() !== o.requireText;
        });
      }
      dlg.appendChild(h('h2', { id: titleId, class: 'dialog-title', text: o.title }));
      (Array.isArray(o.message) ? o.message : [o.message]).forEach((m) => dlg.appendChild(h('p', { class: 'dialog-text', text: m })));
      if (o.requireText) {
        dlg.appendChild(h('p', { class: 'dialog-text' }, 'Type ', h('strong', { text: o.requireText }), ' to continue:'));
        dlg.appendChild(input);
      }
      dlg.appendChild(h('div', { class: 'dialog-actions' }, cancelBtn, okBtn));
      dlg.addEventListener('close', () => {
        dlg.remove();
        resolve(result);
      });
      document.body.appendChild(dlg);
      dlg.showModal();
      (input || cancelBtn).focus();
    });
  }

  function emptyState(title, text, actions) {
    return h('div', { class: 'card empty' },
      h('div', { class: 'empty-icon' }, icon('farm')),
      h('h2', { class: 'card-title', text: title }),
      h('p', { class: 'muted', text: text }),
      actions || null);
  }

  function notice(kind, title, text) {
    return h('div', { class: 'notice notice-' + kind, role: kind === 'danger' ? 'alert' : null },
      icon(kind === 'ok' ? 'check' : kind === 'info' ? 'info' : 'warn'),
      h('div', null, title ? h('strong', { text: title }) : null, title && text ? ' ' : null, text ? h('span', { text: text }) : null));
  }

  function pageHead(title, sub, actions) {
    return h('div', { class: 'page-head' },
      h('div', { class: 'page-head-text' }, h('h1', { class: 'page-title', tabindex: '-1', text: title }), sub ? h('p', { class: 'muted', text: sub }) : null),
      actions || null);
  }

  function link(href, text, cls, iconName) {
    return h('a', { href, class: cls || 'btn btn-secondary' }, iconName ? icon(iconName) : null, h('span', { text }));
  }

  function button(text, cls, onclick, iconName, extra) {
    return h('button', Object.assign({ type: 'button', class: cls || 'btn btn-secondary', onclick }, extra || {}), iconName ? icon(iconName) : null, h('span', { text }));
  }

  function kvList(rows) {
    const dl = h('dl', { class: 'kv' });
    rows.forEach(([k, v]) => {
      if (v == null || v === '') return;
      dl.appendChild(h('div', { class: 'kv-row' }, h('dt', { text: k }), h('dd', null, v instanceof Node ? v : String(v))));
    });
    return dl;
  }

  function friendlyError(e) {
    const err = db.normalizeError(e);
    return err.message;
  }

  /* ================================================================== */
  /* Forms                                                               */
  /* ================================================================== */

  /** Build a labelled control. Returns {wrap, el, setError}. */
  function formControl(spec, value) {
    const id = uid('f');
    const errId = id + '-err';
    let el;
    if (spec.type === 'textarea') {
      el = h('textarea', { id, name: spec.name, rows: spec.rows || 3, maxlength: spec.max });
    } else if (spec.type === 'select') {
      el = h('select', { id, name: spec.name });
      spec.options.forEach((o) => el.appendChild(h('option', { value: o[0], text: o[1] })));
    } else {
      el = h('input', {
        id,
        name: spec.name,
        type: spec.type || 'text',
        maxlength: spec.max,
        inputmode: spec.inputmode,
        autocomplete: 'off',
        autocapitalize: spec.capitalize || 'sentences',
        list: spec.list,
        placeholder: spec.placeholder,
      });
    }
    el.value = value == null ? '' : value;
    el.setAttribute('aria-describedby', errId);
    const err = h('p', { class: 'field-error', id: errId, role: 'alert', hidden: true });
    const wrap = h('div', { class: 'field' + (spec.cls ? ' ' + spec.cls : '') },
      h('label', { for: id }, spec.label, spec.required ? h('span', { class: 'req', text: ' *' }) : null),
      el,
      spec.hint ? h('p', { class: 'hint', text: spec.hint }) : null,
      err);
    return {
      wrap,
      el,
      setError(msg) {
        err.hidden = !msg;
        err.textContent = msg || '';
        if (msg) el.setAttribute('aria-invalid', 'true');
        else el.removeAttribute('aria-invalid');
      },
    };
  }

  function applyErrors(controls, errors, formError) {
    let first = null;
    Object.keys(controls).forEach((k) => {
      const msg = errors[k];
      controls[k].setError(msg || '');
      if (msg && !first) first = controls[k].el;
    });
    if (first) first.focus();
    else if (formError) toast(formError, 'error');
  }

  function datalist(id, values) {
    return h('datalist', { id }, values.map((v) => h('option', { value: v })));
  }

  /* ================================================================== */
  /* Browser storage status                                              */
  /* ================================================================== */

  async function storageInfo() {
    const out = { supported: !!(navigator.storage && navigator.storage.persist), persisted: null, usage: null, quota: null };
    try {
      if (navigator.storage && navigator.storage.persisted) out.persisted = await navigator.storage.persisted();
    } catch (e) { /* unsupported */ }
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        out.usage = typeof est.usage === 'number' ? est.usage : null;
        out.quota = typeof est.quota === 'number' ? est.quota : null;
      }
    } catch (e) { /* unsupported */ }
    return out;
  }

  async function requestPersistence() {
    if (!navigator.storage || !navigator.storage.persist) return null;
    try {
      return await navigator.storage.persist();
    } catch (e) {
      return false;
    }
  }

  function persistenceText(info) {
    if (!info.supported) return { kind: 'warn', title: 'Not available', text: 'This browser cannot protect storage. Back up often.' };
    if (info.persisted) return { kind: 'ok', title: 'Protected', text: 'Chrome has agreed not to clear this data automatically when the phone runs low on space.' };
    return { kind: 'warn', title: 'Not protected', text: 'Chrome may clear this data if the phone runs very low on space. Install the app to the home screen and back up regularly.' };
  }

  function usageBar(info) {
    if (info.usage == null || !info.quota) return null;
    const pct = Math.max(0.5, Math.min(100, (info.usage / info.quota) * 100));
    const bar = h('div', { class: 'bar', role: 'img', 'aria-label': 'Storage used by this app: ' + fmtBytes(info.usage) });
    const fill = h('div', { class: 'bar-fill' });
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    return h('div', null, bar, h('p', { class: 'small muted', text: fmtBytes(info.usage) + ' used by this app (approximate). About ' + fmtBytes(info.quota) + ' available to the browser.' }));
  }

  /* ================================================================== */
  /* Service worker, install and connection                              */
  /* ================================================================== */

  const sw = { supported: 'serviceWorker' in navigator, registration: null, error: null, updateRequested: false, lastCheck: 0 };
  let deferredInstallPrompt = null;

  const isStandalone = () =>
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;

  function showUpdateBanner(worker) {
    const btn = button('Update now', 'btn btn-light btn-small', () => {
      btn.disabled = true;
      sw.updateRequested = true;
      worker.postMessage({ type: 'SKIP_WAITING' });
    });
    setBanner('update', h('div', { class: 'banner banner-update', role: 'status' },
      icon('download'),
      h('div', { class: 'banner-text' }, h('strong', { text: 'A new version is ready.' }), ' The app will reload when you update, so save what you are typing first.'),
      btn));
  }

  async function registerServiceWorker() {
    if (!sw.supported) {
      sw.error = 'This browser does not support offline app files (service workers).';
      return;
    }
    if (!window.isSecureContext) {
      sw.error = 'Offline use needs a secure (https://) address.';
      return;
    }
    try {
      const hadController = !!navigator.serviceWorker.controller;
      const reg = await navigator.serviceWorker.register(new URL('service-worker.js', document.baseURI).href, {
        scope: new URL('./', document.baseURI).href,
        updateViaCache: 'none',
      });
      sw.registration = reg;
      if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(worker);
        });
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // Reload only when the person asked for the update. The first install also fires this event.
        if (sw.updateRequested || (hadController && sw.updateRequested)) window.location.reload();
      });
      checkForUpdate();
      if (!hadController) {
        // First ever visit: the files finish saving a moment after the page appears.
        // Refresh the status once they are stored (unless the person is typing).
        navigator.serviceWorker.ready.then(() => {
          const el = document.activeElement;
          const typing = el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
          if (!typing && currentRoute && (currentRoute.name === 'dashboard' || currentRoute.name === 'settings')) render();
        });
      }
    } catch (e) {
      sw.error = 'Offline app files could not be set up: ' + (e && e.message ? e.message : 'unknown error');
    }
  }

  async function checkForUpdate(force) {
    if (!sw.registration || !navigator.onLine) return false;
    if (!force && Date.now() - sw.lastCheck < 3600000) return false;
    sw.lastCheck = Date.now();
    try {
      await sw.registration.update();
      return true;
    } catch (e) {
      return false;
    }
  }

  /** Ask the service worker which app files it really holds. */
  async function offlineStatus() {
    if (!sw.supported) return { state: 'unsupported', text: sw.error };
    if (sw.error) return { state: 'error', text: sw.error };
    let reg = sw.registration;
    if (!reg) {
      try {
        reg = await navigator.serviceWorker.getRegistration(new URL('./', document.baseURI).href);
      } catch (e) { /* ignore */ }
    }
    const worker = navigator.serviceWorker.controller || (reg && reg.active);
    if (!worker) return { state: 'pending', text: 'Saving the app files for offline use... Keep the app open for a few seconds, then check again.' };
    const data = await new Promise((resolve) => {
      const timer = window.setTimeout(() => resolve(null), 3000);
      const ch = new MessageChannel();
      ch.port1.onmessage = (ev) => {
        window.clearTimeout(timer);
        resolve(ev.data);
      };
      try {
        worker.postMessage({ type: 'GET_STATUS' }, [ch.port2]);
      } catch (e) {
        window.clearTimeout(timer);
        resolve(null);
      }
    });
    if (!data) return { state: 'pending', text: 'Could not read the offline file status yet. Try again in a moment.' };
    if (data.cached === data.expected) {
      return { state: 'ok', version: data.version, text: 'All ' + data.expected + ' app files are stored on this phone (version ' + data.version + ').', data };
    }
    return { state: 'error', version: data.version, text: 'Only ' + data.cached + ' of ' + data.expected + ' app files are stored. Open the app once while online and reload it.', data };
  }

  function setupConnectionIndicator() {
    const pill = $('#conn');
    const update = () => {
      const online = navigator.onLine;
      pill.className = 'conn ' + (online ? 'conn-online' : 'conn-offline');
      $('#conn-text').textContent = online ? 'Online' : 'Offline';
      pill.setAttribute('aria-label', online ? 'Connection: online' : 'Connection: offline. The app still works.');
    };
    window.addEventListener('online', () => {
      update();
      checkForUpdate();
    });
    window.addEventListener('offline', update);
    update();
  }

  function setupInstallPrompt() {
    window.addEventListener('beforeinstallprompt', (ev) => {
      ev.preventDefault();
      deferredInstallPrompt = ev;
      if (currentRoute && (currentRoute.name === 'dashboard' || currentRoute.name === 'settings')) render();
    });
    window.addEventListener('appinstalled', () => {
      deferredInstallPrompt = null;
      toast('App installed. You can open it from your home screen.');
      if (currentRoute && (currentRoute.name === 'dashboard' || currentRoute.name === 'settings')) render();
    });
  }

  async function promptInstall() {
    if (!deferredInstallPrompt) return false;
    const p = deferredInstallPrompt;
    deferredInstallPrompt = null;
    try {
      p.prompt();
      await p.userChoice;
    } catch (e) { /* dismissed */ }
    return true;
  }

  function installInstructions() {
    return h('ol', { class: 'steps' },
      h('li', null, 'Open this app\'s web address in ', h('strong', { text: 'Google Chrome' }), ' (not inside WhatsApp, Facebook or another app\'s built-in browser).'),
      h('li', null, 'Wait until the app has loaded fully, then check ', h('strong', { text: 'Settings' }), ' to see that the app files are stored for offline use.'),
      h('li', null, 'Tap the ', h('strong', { text: '⋮' }), ' menu (top right of Chrome), then ', h('strong', { text: 'Install app' }), ' or ', h('strong', { text: 'Add to Home screen' }), ', then ', h('strong', { text: 'Install' }), '.'),
      h('li', null, 'Open AMA FarmTech from your home screen. It opens full screen and works without internet.'));
  }

  function installCard(forDashboard) {
    if (isStandalone()) {
      return forDashboard ? null : notice('ok', 'Installed.', 'You are using the installed app.');
    }
    const card = h('section', { class: 'card' }, h('h2', { class: 'card-title' }, icon('install'), 'Install on your phone'));
    if (deferredInstallPrompt) {
      card.appendChild(h('p', { class: 'muted', text: 'Install AMA FarmTech Offline so it opens like a normal app, even with no internet.' }));
      card.appendChild(button('Install app', 'btn btn-primary', async () => {
        await promptInstall();
        render();
      }, 'install'));
      if (!forDashboard) card.appendChild(h('details', { class: 'details' }, h('summary', { text: 'Install manually' }), installInstructions()));
    } else if (forDashboard) {
      card.appendChild(h('p', { class: 'muted', text: 'Add this app to your home screen so it opens like a normal app, even with no internet.' }));
      card.appendChild(link('#/settings/install', 'How to install', 'btn btn-secondary', 'chevron'));
    } else {
      card.appendChild(h('p', { class: 'muted', text: 'Chrome has not offered a one-tap install yet. You can install it manually:' }));
      card.appendChild(installInstructions());
    }
    return card;
  }

  /* ================================================================== */
  /* Backup reminder logic                                               */
  /* ================================================================== */

  function backupStatus(s, counts) {
    const records = counts.farms + counts.fields + (counts.crops || 0) + (counts.varieties || 0) + (counts.cycles || 0) + (counts.batches || 0) + (counts.plantings || 0);
    const last = s.lastBackupAt;
    const days = s.backupReminderDays || 7;
    if (!records) return { level: 'none', title: 'Nothing to back up yet.', text: 'Once you add a farm, back it up regularly.' };
    if (!last) return { level: 'warn', title: 'No backup yet.', text: 'Your records exist only on this phone. Create an encrypted backup now.' };
    const age = Date.now() - Date.parse(last);
    const changed = !!s.lastChangeAt && s.lastChangeAt > last;
    if (changed && age > days * 86400000) return { level: 'warn', title: 'Back up again.', text: 'Records changed since your last backup, which was ' + fmtRelative(last) + '.' };
    if (changed) return { level: 'info', title: 'Changes since last backup.', text: 'Back up again soon. You will be reminded after ' + plural(days, 'day') + '.' };
    return { level: 'ok', title: 'Backed up.', text: 'No changes since your last backup.' };
  }

  /* ================================================================== */
  /* Router                                                              */
  /* ================================================================== */

  const ROUTES = [
    [/^\/?$/, 'dashboard', 'dashboard'],
    [/^\/farm\/?$/, 'farm', 'farms'],
    [/^\/farm\/new\/?$/, 'farm', 'farmForm'],
    [/^\/farm\/([0-9a-f-]{36})\/?$/i, 'farm', 'farmDetail'],
    [/^\/farm\/([0-9a-f-]{36})\/edit\/?$/i, 'farm', 'farmForm'],
    [/^\/farm\/([0-9a-f-]{36})\/field\/new\/?$/i, 'farm', 'fieldForm'],
    [/^\/field\/([0-9a-f-]{36})\/?$/i, 'farm', 'fieldDetail'],
    [/^\/field\/([0-9a-f-]{36})\/edit\/?$/i, 'farm', 'fieldForm'],
    // Phase 2 (crop production) routes are added by crops-ui.js through AMA.ui.addRoutes
    [/^\/records(?:\/(farms|fields|activity))?\/?$/, 'records', 'records'],
    [/^\/backup\/?$/, 'backup', 'backup'],
    [/^\/settings(?:\/(install))?\/?$/, 'settings', 'settings'],
  ];

  let currentRoute = null;
  let renderToken = 0;

  function parseRoute() {
    const path = window.location.hash.replace(/^#/, '') || '/';
    for (let i = 0; i < ROUTES.length; i++) {
      const m = ROUTES[i][0].exec(path);
      if (m) return { name: ROUTES[i][1], nav: ROUTES[i][1], view: ROUTES[i][2], match: m, path };
    }
    return { name: 'dashboard', nav: 'dashboard', view: 'notFound', match: [], path };
  }

  function goto(hash, replace) {
    if (replace) window.location.replace(hash);
    else window.location.hash = hash;
  }

  async function render() {
    const token = ++renderToken;
    const route = parseRoute();
    const sameView = currentRoute && currentRoute.path === route.path;
    currentRoute = route;
    document.querySelectorAll('.bottom-nav a').forEach((a) => {
      const on = a.getAttribute('data-nav') === route.nav;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    const root = $('#main');
    let node;
    try {
      node = await VIEWS[route.view](route);
    } catch (e) {
      node = errorView(e);
    }
    if (token !== renderToken) return;
    root.replaceChildren(node);
    root.setAttribute('data-route', route.path); // marks which page is on screen (used by automated tests)
    const heading = root.querySelector('h1');
    document.title = (heading ? heading.textContent + ' · ' : '') + AMA.APP_NAME;
    if (!sameView) {
      window.scrollTo(0, 0);
      if (heading) heading.focus({ preventScroll: true });
    }
    if (route.name === 'settings' && route.match[1] === 'install') {
      const target = $('#install');
      if (target) target.scrollIntoView();
    }
  }

  function errorView(e) {
    const err = db.normalizeError(e);
    return h('div', { class: 'stack' },
      pageHead('Something went wrong'),
      notice('danger', '', err.message),
      button('Reload the app', 'btn btn-primary', () => window.location.reload()));
  }

  function notFoundView(what) {
    return h('div', { class: 'stack' },
      pageHead(what ? 'Not found' : 'Page not found'),
      emptyState(what ? 'This ' + what + ' no longer exists.' : 'That page does not exist.', 'It may have been deleted or the link may be old.',
        link('#/', 'Go to dashboard', 'btn btn-primary')));
  }

  /* ================================================================== */
  /* View: Dashboard                                                     */
  /* ================================================================== */

  function statCard(label, value, sub, iconName) {
    return h('div', { class: 'stat' },
      h('div', { class: 'stat-icon' }, icon(iconName)),
      h('div', { class: 'stat-value', text: String(value) }),
      h('div', { class: 'stat-label', text: label }),
      sub ? h('div', { class: 'stat-sub', text: sub }) : null);
  }

  function activityList(items) {
    if (!items.length) return h('p', { class: 'muted', text: 'No activity yet. Actions such as creating a farm or a backup will appear here.' });
    return h('ul', { class: 'activity' }, items.map((a) =>
      h('li', null,
        h('span', { class: 'activity-dot act-' + a.entityType, 'aria-hidden': 'true' }),
        h('div', { class: 'activity-body' },
          h('div', { class: 'activity-text', text: a.summary }),
          h('div', { class: 'small muted', text: fmtDate(a.createdAt, true) + ' · ' + fmtRelative(a.createdAt) })))));
  }

  async function viewDashboard() {
    const [farms, fields, counts, recent, st, info, offline] = await Promise.all([
      db.listFarms(), db.listFields(), db.getCounts(), db.listActivities(5), db.getSettings(), storageInfo(), offlineStatus(),
    ]);
    settings = st;
    const wrap = h('div', { class: 'stack' });
    wrap.appendChild(pageHead('Dashboard', 'Ama Farms Ltd'));

    // Farm summary or empty state
    if (!farms.length) {
      wrap.appendChild(h('section', { class: 'card empty' },
        h('div', { class: 'empty-icon' }, icon('farm')),
        h('h2', { class: 'card-title', text: 'Welcome. Let\'s register your first farm.' }),
        h('ol', { class: 'steps' },
          h('li', null, h('strong', { text: 'Create a farm' }), ' with its name and location.'),
          h('li', null, h('strong', { text: 'Add its fields' }), ' with their area and soil.'),
          h('li', null, h('strong', { text: 'Make an encrypted backup' }), ' so your records are safe.')),
        link('#/farm/new', 'Create first farm', 'btn btn-primary btn-block', 'plus')));
    } else {
      const main = farms.find((f) => f.id === st.primaryFarmId) || farms[0];
      wrap.appendChild(h('section', { class: 'hero' },
        h('div', { class: 'hero-label', text: farms.length > 1 ? 'Main farm' : 'Your farm' }),
        h('div', { class: 'hero-name', text: main.name }),
        locationLine(main) ? h('div', { class: 'hero-sub', text: locationLine(main) }) : null,
        farms.length > 1 ? h('div', { class: 'hero-sub', text: '+ ' + plural(farms.length - 1, 'other farm') }) : null,
        h('a', { class: 'hero-link', href: '#/farm/' + main.id }, 'Open farm ', icon('chevron'))));
    }

    // Counts
    const totalSqm = units.sumSqm(fields.map((f) => f.areaSqm));
    const hasArea = fields.length > 0;
    wrap.appendChild(h('section', { class: 'stats', 'aria-label': 'Totals' },
      statCard('Registered farms', farms.length, null, 'farm'),
      statCard('Total fields', fields.length, null, 'field'),
      statCard('Farm records', farms.length + fields.length, 'farms + fields', 'records'),
      statCard('Field area', hasArea ? units.group(units.fromSqm(totalSqm, 'acres', 2)) + ' ac' : '—', hasArea ? units.group(units.fromSqm(totalSqm, 'hectares', 2)) + ' ha' : 'No fields yet', 'field')));

    // Crop production summary (Phase 2). It must never be able to break the Phase 1 dashboard.
    try {
      if (AMA.cropsUi && AMA.cropsUi.dashboardCard) {
        const cropCard = await AMA.cropsUi.dashboardCard();
        if (cropCard) wrap.appendChild(cropCard);
      }
    } catch (e) { /* ignore: the Crops tab will show the real error if there is one */ }

    // Backup
    const bs = backupStatus(st, counts);
    const backupCard = h('section', { class: 'card' },
      h('h2', { class: 'card-title' }, icon('backup'), 'Backup'),
      kvList([['Last backup', st.lastBackupAt ? fmtDate(st.lastBackupAt, true) + ' (' + fmtRelative(st.lastBackupAt) + ')' : 'Never']]),
      notice(bs.level === 'warn' ? 'warn' : bs.level === 'ok' ? 'ok' : 'info', bs.title, bs.text),
      link('#/backup', bs.level === 'warn' ? 'Back up now' : 'Open backup', bs.level === 'warn' ? 'btn btn-primary' : 'btn btn-secondary', 'backup'));
    wrap.appendChild(backupCard);

    // Storage and connection
    const pt = persistenceText(info);
    const conn = navigator.onLine;
    const offlineKind = offline.state === 'ok' ? 'ok' : offline.state === 'pending' ? 'info' : 'warn';
    wrap.appendChild(h('section', { class: 'card' },
      h('h2', { class: 'card-title' }, icon('database'), 'Storage and offline'),
      kvList([
        ['Connection', h('span', { class: 'chip ' + (conn ? 'chip-ok' : 'chip-warn'), text: conn ? 'Online' : 'Offline' })],
        ['Local database', 'Ready · ' + plural(counts.farms, 'farm') + ', ' + plural(counts.fields, 'field') + ', ' + plural(counts.activities, 'activity entry', 'activity entries')],
        ['Storage protection', h('span', { class: 'chip ' + (pt.kind === 'ok' ? 'chip-ok' : 'chip-warn'), text: pt.title })],
      ]),
      usageBar(info),
      notice(pt.kind, '', pt.text + ' Clearing Chrome\'s site data, uninstalling Chrome or losing the phone deletes your records, so keep backups.'),
      notice(offlineKind, offline.state === 'ok' ? 'Offline ready.' : 'Offline files:', offline.text),
      !info.persisted && info.supported
        ? button('Ask Chrome to protect storage', 'btn btn-secondary', async () => {
          const ok = await requestPersistence();
          toast(ok ? 'Storage is now protected.' : 'Chrome did not grant protection. Installing the app and using it regularly can help.', ok ? null : 'error');
          render();
        }, 'lock')
        : null));

    const ic = installCard(true);
    if (ic) wrap.appendChild(ic);

    wrap.appendChild(h('section', { class: 'card' },
      h('h2', { class: 'card-title', text: 'Recent activity' }),
      activityList(recent),
      counts.activities > 5 ? link('#/records/activity', 'See all activity', 'btn btn-secondary btn-small', 'chevron') : null));
    return wrap;
  }

  /* ================================================================== */
  /* View: My Farm                                                       */
  /* ================================================================== */

  function chipForStatus(status) {
    return h('span', { class: 'chip chip-status chip-' + status, text: V.optionLabel('status', status) });
  }

  function fieldRow(field, farmName) {
    return h('li', null, h('a', { class: 'row', href: '#/field/' + field.id },
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title', text: field.name + (field.code ? ' · ' + field.code : '') }),
        h('div', { class: 'small muted', text: areaText(field) + (farmName ? ' · ' + farmName : '') })),
      chipForStatus(field.status),
      icon('chevron', 'row-chevron')));
  }

  async function viewFarms() {
    const [farms, fields, st] = await Promise.all([db.listFarms(), db.listFields(), db.getSettings()]);
    settings = st;
    const wrap = h('div', { class: 'stack' });
    wrap.appendChild(pageHead('My Farm', farms.length ? plural(farms.length, 'farm') + ' registered' : null,
      farms.length ? link('#/farm/new', 'Add farm', 'btn btn-primary btn-small', 'plus') : null));
    if (!farms.length) {
      wrap.appendChild(emptyState('No farms yet', 'Create your first farm profile. You can add fields to it afterwards.', link('#/farm/new', 'Create first farm', 'btn btn-primary', 'plus')));
      return wrap;
    }
    const main = farms.find((f) => f.id === st.primaryFarmId) || farms[0];
    farms.forEach((farm) => {
      const own = fields.filter((f) => f.farmId === farm.id);
      const sqm = units.sumSqm(own.map((f) => f.areaSqm));
      wrap.appendChild(h('a', { class: 'card card-link', href: '#/farm/' + farm.id },
        h('div', { class: 'card-row' },
          h('h2', { class: 'card-title', text: farm.name }),
          farms.length > 1 && farm.id === main.id ? h('span', { class: 'chip chip-ok', text: 'Main' }) : null),
        locationLine(farm) ? h('p', { class: 'muted', text: locationLine(farm) }) : null,
        h('p', { class: 'small', text: plural(own.length, 'field') + (own.length ? ' · ' + units.group(units.fromSqm(sqm, 'acres', 2)) + ' acres (' + units.group(units.fromSqm(sqm, 'hectares', 2)) + ' ha)' : '') }),
        h('span', { class: 'card-chevron' }, icon('chevron'))));
    });
    return wrap;
  }

  /** A farm or field that has crop production cycles cannot be deleted. Shows why and returns true. */
  async function blockedByCycles(where, what) {
    const n = await db.countCycles(where);
    if (!n) return false;
    toast('This ' + what + ' has ' + plural(n, 'crop production cycle') + ' (archived ones count too), so it cannot be deleted. Open Crops, then Cycles, and delete or change those cycles first.', 'error');
    return true;
  }

  async function viewFarmDetail(route) {
    const id = route.match[1];
    const [farm, fields, st] = await Promise.all([db.getFarm(id), db.listFields(id), db.getSettings()]);
    if (!farm) return notFoundView('farm');
    settings = st;
    const farmCount = (await db.getCounts()).farms;
    const isMain = st.primaryFarmId === id || (!st.primaryFarmId && (await db.listFarms())[0].id === id);
    const wrap = h('div', { class: 'stack' });
    wrap.appendChild(h('p', { class: 'crumb' }, h('a', { href: '#/farm', text: '‹ My Farm' })));
    wrap.appendChild(pageHead(farm.name, locationLine(farm)));
    wrap.appendChild(h('div', { class: 'actions' },
      link('#/farm/' + id + '/edit', 'Edit farm', 'btn btn-secondary', 'edit'),
      farmCount > 1 && !isMain ? button('Make main farm', 'btn btn-secondary', async () => {
        try {
          await db.saveSettings({ primaryFarmId: id });
          toast('Main farm updated.');
          render();
        } catch (e) {
          toast(friendlyError(e), 'error');
        }
      }) : null,
      button('Delete', 'btn btn-danger-outline', async () => {
        if (await blockedByCycles({ farmId: id }, 'farm')) return;
        const ok = await confirmDialog({
          title: 'Delete "' + farm.name + '"?',
          message: [
            fields.length ? 'This also deletes its ' + plural(fields.length, 'field') + '. This cannot be undone.' : 'This cannot be undone.',
            'Tip: make a backup first if you might need these records again.',
          ],
          confirmText: 'Delete farm',
          danger: true,
        });
        if (!ok) return;
        try {
          await db.deleteFarm(id);
          toast('Farm deleted.');
          goto('#/farm', true);
        } catch (e) {
          toast(friendlyError(e), 'error');
        }
      }, 'trash')));
    wrap.appendChild(h('section', { class: 'card' },
      h('h2', { class: 'card-title', text: 'Farm details' }),
      kvList([
        ['Location', farm.location], ['District', farm.district], ['Region', farm.region], ['Country', farm.country],
        ['Currency', farm.currency], ['Time zone', farm.timezone], ['Contact', farm.contact],
        ['Description', farm.description ? h('span', { class: 'pre', text: farm.description }) : ''],
        ['Notes', farm.notes ? h('span', { class: 'pre', text: farm.notes }) : ''],
        ['Created', fmtDate(farm.createdAt, true)], ['Last changed', fmtDate(farm.updatedAt, true)],
      ])));
    const sqm = units.sumSqm(fields.map((f) => f.areaSqm));
    wrap.appendChild(h('section', { class: 'card' },
      h('div', { class: 'card-row' },
        h('h2', { class: 'card-title', text: 'Fields (' + fields.length + ')' }),
        link('#/farm/' + id + '/field/new', 'Add field', 'btn btn-primary btn-small', 'plus')),
      fields.length
        ? h('div', null,
          h('p', { class: 'small muted', text: 'Total area: ' + units.group(units.fromSqm(sqm, 'acres', 2)) + ' acres (' + units.group(units.fromSqm(sqm, 'hectares', 2)) + ' ha)' }),
          h('ul', { class: 'list' }, fields.map((f) => fieldRow(f))))
        : h('p', { class: 'muted', text: 'No fields yet. Add the first field of this farm.' })));
    return wrap;
  }

  async function viewFarmForm(route) {
    const id = route.match[1] || null;
    const existing = id ? await db.getFarm(id) : null;
    if (id && !existing) return notFoundView('farm');
    const st = await db.getSettings();
    settings = st;
    const data = existing || { name: '', location: '', district: '', region: '', country: st.defaultCountry, description: '', currency: st.defaultCurrency, timezone: st.defaultTimezone, contact: '', notes: '' };
    const C = {
      name: formControl({ name: 'name', label: 'Farm name', required: true, max: V.MAX.name }, data.name),
      location: formControl({ name: 'location', label: 'Farm location', hint: 'Village, parish or landmark', max: V.MAX.location }, data.location),
      district: formControl({ name: 'district', label: 'District', max: V.MAX.short }, data.district),
      region: formControl({ name: 'region', label: 'Region', list: 'region-list', max: V.MAX.short }, data.region),
      country: formControl({ name: 'country', label: 'Country', required: true, max: V.MAX.short }, data.country),
      description: formControl({ name: 'description', label: 'Farm description', type: 'textarea', max: V.MAX.text }, data.description),
      currency: formControl({ name: 'currency', label: 'Currency', required: true, list: 'currency-list', max: 3, capitalize: 'characters', hint: '3-letter code, e.g. UGX' }, data.currency),
      timezone: formControl({ name: 'timezone', label: 'Time zone', required: true, list: 'tz-list', max: 64, capitalize: 'none', hint: 'e.g. Africa/Kampala' }, data.timezone),
      contact: formControl({ name: 'contact', label: 'Contact information', hint: 'Phone, email or contact person', max: V.MAX.contact }, data.contact),
      notes: formControl({ name: 'notes', label: 'Notes', type: 'textarea', rows: 4, max: V.MAX.notes }, data.notes),
    };
    const save = button(existing ? 'Save changes' : 'Create farm', 'btn btn-primary btn-block', null, null, { type: 'submit' });
    const form = h('form', { class: 'form', novalidate: true },
      C.name.wrap, C.location.wrap,
      h('div', { class: 'grid-2' }, C.district.wrap, C.region.wrap),
      C.country.wrap, C.description.wrap,
      h('div', { class: 'grid-2' }, C.currency.wrap, C.timezone.wrap),
      C.contact.wrap, C.notes.wrap,
      datalist('region-list', ['Central', 'Eastern', 'Northern', 'Western', 'West Nile', 'Acholi', 'Lango', 'Teso', 'Busoga', 'Buganda', 'Ankole', 'Kigezi', 'Bunyoro', 'Tooro', 'Karamoja']),
      datalist('currency-list', ['UGX', 'USD', 'KES', 'TZS', 'RWF', 'EUR', 'GBP']),
      datalist('tz-list', ['Africa/Kampala', 'Africa/Nairobi', 'Africa/Kigali', 'Africa/Juba', 'Africa/Dar_es_Salaam', 'UTC']),
      h('div', { class: 'actions' }, save, link(existing ? '#/farm/' + id : '#/farm', 'Cancel', 'btn btn-secondary')));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (save.disabled) return;
      const input = {};
      Object.keys(C).forEach((k) => {
        input[k] = C[k].el.value;
      });
      const check = V.farm(input);
      if (!check.ok) {
        applyErrors(C, check.errors);
        return;
      }
      applyErrors(C, {});
      save.disabled = true;
      try {
        const rec = existing ? (await db.updateFarm(id, input)).record : await db.createFarm(input);
        if (!existing) {
          const counts = await db.getCounts();
          if (counts.farms === 1) await requestPersistence();
        }
        toast(existing ? 'Farm saved.' : 'Farm created. Now add its fields.');
        goto('#/farm/' + rec.id, true);
      } catch (e) {
        save.disabled = false;
        if (e instanceof AMA.ValidationError) applyErrors(C, e.errors);
        else toast(friendlyError(e), 'error');
      }
    });
    return h('div', { class: 'stack' },
      h('p', { class: 'crumb' }, h('a', { href: existing ? '#/farm/' + id : '#/farm', text: '‹ Back' })),
      pageHead(existing ? 'Edit farm' : 'New farm', existing ? null : 'Register a farm profile. You can create more than one.'),
      h('section', { class: 'card' }, form));
  }

  /* ---------------------------- Fields ---------------------------- */

  async function viewFieldDetail(route) {
    const id = route.match[1];
    const field = await db.getField(id);
    if (!field) return notFoundView('field');
    const farm = await db.getFarm(field.farmId);
    settings = await db.getSettings();
    const otherUnit = units.other(field.areaUnit);
    const other = units.fromSqm(field.areaSqm, otherUnit, 4);
    const wrap = h('div', { class: 'stack' });
    wrap.appendChild(h('p', { class: 'crumb' }, h('a', { href: farm ? '#/farm/' + farm.id : '#/farm', text: '‹ ' + (farm ? farm.name : 'My Farm') })));
    wrap.appendChild(pageHead(field.name, (field.code ? field.code + ' · ' : '') + (farm ? farm.name : '')));
    wrap.appendChild(h('div', { class: 'actions' },
      link('#/field/' + id + '/edit', 'Edit field', 'btn btn-secondary', 'edit'),
      button('Delete', 'btn btn-danger-outline', async () => {
        if (await blockedByCycles({ fieldId: id }, 'field')) return;
        const ok = await confirmDialog({ title: 'Delete field "' + field.name + '"?', message: 'This cannot be undone. Tip: make a backup first if you might need it again.', confirmText: 'Delete field', danger: true });
        if (!ok) return;
        try {
          await db.deleteField(id);
          toast('Field deleted.');
          goto(farm ? '#/farm/' + farm.id : '#/farm', true);
        } catch (e) {
          toast(friendlyError(e), 'error');
        }
      }, 'trash')));
    wrap.appendChild(h('section', { class: 'card' },
      h('div', { class: 'card-row' }, h('h2', { class: 'card-title', text: 'Field details' }), chipForStatus(field.status)),
      kvList([
        ['Farm', farm ? farm.name : ''],
        ['Area', areaText(field) + ' (= ' + units.group(other) + ' ' + units.label(otherUnit) + ')'],
        ['Exact area', units.group(field.areaSqm) + ' m²'],
        ['Soil type', V.optionLabel('soilType', field.soilType)],
        ['Soil description', field.soilDescription ? h('span', { class: 'pre', text: field.soilDescription }) : ''],
        ['Water source', V.optionLabel('waterSource', field.waterSource)],
        ['Drainage', field.drainage ? h('span', { class: 'pre', text: field.drainage }) : ''],
        ['Notes', field.notes ? h('span', { class: 'pre', text: field.notes }) : ''],
        ['Created', fmtDate(field.createdAt, true)], ['Last changed', fmtDate(field.updatedAt, true)],
      ])));
    // Crops planted in this field (Phase 2). Must never break the Phase 1 field page.
    try {
      if (AMA.cropsUi && AMA.cropsUi.fieldSection) {
        const section = await AMA.cropsUi.fieldSection(field);
        if (section) wrap.appendChild(section);
      }
    } catch (e) { /* ignore */ }
    return wrap;
  }

  async function viewFieldForm(route) {
    const isNewUnderFarm = /\/field\/new/.test(route.path);
    const farmIdFromPath = isNewUnderFarm ? route.match[1] : null;
    const fieldId = isNewUnderFarm ? null : route.match[1];
    const existing = fieldId ? await db.getField(fieldId) : null;
    if (fieldId && !existing) return notFoundView('field');
    const farms = await db.listFarms();
    settings = await db.getSettings();
    if (!farms.length) {
      return h('div', { class: 'stack' }, pageHead('New field'), emptyState('Create a farm first', 'Fields belong to a farm.', link('#/farm/new', 'Create farm', 'btn btn-primary', 'plus')));
    }
    if (farmIdFromPath && !farms.some((f) => f.id === farmIdFromPath)) return notFoundView('farm');
    const data = existing || { farmId: farmIdFromPath, name: '', code: '', areaValue: '', areaUnit: 'acres', soilType: '', soilDescription: '', waterSource: '', drainage: '', notes: '', status: 'planned' };
    const C = {
      farmId: formControl({ name: 'farmId', label: 'Farm', type: 'select', required: true, options: farms.map((f) => [f.id, f.name]) }, data.farmId),
      name: formControl({ name: 'name', label: 'Field name', required: true, max: V.MAX.name }, data.name),
      code: formControl({ name: 'code', label: 'Field code', hint: 'Short label such as A1 or NORTH-2', max: 20, capitalize: 'characters' }, data.code),
      areaValue: formControl({ name: 'areaValue', label: 'Field area', required: true, inputmode: 'decimal', max: 17, placeholder: 'e.g. 2.5' }, data.areaValue),
      areaUnit: formControl({ name: 'areaUnit', label: 'Unit', type: 'select', required: true, options: OPT.areaUnit }, data.areaUnit),
      status: formControl({ name: 'status', label: 'Field status', type: 'select', required: true, options: OPT.status }, data.status),
      soilType: formControl({ name: 'soilType', label: 'Soil type', type: 'select', options: OPT.soilType }, data.soilType),
      soilDescription: formControl({ name: 'soilDescription', label: 'Soil description', type: 'textarea', max: V.MAX.text, hint: 'Colour, texture, stones, fertility...' }, data.soilDescription),
      waterSource: formControl({ name: 'waterSource', label: 'Water source', type: 'select', options: OPT.waterSource }, data.waterSource),
      drainage: formControl({ name: 'drainage', label: 'Drainage description', type: 'textarea', max: V.MAX.text, hint: 'Slope, waterlogging, flooding...' }, data.drainage),
      notes: formControl({ name: 'notes', label: 'General notes', type: 'textarea', rows: 4, max: V.MAX.notes }, data.notes),
    };
    const preview = h('p', { class: 'conversion', 'aria-live': 'polite' });
    const updatePreview = () => {
      const n = units.normalizeInput(C.areaValue.el.value);
      const unit = C.areaUnit.el.value;
      if (n && units.isPositiveWithin(n, 1000000)) {
        const otherUnit = units.other(unit);
        preview.textContent = units.group(n) + ' ' + units.label(unit) + ' = ' + units.group(units.fromSqm(units.toSqm(n, unit), otherUnit, 4)) + ' ' + units.label(otherUnit);
      } else {
        preview.textContent = '';
      }
    };
    C.areaValue.el.addEventListener('input', updatePreview);
    C.areaUnit.el.addEventListener('change', updatePreview);
    updatePreview();
    const save = button(existing ? 'Save changes' : 'Create field', 'btn btn-primary btn-block', null, null, { type: 'submit' });
    const backHref = '#/farm/' + (existing ? existing.farmId : farmIdFromPath);
    const form = h('form', { class: 'form', novalidate: true },
      C.farmId.wrap, C.name.wrap, C.code.wrap,
      h('div', { class: 'grid-area' }, C.areaValue.wrap, C.areaUnit.wrap),
      preview, C.status.wrap, C.soilType.wrap, C.soilDescription.wrap, C.waterSource.wrap, C.drainage.wrap, C.notes.wrap,
      h('div', { class: 'actions' }, save, link(existing ? '#/field/' + fieldId : backHref, 'Cancel', 'btn btn-secondary')));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (save.disabled) return;
      const input = {};
      Object.keys(C).forEach((k) => {
        input[k] = C[k].el.value;
      });
      const check = V.field(input);
      if (!check.ok) {
        applyErrors(C, check.errors);
        return;
      }
      applyErrors(C, {});
      save.disabled = true;
      try {
        const rec = existing ? (await db.updateField(fieldId, input)).record : await db.createField(input);
        toast(existing ? 'Field saved.' : 'Field created.');
        goto('#/field/' + rec.id, true);
      } catch (e) {
        save.disabled = false;
        if (e instanceof AMA.ValidationError) applyErrors(C, e.errors);
        else toast(friendlyError(e), 'error');
      }
    });
    return h('div', { class: 'stack' },
      h('p', { class: 'crumb' }, h('a', { href: existing ? '#/field/' + fieldId : backHref, text: '‹ Back' })),
      pageHead(existing ? 'Edit field' : 'New field'),
      h('section', { class: 'card' }, form));
  }

  /* ================================================================== */
  /* View: Records                                                       */
  /* ================================================================== */

  async function viewRecords(route) {
    const tab = route.match[1] || 'farms';
    const [farms, fields, activities, counts] = await Promise.all([db.listFarms(), db.listFields(), db.listActivities(200), db.getCounts()]);
    settings = await db.getSettings();
    const farmName = new Map(farms.map((f) => [f.id, f.name]));
    const wrap = h('div', { class: 'stack' });
    wrap.appendChild(pageHead('Records', 'Search everything stored on this phone'));
    const tabs = h('div', { class: 'tabs', role: 'tablist' }, [
      ['farms', 'Farms (' + farms.length + ')'], ['fields', 'Fields (' + fields.length + ')'], ['activity', 'Activity (' + counts.activities + ')'],
    ].map(([key, label]) => h('a', { href: '#/records/' + key, role: 'tab', 'aria-selected': String(tab === key), class: 'tab' + (tab === key ? ' active' : ''), text: label })));
    wrap.appendChild(tabs);

    const results = h('div', { 'aria-live': 'polite' });
    const search = h('input', { type: 'search', class: 'search', placeholder: 'Search ' + (tab === 'activity' ? 'activity' : tab), 'aria-label': 'Search records', autocomplete: 'off', maxlength: '100' });
    let statusFilter = null;
    let farmFilter = null;
    const controls = h('div', { class: 'filters' }, search);
    if (tab === 'fields') {
      farmFilter = h('select', { 'aria-label': 'Filter by farm' }, h('option', { value: '', text: 'All farms' }), farms.map((f) => h('option', { value: f.id, text: f.name })));
      statusFilter = h('select', { 'aria-label': 'Filter by status' }, h('option', { value: '', text: 'All statuses' }), OPT.status.map((o) => h('option', { value: o[0], text: o[1] })));
      controls.appendChild(h('div', { class: 'grid-2' }, farmFilter, statusFilter));
    }
    wrap.appendChild(controls);
    wrap.appendChild(results);

    const haystack = (parts) => parts.filter(Boolean).join(' ').toLowerCase();
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      let node;
      if (tab === 'farms') {
        const rows = farms.filter((f) => !q || haystack([f.name, f.location, f.district, f.region, f.country, f.description, f.contact, f.notes]).includes(q));
        node = rows.length
          ? h('ul', { class: 'list card-list' }, rows.map((f) => h('li', null, h('a', { class: 'row', href: '#/farm/' + f.id },
            h('div', { class: 'row-main' }, h('div', { class: 'row-title', text: f.name }), h('div', { class: 'small muted', text: locationLine(f) || 'No location' })),
            icon('chevron', 'row-chevron')))))
          : h('p', { class: 'muted pad', text: farms.length ? 'No farms match your search.' : 'No farms yet.' });
      } else if (tab === 'fields') {
        const rows = fields.filter((f) =>
          (!farmFilter.value || f.farmId === farmFilter.value) && (!statusFilter.value || f.status === statusFilter.value) &&
          (!q || haystack([f.name, f.code, f.soilDescription, f.drainage, f.notes, V.optionLabel('soilType', f.soilType), V.optionLabel('waterSource', f.waterSource), farmName.get(f.farmId)]).includes(q)));
        node = rows.length
          ? h('ul', { class: 'list card-list' }, rows.map((f) => fieldRow(f, farmName.get(f.farmId))))
          : h('p', { class: 'muted pad', text: fields.length ? 'No fields match your filters.' : 'No fields yet.' });
      } else {
        const rows = activities.filter((a) => !q || a.summary.toLowerCase().includes(q));
        node = h('div', { class: 'card' }, activityList(rows), counts.activities > activities.length ? h('p', { class: 'small muted', text: 'Showing the latest ' + activities.length + ' of ' + counts.activities + ' entries.' }) : null);
      }
      results.replaceChildren(node);
    };
    search.addEventListener('input', draw);
    if (farmFilter) {
      farmFilter.addEventListener('change', draw);
      statusFilter.addEventListener('change', draw);
    }
    draw();
    return wrap;
  }

  /* ================================================================== */
  /* View: Backup                                                        */
  /* ================================================================== */

  function passwordInput(label, id) {
    const input = h('input', { type: 'password', id, autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', 'aria-label': label });
    return input;
  }

  function strengthMeter() {
    const bar = h('div', { class: 'strength' }, h('span'), h('span'), h('span'));
    const text = h('p', { class: 'small muted', 'aria-live': 'polite' });
    return {
      node: h('div', null, bar, text),
      update(pw) {
        const s = B.passwordStrength(pw);
        bar.className = 'strength level-' + (pw ? s.level : 0);
        text.textContent = pw ? s.label : '';
      },
    };
  }

  function showHideToggle(inputs) {
    const id = uid('show');
    const box = h('input', { type: 'checkbox', id });
    box.addEventListener('change', () => inputs.forEach((i) => {
      i.type = box.checked ? 'text' : 'password';
    }));
    return h('label', { class: 'check', for: id }, box, h('span', { text: 'Show password' }));
  }

  function createBackupCard(onChange) {
    const pw1 = passwordInput('Backup password', 'bk-pw1');
    const pw2 = passwordInput('Repeat password', 'bk-pw2');
    const meter = strengthMeter();
    const ack = h('input', { type: 'checkbox', id: 'bk-ack' });
    const err = h('p', { class: 'field-error', role: 'alert', hidden: true });
    const progress = h('p', { class: 'muted', 'aria-live': 'polite' });
    const result = h('div', { 'aria-live': 'polite' });
    pw1.addEventListener('input', () => meter.update(pw1.value));
    const btn = button('Create encrypted backup', 'btn btn-primary btn-block', null, 'lock');

    const fail = (m) => {
      err.hidden = false;
      err.textContent = m;
    };
    btn.addEventListener('click', async () => {
      err.hidden = true;
      if (pw1.value.length < B.MIN_PASSWORD) return fail('Use a password of at least ' + B.MIN_PASSWORD + ' characters.');
      if (pw1.value !== pw2.value) return fail('The two passwords do not match.');
      if (!ack.checked) return fail('Please tick the box to confirm you understand the password warning.');
      btn.disabled = true;
      progress.textContent = 'Encrypting your records. This can take a few seconds on older phones...';
      result.replaceChildren();
      try {
        const file = await B.createBackupFile(pw1.value, { kind: 'export', timeZone: settings.defaultTimezone });
        B.downloadBytes(file.bytes, file.fileName);
        await B.recordBackup(file);
        pw1.value = '';
        pw2.value = '';
        meter.update('');
        ack.checked = false;
        progress.textContent = '';
        const c = file.snapshot.counts;
        result.replaceChildren(h('div', { class: 'notice notice-ok' }, icon('check'), h('div', null,
          h('strong', { text: 'Backup created. ' }),
          h('span', { text: file.fileName + ' (' + fmtBytes(file.sizeBytes) + ') with ' + plural(c.farms, 'farm') + ' and ' + plural(c.fields, 'field') +
            (c.crops || c.cycles ? ', ' + plural(c.crops || 0, 'crop') + ' and ' + plural(c.cycles || 0, 'crop cycle') : '') + '.' }),
          h('p', { class: 'small', text: 'Chrome saves it to your Downloads folder. Open the Files app and check it is there. Keep a copy somewhere safe outside this phone (Google Drive, email to yourself, or another phone). Chrome does not let this app confirm that the file was saved.' }),
          h('div', { class: 'actions' },
            B.canShareFiles() ? button('Share / send file', 'btn btn-secondary btn-small', async () => {
              try {
                await B.shareBytes(file.bytes, file.fileName);
              } catch (e) {
                if (!e || e.name !== 'AbortError') toast('Sharing failed. Use "Download again" instead.', 'error');
              }
            }, 'share') : null,
            button('Download again', 'btn btn-secondary btn-small', () => B.downloadBytes(file.bytes, file.fileName), 'download')))));
        onChange();
      } catch (e) {
        progress.textContent = '';
        fail(e instanceof B.BackupError || e instanceof AMA.AppError ? e.message : friendlyError(e));
      } finally {
        btn.disabled = false;
      }
    });
    return h('section', { class: 'card' },
      h('h2', { class: 'card-title' }, icon('backup'), 'Create encrypted backup'),
      h('p', { class: 'muted', text: 'All farms, fields, crop records and activity are saved into one file, encrypted with a password you choose. The file is safe to keep in email or cloud storage because only the password opens it.' }),
      notice('warn', 'Do not lose the password.', 'It is not stored anywhere. If you forget it, nobody can open the backup, including Ama Farms and the developers of this app. Write it down somewhere safe, apart from the file.'),
      h('div', { class: 'field' }, h('label', { for: 'bk-pw1', text: 'Backup password' }), pw1, meter.node),
      h('div', { class: 'field' }, h('label', { for: 'bk-pw2', text: 'Repeat password' }), pw2),
      showHideToggle([pw1, pw2]),
      h('label', { class: 'check', for: 'bk-ack' }, ack, h('span', { text: 'I understand that if I lose this password, the backup cannot be recovered.' })),
      err, btn, progress, result);
  }

  /* ----------------------------- Restore ----------------------------- */

  const STORE_LABEL = {
    farms: 'Farms', fields: 'Fields', crops: 'Crops', varieties: 'Varieties', cycles: 'Crop cycles',
    batches: 'Planting batches', plantings: 'Planting records', activities: 'Activity log',
  };
  // Singular / plural names used in sentences about deleted or added records.
  const STORE_NOUN = {
    farms: ['farm', 'farms'], fields: ['field', 'fields'], crops: ['crop', 'crops'], varieties: ['variety', 'varieties'],
    cycles: ['crop cycle', 'crop cycles'], batches: ['planting batch', 'planting batches'], plantings: ['planting record', 'planting records'],
    activities: ['activity log entry', 'activity log entries'],
  };
  const countNoun = (store, n) => n + ' ' + STORE_NOUN[store][n === 1 ? 0 : 1];
  function joinList(items) {
    if (items.length <= 1) return items.join('');
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }

  function restoreCard(onChange) {
    const card = h('section', { class: 'card' });
    let S = null;
    const reset = () => {
      S = { step: 'choose', file: null, password: '', parsed: null, current: null, mode: 'merge', policy: 'keep_existing', skipInvalid: false, safetyDone: false, safetySkip: false, error: '', busy: false, pwMode: 'same', safetyPw: '' };
    };
    reset();

    function head() {
      return [
        h('h2', { class: 'card-title' }, icon('upload'), 'Restore from backup'),
        h('p', { class: 'muted', text: 'Use this to move your records to a new phone, or to recover them. You will see exactly what will change before anything is saved.' }),
      ];
    }

    function drawChoose() {
      const fileInput = h('input', { type: 'file', id: 'rs-file', 'aria-label': 'Choose backup file' });
      const fileName = h('p', { class: 'small muted', text: S.file ? S.file.name : 'No file chosen' });
      const pw = passwordInput('Backup password', 'rs-pw');
      pw.value = S.password;
      const err = h('p', { class: 'field-error', role: 'alert', hidden: !S.error, text: S.error });
      const btn = button('Open backup', 'btn btn-primary btn-block', null, 'lock', { disabled: S.busy });
      fileInput.addEventListener('change', () => {
        S.file = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
        fileName.textContent = S.file ? S.file.name + ' (' + fmtBytes(S.file.size) + ')' : 'No file chosen';
      });
      btn.addEventListener('click', async () => {
        S.error = '';
        S.password = pw.value;
        if (!S.file) {
          S.error = 'Choose a backup file (.amabackup) first.';
          return draw();
        }
        if (!S.password) {
          S.error = 'Enter the backup password.';
          return draw();
        }
        S.busy = true;
        draw();
        try {
          S.parsed = await B.openBackupFile(S.file, S.password);
          S.current = await db.readAll();
          S.step = 'preview';
        } catch (e) {
          S.error = e instanceof B.BackupError || e instanceof AMA.AppError ? e.message : 'The backup could not be opened: ' + friendlyError(e);
        }
        S.busy = false;
        draw();
      });
      return [
        ...head(),
        h('div', { class: 'field' }, h('label', { for: 'rs-file', text: 'Backup file' }), fileInput, fileName),
        h('div', { class: 'field' }, h('label', { for: 'rs-pw', text: 'Backup password' }), pw),
        showHideToggle([pw]),
        err, btn,
        S.busy ? h('p', { class: 'muted', text: 'Decrypting... this can take a few seconds.', 'aria-live': 'polite' }) : null,
      ];
    }

    function planOptions() {
      return { mode: S.mode, policy: S.policy, skipInvalid: S.skipInvalid };
    }

    function drawPreview() {
      const p = S.parsed;
      const plan = B.makePlan(p, S.current, planOptions());
      const DS = B.DATA_STORES;
      const hasCurrent = DS.some((n) => (S.current[n] || []).length > 0);
      const dupCount = DS.reduce((n, k) => n + plan.analysis[k].different.length, 0);
      const identicalCount = DS.reduce((n, k) => n + plan.analysis[k].identical.length, 0);
      // Farms, fields and activity always get a row; the crop stores only when they have records somewhere.
      const rowStores = DS.filter((k) => ['farms', 'fields', 'activities'].indexOf(k) !== -1 || p.records[k].length || (S.current[k] || []).length);
      const nothing = plan.summary.added === 0 && plan.summary.updated === 0 && plan.summary.removed === 0;
      const needSafety = hasCurrent && plan.changesExisting;

      const grid = h('div', { class: 'cmp', role: 'table', 'aria-label': 'Backup compared with this phone' },
        h('div', { class: 'cmp-row cmp-head', role: 'row' }, h('span', { role: 'columnheader', text: 'Records' }), h('span', { role: 'columnheader', text: 'In file' }), h('span', { role: 'columnheader', text: 'New' }), h('span', { role: 'columnheader', text: 'Same' }), h('span', { role: 'columnheader', text: 'Differ' })),
        rowStores.map((k) => h('div', { class: 'cmp-row', role: 'row' },
          h('span', { role: 'cell', text: STORE_LABEL[k] }), h('span', { role: 'cell', text: String(p.records[k].length) }),
          h('span', { role: 'cell', text: String(plan.analysis[k].newItems.length) }), h('span', { role: 'cell', text: String(plan.analysis[k].identical.length) }),
          h('span', { role: 'cell', class: plan.analysis[k].different.length ? 'warn-text' : '', text: String(plan.analysis[k].different.length) }))));

      const dupList = [];
      ['farms', 'fields', 'crops', 'varieties', 'cycles'].forEach((k) => {
        plan.analysis[k].different.slice(0, 5).forEach((d) => {
          dupList.push(h('li', null, h('strong', { text: STORE_NOUN[k][0].charAt(0).toUpperCase() + STORE_NOUN[k][0].slice(1) + ': ' + d.backup.name }),
            h('span', { class: 'small muted', text: ' — same ID on this phone as "' + d.current.name + '". ' + (d.newer === 'backup' ? 'The backup copy is newer.' : d.newer === 'current' ? 'The copy on this phone is newer.' : 'Both were changed at the same time.') })));
        });
      });

      const modeId = uid('mode');
      const mergeRadio = h('input', { type: 'radio', name: modeId, value: 'merge', checked: S.mode === 'merge' });
      const replaceRadio = h('input', { type: 'radio', name: modeId, value: 'replace', checked: S.mode === 'replace' });
      [mergeRadio, replaceRadio].forEach((r) => r.addEventListener('change', () => {
        S.mode = r.value;
        S.safetyDone = false;
        S.error = '';
        draw();
      }));

      const children = [
        ...head(),
        notice('ok', 'Backup opened.', 'Nothing has been changed yet.'),
        kvList([
          ['File', S.file.name], ['Exported', fmtDate(p.meta.exportedAt, true)], ['App version', p.meta.appVersion || 'unknown'],
          ['Database version', String(p.meta.dbSchemaVersion)],
        ]),
        grid,
        h('p', { class: 'small muted', text: 'New = not on this phone. Same = identical record already here. Differ = same ID but different contents.' }),
      ];

      if (p.invalid.length) {
        children.push(notice('danger', plural(p.invalid.length, 'record') + ' in the backup ' + (p.invalid.length === 1 ? 'is' : 'are') + ' damaged or invalid.',
          'Example: ' + p.invalid[0].store + ' — ' + p.invalid[0].error + '.'));
        const skipId = uid('skip');
        const skip = h('input', { type: 'checkbox', id: skipId, checked: S.skipInvalid });
        skip.addEventListener('change', () => {
          S.skipInvalid = skip.checked;
          draw();
        });
        children.push(h('label', { class: 'check', for: skipId }, skip, h('span', { text: 'Restore the valid records only and skip the damaged ones.' })));
      }
      if (dupCount) {
        children.push(notice('info', plural(dupCount, 'record') + ' already exist' + (dupCount === 1 ? 's' : '') + ' on this phone with different contents.', 'They will never be overwritten silently. You choose what happens below.'));
        if (dupList.length) children.push(h('ul', { class: 'dups' }, dupList));
      }
      if (identicalCount) children.push(h('p', { class: 'small muted', text: plural(identicalCount, 'record') + ' already on this phone ' + (identicalCount === 1 ? 'is' : 'are') + ' identical and will be left alone.' }));

      children.push(
        h('fieldset', { class: 'choices' },
          h('legend', { text: 'How should the backup be restored?' }),
          h('label', { class: 'choice' }, mergeRadio, h('span', null, h('strong', { text: 'Merge (recommended). ' }), 'Add the records that are missing. Nothing on this phone is deleted.')),
          h('label', { class: 'choice' }, replaceRadio, h('span', null, h('strong', { text: 'Replace everything. ' }), 'Delete all farms, fields, crop records and activity on this phone and use only the backup.'))));

      if (S.mode === 'merge' && dupCount) {
        const sel = h('select', { id: 'rs-policy', 'aria-label': 'For records that differ' },
          h('option', { value: 'keep_existing', text: 'Keep the copy on this phone' }),
          h('option', { value: 'keep_newer', text: 'Use whichever copy was changed most recently' }),
          h('option', { value: 'use_backup', text: 'Use the backup\'s copy' }));
        sel.value = S.policy;
        sel.addEventListener('change', () => {
          S.policy = sel.value;
          S.safetyDone = false;
          draw();
        });
        children.push(h('div', { class: 'field' }, h('label', { for: 'rs-policy', text: 'For records that differ' }), sel));
      }

      if (plan.problems.length) {
        plan.problems.forEach((m) => children.push(notice('danger', 'Restore blocked.', m)));
      }

      // Outcome
      const keptParts = ['farms', 'fields', 'crops', 'varieties', 'cycles', 'batches', 'plantings']
        .filter((k) => k === 'farms' || k === 'fields' || p.records[k].length)
        .map((k) => countNoun(k, p.records[k].length));
      const removedParts = DS.filter((k) => plan.detail[k].removed > 0).map((k) => countNoun(k, plan.detail[k].removed));
      const outcome = S.mode === 'replace'
        ? 'This phone will end up with exactly what is in the backup: ' + joinList(keptParts) + '. ' +
          (plan.summary.removed
            ? 'What is on this phone but not in the backup will be DELETED: ' + joinList(removedParts) + '.'
            : 'Nothing on this phone will be deleted.')
        : 'This will add ' + plan.summary.added + ', update ' + plan.summary.updated + ', and keep ' + plan.summary.kept + ' as they are on this phone. Nothing will be deleted.';
      children.push(notice(S.mode === 'replace' && plan.summary.removed ? 'warn' : 'info', 'What will happen.', outcome));
      if (nothing && !plan.problems.length) children.push(notice('ok', 'Nothing to restore.', 'Every record in this backup is already on this phone.'));

      // Safety backup
      let applyEnabled = !plan.problems.length && !nothing;
      if (needSafety && !plan.problems.length && !nothing) {
        const sameId = uid('same');
        const same = h('input', { type: 'checkbox', id: sameId, checked: S.pwMode === 'same' });
        const safetyPw = passwordInput('Password for the safety backup', 'rs-safety-pw');
        safetyPw.value = S.safetyPw;
        safetyPw.hidden = S.pwMode === 'same';
        safetyPw.addEventListener('input', () => {
          S.safetyPw = safetyPw.value;
        });
        same.addEventListener('change', () => {
          S.pwMode = same.checked ? 'same' : 'new';
          draw();
        });
        const skipId = uid('skipsafe');
        const skipSafe = h('input', { type: 'checkbox', id: skipId, checked: S.safetySkip });
        skipSafe.addEventListener('change', () => {
          S.safetySkip = skipSafe.checked;
          draw();
        });
        const sbtn = button(S.safetyDone ? 'Safety backup saved ✓' : 'Step 1: Save a safety backup of this phone', S.safetyDone ? 'btn btn-secondary btn-block' : 'btn btn-primary btn-block', async () => {
          const pwUse = S.pwMode === 'same' ? S.password : S.safetyPw;
          if (!pwUse || pwUse.length < B.MIN_PASSWORD) {
            S.error = 'Use a safety backup password of at least ' + B.MIN_PASSWORD + ' characters.';
            return draw();
          }
          sbtn.disabled = true;
          S.error = '';
          try {
            const file = await B.createBackupFile(pwUse, { kind: 'safety', timeZone: settings.defaultTimezone });
            B.downloadBytes(file.bytes, file.fileName);
            await B.recordBackup(file);
            S.safetyDone = true;
            S.current = await db.readAll();
            toast('Safety backup saved to Downloads: ' + file.fileName);
          } catch (e) {
            S.error = 'The safety backup failed: ' + friendlyError(e);
          }
          draw();
        }, 'download', { disabled: S.safetyDone });
        children.push(h('div', { class: 'box' },
          h('h3', { class: 'box-title', text: 'Protect what is on this phone first' }),
          h('p', { class: 'small', text: 'This restore would change or delete records that are on this phone. Save a safety backup first so you can undo it.' }),
          h('label', { class: 'check', for: sameId }, same, h('span', { text: 'Protect it with the same password as the backup I am restoring' })),
          safetyPw, sbtn,
          S.safetyDone ? null : h('label', { class: 'check', for: skipId }, skipSafe, h('span', { text: 'Continue without a safety backup (not recommended)' }))));
        applyEnabled = applyEnabled && (S.safetyDone || S.safetySkip);
      }

      // Confirmation for replace
      let confirmInput = null;
      if (S.mode === 'replace' && hasCurrent && !plan.problems.length && !nothing) {
        confirmInput = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'characters', 'aria-label': 'Type REPLACE to confirm', class: 'dialog-input' });
        children.push(h('div', { class: 'field' }, h('label', { text: 'Step 2: type REPLACE to confirm deleting the current records' }), confirmInput));
      }

      const err = h('p', { class: 'field-error', role: 'alert', hidden: !S.error, text: S.error });
      const applyBtn = button(S.mode === 'replace' ? 'Replace everything with this backup' : 'Restore (merge)', S.mode === 'replace' ? 'btn btn-danger btn-block' : 'btn btn-primary btn-block', async () => {
        if (confirmInput && confirmInput.value.trim().toUpperCase() !== 'REPLACE') {
          S.error = 'Type REPLACE in the box to confirm.';
          return draw();
        }
        applyBtn.disabled = true;
        S.error = '';
        try {
          const fresh = await db.readAll();
          const again = B.makePlan(S.parsed, fresh, planOptions());
          if (U.stable(again.summary) !== U.stable(plan.summary) || again.problems.length) {
            S.current = fresh;
            S.error = 'The records on this phone changed while you were reviewing. Please review the updated preview.';
            return draw();
          }
          const summary = await B.applyPlan(again, { fileName: S.file.name, sizeBytes: S.file.size, appVersion: S.parsed.meta.appVersion, dbSchemaVersion: S.parsed.meta.dbSchemaVersion });
          S.step = 'done';
          S.summary = summary;
          S.modeDone = again.mode;
          S.parsed = null;
          S.password = '';
          S.safetyPw = '';
          S.current = null;
          settings = await db.getSettings();
          onChange();
        } catch (e) {
          S.error = e instanceof B.BackupError ? e.message : 'Restore failed and nothing was changed: ' + friendlyError(e);
        }
        draw();
      }, 'upload', { disabled: !applyEnabled });
      children.push(err, applyBtn, button('Cancel', 'btn btn-secondary btn-block', () => {
        reset();
        draw();
      }));
      return children;
    }

    function drawDone() {
      const s = S.summary;
      return [
        ...head(),
        notice('ok', 'Restore complete.', S.modeDone === 'replace'
          ? s.added + ' added, ' + s.updated + ' updated, ' + s.removed + ' removed.'
          : s.added + ' added, ' + s.updated + ' updated, ' + s.kept + ' kept as they were.'),
        h('div', { class: 'actions' }, link('#/farm', 'Go to My Farm', 'btn btn-primary', 'farm'), button('Restore another file', 'btn btn-secondary', () => {
          reset();
          draw();
        })),
      ];
    }

    function draw() {
      const nodes = S.step === 'choose' ? drawChoose() : S.step === 'preview' ? drawPreview() : drawDone();
      card.replaceChildren(...nodes.filter(Boolean));
    }
    draw();
    return card;
  }

  async function viewBackup() {
    const [counts, backups, st] = await Promise.all([db.getCounts(), db.listBackups(8), db.getSettings()]);
    settings = st;
    const wrap = h('div', { class: 'stack' });
    wrap.appendChild(pageHead('Backup', 'Protect your records and move them between phones'));
    const bs = backupStatus(st, counts);
    wrap.appendChild(notice(bs.level === 'warn' ? 'warn' : bs.level === 'ok' ? 'ok' : 'info', bs.title, bs.text + (st.lastBackupAt ? ' Last backup: ' + fmtDate(st.lastBackupAt, true) + '.' : '')));
    const history = h('section', { class: 'card' });
    const drawHistory = async () => {
      const list = await db.listBackups(8);
      history.replaceChildren(h('h2', { class: 'card-title', text: 'Backup history on this phone' }),
        list.length
          ? h('ul', { class: 'activity' }, list.map((b) => h('li', null,
            h('span', { class: 'activity-dot act-backup', 'aria-hidden': 'true' }),
            h('div', { class: 'activity-body' },
              h('div', { class: 'activity-text', text: (b.kind === 'export' ? 'Backup' : b.kind === 'safety' ? 'Safety backup' : 'Restore') + (b.fileName ? ': ' + b.fileName : '') }),
              h('div', { class: 'small muted', text: fmtDate(b.createdAt, true) + (b.sizeBytes ? ' · ' + fmtBytes(b.sizeBytes) : '') + (b.note ? ' · ' + b.note : '') })))))
          : h('p', { class: 'muted', text: 'No backups or restores yet.' }));
    };
    wrap.appendChild(createBackupCard(drawHistory));
    wrap.appendChild(restoreCard(drawHistory));
    wrap.appendChild(h('section', { class: 'card' },
      h('h2', { class: 'card-title', text: 'Moving to another phone' }),
      h('ol', { class: 'steps' },
        h('li', null, 'On this phone: create an encrypted backup (above).'),
        h('li', null, 'Send the .amabackup file to the other phone: Share, Google Drive, email to yourself, WhatsApp "document", Bluetooth or a USB cable.'),
        h('li', null, 'On the other phone: open AMA FarmTech Offline in Chrome (install it like on this phone).'),
        h('li', null, 'Open Backup, choose the file, enter the password and restore.'),
        h('li', null, 'Check that your farms and fields are there before deleting anything on the old phone.')),
      notice('info', '', 'The password is the only key. Nothing from the old phone\'s browser is needed.')));
    wrap.appendChild(history);
    await drawHistory();
    return wrap;
  }

  /* ================================================================== */
  /* View: Settings                                                      */
  /* ================================================================== */

  async function viewSettings() {
    const [st, info, offline, schema, counts] = await Promise.all([db.getSettings(), storageInfo(), offlineStatus(), db.getSchemaInfo(), db.getCounts()]);
    settings = st;
    const wrap = h('div', { class: 'stack' });
    wrap.appendChild(pageHead('Settings'));

    // Defaults
    const C = {
      defaultCountry: formControl({ name: 'defaultCountry', label: 'Default country', max: V.MAX.short }, st.defaultCountry),
      defaultCurrency: formControl({ name: 'defaultCurrency', label: 'Default currency', max: 3, capitalize: 'characters', hint: '3-letter code, e.g. UGX' }, st.defaultCurrency),
      defaultTimezone: formControl({ name: 'defaultTimezone', label: 'Time zone', list: 'tz-list2', max: 64, capitalize: 'none', hint: 'Dates in the app use this time zone.' }, st.defaultTimezone),
      backupReminderDays: formControl({ name: 'backupReminderDays', label: 'Backup reminder (days)', type: 'text', inputmode: 'numeric', max: 3, hint: 'Remind me to back up when records changed and the last backup is older than this.' }, String(st.backupReminderDays)),
    };
    const saveBtn = button('Save settings', 'btn btn-primary btn-block', null, null, { type: 'submit' });
    const form = h('form', { class: 'form', novalidate: true },
      C.defaultCountry.wrap, h('div', { class: 'grid-2' }, C.defaultCurrency.wrap, C.defaultTimezone.wrap), C.backupReminderDays.wrap,
      datalist('tz-list2', ['Africa/Kampala', 'Africa/Nairobi', 'Africa/Kigali', 'Africa/Juba', 'Africa/Dar_es_Salaam', 'UTC']), saveBtn);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const values = {};
      Object.keys(C).forEach((k) => {
        values[k] = C[k].el.value;
      });
      const errors = {};
      Object.keys(values).forEach((k) => {
        const r = V.setting(k, values[k]);
        if (!r.ok) errors[k] = r.error;
      });
      applyErrors(C, errors);
      if (Object.keys(errors).length) return;
      try {
        await db.saveSettings(values);
        settings = await db.getSettings();
        toast('Settings saved. They are used for new farms.');
        render();
      } catch (e) {
        toast(friendlyError(e), 'error');
      }
    });
    wrap.appendChild(h('section', { class: 'card' }, h('h2', { class: 'card-title', text: 'Defaults' }), form));

    // Install
    const inst = installCard(false);
    const instWrap = h('div', { id: 'install' }, inst);
    wrap.appendChild(instWrap);

    // Storage
    const pt = persistenceText(info);
    wrap.appendChild(h('section', { class: 'card' },
      h('h2', { class: 'card-title' }, icon('database'), 'Storage'),
      kvList([['Storage protection', h('span', { class: 'chip ' + (pt.kind === 'ok' ? 'chip-ok' : 'chip-warn'), text: pt.title })]]),
      usageBar(info),
      notice(pt.kind, '', pt.text),
      h('p', { class: 'small muted', text: 'Protection reduces the chance Chrome clears data when space is low. It does not protect against deleting site data, uninstalling Chrome, a damaged phone or a lost phone. Only backups kept outside the phone do.' }),
      info.supported && !info.persisted ? button('Ask Chrome to protect storage', 'btn btn-secondary', async () => {
        const ok = await requestPersistence();
        toast(ok ? 'Storage is now protected.' : 'Chrome did not grant protection. Installing the app and using it regularly can help.', ok ? null : 'error');
        render();
      }, 'lock') : null));

    // Offline and updates
    const upd = h('p', { class: 'small muted', 'aria-live': 'polite' });
    wrap.appendChild(h('section', { class: 'card' },
      h('h2', { class: 'card-title' }, icon('wifi'), 'Offline use and updates'),
      notice(offline.state === 'ok' ? 'ok' : offline.state === 'pending' ? 'info' : 'warn', offline.state === 'ok' ? 'Offline files stored.' : '', offline.text),
      button('Check for a new version', 'btn btn-secondary', async () => {
        if (!navigator.onLine) {
          upd.textContent = 'You are offline. Updates can only be checked online.';
          return;
        }
        upd.textContent = 'Checking...';
        const ok = await checkForUpdate(true);
        upd.textContent = ok ? 'Check finished. If a new version exists, a banner will appear at the top.' : 'Could not check for updates right now.';
      }, 'download'), upd));

    // About
    wrap.appendChild(h('section', { class: 'card' },
      h('h2', { class: 'card-title', text: 'About' }),
      kvList([
        ['App', AMA.APP_NAME], ['Brand', AMA.BRAND], ['Version', AMA.APP_VERSION],
        ['Database', schema.name + ' (version ' + schema.version + ')'],
        ['Stored records', plural(counts.farms, 'farm') + ', ' + plural(counts.fields, 'field') + ', ' + plural(counts.crops || 0, 'crop') + ', ' + plural(counts.cycles || 0, 'crop cycle') + ', ' + plural(counts.activities, 'activity entry', 'activity entries')],
        ['Secure connection', window.isSecureContext ? 'Yes (https)' : 'No - offline use and encryption need https'],
      ]),
      h('p', { class: 'small muted', text: 'All records stay on this phone. The app has no account, no cloud database and sends no farm data anywhere.' })));

    // Danger zone
    wrap.appendChild(h('section', { class: 'card card-danger' },
      h('h2', { class: 'card-title', text: 'Erase all data on this phone' }),
      h('p', { class: 'muted', text: 'Deletes every farm, field, crop record and activity entry stored in this app on this phone. Backup files you saved are not affected.' }),
      button('Erase all data', 'btn btn-danger-outline', async () => {
        const ok = await confirmDialog({
          title: 'Erase all data?',
          message: ['This permanently deletes all farms, fields, crop records and activity on this phone. This cannot be undone.', 'Make a backup first if you might want these records again.'],
          confirmText: 'Erase everything', danger: true, requireText: 'ERASE',
        });
        if (!ok) return;
        try {
          await db.eraseAllData();
          settings = await db.getSettings();
          toast('All data erased.');
          goto('#/', true);
          render();
        } catch (e) {
          toast(friendlyError(e), 'error');
        }
      }, 'trash')));
    return wrap;
  }

  const VIEWS = {
    dashboard: viewDashboard,
    farms: viewFarms,
    farmDetail: viewFarmDetail,
    farmForm: viewFarmForm,
    fieldDetail: viewFieldDetail,
    fieldForm: viewFieldForm,
    records: viewRecords,
    backup: viewBackup,
    settings: viewSettings,
    notFound: async () => notFoundView(),
  };

  /* ================================================================== */
  /* Extension point (Phase 2: crops-ui.js adds its screens through this) */
  /* ================================================================== */

  AMA.ui = {
    $, h, icon, ICONS, uid, plural, fmtDate, fmtRelative, fmtBytes, areaText, locationLine,
    toast, confirmDialog, emptyState, notice, pageHead, link, button, kvList, friendlyError,
    formControl, applyErrors, datalist, statCard, notFoundView, goto,
    render: () => render(),
    getSettings: () => settings,
    refreshSettings: async () => {
      settings = await db.getSettings();
      return settings;
    },
    addRoutes(routes, views) {
      routes.forEach((route) => ROUTES.push(route));
      Object.assign(VIEWS, views);
    },
  };

  /* ================================================================== */
  /* Start-up                                                            */
  /* ================================================================== */

  function fatal(e) {
    const err = db.normalizeError(e);
    $('#main').replaceChildren(h('div', { class: 'stack' },
      pageHead('The app could not start'),
      notice('danger', '', err.message),
      h('p', { class: 'muted', text: 'If this keeps happening, make sure Chrome is up to date and you are not using private (incognito) browsing.' }),
      button('Try again', 'btn btn-primary', () => window.location.reload())));
    document.querySelector('.bottom-nav').hidden = true;
  }

  async function boot() {
    $('#app-version').textContent = 'v' + AMA.APP_VERSION;
    setupConnectionIndicator();
    setupInstallPrompt();
    db.onNotice((type) => {
      if (type === 'versionchange') {
        setBanner('db', h('div', { class: 'banner banner-warn', role: 'alert' }, icon('warn'),
          h('div', { class: 'banner-text', text: 'The app was updated in another tab. Reload to continue.' }),
          button('Reload', 'btn btn-light btn-small', () => window.location.reload())));
      } else if (type === 'blocked') {
        setBanner('db', h('div', { class: 'banner banner-warn', role: 'alert' }, icon('warn'),
          h('div', { class: 'banner-text', text: 'An update is waiting. Close other tabs of this app to finish it.' })));
      }
    });
    try {
      await db.open();
      settings = await db.getSettings();
    } catch (e) {
      fatal(e);
      return;
    }
    window.addEventListener('hashchange', render);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      checkForUpdate();
      if (currentRoute && currentRoute.name === 'dashboard') render();
    });
    await render();
    registerServiceWorker();
    storageInfo().then((info) => {
      if (info.supported && !info.persisted) return db.getCounts().then((c) => (c.farms ? requestPersistence() : null));
      return null;
    }).catch(() => {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
