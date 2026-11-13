/*
 * EasyHangar exporter
 *
 * Runs on robertsspaceindustries.com, in your own browser, with whatever account is signed in
 * there. It reads your hangar and buy-back pages (GET requests only), changes nothing in the
 * account, and uploads nothing: the result goes to a file in your Downloads folder and, when the
 * EasyHangar page is open, straight to that tab.
 *
 * The EasyHangar page loads this file too, only to offer it as a bookmark and a copyable script.
 */
(function () {
  async function easyHangarExport(config) {
    'use strict';
    if (!/(^|\.)robertsspaceindustries\.com$/i.test(location.hostname)) {
      alert('This runs on the RSI website.\n\nOpen robertsspaceindustries.com, sign in, then run it again there.');
      return;
    }
    if (window.__hangarExportRunning) return;

    const HANGAR_URL = '/en/account/pledges';
    const BUYBACK_URL = '/en/account/buy-back-pledges';
    const BUYBACK_PAGESIZE = 100;
    const DELAY_MS = 300; // pause between requests, to be polite to the server
    const DETAIL_WORKERS = 2; // buy-back pages read at the same time
    const MAX_PAGES = 500; // safety stop

    // ------------------------------------------------------------------ panel
    // Lives in a shadow root so the site's own styles cannot disturb it.

    const oldHost = document.getElementById('rsi-hangar-export');
    if (oldHost) oldHost.remove();
    const host = document.createElement('div');
    host.id = 'rsi-hangar-export';
    host.style.cssText = 'position:fixed;z-index:2147483647;right:20px;bottom:20px;';
    const root = host.attachShadow({ mode: 'open' });
    const sheet = document.createElement('style');
    sheet.textContent = [
      '.panel{box-sizing:border-box;width:340px;max-width:calc(100vw - 40px);background:#0f161e;color:#e6edf3;',
      'border:1px solid #4cc2ff;border-radius:10px;padding:16px;font:14px/1.45 "Segoe UI",system-ui,sans-serif;',
      'box-shadow:0 10px 40px rgba(0,0,0,.6);text-align:left}',
      '.title{font-weight:650;font-size:16px;margin-bottom:8px}',
      '.status{color:#b6c2d0;margin-bottom:12px;overflow-wrap:anywhere}',
      '.status.bad{color:#ff9d8a}',
      '.track{height:6px;border-radius:3px;background:#223040;overflow:hidden;margin-bottom:12px}',
      '.bar{height:100%;width:0;background:#4cc2ff;transition:width .2s}',
      '.opt{display:flex;gap:8px;align-items:flex-start;margin:0 0 10px;cursor:pointer}',
      '.opt input{margin:3px 0 0;width:16px;height:16px;accent-color:#4cc2ff;flex:none}',
      '.hint{display:block;color:#8a9bb0;font-size:12.5px}',
      '.note{color:#8a9bb0;font-size:12.5px;margin-bottom:12px;overflow-wrap:anywhere}',
      '.row{display:flex;gap:8px;flex-wrap:wrap}',
      'button{font:inherit;cursor:pointer;border-radius:7px;padding:7px 14px;border:1px solid #2b3b4d;background:#18212c;color:#e6edf3}',
      'button.primary{background:#4cc2ff;border-color:#4cc2ff;color:#04202e;font-weight:600}',
      'button:focus-visible,input:focus-visible{outline:2px solid #4cc2ff;outline-offset:2px}',
      '[hidden]{display:none!important}',
    ].join('');
    const mk = (tag, cls, txt) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (txt != null) n.textContent = txt;
      return n;
    };
    const panel = mk('div', 'panel');
    const statusEl = mk('div', 'status', 'This reads your hangar pages on this site so you can browse them in EasyHangar. It only reads: nothing in your account is changed and nothing is uploaded. A copy is saved as a file in your Downloads folder.');
    const track = mk('div', 'track');
    const bar = mk('div', 'bar');
    track.hidden = true;
    track.append(bar);
    const options = mk('div');
    const addOption = (label, hint) => {
      const wrap = mk('label', 'opt');
      const box = mk('input');
      box.type = 'checkbox';
      box.checked = true;
      const words = mk('span', '', label);
      if (hint) words.append(mk('span', 'hint', hint));
      wrap.append(box, words);
      options.append(wrap);
      return box;
    };
    const optBuybacks = addOption('Buy-back pledges');
    const optDetails = addOption('Buy-back prices and contents', 'Slow: opens one page per buy-back, so hundreds of buy-backs take several minutes.');
    optBuybacks.addEventListener('change', () => {
      optDetails.disabled = !optBuybacks.checked;
      if (!optBuybacks.checked) optDetails.checked = false;
    });
    const buttons = mk('div', 'row');
    const startBtn = mk('button', 'primary', 'Start');
    const showBtn = mk('button', 'primary', 'Show my hangar');
    const againBtn = mk('button', '', 'Save file again');
    const closeBtn = mk('button', '', 'Close');
    startBtn.type = showBtn.type = againBtn.type = closeBtn.type = 'button';
    showBtn.hidden = againBtn.hidden = true;
    buttons.append(startBtn, showBtn, againBtn, closeBtn);
    // Where the saved file went, shown once the export is done
    const noteEl = mk('div', 'note');
    noteEl.hidden = true;
    panel.append(mk('div', 'title', 'EasyHangar'), statusEl, track, options, noteEl, buttons);
    root.append(sheet, panel);
    document.body.append(host);

    let running = false;
    let cancelled = false;
    const checkCancel = () => { if (cancelled) throw new Error('Cancelled'); };
    function setStatus(message, fraction) {
      statusEl.textContent = message;
      if (fraction != null) bar.style.width = Math.round(Math.max(0, Math.min(1, fraction)) * 100) + '%';
    }

    // ---------------------------------------------------------------- helpers

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const text = (node, sel) => {
      const el = node.querySelector(sel);
      return el ? clean(el.textContent) : '';
    };
    const hidden = (node, cls) => {
      const el = node.querySelector('input.' + cls);
      return el ? el.value : '';
    };
    const absUrl = (u) => {
      if (!u) return '';
      try {
        return new URL(u, location.origin).href;
      } catch (e) {
        return u;
      }
    };
    const bgImage = (el) => {
      if (!el) return '';
      const m = /url\((['"]?)(.*?)\1\)/.exec(el.getAttribute('style') || '');
      return m && m[2] ? absUrl(m[2]) : '';
    };
    const json = (node, sel) => {
      const el = node.querySelector(sel);
      if (!el) return null;
      try {
        return JSON.parse(el.textContent);
      } catch (e) {
        return null;
      }
    };
    // "$575.00 USD" -> { amount: 575, currency: "USD" }
    const money = (s) => {
      const m = /(-?[\d.,]+)\s*([A-Za-z]{3})?/.exec(s || '');
      if (!m) return { amount: null, currency: '' };
      return { amount: parseFloat(m[1].replace(/,/g, '')), currency: (m[2] || '').toUpperCase() };
    };
    // "November 12, 2026" -> "2026-11-12"
    const isoDate = (s) => {
      const d = new Date(s);
      if (isNaN(d)) return '';
      const p = (n) => String(n).padStart(2, '0');
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    };
    // Text of an element without its <label>
    const afterLabel = (node, sel) => {
      const el = node.querySelector(sel);
      if (!el) return '';
      const copy = el.cloneNode(true);
      copy.querySelectorAll('label').forEach((l) => l.remove());
      return clean(copy.textContent);
    };
    const isInsurance = (s) => /insurance/i.test(s);
    const lastPageOf = (doc) => {
      const last = doc.querySelector('.pager a.raquo');
      const m = last ? /[?&]page=(\d+)/.exec(last.getAttribute('href') || '') : null;
      return m ? parseInt(m[1], 10) : null;
    };

    // GET a page and parse it. Retries with a growing pause when the server pushes back.
    async function fetchDoc(url) {
      const waits = [2000, 6000, 15000, 30000];
      for (let attempt = 0; ; attempt++) {
        checkCancel();
        let problem = '';
        try {
          const res = await fetch(url, { credentials: 'same-origin' });
          if (res.ok) {
            const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
            if (/access denied/i.test(doc.title)) throw new Error('Not signed in');
            return doc;
          }
          problem = 'HTTP ' + res.status;
          // A missing page will not appear on a retry
          if (res.status === 404 || res.status === 403) throw new Error(problem + ' for ' + url);
        } catch (err) {
          if (/Not signed in|HTTP 40[34]/.test(String(err.message))) throw err;
          problem = String(err.message || err);
        }
        if (attempt >= waits.length) throw new Error(problem + ' for ' + url);
        console.warn('[hangar] ' + problem + ' on ' + url + ', retrying in ' + waits[attempt] / 1000 + 's');
        setStatus('RSI is slow to answer. Trying again in ' + waits[attempt] / 1000 + ' seconds.');
        await sleep(waits[attempt]);
      }
    }

    // ----------------------------------------------------------------- hangar

    const KNOWN_INPUTS = [
      'js-pledge-id',
      'js-pledge-name',
      'js-pledge-value',
      'js-pledge-configuration-value',
      'js-pledge-currency',
      'js-pledge-last-alpha',
      'js-pledge-not-buybackable',
    ];

    function parsePledge(li, page) {
      const value = money(hidden(li, 'js-pledge-value'));
      const config = money(hidden(li, 'js-pledge-configuration-value'));
      const createdText = afterLabel(li, '.date-col');

      const items = [...li.querySelectorAll('.with-images .item')].map((it) => {
        const liner = it.querySelector('.liner');
        let manufacturer = '';
        let manufacturerCode = '';
        if (liner) {
          manufacturerCode = text(liner, 'span');
          manufacturer = clean(liner.textContent).replace(/\s*\([^)]*\)\s*$/, '');
        }
        const item = {
          title: text(it, '.title'),
          kind: text(it, '.kind'),
          manufacturer,
          manufacturerCode,
          image: bgImage(it.querySelector('.image')),
        };
        // Name the owner gave the ship (e.g. on an Idris), when there is one
        const customName = text(it, '.custom-name-text');
        if (customName) item.customName = customName;
        return item;
      });

      const alsoContains = [...li.querySelectorAll('.without-images .item')]
        .map((it) => text(it, '.title') || clean(it.textContent))
        .filter(Boolean);

      // Action buttons shown for this pledge (Exchange / Gift / Upgrade ...)
      const actionEls = [...li.querySelectorAll('.items a.shadow-button')];
      // True when a button has a class starting with the given prefix (js-gift, js-gift-v2, ...)
      const hasAction = (prefix) => actionEls.some((a) => [...a.classList].some((c) => c.startsWith(prefix)));
      const actions = actionEls
        .filter((a) => !a.classList.contains('js-rename-ship'))
        .map((a) => text(a, '.js-label') || clean(a.textContent))
        .filter(Boolean);

      // Keep any hidden fields this script does not know about (e.g. upgrade data)
      const other = {};
      li.querySelectorAll('input[type=hidden]').forEach((inp) => {
        const cls = [...inp.classList].find((c) => c.startsWith('js-'));
        if (cls && !KNOWN_INPUTS.includes(cls)) other[cls] = inp.value;
      });

      const pledge = {
        id: hidden(li, 'js-pledge-id'),
        name: hidden(li, 'js-pledge-name') || text(li, 'h3'),
        value: value.amount,
        valueCurrency: value.currency,
        valueText: hidden(li, 'js-pledge-value'),
        configurationValue: config.amount,
        paidWith: hidden(li, 'js-pledge-currency'),
        created: isoDate(createdText),
        createdText,
        contains: afterLabel(li, '.items-col'),
        availability: text(li, '.availability'),
        image: bgImage(li.querySelector('.basic-infos .image')),
        canExchange: hasAction('js-reclaim'),
        canGift: hasAction('js-gift'),
        canUpgrade: hasAction('js-apply-upgrade'),
        canRename: hasAction('js-rename-ship'),
        actions,
        buybackable: hidden(li, 'js-pledge-not-buybackable') !== '1',
        lastAlpha: hidden(li, 'js-pledge-last-alpha') === '1',
        nameableShips: json(li, '.js-pledge-nameable-ships'),
        nameReservations: json(li, '.js-pledge-name-reservations'),
        items,
        alsoContains,
        page,
      };
      if (Object.keys(other).length) pledge.other = other;
      return pledge;
    }

    async function readHangar(report) {
      const pledges = [];
      const seen = new Set();
      let lastPage = null;
      let pagesRead = 0;
      for (let page = 1; page <= MAX_PAGES; page++) {
        const doc = await fetchDoc(HANGAR_URL + '?page=' + page);
        const rows = [...doc.querySelectorAll('ul.list-items > li')];
        const lp = lastPageOf(doc);
        if (lp) lastPage = Math.max(lastPage || 0, lp);
        let added = 0;
        for (const li of rows) {
          const p = parsePledge(li, page);
          const key = p.id || p.name + '|' + p.createdText + '|' + pledges.length;
          if (seen.has(key)) continue;
          seen.add(key);
          pledges.push(p);
          added++;
        }
        pagesRead = page;
        report(page, lastPage);
        // Stop on an empty page, a page of repeats, or once the last page is done
        if (rows.length === 0 || added === 0) break;
        if (lastPage && page >= lastPage) break;
        await sleep(DELAY_MS);
      }
      return { pledges, pagesRead };
    }

    // One row per ship, carrying the details of the pledge it lives in
    function flattenShips(pledges) {
      const ships = [];
      for (const p of pledges) {
        const insurance = [
          ...p.items.filter((i) => i.kind === 'Insurance' || isInsurance(i.title)).map((i) => i.title),
          ...p.alsoContains.filter(isInsurance),
        ];
        const shipItems = p.items.filter((i) => i.kind === 'Ship');
        for (const s of shipItems) {
          ships.push({
            name: s.title,
            customName: s.customName || '',
            manufacturer: s.manufacturer,
            manufacturerCode: s.manufacturerCode,
            image: s.image,
            insurance,
            pledgeId: p.id,
            pledgeName: p.name,
            pledgeValue: p.value,
            pledgeCurrency: p.valueCurrency,
            paidWith: p.paidWith,
            created: p.created,
            availability: p.availability,
            canExchange: p.canExchange,
            canGift: p.canGift,
            shipsInPledge: shipItems.length,
          });
        }
      }
      return ships;
    }

    // -------------------------------------------------------------- buy-backs

    function parseBuybackRow(article, page) {
      const name = text(article, 'h1');
      const fields = {};
      article.querySelectorAll('dl dt').forEach((dt) => {
        const dd = dt.nextElementSibling;
        if (dd && dd.tagName === 'DD') fields[clean(dt.textContent)] = clean(dd.textContent);
      });
      const img = article.querySelector('figure img');
      const link = article.querySelector('a.holosmallbtn[href*="/pledge/buyback/"]');
      const upgradeBtn = article.querySelector('a.js-open-ship-upgrades');
      const idMatch = link ? /\/pledge\/buyback\/(\d+)/.exec(link.getAttribute('href')) : null;
      const reclaimText = fields['Reclaim Date'] || '';

      const row = {
        id: idMatch ? idMatch[1] : upgradeBtn ? upgradeBtn.getAttribute('data-pledgeid') || '' : '',
        name,
        // "Standalone Ships - Sabre Peregrine" -> category "Standalone Ships"
        category: name.includes(' - ') ? name.split(' - ')[0] : '',
        reclaimed: isoDate(reclaimText),
        reclaimedText: reclaimText,
        contained: fields['Contained'] || '',
        image: img ? absUrl(img.getAttribute('src')) : '',
        isUpgrade: !!upgradeBtn,
        buybackUrl: link ? absUrl(link.getAttribute('href')) : '',
        page,
      };
      if (upgradeBtn) {
        // Ship upgrades are bought back through the upgrade tool and have no page of their own
        row.upgrade = {
          fromShipId: upgradeBtn.getAttribute('data-fromshipid') || '',
          toShipId: upgradeBtn.getAttribute('data-toshipid') || '',
          toSkuId: upgradeBtn.getAttribute('data-toskuid') || '',
        };
      }
      // Any list fields beyond the two known ones
      for (const k of Object.keys(fields)) {
        if (k !== 'Reclaim Date' && k !== 'Contained') (row.otherFields = row.otherFields || {})[k] = fields[k];
      }
      return row;
    }

    async function readBuybackList(report) {
      const rows = [];
      const seen = new Set();
      let lastPage = null;
      let pagesRead = 0;
      for (let page = 1; page <= MAX_PAGES; page++) {
        const doc = await fetchDoc(BUYBACK_URL + '?page=' + page + '&pagesize=' + BUYBACK_PAGESIZE);
        const articles = [...doc.querySelectorAll('section.available-pledges ul.pledges > li > article.pledge')];
        const lp = lastPageOf(doc);
        if (lp) lastPage = Math.max(lastPage || 0, lp);
        let added = 0;
        for (const a of articles) {
          const r = parseBuybackRow(a, page);
          const key = r.id || r.name + '|' + r.reclaimedText + '|' + rows.length;
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push(r);
          added++;
        }
        pagesRead = page;
        report(page, lastPage);
        if (articles.length === 0 || added === 0) break;
        if (lastPage && page >= lastPage) break;
        await sleep(DELAY_MS);
      }
      return { rows, pagesRead };
    }

    // The buy-back's own store page: price, what is inside, description
    function parseBuybackDetail(doc) {
      const priceEl = doc.querySelector('.final-price');
      const cents = priceEl ? parseInt(priceEl.getAttribute('data-value'), 10) : NaN;
      const buyBtn = doc.querySelector('a.js-buy-back');
      const img = doc.querySelector('.lcol figure img');
      const viewAll = doc.querySelector('a.viewall');
      const tokens = doc.querySelector('.buy-back-warning strong');

      const ships = [...doc.querySelectorAll('.package-listing.ship li')].map((li) => {
        const info = {};
        li.querySelectorAll('.info').forEach((d) => {
          const label = clean(d.textContent.split(':')[0]).toLowerCase();
          info[label] = text(d, 'span');
        });
        const shipImg = li.querySelector('img');
        const page = li.querySelector('a[href]');
        const ship = {
          name: info.ship || info.vehicle || info.name || '',
          manufacturer: info.manufacturer || '',
          focus: info.focus || '',
          image: shipImg ? absUrl(shipImg.getAttribute('src')) : '',
          shipPage: page ? absUrl(page.getAttribute('href')) : '',
        };
        for (const k of Object.keys(info)) {
          if (!['ship', 'vehicle', 'name', 'manufacturer', 'focus'].includes(k)) (ship.other = ship.other || {})[k] = info[k];
        }
        return ship;
      });

      // Every other list on the page, by its heading ("Also Contains", ...)
      const alsoContains = [];
      const otherLists = {};
      doc.querySelectorAll('.package-listing:not(.ship)').forEach((box) => {
        const heading = text(box, 'h4') || 'Items';
        const entries = [...box.querySelectorAll('li')].map((li) => clean(li.textContent)).filter(Boolean);
        if (/also contains/i.test(heading)) alsoContains.push(...entries);
        else otherLists[heading] = (otherLists[heading] || []).concat(entries);
      });

      const detail = {
        price: isNaN(cents) ? null : cents / 100,
        priceCurrency: priceEl ? priceEl.getAttribute('data-currency') || '' : '',
        priceText: priceEl ? clean(priceEl.textContent) : '',
        sku: buyBtn ? buyBtn.getAttribute('data-sku') || '' : '',
        canAddToCart: !!buyBtn,
        storeCategory: viewAll ? text(viewAll, 'span') : '',
        storeImage: img ? absUrl(img.getAttribute('src')) : '',
        description: text(doc, '.buy-back-description'),
        ships,
        alsoContains,
        insurance: alsoContains.filter(isInsurance),
      };
      if (Object.keys(otherLists).length) detail.otherLists = otherLists;
      return { detail, tokens: tokens ? parseInt(tokens.textContent, 10) : null };
    }

    async function readBuybackDetails(rows, report) {
      const todo = rows.filter((r) => r.buybackUrl);
      let next = 0;
      let done = 0;
      let failed = 0;
      let tokens = null;
      async function worker() {
        while (next < todo.length) {
          const row = todo[next++];
          try {
            const parsed = parseBuybackDetail(await fetchDoc(row.buybackUrl));
            Object.assign(row, parsed.detail);
            if (parsed.tokens !== null && !isNaN(parsed.tokens)) tokens = parsed.tokens;
          } catch (err) {
            // Keep going: one unreadable page should not lose the rest
            if (/Not signed in|Cancelled/.test(String(err.message))) throw err;
            row.detailError = String(err.message || err);
            failed++;
          }
          done++;
          report(done, todo.length);
          await sleep(DELAY_MS);
        }
      }
      await Promise.all(Array.from({ length: DETAIL_WORKERS }, worker));
      return { tokens, failed };
    }

    // One row per ship that can be bought back
    function flattenBuybackShips(buybacks) {
      const out = [];
      for (const b of buybacks) {
        for (const s of b.ships || []) {
          out.push({
            name: s.name,
            manufacturer: s.manufacturer,
            focus: s.focus,
            image: s.image,
            shipPage: s.shipPage,
            insurance: b.insurance || [],
            buybackId: b.id,
            buybackName: b.name,
            price: b.price,
            priceCurrency: b.priceCurrency,
            reclaimed: b.reclaimed,
            canAddToCart: b.canAddToCart,
            buybackUrl: b.buybackUrl,
            shipsInPledge: b.ships.length,
          });
        }
      }
      return out;
    }

    // -------------------------------------------------------------------- run

    // "EasyHangar-2026-11-13.json": dated, so repeat exports do not pile up under one name
    function fileName(out) {
      return 'EasyHangar-' + out.exportedAt.slice(0, 10) + '.json';
    }
    function download(out) {
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileName(out);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }

    // ---------------------------------------------- handing over to the viewer
    // The data goes from this tab straight to the EasyHangar tab inside the browser
    // (postMessage). It is addressed to the viewer's own address only, so no other
    // site can receive it, and it never touches a server.

    const viewerUrl = config && /^https?:\/\//i.test(config.viewer || '') ? config.viewer : '';
    const viewerOrigin = viewerUrl ? new URL(viewerUrl).origin : '';

    // Send to one window; resolves true once the viewer confirms it has the data
    function sendTo(win, out) {
      return new Promise((resolve) => {
        if (!win || !viewerOrigin) { resolve(false); return; }
        const finish = (ok) => {
          clearTimeout(timer);
          removeEventListener('message', onMessage);
          resolve(ok);
        };
        const onMessage = (e) => {
          if (e.origin === viewerOrigin && e.data && e.data.type === 'easyhangar-ack') finish(true);
        };
        const timer = setTimeout(() => finish(false), 3000);
        addEventListener('message', onMessage);
        try {
          win.postMessage({ type: 'easyhangar-data', payload: out }, viewerOrigin);
        } catch (e) {
          finish(false);
        }
      });
    }

    // "Show my hangar": open the viewer in a new tab and give it the data when it says it is ready
    function openViewer(out) {
      const win = window.open(viewerUrl);
      if (!win) {
        noteEl.textContent = 'Your browser blocked the new tab. Open EasyHangar yourself and load the file ' + fileName(out) + ' from your Downloads folder.';
        return;
      }
      const onReady = (e) => {
        if (e.origin !== viewerOrigin || e.source !== win || !e.data || e.data.type !== 'easyhangar-ready') return;
        removeEventListener('message', onReady);
        sendTo(win, out);
      };
      addEventListener('message', onReady);
    }

    async function run() {
      const wantBuybacks = optBuybacks.checked;
      const wantDetails = wantBuybacks && optDetails.checked;
      const steps = 1 + (wantBuybacks ? 1 : 0) + (wantDetails ? 1 : 0);
      const step = (i, message) => 'Step ' + i + ' of ' + steps + ': ' + message;
      const outOf = (n, total) => n + (total ? ' of ' + total : '');

      running = true;
      cancelled = false;
      window.__hangarExportRunning = true;
      const progress = (window.__hangarProgress = { status: 'running', error: null });
      options.hidden = true;
      startBtn.hidden = true;
      showBtn.hidden = againBtn.hidden = noteEl.hidden = true;
      track.hidden = false;
      statusEl.className = 'status';
      closeBtn.textContent = 'Cancel';
      try {
        setStatus(step(1, 'reading your hangar'), 0);
        const hangar = await readHangar((page, last) => setStatus(step(1, 'hangar page ' + outOf(page, last)), last ? page / last : null));
        const ships = flattenShips(hangar.pledges);

        let buybacks = [];
        let buybackShips = [];
        let buybackPagesRead = 0;
        let buybackTokens = null;
        let buybackDetailsFailed = 0;
        if (wantBuybacks) {
          setStatus(step(2, 'reading the buy-back list'), 0);
          const list = await readBuybackList((page, last) => setStatus(step(2, 'buy-back page ' + outOf(page, last)), last ? page / last : null));
          buybacks = list.rows;
          buybackPagesRead = list.pagesRead;
          if (wantDetails) {
            setStatus(step(3, 'reading buy-back prices'), 0);
            const details = await readBuybackDetails(buybacks, (done, total) => setStatus(step(3, 'buy-back ' + outOf(done, total)), total ? done / total : null));
            buybackTokens = details.tokens;
            buybackDetailsFailed = details.failed;
            buybackShips = flattenBuybackShips(buybacks);
          }
        }

        const out = {
          exporterVersion: 2,
          exportedAt: new Date().toISOString(),
          source: location.origin + HANGAR_URL,
          pagesRead: hangar.pagesRead,
          pledgeCount: hangar.pledges.length,
          shipCount: ships.length,
          buybackSource: location.origin + BUYBACK_URL,
          buybackPagesRead,
          buybackCount: buybacks.length,
          buybackShipCount: buybackShips.length,
          buybackDetailsFailed,
          // "You have N opportunity to buy back a pledge with store credits"
          buybackTokens,
          ships,
          pledges: hangar.pledges,
          buybackShips,
          buybacks,
        };
        window.__hangarExport = out;
        progress.status = 'done';

        const counts = [out.pledgeCount + ' pledges', out.shipCount + ' ships'];
        if (wantBuybacks) counts.push(out.buybackCount + ' buy-backs');
        if (buybackDetailsFailed) counts.push(buybackDetailsFailed + ' buy-back pages could not be read');
        const saved = !window.__HANGAR_NO_DOWNLOAD;
        if (saved) download(out);
        // If this tab was opened from the EasyHangar page, that tab gets the data right away
        const delivered = await sendTo(window.opener, out);
        progress.delivered = delivered;

        const done = 'Done: ' + counts.join(', ') + '. ';
        if (delivered) setStatus(done + 'Your hangar is now showing in the EasyHangar tab. Switch back to it, or press Show my hangar.', 1);
        else if (viewerOrigin) setStatus(done + 'Press Show my hangar to see it.', 1);
        else setStatus(done + 'Go back to the EasyHangar page and press Load a file to open it.', 1);
        noteEl.textContent = 'A copy was saved as ' + fileName(out) + ' in your browser\'s Downloads folder (Ctrl+J shows it). You only need it as a backup.';
        noteEl.hidden = false;
        track.hidden = true;
        showBtn.hidden = !viewerOrigin;
        showBtn.onclick = () => openViewer(out);
        againBtn.hidden = false;
        againBtn.onclick = () => download(out);
      } catch (err) {
        const message = String(err && err.message ? err.message : err);
        if (message === 'Cancelled') {
          progress.status = 'cancelled';
          setStatus('Stopped. Nothing was saved.');
        } else {
          progress.status = 'error';
          progress.error = message;
          statusEl.className = 'status bad';
          setStatus(message === 'Not signed in'
            ? 'You are not signed in. Sign in on this site, then start again.'
            : 'The export failed: ' + message);
          console.error('[hangar] failed:', err);
        }
        track.hidden = true;
        bar.style.width = '0';
        options.hidden = false;
        startBtn.hidden = false;
        startBtn.textContent = 'Start again';
      } finally {
        running = false;
        window.__hangarExportRunning = false;
        closeBtn.textContent = 'Close';
        closeBtn.disabled = false;
      }
    }

    startBtn.addEventListener('click', run);
    closeBtn.addEventListener('click', () => {
      if (!running) { host.remove(); return; }
      cancelled = true;
      closeBtn.disabled = true;
      setStatus('Stopping.');
    });
  }

  if (/(^|\.)robertsspaceindustries\.com$/i.test(location.hostname)) {
    // Loaded by the bookmark: the viewer lives next to this file
    var self = document.currentScript && document.currentScript.src;
    easyHangarExport({ viewer: self ? new URL('./', self).href : '' });
  } else {
    // On the EasyHangar page: hand the function over, do not run it
    window.easyHangarExport = easyHangarExport;
  }
})();
