'use strict';

const APP_VERSION = '6.2.0';

function renderAppVersion() {
    const el = document.getElementById('app-version-value');
    if (el) el.textContent = `v${APP_VERSION}`;
}

let settingsReturnFocus = null;

function openSettings() {
        settingsReturnFocus = document.activeElement;
        document.getElementById('modal-overlay').classList.add('open');
        const modal = document.getElementById('settings-modal');
        modal.classList.add('open');
        renderAppVersion();
        refreshCacheIndicators();
        requestAnimationFrame(() => {
            const closeButton = modal.querySelector('.close-btn');
            if (closeButton) closeButton.focus({ preventScroll: true });
        });
    }
    function closeSettings() {
        document.getElementById('modal-overlay').classList.remove('open');
        document.getElementById('settings-modal').classList.remove('open');
        if (settingsReturnFocus && typeof settingsReturnFocus.focus === 'function') {
            settingsReturnFocus.focus({ preventScroll: true });
        }
        settingsReturnFocus = null;
    }
    function toggleDarkMode() {
        const isChecked = document.getElementById('dark-mode-toggle').checked;
        if (isChecked) {
            document.body.classList.add('dark-mode');
            localStorage.setItem('darkMode', 'enabled');
        } else {
            document.body.classList.remove('dark-mode');
            localStorage.setItem('darkMode', 'disabled');
        }
    }
    function initSettings() {
        const savedMode = localStorage.getItem('darkMode');
        const darkToggle = document.getElementById('dark-mode-toggle');
        if (savedMode === 'enabled') {
            document.body.classList.add('dark-mode');
            darkToggle.checked = true;
        } else if (savedMode === 'disabled') {
            document.body.classList.remove('dark-mode');
            darkToggle.checked = false;
        } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            document.body.classList.add('dark-mode');
            darkToggle.checked = true;
        }
    }


    const CACHE_OPERATOR_DATASETS = {
        kmb: ['kmb-route.json', 'kmb-stop.json'],
        citybus: ['ctb-route.json'],
        gmb: ['gmb-route-HKI.json', 'gmb-route-KLN.json', 'gmb-route-NT.json']
    };

    function computeCacheOperatorStatus(meta, operator) {
        const declared = meta && meta.operatorStatus && meta.operatorStatus[operator];
        if (declared && ['success', 'partial', 'fail'].includes(declared.status)) {
            return {
                status: declared.status,
                fresh: Number(declared.fresh || 0),
                available: Number(declared.available || 0),
                total: Number(declared.total || CACHE_OPERATOR_DATASETS[operator].length)
            };
        }

        const datasets = (meta && meta.datasets) || {};
        const names = CACHE_OPERATOR_DATASETS[operator] || [];
        const entries = names.map(name => datasets[name]).filter(Boolean);
        const fresh = entries.filter(item => item.available !== false && item.fresh !== false).length;
        const available = entries.filter(item => item.available !== false).length;
        const total = names.length;
        return {
            status: fresh === total ? 'success' : (available > 0 ? 'partial' : 'fail'),
            fresh,
            available,
            total
        };
    }

    function setCacheIndicator(operator, info, isStaleServiceDay = false) {
        const row = document.getElementById(`cache-status-${operator}`);
        if (!row) return;
        const dot = row.querySelector('.cache-status-dot');
        const text = row.querySelector('.cache-status-text');
        let status = info && info.status ? info.status : 'fail';
        if (isStaleServiceDay && status === 'success') status = 'partial';

        if (dot) dot.className = `cache-status-dot ${status}`;
        if (text) {
            const labels = { success: 'Success', partial: 'Partially success', fail: 'Fail' };
            const counts = info && info.total ? ` · ${Math.min(info.fresh || 0, info.total)}/${info.total} 最新` : '';
            text.textContent = `${labels[status] || 'Fail'}${counts}${isStaleServiceDay && status !== 'fail' ? ' · 舊快取' : ''}`;
        }
    }

    function setAllCacheIndicatorsFailed(message) {
        ['kmb', 'citybus', 'gmb'].forEach(operator => {
            setCacheIndicator(operator, { status: 'fail', fresh: 0, available: 0, total: CACHE_OPERATOR_DATASETS[operator].length });
        });
        const updatedEl = document.getElementById('cache-status-updated');
        if (updatedEl) updatedEl.textContent = message || '最後更新：無法讀取快取狀態';
    }

    function formatCacheUpdatedAt(iso) {
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return '未知';
        return date.toLocaleString('zh-HK', {
            timeZone: 'Asia/Hong_Kong',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: false
        });
    }

    async function refreshCacheIndicators(force = false) {
        const updatedEl = document.getElementById('cache-status-updated');
        if (updatedEl) updatedEl.textContent = '最後更新：檢查中…';
        ['kmb', 'citybus', 'gmb'].forEach(operator => {
            const row = document.getElementById(`cache-status-${operator}`);
            if (!row) return;
            const dot = row.querySelector('.cache-status-dot');
            const text = row.querySelector('.cache-status-text');
            if (dot) dot.className = 'cache-status-dot unknown';
            if (text) text.textContent = '檢查中';
        });

        try {
            const res = await fetch(`./data/transport-meta.json?status=${Date.now()}`, {
                cache: force ? 'reload' : 'no-store'
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const meta = await res.json();
            const currentServiceDay = getHongKongServiceDayKey(6);
            const metaServiceDay = meta.serviceDay || (meta.updatedAt ? getHongKongServiceDayKey(6, new Date(meta.updatedAt).getTime()) : '');
            const isStaleServiceDay = !metaServiceDay || metaServiceDay !== currentServiceDay;

            ['kmb', 'citybus', 'gmb'].forEach(operator => {
                setCacheIndicator(operator, computeCacheOperatorStatus(meta, operator), isStaleServiceDay);
            });

            if (updatedEl) {
                const staleText = isStaleServiceDay ? ' · 非今日服務日快取' : '';
                updatedEl.textContent = `最後更新：${formatCacheUpdatedAt(meta.updatedAt)}${staleText}`;
            }
        } catch (error) {
            console.warn('Unable to read daily transport cache status:', error);
            setAllCacheIndicatorsFailed('最後更新：無法讀取 transport-meta.json');
        }
    }

    const formatTime = (iso) => iso ? new Date(iso).toLocaleTimeString('zh-HK', {hour:'2-digit', minute:'2-digit', hour12:false}) : '--:--';
    const getMins = (iso) => {
        const diff = Math.floor((new Date(iso) - new Date()) / 60000);
        return diff <= 0 ? '即將' : `${diff}分`;
    };

    function escapeHtml(value) {
        return String(value || '').replace(/[&<>'"]/g, ch => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        }[ch]));
    }

    function isScheduledEtaRemark(text) {
        return /預定|预定|原定|未開出|未开出|scheduled|timetable|按時間表|按时间表/i.test(String(text || ''));
    }

    function renderEtaRemark(remarkTc, remarkEn) {
        const raw = (remarkTc || remarkEn || '').trim();
        if (!raw) return '';
        const combined = `${remarkTc || ''} ${remarkEn || ''}`;
        if (isScheduledEtaRemark(combined)) {
            return `<span class="service-remark scheduled">原定班次</span>`;
        }
        return `<span class="service-remark">${escapeHtml(raw)}</span>`;
    }

    function renderMtrScheduleRemark(train) {
        const source = String((train && train.source) || '').trim();
        if (/^(T|S|P)$/i.test(source) || isScheduledEtaRemark(source)) {
            return '<span class="service-remark scheduled">原定班次</span>';
        }
        return '';
    }

    function renderCardMinutesLabel(mins, { isUrgent = false, isScheduled = false } = {}) {
        const raw = String(mins || '').trim();
        const classes = ['eta-main-text'];
        if (isUrgent) classes.push('urgent');
        if (isScheduled) classes.push('scheduled');

        if (!raw) {
            return `<span class="${classes.join(' ')}"><span class="eta-main-number">--</span><span class="eta-main-unit">分鐘</span></span>`;
        }
        if (raw === '即將') {
            return `<span class="${classes.join(' ')}"><span class="eta-main-number">即將</span></span>`;
        }
        const num = raw.replace(/分鐘|分/g, '').trim();
        return `<span class="${classes.join(' ')}"><span class="eta-main-number">${escapeHtml(num || raw)}</span><span class="eta-main-unit">分鐘</span></span>`;
    }

    function getInlineRemarkText(remarkTc, remarkEn) {
        return (remarkTc || remarkEn || '').trim();
    }

    function isScheduledRemarkPair(remarkTc, remarkEn) {
        return isScheduledEtaRemark(`${remarkTc || ''} ${remarkEn || ''}`);
    }

    function formatMtrPlatformSymbol(platform) {
        const raw = String(platform || '').trim();
        const num = Number(raw.replace(/\D/g, ''));
        const circled = ['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩','⑪','⑫','⑬','⑭','⑮','⑯','⑰','⑱','⑲','⑳'];
        return Number.isInteger(num) && num >= 1 && num <= circled.length ? circled[num - 1] : escapeHtml(raw || '-');
    }

    let currentTab = 1;
    let validKmbStopId_PokYin = null;
    let validKmbStopId_Uni = null;
    let mtrUniDirection = 'DOWN';
    let selectedReturnStation = 'ADM';
    window.gmbResolvedStops = {};

    // MTR 官方 East Rail Line 站碼：紅磡為 HUH；保留 HOM 作舊版別名，避免舊資料出錯。
    const MTR_STATION_NAMES = {
        'ADM': '金鐘', 'EXC': '會展', 'HUH': '紅磡', 'HOM': '紅磡', 'MKK': '旺角東',
        'KOT': '九龍塘', 'TAW': '大圍', 'SHT': '沙田', 'FOT': '火炭', 'RAC': '馬場',
        'UNI': '大學', 'TAP': '大埔墟', 'TWO': '太和', 'FAN': '粉嶺', 'SHS': '上水',
        'LOW': '羅湖', 'LMC': '落馬洲'
    };
    const MTR_STATION_ALIASES = { 'HOM': 'HUH' };
    const normalizeMtrStationCode = (code) => MTR_STATION_ALIASES[code] || code;

    const mtrConfig = {
        'ADM': { dir: 'UP', label: '往羅湖/落馬洲' }, 'EXC': { dir: 'UP', label: '往羅湖/落馬洲' },
        'HUH': { dir: 'UP', label: '往羅湖/落馬洲' }, 'HOM': { dir: 'UP', label: '往羅湖/落馬洲' },
        'MKK': { dir: 'UP', label: '往羅湖/落馬洲' }, 'KOT': { dir: 'UP', label: '往羅湖/落馬洲' },
        'TAW': { dir: 'UP', label: '往羅湖/落馬洲' }, 'SHT': { dir: 'UP', label: '往羅湖/落馬洲' },
        'FOT': { dir: 'UP', label: '往羅湖/落馬洲' }, 'RAC': { dir: 'UP', label: '往羅湖/落馬洲' },
        'TAP': { dir: 'DOWN', label: '往金鐘' }, 'TWO': { dir: 'DOWN', label: '往金鐘' },
        'FAN': { dir: 'DOWN', label: '往金鐘' }, 'SHS': { dir: 'DOWN', label: '往金鐘' },
        'LOW': { dir: 'DOWN', label: '往金鐘' }, 'LMC': { dir: 'DOWN', label: '往金鐘' }
    };

    // 共用 JSON 快取：靜態路線/車站資料長快取，ETA/列車資料短快取，減少重覆請求。
    window.apiJsonCache = new Map();
    // Share identical concurrent requests so multiple UI components never hit the same endpoint twice.
    window.apiJsonInflight = new Map();

    function isHongKongTransportApi(url) {
        return /^https:\/\/(data\.etagmb\.gov\.hk|data\.etabus\.gov\.hk|rt\.data\.gov\.hk)\//i.test(String(url || ''));
    }

    function getJsonFetchUrls(url) {
        if (!isHongKongTransportApi(url)) return [url];

        const encoded = encodeURIComponent(url);

        // GitHub Pages is static hosting, so there is no same-origin /proxy endpoint.
        // Always try the official Hong Kong transport API first. If a browser/network
        // blocks a particular endpoint, fall back to read-only public CORS relays.
        return [...new Set([
            url,
            `https://api.allorigins.win/raw?url=${encoded}`,
            `https://api.codetabs.com/v1/proxy/?quest=${encoded}`,
            `https://corsproxy.io/?url=${encoded}`
        ])];
    }

    function parseJsonTextSafely(text) {
        const raw = String(text || '').trim();
        if (!raw) throw new Error('Empty JSON response');

        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (err) {
            const firstObj = raw.indexOf('{');
            const firstArr = raw.indexOf('[');
            const first = [firstObj, firstArr].filter(i => i >= 0).sort((a, b) => a - b)[0];
            const last = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'));
            if (first === undefined || last < first) throw err;
            parsed = JSON.parse(raw.slice(first, last + 1));
        }

        // 兼容部分 proxy 回傳 { contents: "...json..." } 的格式。
        if (parsed && typeof parsed.contents === 'string') {
            try { return parseJsonTextSafely(parsed.contents); } catch (e) {}
        }
        return parsed;
    }

    // GitHub Pages daily static mirrors for heavy route / stop indexes.
    // GitHub Actions refreshes these files once per service day. ETA endpoints are
    // deliberately excluded and always remain live.
    const DAILY_STATIC_FILES = new Map([
        ['https://data.etabus.gov.hk/v1/transport/kmb/stop', './data/kmb-stop.json'],
        ['https://data.etabus.gov.hk/v1/transport/kmb/route/', './data/kmb-route.json'],
        ['https://data.etabus.gov.hk/v1/transport/kmb/route', './data/kmb-route.json'],
        ['https://rt.data.gov.hk/v2/transport/citybus/route/CTB', './data/ctb-route.json'],
        ['https://data.etagmb.gov.hk/route/HKI', './data/gmb-route-HKI.json'],
        ['https://data.etagmb.gov.hk/route/KLN', './data/gmb-route-KLN.json'],
        ['https://data.etagmb.gov.hk/route/NT', './data/gmb-route-NT.json']
    ]);

    function getHongKongServiceDayKey(cutoffHour = 6, timestamp = Date.now()) {
        // Shift UTC into Hong Kong time, then move the day boundary to 06:00 HKT.
        const base = Number(timestamp);
        const shifted = new Date((Number.isFinite(base) ? base : Date.now()) + (8 - cutoffHour) * 60 * 60 * 1000);
        return shifted.toISOString().slice(0, 10);
    }

    async function fetchDailyStaticFile(apiUrl, timeout = 12000) {
        const staticPath = DAILY_STATIC_FILES.get(String(apiUrl || ''));
        if (!staticPath) return null;

        const dayKey = getHongKongServiceDayKey(6);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
            // The day query gives the Service Worker one stable cache entry per day.
            // GitHub Actions updates the underlying JSON after 05:00 HKT and before the 06:00 day boundary.
            const res = await fetch(`${staticPath}?day=${encodeURIComponent(dayKey)}`, {
                signal: controller.signal,
                cache: 'default'
            });
            if (!res.ok) throw new Error(`Daily static data HTTP ${res.status}`);
            return parseJsonTextSafely(await res.text());
        } finally {
            clearTimeout(timer);
        }
    }

    function getPersistentJsonCacheKey(url) {
        return 'psk_transport_static_json_v1::' + encodeURIComponent(url);
    }

    function shouldPersistTransportJson(url, ttl) {
        if (!ttl || ttl < 3600000) return false;
        const u = String(url || '');

        // Never persist live arrival/schedule feeds.
        if (/\/eta(?:\/|$)/i.test(u) || /\/stop-eta(?:\/|$)/i.test(u) || /getSchedule\.php/i.test(u)) return false;

        // KMB's global stop list is large and is already supplied by the GitHub
        // daily mirror. Avoid duplicating that full payload in localStorage.
        if (/data\.etabus\.gov\.hk\/v1\/transport\/kmb\/stop\/?(?:\?|$)/i.test(u)) return false;

        // Persist static indexes and per-route/per-stop details. This means a
        // Citybus/KMB route opened once on a device does not need to refetch its
        // stop sequence/details again during the cache TTL.
        return /\/route(?:-stop)?(?:\/|$)/i.test(u) ||
               /rt\.data\.gov\.hk\/v2\/transport\/citybus\/stop\/[^/?]+/i.test(u);
    }

    async function fetchJsonCached(url, { ttl = 0, timeout = 8000 } = {}) {
        const requestKey = String(url || '');
        const now = Date.now();
        const cached = window.apiJsonCache.get(requestKey);
        if (ttl > 0 && cached && (now - cached.time) < ttl) return cached.data;

        // A surprisingly large number of screens can ask for the same route/ETA at once.
        // Reuse the same Promise instead of creating duplicate HTTP requests.
        const existing = window.apiJsonInflight.get(requestKey);
        if (existing) return existing;

        const task = (async () => {
            // Heavy static route/stop indexes come from the repository's daily mirror first.
            if (DAILY_STATIC_FILES.has(requestKey)) {
                try {
                    const mirrored = await fetchDailyStaticFile(requestKey, timeout);
                    if (mirrored) {
                        window.apiJsonCache.set(requestKey, { time: Date.now(), data: mirrored });
                        return mirrored;
                    }
                } catch (err) {
                    console.warn('Daily static mirror unavailable; falling back to official API.', err);
                }
            }

            const usePersistentCache = shouldPersistTransportJson(requestKey, ttl);
            const persistentKey = usePersistentCache ? getPersistentJsonCacheKey(requestKey) : null;
            if (persistentKey) {
                const raw = safeLocalStorageGet(persistentKey);
                if (raw) {
                    try {
                        const stored = JSON.parse(raw);
                        if (stored && stored.time && (Date.now() - stored.time) < ttl) {
                            window.apiJsonCache.set(requestKey, { time: stored.time, data: stored.data });
                            return stored.data;
                        }
                    } catch (e) {}
                }
            }

            const urlsToTry = getJsonFetchUrls(requestKey);
            let lastError = null;

            for (const fetchUrl of urlsToTry) {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), timeout);
                try {
                    const res = await fetch(fetchUrl, { signal: controller.signal, cache: 'no-store' });
                    if (!res.ok) throw new Error(`HTTP ${res.status}: ${fetchUrl}`);
                    const data = parseJsonTextSafely(await res.text());
                    if (ttl > 0) window.apiJsonCache.set(requestKey, { time: Date.now(), data });
                    if (persistentKey) {
                        safeLocalStorageSet(persistentKey, JSON.stringify({ time: Date.now(), data }));
                    }
                    return data;
                } catch (err) {
                    lastError = err;
                    console.warn('JSON fetch failed, trying next source:', fetchUrl, err);
                } finally {
                    clearTimeout(timer);
                }
            }
            throw lastError || new Error(`Fetch failed: ${requestKey}`);
        })();

        window.apiJsonInflight.set(requestKey, task);
        try {
            return await task;
        } finally {
            if (window.apiJsonInflight.get(requestKey) === task) {
                window.apiJsonInflight.delete(requestKey);
            }
        }
    }


    const runSoon = (fn) => {
        if ('requestIdleCallback' in window) requestIdleCallback(fn, { timeout: 1200 });
        else setTimeout(fn, 0);
    };


    async function mapWithConcurrency(items, limit, worker) {
        const list = Array.from(items || []);
        if (list.length === 0) return [];
        const results = new Array(list.length);
        let nextIndex = 0;
        const workerCount = Math.max(1, Math.min(Number(limit) || 1, list.length));

        async function runWorker() {
            while (true) {
                const index = nextIndex++;
                if (index >= list.length) return;
                results[index] = await worker(list[index], index);
            }
        }

        await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
        return results;
    }

    function switchTab(tabId) {
        if (currentTab === tabId) {
            const currentContent = document.getElementById(`tab-${tabId}`);
            if (currentContent && currentContent.scrollTop > 0) {
                currentContent.scrollTo({ top: 0, behavior: 'smooth' });
            }
            return;
        }

        currentTab = tabId;
        document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
        document.getElementById(`tab-${tabId}`).classList.add('active');
        document.querySelectorAll('.tab-item').forEach((el, index) => {
            el.classList.toggle('active', index + 1 === tabId);
        });

        const titles = {1: '白石角出發', 2: '我要回家', 3: '收藏', 4: '全港巴士/小巴查詢'};
        document.getElementById('page-title').innerText = titles[tabId];

        if (tabId !== 4) hideRouteKeyboard();
        if (tabId === 1 || tabId === 2) refreshAll(false);
        if (tabId === 3) renderFavorites();
        if (tabId === 4) initTab4();
    }

    function switchMtrDir(dir) {
        if (mtrUniDirection === dir) return;
        mtrUniDirection = dir;
        document.getElementById('btn-down').classList.toggle('active', dir === 'DOWN');
        document.getElementById('btn-up').classList.toggle('active', dir === 'UP');
        smoothRefresh('mtr-list-1', fetchMTR_Uni);
    }
    function switchReturnStation(stationCode) {
        if (selectedReturnStation === stationCode) return;
        selectedReturnStation = stationCode;
        const config = mtrConfig[stationCode];
        if (config) document.getElementById('dest-label').innerText = config.label;
        smoothRefresh('mtr-list-2', fetchMTR_Return);
    }
    function smoothRefresh(elementId, fetchFunc) {
        const el = document.getElementById(elementId);
        if (!el) return;
        el.classList.add('fading');
        setTimeout(async () => {
            try { await fetchFunc(); }
            finally { el.classList.remove('fading'); }
        }, 160);
    }


    // --- Tab 1 & Tab 2 Fetching Logic ---
    async function fetchKMB_PokYin() {
        if(currentTab !== 1) return; 
        const listEl = document.getElementById('kmb-list-1');
        try {
            if (!validKmbStopId_PokYin) {
                const routeData = await fetchJsonCached('https://data.etabus.gov.hk/v1/transport/kmb/route-stop/272A/outbound/1', { ttl: 3600000 });
                const promises = routeData.data.map(async (s) => {
                    const detail = await fetchJsonCached(`https://data.etabus.gov.hk/v1/transport/kmb/stop/${s.stop}`, { ttl: 86400000 });
                    return detail.data.name_tc.includes('博研路') ? s.stop : null;
                });
                const stops = (await Promise.all(promises)).filter(s => s);
                for (const sid of stops) {
                    const etaData = await fetchJsonCached(`https://data.etabus.gov.hk/v1/transport/kmb/eta/${sid}/272A/1`, { ttl: 12000, timeout: 5000 });
                    if (etaData.data.some(e => e.eta)) { validKmbStopId_PokYin = sid; break; }
                }
                if (!validKmbStopId_PokYin && stops.length) validKmbStopId_PokYin = stops[0];
            }
            renderKMB(listEl, validKmbStopId_PokYin, '博研路');
        } catch (e) { listEl.innerHTML = '<div class="status-msg error">更新失敗</div>'; }
    }

    async function fetchKMB_Uni() {
        if(currentTab !== 2) return;
        const listEl = document.getElementById('kmb-list-2');
        try {
            if (!validKmbStopId_Uni) {
                const routeData = await fetchJsonCached('https://data.etabus.gov.hk/v1/transport/kmb/route-stop/272A/outbound/1', { ttl: 3600000 });
                const firstStop = routeData.data.find(s => s.seq === '1');
                if (firstStop) validKmbStopId_Uni = firstStop.stop;
            }
            renderKMB(listEl, validKmbStopId_Uni, '大學站');
        } catch (e) { listEl.innerHTML = '<div class="status-msg error">更新失敗</div>'; }
    }

    async function renderKMB(element, stopId, displayLabel) {
        if (!stopId) { element.innerHTML = '<div class="status-msg">找不到車站</div>'; return; }
        const data = await fetchJsonCached(`https://data.etabus.gov.hk/v1/transport/kmb/eta/${stopId}/272A/1`, { ttl: 12000, timeout: 5000 });
        const etas = data.data.filter(e => e.eta != null);

        if (etas.length === 0) {
            element.innerHTML = '<div class="status-msg">暫無班次</div>';
        } else {
            element.innerHTML = etas.slice(0, 3).map(bus => {
                const mins = getMins(bus.eta);
                const isUrgent = mins === '即將' || mins === '0分' || mins === '1分' || mins === '2分' || mins === '3分';
                const scheduled = isScheduledRemarkPair(bus.rmk_tc || '', bus.rmk_en || '');
                const rawRemark = getInlineRemarkText(bus.rmk_tc || '', bus.rmk_en || '');
                const extraRemark = rawRemark && !scheduled ? `<span class="service-remark">${escapeHtml(rawRemark)}</span>` : '';
                return `
                <div class="schedule-item">
                    <div class="schedule-line">
                        ${renderCardMinutesLabel(mins, { isUrgent, isScheduled: scheduled })}
                        <span class="eta-clock">(${formatTime(bus.eta)})</span>
                        ${scheduled ? '<span class="eta-scheduled-inline">原定班次</span>' : ''}
                    </div>
                    ${extraRemark}
                </div>`;
            }).join('');
        }
    }


    const GMB_CONFIGS = {
        '28A': {
            region: 'NT',
            routeCode: '28A',
            destKeyword: '大埔墟站',
            stopSeq: 1,
            stopKeyword: '優景里',
            stopKeywordAlt: '博研路',
            displayDest: '大埔墟站',
            displayStop: '優景里, 近博研路',
            elementId: 'gmb-list-28a'
        },
        '28S': {
            region: 'NT',
            routeCode: '28S',
            destKeyword: '沙田',
            stopSeq: 4,
            stopKeyword: '坡面',
            displayDest: '沙田(白鶴汀街)',
            displayStop: '坡面',
            elementId: 'gmb-list-28s'
        }
    };

    function normalizeStopText(text) {
        return String(text || '')
            .replace(/[\s　]/g, '')
            .replace(/[，,。．\.、\-－–—]/g, '')
            .replace(/[()（）]/g, '')
            .toLowerCase();
    }

    function gmbNameMatches(stop, cfg) {
        const stopName = normalizeStopText(stop.name_tc || stop.name_en || '');
        const primary = normalizeStopText(cfg.stopKeyword);
        const alt = normalizeStopText(cfg.stopKeywordAlt);
        if (primary && stopName.includes(primary)) return true;
        if (alt && stopName.includes(alt)) return true;
        return false;
    }

    async function resolveGmbRouteStop(cfg) {
        const cacheKey = `${cfg.region}-${cfg.routeCode}-${cfg.destKeyword}-${cfg.stopSeq}-${cfg.stopKeyword}`;
        if (window.gmbResolvedStops[cacheKey]) return window.gmbResolvedStops[cacheKey];

        const routeUrl = `https://data.etagmb.gov.hk/route/${encodeURIComponent(cfg.region)}/${encodeURIComponent(cfg.routeCode)}`;
        const routeData = await fetchJsonCached(routeUrl, { ttl: 3600000, timeout: 8000 });
        const routeVariants = routeData.data || [];
        const normalizedDestKeyword = normalizeStopText(cfg.destKeyword);
        let fallback = null;

        for (const route of routeVariants) {
            for (const dir of (route.directions || [])) {
                const destName = dir.dest_tc || dir.dest_en || '';
                const destHit = !normalizedDestKeyword || normalizeStopText(destName).includes(normalizedDestKeyword);
                const stopData = await fetchJsonCached(`https://data.etagmb.gov.hk/route-stop/${route.route_id}/${dir.route_seq}`, { ttl: 3600000, timeout: 8000 });
                const stops = (stopData.data && stopData.data.route_stops) ? stopData.data.route_stops : [];
                const seqMatch = stops.find(s => Number(s.stop_seq) === Number(cfg.stopSeq));
                const nameMatch = stops.find(s => gmbNameMatches(s, cfg));
                const selectedStop = (seqMatch && (gmbNameMatches(seqMatch, cfg) || !nameMatch)) ? seqMatch : nameMatch;

                if (!selectedStop) continue;

                const resolved = {
                    routeId: route.route_id,
                    routeSeq: dir.route_seq,
                    stopSeq: selectedStop.stop_seq,
                    stopId: selectedStop.stop_id,
                    stopName: selectedStop.name_tc || cfg.displayStop,
                    destName: destName || cfg.displayDest,
                    description: route.description_tc || ''
                };

                if (destHit) {
                    window.gmbResolvedStops[cacheKey] = resolved;
                    return resolved;
                }
                if (!fallback) fallback = resolved;
            }
        }

        if (fallback) {
            window.gmbResolvedStops[cacheKey] = fallback;
            return fallback;
        }
        throw new Error(`GMB route-stop not found: ${cfg.routeCode}`);
    }

    async function fetchGMB(routeCode) {
        if (currentTab !== 1) return;
        const cfg = GMB_CONFIGS[routeCode];
        if (!cfg) return;
        const listEl = document.getElementById(cfg.elementId);
        try {
            const resolved = await resolveGmbRouteStop(cfg);
            await renderGMB(listEl, cfg, resolved);
        } catch (e) {
            console.warn('GMB update failed', routeCode, e);
            listEl.innerHTML = '<div class="status-msg error">小巴資料無法載入</div>';
        }
    }

    async function renderGMB(element, cfg, resolved) {
        const etaUrl = `https://data.etagmb.gov.hk/eta/route-stop/${resolved.routeId}/${resolved.routeSeq}/${resolved.stopSeq}`;
        const data = await fetchJsonCached(etaUrl, { ttl: 12000, timeout: 5000 });
        const payload = data.data || {};

        if (payload.enabled === false) {
            const reason = payload.description_tc || '到站預報暫停';
            element.innerHTML = `<div class="status-msg">${reason}</div>`;
            return;
        }

        const etas = (payload.eta || [])
            .filter(e => e && e.timestamp)
            .sort((a, b) => (a.eta_seq || 0) - (b.eta_seq || 0));

        if (etas.length === 0) {
            element.innerHTML = '<div class="status-msg">暫無班次</div>';
            return;
        }

        element.innerHTML = etas.slice(0, 3).map(bus => {
            const mins = Number.isFinite(Number(bus.diff)) ? (Number(bus.diff) <= 0 ? '即將' : `${bus.diff}分`) : getMins(bus.timestamp);
            const isUrgent = mins === '即將' || mins === '0分' || mins === '1分' || mins === '2分' || mins === '3分';
            const scheduled = isScheduledRemarkPair(bus.remarks_tc || '', bus.remarks_en || '');
            const rawRemark = getInlineRemarkText(bus.remarks_tc || '', bus.remarks_en || '');
            const extraRemark = rawRemark && !scheduled ? `<span class="service-remark">${escapeHtml(rawRemark)}</span>` : '';
            return `
                <div class="schedule-item">
                    <div class="schedule-line">
                        ${renderCardMinutesLabel(mins, { isUrgent, isScheduled: scheduled })}
                        <span class="eta-clock">(${formatTime(bus.timestamp)})</span>
                        ${scheduled ? '<span class="eta-scheduled-inline">原定班次</span>' : ''}
                    </div>
                    ${extraRemark}
                </div>`;
        }).join('');
    }

    async function fetchMTR_Uni() {
        if(currentTab !== 1) return;
        await renderMTR('UNI', document.getElementById('mtr-list-1'), mtrUniDirection);
    }
    async function fetchMTR_Return() {
        if(currentTab !== 2) return;
        const config = mtrConfig[selectedReturnStation];
        const direction = config ? config.dir : 'UP'; 
        await renderMTR(selectedReturnStation, document.getElementById('mtr-list-2'), direction);
    }
    async function renderMTR(station, element, direction) {
        try {
            const apiStation = normalizeMtrStationCode(station);
            const data = await fetchJsonCached(`https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=EAL&sta=${apiStation}`, { ttl: 10000, timeout: 5000 });
            const stationKey = `EAL-${apiStation}`;
            const schedule = data.data && data.data[stationKey] ? data.data[stationKey][direction] : null;

            if (!schedule || schedule.length === 0) {
                element.innerHTML = '<div class="status-msg">暫無班次</div>'; return;
            }
            
            element.innerHTML = schedule.map(t => {
                let dest = MTR_STATION_NAMES[normalizeMtrStationCode(t.dest)] || t.dest;
                const mins = getMins(t.time);
                const isUrgent = mins === '即將' || mins === '0分' || mins === '1分' || mins === '2分' || mins === '3分';

                return `
                <div class="schedule-item">
                    <div class="schedule-line">
                        ${renderCardMinutesLabel(mins, { isUrgent, isScheduled: false })}
                        <span class="eta-clock">(${formatTime(t.time)})</span>
                        <span class="mtr-meta"><span class="mtr-platform-circle">${formatMtrPlatformSymbol(t.plat)}</span><span class="mtr-dest-text">${escapeHtml(dest)}</span></span>
                    </div>
                </div>`;
            }).join('');
        } catch (e) {
            element.innerHTML = '<div class="status-msg error">資料無法載入</div>';
        }
    }

    const REFRESH_MIN_INTERVAL_MS = 8000;
    const lastRefreshAtByTab = new Map();
    const refreshPromiseByTab = new Map();

    function invalidateLiveTransportMemoryCache() {
        for (const key of window.apiJsonCache.keys()) {
            if (/\/eta(?:\/|$)|\/route-eta\/|\/eta\/route-stop\/|getSchedule\.php/i.test(String(key))) {
                window.apiJsonCache.delete(key);
            }
        }
    }

    async function refreshAll(force = false) {
        const tabId = currentTab;
        const now = Date.now();
        const existing = refreshPromiseByTab.get(tabId);
        if (existing) return existing;

        if (!force && now - (lastRefreshAtByTab.get(tabId) || 0) < REFRESH_MIN_INTERVAL_MS) return;
        if (force) invalidateLiveTransportMemoryCache();

        const updateEl = document.getElementById('last-updated');
        if (updateEl) updateEl.innerText = '更新中…';

        let jobs = [];
        if (tabId === 1) {
            jobs = [fetchKMB_PokYin(), fetchGMB('28A'), fetchGMB('28S'), fetchMTR_Uni()];
        } else if (tabId === 2) {
            jobs = [fetchMTR_Return(), fetchKMB_Uni()];
        } else if (tabId === 3) {
            jobs = [refreshFavoritesEta()];
        } else {
            return;
        }

        const task = Promise.allSettled(jobs).then(results => {
            lastRefreshAtByTab.set(tabId, Date.now());
            const failed = results.filter(r => r.status === 'rejected').length;
            if (updateEl && currentTab === tabId) {
                const time = new Date().toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit', hour12: false });
                updateEl.innerText = failed === jobs.length ? `更新失敗 · ${time}` : `最後更新: ${time}`;
            }
            return results;
        }).finally(() => {
            if (refreshPromiseByTab.get(tabId) === task) refreshPromiseByTab.delete(tabId);
        });

        refreshPromiseByTab.set(tabId, task);
        return task;
    }

    function getDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; 
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    // ==========================================
    // 全域共用變數與骨架屏切換
    // ==========================================
    const targetKeywords = ['科學園', '雲滙', '雲匯', '天賦海灣', '創新路', '白石角', '科研路', '博研路', '白石角變電站', '逸瓏灣'];
    
    window.globalStopsList = [];
    window.globalStopsMap = {};
    window.globalRouteStops = null;
    window.globalRouteStopsIndex = {};
    window.routeStopsCache = {};
    window.tab3RadiusResultCache = {};
    window.lastGeoPosition = null;

    function toggleSkeleton(containerId, show) {
        const el = document.getElementById(containerId);
        if (el) el.style.display = show ? 'block' : 'none';
    }

    function buildKmbRouteStopsIndex(routeStops) {
        window.globalRouteStopsIndex = {};
        (routeStops || []).forEach(rs => {
            if (rs.service_type !== '1') return;
            const key = `${rs.route}-${rs.bound}`;
            if (!window.globalRouteStopsIndex[key]) window.globalRouteStopsIndex[key] = [];
            window.globalRouteStopsIndex[key].push(rs);
        });
        Object.values(window.globalRouteStopsIndex).forEach(list => {
            list.sort((a, b) => parseInt(a.seq, 10) - parseInt(b.seq, 10));
        });
    }

    async function ensureKmbRouteStopsLoaded() {
        // The KMB all-route route-stop endpoint currently returns HTTP 403 from
        // GitHub Actions and some server environments. Do not preload it globally.
        // Individual route-stop data is fetched only when a route is actually needed.
        return [];
    }

    function getKmbStopsFromIndex(route, boundCode) {
        return window.globalRouteStopsIndex[`${route}-${boundCode}`] || [];
    }

    async function ensureKmbStopNamesLoaded() {
        if (window.globalStopsList.length > 0 && Object.keys(window.globalStopsMap).length > 0) return window.globalStopsList;
        const stopsData = await fetchJsonCached('https://data.etabus.gov.hk/v1/transport/kmb/stop', { ttl: 86400000, timeout: 12000 });
        window.globalStopsList = stopsData.data || [];
        window.globalStopsList.forEach(s => {
            if (s && s.stop) window.globalStopsMap[s.stop] = s.name_tc || s.name_en || s.stop;
        });
        return window.globalStopsList;
    }

    function enrichKmbRouteStopList(stops) {
        return (stops || []).map(s => {
            const stopId = s && s.stop ? String(s.stop) : '';
            const stopName = (s && s.name_tc && s.name_tc !== stopId ? s.name_tc : '') || window.globalStopsMap[stopId] || stopId;
            return { ...s, name_tc: stopName };
        });
    }

    async function getRouteStopsCached(route, bound, isCitybus) {
        const key = `${route}-${bound}-${isCitybus}`;
        if (window.routeStopsCache[key]) {
            if (!isCitybus) {
                try {
                    const hasReadableName = window.routeStopsCache[key].some(s => s && s.name_tc && s.name_tc !== s.stop);
                    if (!hasReadableName) {
                        await ensureKmbStopNamesLoaded();
                        window.routeStopsCache[key] = enrichKmbRouteStopList(window.routeStopsCache[key]);
                    }
                } catch(e) {}
            }
            return window.routeStopsCache[key];
        }
        
        try {
            if (isCitybus) {
                // Citybus does not currently expose a working aggregate all-stop /
                // all-route-stop download to GitHub Actions. Fetch only the selected
                // route, then persist that static route-stop list and each stop detail
                // in localStorage for 24 hours. ETA requests remain live.
                const data = await fetchJsonCached(`https://rt.data.gov.hk/v2/transport/citybus/route-stop/CTB/${route}/${bound}`, { ttl: 86400000, timeout: 10000 });
                const stops = data.data || [];

                // Do not open dozens of Citybus stop-detail connections at once.
                // Six workers keeps the UI/network responsive and is friendlier to the public API.
                await mapWithConcurrency(stops, 6, async (s) => {
                    if (!window.globalStopsMap[s.stop] || !s.lat || !s.long) {
                        try {
                            const sData = await fetchJsonCached(`https://rt.data.gov.hk/v2/transport/citybus/stop/${s.stop}`, { ttl: 86400000, timeout: 6000 });
                            window.globalStopsMap[s.stop] = sData.data.name_tc || sData.data.name_en || s.stop;
                            s.name_tc = window.globalStopsMap[s.stop];
                            s.lat = s.lat || sData.data.lat;
                            s.long = s.long || sData.data.long;
                        } catch(e) {}
                    }
                });
                window.routeStopsCache[key] = stops;
                return stops;
            } else {
                const boundCode = bound === 'outbound' ? 'O' : 'I';
                try { await ensureKmbStopNamesLoaded(); } catch(e) { console.warn('KMB stop names failed, using stop IDs as fallback', e); }

                if (window.globalRouteStops) {
                    const stops = enrichKmbRouteStopList(getKmbStopsFromIndex(route, boundCode));
                    window.routeStopsCache[key] = stops;
                    return stops;
                }

                const data = await fetchJsonCached(`https://data.etabus.gov.hk/v1/transport/kmb/route-stop/${route}/${bound}/1`, { ttl: 86400000, timeout: 10000 });
                window.routeStopsCache[key] = enrichKmbRouteStopList(data.data || []);
                return window.routeStopsCache[key];
            }
        } catch(e) { return []; }
    }


    function generateEtaHtml(sortedEtas) {
        if (!sortedEtas || sortedEtas.length === 0) {
            return `<span style="font-size:0.85rem; color:var(--text-sub);">暫無班次</span>`;
        }

        let firstMins = getMins(sortedEtas[0]);
        let firstHtml = '';
        if (firstMins === '即將') {
            firstHtml = `<span style="color:var(--kmb-red); font-size:1.2rem; font-weight:800;">即將</span>`;
        } else {
            let num = firstMins.replace('分', '');
            firstHtml = `<span style="color:var(--kmb-red); font-size:1.4rem; font-weight:900;">${num}</span><span style="font-size:0.8rem; color:var(--text-main); margin-left:2px; font-weight:600;">分鐘</span>`;
        }

        let subsHtml = sortedEtas.slice(1).map(eta => {
            let m = getMins(eta).replace('分', '');
            if (m === '即將') m = '0';
            return `<span style="font-size:1.15rem; color:var(--text-main); margin-left:14px; font-weight:700;">${m}</span>`;
        }).join('');

        return `<div style="display:flex; align-items:baseline; font-family: 'Arial', sans-serif;">${firstHtml}${subsHtml}</div>`;
    }

    // ==========================================
    // Tab 3: 回家目錄邏輯
    // ==========================================
    const targetBusRoutes = [
        '73D', '263C', '272P', '272X', '900', '900X', '907D', 
        'A47X', 'NA47', '74', '74D', '74P', '96', '271B', 
        '64X', '65X', '82D', '272A', '274', '274P'
    ];
    window.cachedRouteGroupsTab3 = {};
    window.routeEtaStatusTab3 = {};
    window.tab3CurrentRadius = 'ALL';

    async function initTab3() {
        const container = document.getElementById('tab3-target-routes-container');
        if (container.innerHTML !== '') return; 

        toggleSkeleton('tab3-skeleton', true);

        try {
            const staticJobs = [];
            if (window.globalStopsList.length === 0) {
                staticJobs.push(fetchJsonCached('https://data.etabus.gov.hk/v1/transport/kmb/stop', { ttl: 86400000, timeout: 12000 }).then(stopsData => {
                    window.globalStopsList = stopsData.data || [];
                    window.globalStopsList.forEach(s => { window.globalStopsMap[s.stop] = s.name_tc; });
                }));
            }
            staticJobs.push(fetchJsonCached('https://data.etabus.gov.hk/v1/transport/kmb/route/', { ttl: 3600000, timeout: 12000 }));

            const results = await Promise.all(staticJobs);
            const routesData = results[results.length - 1];

            targetBusRoutes.forEach(r => window.cachedRouteGroupsTab3[r] = []);

            routesData.data.forEach(r => {
                if (targetBusRoutes.includes(r.route) && r.service_type === '1') {
                    if (!window.cachedRouteGroupsTab3[r.route].some(existing => existing.bound === r.bound)) {
                        window.cachedRouteGroupsTab3[r.route].push(r);
                    }
                }
            });

            window.cachedRouteGroupsTab3['582'] = [
                { route: '582', bound: 'O', orig_tc: '白石角', dest_tc: '西沙 GO PARK', isCitybus: true },
                { route: '582', bound: 'I', orig_tc: '西沙 GO PARK', dest_tc: '白石角', isCitybus: true }
            ];

            const etaPromises = targetBusRoutes.map(route => 
                fetchJsonCached(`https://data.etabus.gov.hk/v1/transport/kmb/route-eta/${route}/1`, { ttl: 15000, timeout: 6000 })
                    .then(data => ({ route, data }))
                    .catch(err => ({ route, error: err }))
            );
            
            const etaResults = await Promise.all(etaPromises);
            etaResults.forEach(res => {
                if (res.data && res.data.data) {
                    res.data.data.forEach(e => {
                        if (e.eta) window.routeEtaStatusTab3[`${res.route}-${e.dir}`] = true;
                    });
                }
            });
            window.routeEtaStatusTab3['582-O'] = true; 
            window.routeEtaStatusTab3['582-I'] = true;

            applyTab3Radius('ALL');

        } catch(e) {
            toggleSkeleton('tab3-skeleton', false);
            document.getElementById('tab3-target-routes-container').innerHTML = '<span class="error" style="padding:20px; display:block;">載入失敗，請檢查網絡。</span>';
            document.getElementById('tab3-target-routes-container').style.display = 'block';
        }
    }


    function getCurrentPositionCached() {
        const cached = window.lastGeoPosition;
        if (cached && Date.now() - cached.time < 60000) return Promise.resolve(cached);

        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) return reject(new Error('NO_GEOLOCATION'));
            navigator.geolocation.getCurrentPosition((pos) => {
                const result = {
                    lat: pos.coords.latitude,
                    lon: pos.coords.longitude,
                    accuracy: pos.coords.accuracy,
                    time: Date.now()
                };
                window.lastGeoPosition = result;
                resolve(result);
            }, reject, { enableHighAccuracy: true, timeout: 7000, maximumAge: 60000 });
        });
    }

    function hasTargetStopAfter(stops, boardIdx) {
        for (let i = boardIdx + 1; i < stops.length; i++) {
            const stopName = window.globalStopsMap[stops[i].stop] || '';
            if (targetKeywords.some(kw => stopName.includes(kw))) return true;
        }
        return false;
    }

    async function applyTab3Radius(radius) {
        const container = document.getElementById('tab3-target-routes-container');
        if (window.tab3CurrentRadius === radius && container.innerHTML !== '') return;
        window.tab3CurrentRadius = radius;
        
        document.querySelectorAll('#tab-3 .rad-btn').forEach(btn => btn.classList.remove('active'));
        document.getElementById(`tab3-rad-${radius}`).classList.add('active');
        
        if (radius === 'ALL') {
            container.style.display = 'none';
            toggleSkeleton('tab3-skeleton', false);
            renderCatalogHTML(window.cachedRouteGroupsTab3, 'tab3-target-routes-container', true);
            container.style.display = 'block';
            return;
        }

        container.style.display = 'none';
        toggleSkeleton('tab3-skeleton', true);

        try {
            const pos = await getCurrentPositionCached();
            const geoKey = `${radius}-${pos.lat.toFixed(4)}-${pos.lon.toFixed(4)}`;
            if (window.tab3RadiusResultCache[geoKey]) {
                toggleSkeleton('tab3-skeleton', false);
                const cached = window.tab3RadiusResultCache[geoKey];
                if (Object.keys(cached).length === 0) {
                    container.innerHTML = `<div class="status-msg" style="padding: 40px;">附近 ${radius} 米內沒有直達目標車站的路線。</div>`;
                } else {
                    renderCatalogHTML(cached, 'tab3-target-routes-container', true);
                }
                container.style.display = 'block';
                return;
            }

            const nearbyStops = window.globalStopsList
                .map(s => ({ ...s, distance: getDistance(pos.lat, pos.lon, Number(s.lat), Number(s.long)) * 1000 }))
                .filter(s => Number.isFinite(s.distance) && s.distance <= radius)
                .sort((a, b) => a.distance - b.distance);

            const nearbyStopById = new Map(nearbyStops.map(s => [s.stop, s]));
            const nearbyStopIds = new Set(nearbyStopById.keys());
            const filteredGroups = {};
            
            await Promise.all(Object.keys(window.cachedRouteGroupsTab3).map(async (rName) => {
                const dirs = window.cachedRouteGroupsTab3[rName];
                const validDirs = [];

                await Promise.all(dirs.map(async (dir) => {
                    let boardStopDistance = 99999;
                    let boardStopName = '';
                    let isValid = false;

                    if (dir.isCitybus) {
                        const stops = await getRouteStopsCached(dir.route, dir.bound === 'O' ? 'outbound' : 'inbound', true);
                        let boardIdx = -1;
                        for (let i = 0; i < stops.length; i++) {
                            const s = stops[i];
                            const dist = getDistance(pos.lat, pos.lon, Number(s.lat), Number(s.long)) * 1000;
                            if (Number.isFinite(dist) && dist <= radius) {
                                boardIdx = i;
                                boardStopDistance = dist;
                                boardStopName = window.globalStopsMap[s.stop] || s.stop;
                                break;
                            }
                        }
                        isValid = boardIdx !== -1 && hasTargetStopAfter(stops, boardIdx);
                    } else {
                        // Load only this route/direction when the nearby filter is used.
                        // This avoids downloading the all-route route-stop dataset.
                        const stops = await getRouteStopsCached(
                            rName,
                            dir.bound === 'O' ? 'outbound' : 'inbound',
                            false
                        );
                        const boardIdx = stops.findIndex(s => nearbyStopIds.has(s.stop));
                        
                        if (boardIdx !== -1 && hasTargetStopAfter(stops, boardIdx)) {
                            isValid = true;
                            const matchedStop = nearbyStopById.get(stops[boardIdx].stop);
                            boardStopDistance = matchedStop.distance;
                            boardStopName = window.globalStopsMap[matchedStop.stop] || matchedStop.stop;
                        }
                    }

                    if (isValid) {
                        validDirs.push({
                            ...dir,
                            nearbyHint: `於 ${boardStopName} 上車 (約 ${Math.round(boardStopDistance)}米)`
                        });
                    }
                }));

                if (validDirs.length > 0) filteredGroups[rName] = validDirs;
            }));

            window.tab3RadiusResultCache[geoKey] = filteredGroups;
            toggleSkeleton('tab3-skeleton', false);
            if (Object.keys(filteredGroups).length === 0) {
                container.innerHTML = `<div class="status-msg" style="padding: 40px;">附近 ${radius} 米內沒有直達目標車站的路線。</div>`;
            } else {
                renderCatalogHTML(filteredGroups, 'tab3-target-routes-container', true);
            }
            container.style.display = 'block';

        } catch (err) {
            toggleSkeleton('tab3-skeleton', false);
            const msg = err && err.message === 'NO_GEOLOCATION' ? '您的瀏覽器不支援定位功能。' : '定位超時或被拒絕，請確保已開啟定位權限。';
            container.innerHTML = `<div class="status-msg error" style="padding: 40px;">${msg}</div>`;
            container.style.display = 'block';
        }
    }


    // ==========================================
    // Tab 4: 全港巴士 / 專線小巴查詢邏輯 
    // ==========================================
    window.allRoutesGroupsTab4 = {};
    window.tab4Loaded = false;
    window.tab4SearchText = '';
    window.tab4OperatorFilter = 'ALL';
    window.tab4SourceStatus = { kmb: false, ctb: false, gmb: false };
    window.routeEtaStatusTab4 = {};
    window.gmbRouteDetailCache = {};
    window.gmbDirectionsLoadedKeys = {};
    
    window.tab4DisplayRoutes = [];
    window.tab4FilteredGroups = {};
    window.tab4CurrentPage = 0;
    window.isTab4LoadingMore = false;
    window.tab4BackgroundRefreshing = false;
    window.tab4ListScrollTop = 0;
    window.tab4DetailContext = null;

    // ==========================================
    // Tab 4 本機快取：先顯示舊資料，再背景更新。
    // 只快取靜態路線/方向資料；ETA 到站時間仍然即時讀取。
    // ==========================================
    const TAB4_ROUTE_CACHE_KEY = 'psk_transport_tab4_route_groups_v2';
    const TAB4_ROUTE_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

    function safeLocalStorageGet(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }

    function safeLocalStorageSet(key, value) {
        try { localStorage.setItem(key, value); return true; }
        catch (e) { console.warn('localStorage save failed', key, e); return false; }
    }


    // ==========================================
    // 收藏車站：Tab 4 車站詳情加 ★ / ✰，Tab 3 以卡片顯示
    // ==========================================
    const FAVORITE_STOPS_KEY = 'psk_transport_favorite_stops_v1';

    function getFavoriteBoundCode(bound) {
        const b = String(bound || '').toLowerCase();
        if (b === 'i' || b === 'inbound') return 'I';
        return 'O';
    }

    function normalizeFavoriteStop(fav) {
        const normalized = {
            route: String(fav.route || fav.routeDisplay || '').trim(),
            routeDisplay: String(fav.routeDisplay || fav.route || '').trim(),
            bound: getFavoriteBoundCode(fav.bound) === 'I' ? 'inbound' : 'outbound',
            boundCode: getFavoriteBoundCode(fav.boundCode || fav.bound),
            dest: String(fav.dest || '').trim(),
            stopId: String(fav.stopId || fav.stop || '').trim(),
            seq: String(fav.seq || '').trim(),
            stopName: String(fav.stopName || fav.name_tc || fav.stopId || '').trim(),
            isCitybus: !!fav.isCitybus,
            isGmb: !!fav.isGmb,
            gmbRegion: String(fav.gmbRegion || '').trim(),
            gmbRouteId: String(fav.gmbRouteId || fav.routeId || '').trim(),
            gmbRouteSeq: String(fav.gmbRouteSeq || fav.routeSeq || '').trim(),
            badgeColor: String(fav.badgeColor || '').trim(),
            operatorLabel: String(fav.operatorLabel || '').trim()
        };
        normalized.key = makeFavoriteStopKey(normalized);
        return normalized;
    }

    function makeFavoriteStopKey(fav) {
        const op = fav.isGmb ? 'GMB' : (fav.isCitybus ? 'CTB' : 'KMB');
        const routeCode = String(fav.route || fav.routeDisplay || '').trim().toUpperCase();
        const boundCode = getFavoriteBoundCode(fav.boundCode || fav.bound);
        const gmbPart = fav.isGmb ? `${fav.gmbRegion || ''}:${fav.gmbRouteId || ''}:${fav.gmbRouteSeq || ''}` : '';
        return [op, routeCode, boundCode, gmbPart, String(fav.seq || ''), String(fav.stopId || '')].join('|');
    }

    function getFavoriteStops() {
        const raw = safeLocalStorageGet(FAVORITE_STOPS_KEY);
        if (!raw) return [];
        try {
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            const seen = new Set();
            return parsed.map(normalizeFavoriteStop).filter(fav => {
                if (!fav.route || !fav.seq || !fav.stopName) return false;
                if (seen.has(fav.key)) return false;
                seen.add(fav.key);
                return true;
            });
        } catch (e) {
            console.warn('Favorite stops restore failed', e);
            return [];
        }
    }

    function saveFavoriteStops(list) {
        safeLocalStorageSet(FAVORITE_STOPS_KEY, JSON.stringify((list || []).map(normalizeFavoriteStop)));
    }

    function isFavoriteStop(fav) {
        const key = makeFavoriteStopKey(normalizeFavoriteStop(fav));
        return getFavoriteStops().some(item => item.key === key);
    }

    function encodeFavoriteStopPayload(fav) {
        return encodeURIComponent(JSON.stringify(normalizeFavoriteStop(fav)));
    }

    function makeFavoriteStopPayload({ route, routeDisplay, bound, dest, isCitybus, isGmb, gmbRegion, gmbRouteId, gmbRouteSeq, seq, stopId, stopName, badgeColor }) {
        let operatorLabel = '九巴';
        if (isCitybus) operatorLabel = '城巴';
        if (isGmb) operatorLabel = '專線小巴';
        if (!isCitybus && !isGmb && /^N?A/i.test(String(routeDisplay || route || ''))) operatorLabel = '龍運';

        return normalizeFavoriteStop({
            route,
            routeDisplay: routeDisplay || route,
            bound,
            dest,
            stopId,
            seq,
            stopName,
            isCitybus,
            isGmb,
            gmbRegion,
            gmbRouteId,
            gmbRouteSeq,
            badgeColor,
            operatorLabel
        });
    }

    function renderStopFavoriteButton(fav) {
        const normalized = normalizeFavoriteStop(fav);
        const selected = isFavoriteStop(normalized);
        const encoded = encodeFavoriteStopPayload(normalized);
        return `<button type="button" class="stop-star-btn ${selected ? 'is-favorite' : ''}" data-favorite-key="${escapeHtml(normalized.key)}" onclick="toggleFavoriteStopFromEncoded(event, '${encoded}')" title="${selected ? '取消收藏' : '加入收藏'}">${selected ? '★' : '✰'}</button>`;
    }

    function renderFavoriteStarButton(fav) {
        const normalized = normalizeFavoriteStop(fav);
        const encoded = encodeFavoriteStopPayload(normalized);
        return `<button type="button" class="favorite-star-btn is-favorite" data-favorite-key="${escapeHtml(normalized.key)}" onclick="toggleFavoriteStopFromEncoded(event, '${encoded}')" title="取消收藏">★</button>`;
    }

    function setFavoriteButtonVisual(btn, selected) {
        if (!btn) return;
        btn.classList.toggle('is-favorite', !!selected);
        btn.textContent = selected ? '★' : '✰';
        btn.title = selected ? '取消收藏' : '加入收藏';
    }

    function refreshFavoriteButtonStates() {
        const favKeys = new Set(getFavoriteStops().map(fav => fav.key));
        document.querySelectorAll('.stop-star-btn, .favorite-star-btn').forEach(btn => {
            const key = btn.getAttribute('data-favorite-key') || '';
            setFavoriteButtonVisual(btn, favKeys.has(key));
        });
    }

    function toggleFavoriteStopFromEncoded(event, encoded) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        try {
            const fav = normalizeFavoriteStop(JSON.parse(decodeURIComponent(encoded)));
            const list = getFavoriteStops();
            const idx = list.findIndex(item => item.key === fav.key);
            if (idx >= 0) list.splice(idx, 1);
            else list.unshift(fav);
            saveFavoriteStops(list);
            refreshFavoriteButtonStates();
            if (currentTab === 3) renderFavorites();
        } catch (e) {
            console.warn('Toggle favorite stop failed', e);
        }
    }

    function getFavoriteHeaderClass(fav) {
        if (fav.isGmb) return 'gmb-header';
        if (fav.isCitybus) return 'ctb-header';
        return 'kmb-header';
    }

    function getFavoriteIcon(fav) {
        if (fav.isGmb) return '🚐';
        return '🚌';
    }

    function makeFavoriteEtaDomId(key) {
        return 'favorite-eta-' + makeTab4SafeDomId(key);
    }

    function renderFavoriteEtaHtml(etas) {
        const sorted = (etas || []).filter(Boolean).sort((a, b) => new Date(a) - new Date(b)).slice(0, 3);
        if (sorted.length === 0) return '<div class="status-msg" style="padding: 8px 0; text-align:left;">暫無班次</div>';
        return sorted.map(eta => {
            const mins = getMins(eta);
            const isUrgent = mins === '即將' || mins === '0分' || mins === '1分' || mins === '2分' || mins === '3分';
            return `
            <div class="schedule-item favorite-eta-item">
                <div class="schedule-line favorite-eta-line">
                    ${renderCardMinutesLabel(mins, { isUrgent, isScheduled: false })}
                    <span class="eta-clock">(${formatTime(eta)})</span>
                    <span></span>
                </div>
            </div>`;
        }).join('');
    }

    async function fetchFavoriteEtas(fav) {
        const normalized = normalizeFavoriteStop(fav);
        const boundCode = getFavoriteBoundCode(normalized.boundCode || normalized.bound);

        if (normalized.isGmb) {
            if (!normalized.gmbRouteId || !normalized.gmbRouteSeq) return [];
            return fetchGmbEtaForStop(normalized.gmbRouteId, normalized.gmbRouteSeq, normalized.seq);
        }

        if (normalized.isCitybus) {
            const etaObj = await fetchJsonCached(`https://rt.data.gov.hk/v2/transport/citybus/eta/CTB/${encodeURIComponent(normalized.stopId)}/${encodeURIComponent(normalized.route)}`, { ttl: 12000, timeout: 5000 });
            return ((etaObj && etaObj.data) || [])
                .filter(e => e && e.dir === boundCode && e.eta)
                .map(e => e.eta);
        }

        const etaObj = await fetchJsonCached(`https://data.etabus.gov.hk/v1/transport/kmb/route-eta/${encodeURIComponent(normalized.route)}/1`, { ttl: 12000, timeout: 6000 });
        return ((etaObj && etaObj.data) || [])
            .filter(e => e && e.dir === boundCode && String(e.seq) === String(normalized.seq) && e.eta)
            .map(e => e.eta);
    }

    async function refreshFavoritesEta() {
        const favorites = getFavoriteStops();
        if (favorites.length === 0) return;

        await mapWithConcurrency(favorites, 4, async fav => {
            const el = document.getElementById(makeFavoriteEtaDomId(fav.key));
            if (!el) return;
            try {
                const etas = await fetchFavoriteEtas(fav);
                el.innerHTML = renderFavoriteEtaHtml(etas);
            } catch (e) {
                console.warn('Favorite ETA refresh failed', fav, e);
                el.innerHTML = '<div class="status-msg error" style="padding: 8px 0; text-align:left;">資料無法載入</div>';
            }
        });
    }


    function renderFavorites() {
        const container = document.getElementById('favorites-list');
        if (!container) return;
        const favorites = getFavoriteStops();

        if (favorites.length === 0) {
            container.innerHTML = '<div class="status-msg" style="padding: 40px 12px;">未有收藏車站。請到「巴士/小巴」搜尋路線，進入車站列表後按 ✰ 加入收藏。</div>';
            return;
        }

        container.innerHTML = favorites.map(fav => {
            const etaId = makeFavoriteEtaDomId(fav.key);
            return `
            <div class="card favorite-card" data-favorite-key="${escapeHtml(fav.key)}">
                <div class="card-header ${getFavoriteHeaderClass(fav)}">
                    <span class="icon">${getFavoriteIcon(fav)}</span>
                    <span class="card-title">${escapeHtml(fav.routeDisplay || fav.route)}</span>
                    <span class="favorite-route-meta">${escapeHtml(fav.operatorLabel || '')}</span>
                    ${renderFavoriteStarButton(fav)}
                </div>
                <div class="card-content favorite-card-content">
                    <div class="favorite-stop-name">${escapeHtml(fav.stopName)}</div>
                    <div class="favorite-stop-meta">往 ${escapeHtml(fav.dest || '')}</div>
                    <div id="${etaId}" class="favorite-card-eta"><div class="status-msg" style="padding: 8px 0; text-align:left;">更新中...</div></div>
                </div>
            </div>`;
        }).join('');

        refreshFavoritesEta();
        refreshFavoriteButtonStates();
    }

    function restoreTab4RouteCache() {
        const raw = safeLocalStorageGet(TAB4_ROUTE_CACHE_KEY);
        if (!raw) return false;
        try {
            const cached = JSON.parse(raw);
            if (!cached || !cached.groups || typeof cached.groups !== 'object') return false;
            if (Date.now() - Number(cached.time || 0) > TAB4_ROUTE_CACHE_TTL) return false;

            window.allRoutesGroupsTab4 = cached.groups;
            window.tab4SourceStatus = cached.sourceStatus || { kmb: true, ctb: true, gmb: true };
            window.gmbDirectionsLoadedKeys = cached.gmbDirectionsLoadedKeys || {};
            window.tab4Loaded = true;
            return Object.keys(window.allRoutesGroupsTab4).length > 0;
        } catch (e) {
            console.warn('Tab 4 route cache restore failed', e);
            return false;
        }
    }

    function saveTab4RouteCache() {
        if (!window.allRoutesGroupsTab4 || Object.keys(window.allRoutesGroupsTab4).length === 0) return;
        const payload = {
            version: 2,
            time: Date.now(),
            groups: window.allRoutesGroupsTab4,
            sourceStatus: window.tab4SourceStatus,
            gmbDirectionsLoadedKeys: window.gmbDirectionsLoadedKeys || {}
        };
        safeLocalStorageSet(TAB4_ROUTE_CACHE_KEY, JSON.stringify(payload));
    }

    const GMB_REGIONS = [
        { code: 'HKI', label: '港島' },
        { code: 'KLN', label: '九龍' },
        { code: 'NT', label: '新界' }
    ];

    function escapeJsArg(value) {
        return String(value ?? '')
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/\r?\n/g, ' ');
    }

    function getRouteDisplayNameForTab4(groupKey) {
        const dirs = window.allRoutesGroupsTab4[groupKey] || window.tab4FilteredGroups[groupKey] || [];
        return (dirs[0] && dirs[0].displayRoute) ? dirs[0].displayRoute : groupKey;
    }

    function sortRouteGroupKeysTab4(a, b) {
        const aName = getRouteDisplayNameForTab4(a);
        const bName = getRouteDisplayNameForTab4(b);
        const routeCmp = aName.localeCompare(bName, undefined, { numeric: true, sensitivity: 'base' });
        if (routeCmp !== 0) return routeCmp;
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    }

    function getGmbRegionLabel(region) {
        const found = GMB_REGIONS.find(r => r.code === region);
        return found ? found.label : region;
    }

    function getGmbRouteCode(routeObj, fallback = '') {
        if (!routeObj) return String(fallback || '').trim();
        if (typeof routeObj === 'string' || typeof routeObj === 'number') return String(routeObj).trim().toUpperCase();
        return String(routeObj.route_code || routeObj.route || routeObj.route_no || routeObj.routeName || fallback || '').trim().toUpperCase();
    }

    function getGmbText(...values) {
        for (const v of values) {
            if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
        }
        return '';
    }

    function flattenGmbRouteItems(payload) {
        const data = payload && payload.data !== undefined ? payload.data : payload;
        if (Array.isArray(data)) return data;
        if (data && typeof data === 'object') {
            // /route/{region}/{route} 有機會直接回傳單一路線物件；
            // /route/{region} 則多數只回傳路線編號陣列。兩者都要兼容。
            if (Array.isArray(data.directions) || data.route_id || data.routeId || data.id) return [data];
            if (Array.isArray(data.routes)) return data.routes;
            if (Array.isArray(data.route_list)) return data.route_list;
            const arr = [];
            Object.values(data).forEach(v => {
                if (Array.isArray(v)) arr.push(...v);
                else if (v && typeof v === 'object' && (Array.isArray(v.directions) || v.route_id || v.routeId || v.id)) arr.push(v);
            });
            return arr;
        }
        return [];
    }

    function addGmbDirectionToTab4(groupKey, dirObj) {
        if (!window.allRoutesGroupsTab4[groupKey]) window.allRoutesGroupsTab4[groupKey] = [];
        const exists = window.allRoutesGroupsTab4[groupKey].some(existing =>
            existing.isGmb &&
            String(existing.bound) === String(dirObj.bound) &&
            String(existing.routeId || '') === String(dirObj.routeId || '') &&
            String(existing.routeSeq || '') === String(dirObj.routeSeq || '') &&
            String(existing.dest_tc || '') === String(dirObj.dest_tc || '')
        );
        if (!exists) window.allRoutesGroupsTab4[groupKey].push(dirObj);
    }

    function addGmbRouteToTab4(routeObj, region, fallbackRouteCode = '') {
        const routeCode = getGmbRouteCode(routeObj, fallbackRouteCode);
        if (!routeCode) return;

        const regionLabel = getGmbRegionLabel(region);
        const groupKey = `GMB-${region}-${routeCode}`;
        const routeId = routeObj && typeof routeObj === 'object' ? getGmbText(routeObj.route_id, routeObj.routeId, routeObj.id) : '';
        const description = routeObj && typeof routeObj === 'object' ? getGmbText(routeObj.description_tc, routeObj.description_en, routeObj.name_tc, routeObj.name_en) : '';
        const directions = (routeObj && typeof routeObj === 'object' && Array.isArray(routeObj.directions)) ? routeObj.directions : [];

        if (directions.length === 0) {
            // 路線總表只得車號、未有方向資料時，先顯示兩個明確入口。
            // 按「方向 1」會讀取第一個方向；按「方向 2」會讀取第二個方向。
            // 背景補齊成功後，列表會自動改回真正的目的地名稱。
            [
                { bound: 'O', label: '方向 1' },
                { bound: 'I', label: '方向 2' }
            ].forEach(item => addGmbDirectionToTab4(groupKey, {
                route: routeCode,
                displayRoute: routeCode,
                bound: item.bound,
                orig_tc: regionLabel,
                dest_tc: item.label,
                isCitybus: false,
                isGmb: true,
                gmbRegion: region,
                routeId,
                routeSeq: '',
                needsGmbDetail: true,
                operatorName: `${regionLabel}專線小巴`
            }));
            return;
        }

        directions.forEach((dir, idx) => {
            const routeSeq = getGmbText(dir.route_seq, dir.seq, idx + 1);
            const bound = idx === 0 ? 'O' : (idx === 1 ? 'I' : String(routeSeq || idx + 1));
            const dest = getGmbText(dir.dest_tc, dir.destination_tc, dir.dest_en, dir.destination_en, description, '詳情');
            const orig = getGmbText(dir.orig_tc, dir.origin_tc, dir.orig_en, dir.origin_en, routeObj.orig_tc, routeObj.origin_tc, regionLabel);
            addGmbDirectionToTab4(groupKey, {
                route: routeCode,
                displayRoute: routeCode,
                bound,
                orig_tc: orig,
                dest_tc: dest,
                isCitybus: false,
                isGmb: true,
                gmbRegion: region,
                routeId,
                routeSeq,
                needsGmbDetail: !routeId || !routeSeq,
                operatorName: `${regionLabel}專線小巴`
            });
        });
    }

    async function getGmbRouteDetailByCode(region, routeCode) {
        const cacheKey = `${region}-${routeCode}`;
        if (window.gmbRouteDetailCache[cacheKey]) return window.gmbRouteDetailCache[cacheKey];
        const data = await fetchJsonCached(`https://data.etagmb.gov.hk/route/${encodeURIComponent(region)}/${encodeURIComponent(routeCode)}`, { ttl: 3600000, timeout: 10000 });
        const routes = flattenGmbRouteItems(data);
        window.gmbRouteDetailCache[cacheKey] = routes;
        return routes;
    }

    async function resolveGmbDirectionForDetail(routeCode, region, routeId, routeSeq, bound) {
        if (routeId && routeSeq) {
            return { routeId, routeSeq, routeCode, region };
        }

        const routes = await getGmbRouteDetailByCode(region, routeCode);
        const preferredIndex = bound === 'inbound' ? 1 : 0;
        let fallback = null;

        for (const routeObj of routes) {
            const thisRouteId = getGmbText(routeObj.route_id, routeObj.routeId, routeObj.id);
            const directions = Array.isArray(routeObj.directions) ? routeObj.directions : [];
            directions.forEach((dir, idx) => {
                const thisRouteSeq = getGmbText(dir.route_seq, dir.seq, idx + 1);
                const resolved = {
                    routeId: thisRouteId,
                    routeSeq: thisRouteSeq,
                    routeCode,
                    region,
                    dest_tc: getGmbText(dir.dest_tc, dir.destination_tc, dir.dest_en, dir.destination_en),
                    orig_tc: getGmbText(dir.orig_tc, dir.origin_tc, dir.orig_en, dir.origin_en)
                };
                if (idx === preferredIndex && thisRouteId && thisRouteSeq && !fallback) fallback = resolved;
                if (!fallback && thisRouteId && thisRouteSeq) fallback = resolved;
            });
        }

        if (!fallback) throw new Error(`GMB route detail not found: ${region} ${routeCode}`);
        return fallback;
    }

    async function getGmbRouteStopsForDetail(routeId, routeSeq) {
        const cacheKey = `GMB-STOPS-${routeId}-${routeSeq}`;
        if (window.routeStopsCache[cacheKey]) return window.routeStopsCache[cacheKey];

        const stopData = await fetchJsonCached(`https://data.etagmb.gov.hk/route-stop/${encodeURIComponent(routeId)}/${encodeURIComponent(routeSeq)}`, { ttl: 3600000, timeout: 10000 });
        const rawStops = (stopData.data && stopData.data.route_stops) ? stopData.data.route_stops : (Array.isArray(stopData.data) ? stopData.data : []);
        const stops = rawStops.map((s, idx) => {
            const stopId = getGmbText(s.stop_id, s.stop, s.id, s.name_tc, `gmb-${routeId}-${routeSeq}-${idx + 1}`);
            const stopName = getGmbText(s.name_tc, s.name_en, s.stop_name_tc, stopId);
            if (stopId) window.globalStopsMap[stopId] = stopName;
            return {
                ...s,
                stop: stopId,
                seq: getGmbText(s.stop_seq, s.seq, idx + 1),
                name_tc: stopName,
                isGmb: true
            };
        });
        window.routeStopsCache[cacheKey] = stops;
        return stops;
    }

    async function fetchGmbEtaForStop(routeId, routeSeq, stopSeq) {
        const etaObj = await fetchJsonCached(`https://data.etagmb.gov.hk/eta/route-stop/${encodeURIComponent(routeId)}/${encodeURIComponent(routeSeq)}/${encodeURIComponent(stopSeq)}`, { ttl: 12000, timeout: 5000 });
        const payload = etaObj.data || {};
        if (payload.enabled === false) return [];
        return (payload.eta || [])
            .map(e => e && (e.timestamp || e.eta))
            .filter(Boolean);
    }

    async function loadGmbRoutesForTab4() {
        const results = await Promise.allSettled(GMB_REGIONS.map(region =>
            fetchJsonCached(`https://data.etagmb.gov.hk/route/${encodeURIComponent(region.code)}`, { ttl: 3600000, timeout: 12000 })
                .then(data => ({ region, data }))
        ));

        let loaded = false;
        results.forEach(res => {
            if (res.status !== 'fulfilled') {
                console.warn('GMB route list failed', res.reason);
                return;
            }
            const { region, data } = res.value;
            const items = flattenGmbRouteItems(data);
            if (!items.length) return;
            loaded = true;
            items.forEach(item => addGmbRouteToTab4(item, region.code));
        });
        return loaded;
    }

    function buildGmbDirectionsFromDetailRoutes(routes, region, fallbackRouteCode) {
        const regionLabel = getGmbRegionLabel(region);
        const directionsOut = [];

        (routes || []).forEach(routeObj => {
            const routeCode = getGmbRouteCode(routeObj, fallbackRouteCode);
            const routeId = routeObj && typeof routeObj === 'object' ? getGmbText(routeObj.route_id, routeObj.routeId, routeObj.id) : '';
            const description = routeObj && typeof routeObj === 'object' ? getGmbText(routeObj.description_tc, routeObj.description_en, routeObj.name_tc, routeObj.name_en) : '';
            const directions = (routeObj && typeof routeObj === 'object' && Array.isArray(routeObj.directions)) ? routeObj.directions : [];

            if (directions.length === 0) {
                if (routeId || description) {
                    directionsOut.push({
                        route: routeCode || fallbackRouteCode,
                        displayRoute: routeCode || fallbackRouteCode,
                        bound: 'O',
                        orig_tc: regionLabel,
                        dest_tc: description || '詳情',
                        isCitybus: false,
                        isGmb: true,
                        gmbRegion: region,
                        routeId,
                        routeSeq: '',
                        needsGmbDetail: !routeId,
                        operatorName: `${regionLabel}專線小巴`
                    });
                }
                return;
            }

            directions.forEach((dir, idx) => {
                const routeSeq = getGmbText(dir.route_seq, dir.seq, idx + 1);
                const bound = idx === 0 ? 'O' : (idx === 1 ? 'I' : `G${idx + 1}`);
                const dest = getGmbText(dir.dest_tc, dir.destination_tc, dir.dest_en, dir.destination_en, description, '詳情');
                const orig = getGmbText(dir.orig_tc, dir.origin_tc, dir.orig_en, dir.origin_en, routeObj.orig_tc, routeObj.origin_tc, regionLabel);
                directionsOut.push({
                    route: routeCode || fallbackRouteCode,
                    displayRoute: routeCode || fallbackRouteCode,
                    bound,
                    orig_tc: orig,
                    dest_tc: dest,
                    isCitybus: false,
                    isGmb: true,
                    gmbRegion: region,
                    routeId,
                    routeSeq,
                    needsGmbDetail: !routeId || !routeSeq,
                    operatorName: `${regionLabel}專線小巴`
                });
            });
        });

        return directionsOut;
    }

    async function ensureGmbDirectionsLoadedForKeys(groupKeys) {
        const updatedKeys = [];
        const keys = [...new Set((groupKeys || []).filter(key => {
            const dirs = window.allRoutesGroupsTab4[key] || [];
            if (!dirs.some(d => d.isGmb)) return false;
            if (window.gmbDirectionsLoadedKeys[key]) return false;
            // 路線總表只得編號時，先用 placeholder 顯示；實際方向要進一步讀 /route/{region}/{route}。
            return dirs.some(d => d.needsGmbDetail || !d.routeId || !d.routeSeq || /點擊載入方向資料|詳情|^方向\s*\d+$/.test(String(d.dest_tc || '')));
        }))];

        if (keys.length === 0) return updatedKeys;

        setTab4Loading(true);
        try {
            const chunkSize = 6;
            for (let i = 0; i < keys.length; i += chunkSize) {
                const chunk = keys.slice(i, i + chunkSize);
                const results = await Promise.allSettled(chunk.map(async key => {
                    const oldDirs = window.allRoutesGroupsTab4[key] || [];
                    const first = oldDirs.find(d => d.isGmb) || {};
                    const parts = String(key).split('-');
                    const region = first.gmbRegion || parts[1] || '';
                    const routeCode = first.route || parts.slice(2).join('-');
                    if (!region || !routeCode) return;

                    const detailRoutes = await getGmbRouteDetailByCode(region, routeCode);
                    const detailDirs = buildGmbDirectionsFromDetailRoutes(detailRoutes, region, routeCode)
                        .filter(d => d.route && String(d.route).toUpperCase() === String(routeCode).toUpperCase());

                    if (detailDirs.length > 0) {
                        window.allRoutesGroupsTab4[key] = detailDirs;
                        window.tab4FilteredGroups[key] = getTab4DirsByOperator(detailDirs);
                        window.gmbDirectionsLoadedKeys[key] = true;
                        updatedKeys.push(key);
                    }
                }));

                results.forEach((res, idx) => {
                    if (res.status !== 'fulfilled') console.warn('GMB direction detail failed', chunk[idx], res.reason);
                });
            }
        } finally {
            setTab4Loading(false);
        }
        if (updatedKeys.length) saveTab4RouteCache();
        return updatedKeys;
    }

    // 非同步進度條控制器
    window.tab4ActiveFetches = 0;
    function setTab4Loading(isActive) {
        if (isActive) window.tab4ActiveFetches++;
        else window.tab4ActiveFetches = Math.max(0, window.tab4ActiveFetches - 1);
        
        const p = document.getElementById('tab4-progress-container');
        if (p) p.style.display = window.tab4ActiveFetches > 0 ? 'block' : 'none';
    }

    function updateTab4SourceStatus() {
        const el = document.getElementById('tab4-source-status');
        if (!el) return;
        const missing = [];
        if (!window.tab4SourceStatus.kmb) missing.push('九巴');
        if (!window.tab4SourceStatus.ctb) missing.push('城巴');
        if (!window.tab4SourceStatus.gmb) missing.push('小巴');
        if (missing.length === 0 || missing.length === 3) el.innerText = '';
        else el.innerText = `${missing.join('、')}暫未載入${location.protocol === 'file:' ? '，建議用本地伺服器開啟' : ''}`;
    }

    function getTab4DirsByOperator(dirs) {
        if (window.tab4OperatorFilter === 'KMB') return (dirs || []).filter(d => !d.isCitybus && !d.isGmb);
        if (window.tab4OperatorFilter === 'CTB') return (dirs || []).filter(d => d.isCitybus && !d.isGmb);
        if (window.tab4OperatorFilter === 'GMB') return (dirs || []).filter(d => d.isGmb);
        return dirs || [];
    }

    function applyTab4Operator(operator) {
        window.tab4OperatorFilter = operator;
        document.querySelectorAll('#tab-4 .op-btn').forEach(btn => btn.classList.remove('active'));
        const active = document.getElementById(`tab4-op-${operator}`);
        if (active) active.classList.add('active');
        routeKeyboardSync();
        if (window.tab4Loaded) updateTab4View();
    }

    // ==========================================
    // Tab 4：自訂車號鍵盤
    // ==========================================
    const ROUTE_KEYBOARD_DIGIT_KEYS = [
        { key: '1' }, { key: '2' }, { key: '3' }, { key: '4' }, { key: '5' }, { action: 'clear', label: '⊖', title: '清除' },
        { key: '6' }, { key: '7' }, { key: '8' }, { key: '9' }, { key: '0' }, { action: 'backspace', label: '⌫', title: '刪除' }
    ];
    const ROUTE_KEYBOARD_LETTER_KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const ROUTE_KEYBOARD_KEYS = ['0','1','2','3','4','5','6','7','8','9', ...ROUTE_KEYBOARD_LETTER_KEYS];
    const ROUTE_KEYBOARD_LETTER_SLOT_COUNT = 12;
    window.routeKeyboardBuilt = false;

    function buildRouteKeyboard() {
        if (window.routeKeyboardBuilt) return;
        const grid = document.getElementById('route-keyboard-grid');
        const extra = document.getElementById('route-keyboard-extra');
        if (!grid) return;

        grid.innerHTML = ROUTE_KEYBOARD_DIGIT_KEYS.map(item => {
            if (item.action === 'clear') {
                return `<button type="button" class="route-key-btn route-key-action-key" title="${item.title}" aria-label="${item.title}" onmousedown="event.preventDefault()" onclick="routeKeyboardClear()">${item.label}</button>`;
            }
            if (item.action === 'backspace') {
                return `<button type="button" class="route-key-btn route-key-action-key" title="${item.title}" aria-label="${item.title}" onmousedown="event.preventDefault()" onclick="routeKeyboardBackspace()">${item.label}</button>`;
            }
            return `<button type="button" class="route-key-btn" data-key="${item.key}" onmousedown="event.preventDefault()" onclick="routeKeyboardPress('${item.key}')">${item.key}</button>`;
        }).join('');

        if (extra) {
            // 只建立 12 個固定槽位。內容按可接續字母填入；無字母的槽位隱藏但仍佔位，確保鍵盤比例不變。
            extra.innerHTML = Array.from({ length: ROUTE_KEYBOARD_LETTER_SLOT_COUNT }, (_, i) => `
                <button type="button" class="route-key-btn route-key-letter-slot key-hidden" data-slot="${i}" data-key="" onmousedown="event.preventDefault()" onclick="routeKeyboardPress(this.dataset.key || '')" aria-hidden="true">&nbsp;</button>
            `).join('');
        }
        window.routeKeyboardBuilt = true;
    }

    function getRouteKeyboardSearchPrefix() {
        const input = document.getElementById('route-search-input');
        const value = input ? input.value.trim().toUpperCase() : '';
        // 車號鍵盤按逐字位置判斷：第 1 個字必須是路線第 1 個字，第 2 個字必須是路線第 2 個字，如此類推。
        return value.replace(/[^A-Z0-9]/g, '');
    }

    function getKeyboardCandidateRouteNames() {
        const groups = window.allRoutesGroupsTab4 || {};
        return Object.keys(groups)
            .filter(key => getTab4DirsByOperator(groups[key]).length > 0)
            .map(key => String(getRouteDisplayNameForTab4(key) || key).toUpperCase())
            .filter(Boolean);
    }

    function getAvailableRouteKeyboardChars(prefix) {
        const routeNames = getKeyboardCandidateRouteNames();
        if (routeNames.length === 0) return new Set(ROUTE_KEYBOARD_KEYS);
        const available = new Set();
        routeNames.forEach(name => {
            if (!prefix || name.startsWith(prefix)) {
                const nextChar = name.charAt(prefix.length);
                if (/^[A-Z0-9]$/.test(nextChar)) available.add(nextChar);
            }
        });
        return available;
    }

    function routeKeyboardSync() {
        buildRouteKeyboard();
        const keyboard = document.getElementById('route-keyboard');
        const hint = document.getElementById('route-keyboard-hint');
        const empty = document.getElementById('route-keyboard-empty');
        const extra = document.getElementById('route-keyboard-extra');
        if (!keyboard) return;

        const prefix = getRouteKeyboardSearchPrefix();
        const available = getAvailableRouteKeyboardChars(prefix);
        const visibleLetters = ROUTE_KEYBOARD_LETTER_KEYS
            .filter(k => available.has(k))
            .slice(0, ROUTE_KEYBOARD_LETTER_SLOT_COUNT);
        let enabledDigitCount = 0;
        let visibleLetterCount = 0;

        document.querySelectorAll('#route-keyboard-grid .route-key-btn[data-key]').forEach(btn => {
            const key = btn.dataset.key;
            const canUse = available.has(key);
            // 數字固定在 1 2 3 4 5 ⊖ / 6 7 8 9 0 ⌫，不可接續時只變灰，不會消失或移位。
            btn.classList.toggle('key-disabled', !canUse);
            btn.disabled = !canUse;
            btn.classList.remove('key-hidden');
            if (canUse) enabledDigitCount++;
        });

        document.querySelectorAll('#route-keyboard-extra .route-key-letter-slot').forEach((btn, idx) => {
            const key = visibleLetters[idx] || '';
            const canShow = Boolean(key);
            btn.dataset.key = key;
            btn.textContent = key || '';
            btn.setAttribute('aria-hidden', canShow ? 'false' : 'true');
            btn.classList.toggle('key-hidden', !canShow);
            btn.disabled = !canShow;
            if (canShow) visibleLetterCount++;
        });

        const availableCount = enabledDigitCount + visibleLetterCount;
        const loadedCount = Object.keys(window.allRoutesGroupsTab4 || {}).length;
        if (hint) {
            if (!loadedCount) hint.innerText = '路線載入中，可先輸入車號';
            else if (!prefix) hint.innerText = `可輸入 ${availableCount} 個開首字元`;
            else hint.innerText = availableCount ? `${prefix} 後可接續 ${availableCount} 個字元` : `${prefix} 已無可接續字元`;
        }
        if (empty) empty.classList.toggle('is-visible', availableCount === 0);
        if (extra) extra.setAttribute('aria-label', visibleLetterCount ? '可接續英文字母' : '沒有可接續英文字母');
    }

    function showRouteKeyboard() {
        if (currentTab !== 4) return;
        buildRouteKeyboard();
        routeKeyboardSync();
        const keyboard = document.getElementById('route-keyboard');
        if (!keyboard) return;
        keyboard.classList.add('open');
        keyboard.setAttribute('aria-hidden', 'false');
        document.body.classList.add('route-keyboard-open');
    }

    function hideRouteKeyboard() {
        const keyboard = document.getElementById('route-keyboard');
        if (!keyboard) return;
        keyboard.classList.remove('open');
        keyboard.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('route-keyboard-open');
    }

    function setRouteKeyboardSearchValue(value) {
        const input = document.getElementById('route-search-input');
        if (!input) return;
        input.value = String(value || '').toUpperCase();
        onTab4Search();
        setTimeout(routeKeyboardSync, 0);
        try { input.focus({ preventScroll: true }); } catch(e) { input.focus(); }
    }

    function routeKeyboardPress(key) {
        if (!key) return;
        const prefix = getRouteKeyboardSearchPrefix();
        const available = getAvailableRouteKeyboardChars(prefix);
        if (available.size && !available.has(key)) return;
        setRouteKeyboardSearchValue(prefix + key);
    }

    function routeKeyboardBackspace() {
        const prefix = getRouteKeyboardSearchPrefix();
        if (prefix) setRouteKeyboardSearchValue(prefix.slice(0, -1));
        else setRouteKeyboardSearchValue('');
    }

    function routeKeyboardClear() {
        setRouteKeyboardSearchValue('');
    }

    async function refreshTab4RouteSourcesInBackground() {
        if (window.tab4BackgroundRefreshing) return;
        window.tab4BackgroundRefreshing = true;
        setTab4Loading(true);

        const previousGroups = window.allRoutesGroupsTab4;
        const previousStatus = window.tab4SourceStatus;
        const previousLoadedKeys = window.gmbDirectionsLoadedKeys || {};

        const freshGroups = {};
        window.allRoutesGroupsTab4 = freshGroups;
        window.tab4SourceStatus = { kmb: false, ctb: false, gmb: false };
        window.gmbDirectionsLoadedKeys = {};

        try {
            const [kmbResult, ctbResult, gmbResult] = await Promise.allSettled([
                fetchJsonCached('https://data.etabus.gov.hk/v1/transport/kmb/route/', { ttl: 3600000, timeout: 12000 }),
                fetchJsonCached('https://rt.data.gov.hk/v2/transport/citybus/route/CTB', { ttl: 3600000, timeout: 12000 }),
                loadGmbRoutesForTab4()
            ]);

            let loadedAnySource = false;

            if (kmbResult.status === 'fulfilled' && kmbResult.value && Array.isArray(kmbResult.value.data)) {
                window.tab4SourceStatus.kmb = true;
                loadedAnySource = true;
                kmbResult.value.data.forEach(r => {
                    if (r.service_type === '1') {
                        if (!window.allRoutesGroupsTab4[r.route]) window.allRoutesGroupsTab4[r.route] = [];
                        if (!window.allRoutesGroupsTab4[r.route].some(e => e.bound === r.bound && !e.isCitybus && !e.isGmb)) {
                            window.allRoutesGroupsTab4[r.route].push({ ...r, isCitybus: false, isGmb: false, displayRoute: r.route });
                        }
                    }
                });
            }

            if (ctbResult.status === 'fulfilled' && ctbResult.value && Array.isArray(ctbResult.value.data)) {
                window.tab4SourceStatus.ctb = true;
                loadedAnySource = true;
                ctbResult.value.data.forEach(r => {
                    if (!window.allRoutesGroupsTab4[r.route]) window.allRoutesGroupsTab4[r.route] = [];
                    if (!window.allRoutesGroupsTab4[r.route].some(e => e.bound === 'O' && e.isCitybus && !e.isGmb)) {
                        window.allRoutesGroupsTab4[r.route].push({ route: r.route, displayRoute: r.route, bound: 'O', orig_tc: r.orig_tc, dest_tc: r.dest_tc, isCitybus: true, isGmb: false });
                    }
                    if (!window.allRoutesGroupsTab4[r.route].some(e => e.bound === 'I' && e.isCitybus && !e.isGmb)) {
                        window.allRoutesGroupsTab4[r.route].push({ route: r.route, displayRoute: r.route, bound: 'I', orig_tc: r.dest_tc, dest_tc: r.orig_tc, isCitybus: true, isGmb: false });
                    }
                });
            }

            if (gmbResult.status === 'fulfilled' && gmbResult.value) {
                window.tab4SourceStatus.gmb = true;
                loadedAnySource = true;
            }

            if (!loadedAnySource || Object.keys(window.allRoutesGroupsTab4).length === 0) throw new Error('NO_ROUTE_SOURCE');
            saveTab4RouteCache();
            updateTab4SourceStatus();
        } catch (e) {
            console.warn('Background route refresh failed, keeping local cache', e);
            window.allRoutesGroupsTab4 = previousGroups;
            window.tab4SourceStatus = previousStatus;
            window.gmbDirectionsLoadedKeys = previousLoadedKeys;
        } finally {
            window.tab4BackgroundRefreshing = false;
            setTab4Loading(false);
        }
    }

    async function initTab4() {
        if (window.tab4Loaded) return;
        const container = document.getElementById('tab4-all-routes-container');
        let target = document.getElementById('tab4-routes-append-target');
        if (!target) {
            container.innerHTML = '<div class="route-list-wrapper" id="tab4-routes-append-target"></div>';
            target = document.getElementById('tab4-routes-append-target');
        }

        if (restoreTab4RouteCache()) {
            toggleSkeleton('tab4-skeleton', false);
            container.style.display = 'block';
            updateTab4SourceStatus();
            updateTab4View();
            runSoon(() => refreshTab4RouteSourcesInBackground());
            return;
        }
        
        toggleSkeleton('tab4-skeleton', true);
        setTab4Loading(true);
        if (target) target.innerHTML = '';
        
        try {
            const [kmbResult, ctbResult, gmbResult] = await Promise.allSettled([
                fetchJsonCached('https://data.etabus.gov.hk/v1/transport/kmb/route/', { ttl: 3600000, timeout: 12000 }),
                // Citybus V1/V1.1 已停止支援；使用 V2 endpoint，避免整個巴士查詢因城巴 API 失敗而中斷。
                fetchJsonCached('https://rt.data.gov.hk/v2/transport/citybus/route/CTB', { ttl: 3600000, timeout: 12000 }),
                loadGmbRoutesForTab4()
            ]);

            let loadedAnySource = false;

            if (kmbResult.status === 'fulfilled' && kmbResult.value && Array.isArray(kmbResult.value.data)) {
                window.tab4SourceStatus.kmb = true;
                loadedAnySource = true;
                kmbResult.value.data.forEach(r => {
                    if (r.service_type === '1') {
                        if (!window.allRoutesGroupsTab4[r.route]) window.allRoutesGroupsTab4[r.route] = [];
                        if (!window.allRoutesGroupsTab4[r.route].some(e => e.bound === r.bound && !e.isCitybus && !e.isGmb)) {
                            window.allRoutesGroupsTab4[r.route].push({ ...r, isCitybus: false, isGmb: false, displayRoute: r.route });
                        }
                    }
                });
            } else {
                console.warn('KMB route list failed', kmbResult.reason || kmbResult.value);
            }

            if (ctbResult.status === 'fulfilled' && ctbResult.value && Array.isArray(ctbResult.value.data)) {
                window.tab4SourceStatus.ctb = true;
                loadedAnySource = true;
                ctbResult.value.data.forEach(r => {
                    if (!window.allRoutesGroupsTab4[r.route]) window.allRoutesGroupsTab4[r.route] = [];
                    if (!window.allRoutesGroupsTab4[r.route].some(e => e.bound === 'O' && e.isCitybus && !e.isGmb)) {
                        window.allRoutesGroupsTab4[r.route].push({ route: r.route, displayRoute: r.route, bound: 'O', orig_tc: r.orig_tc, dest_tc: r.dest_tc, isCitybus: true, isGmb: false });
                    }
                    if (!window.allRoutesGroupsTab4[r.route].some(e => e.bound === 'I' && e.isCitybus && !e.isGmb)) {
                        window.allRoutesGroupsTab4[r.route].push({ route: r.route, displayRoute: r.route, bound: 'I', orig_tc: r.dest_tc, dest_tc: r.orig_tc, isCitybus: true, isGmb: false });
                    }
                });
            } else {
                console.warn('Citybus route list failed', ctbResult.reason || ctbResult.value);
            }

            if (gmbResult.status === 'fulfilled' && gmbResult.value) {
                window.tab4SourceStatus.gmb = true;
                loadedAnySource = true;
            } else {
                console.warn('GMB route list failed', gmbResult.reason || gmbResult.value);
            }

            updateTab4SourceStatus();

            if (!loadedAnySource || Object.keys(window.allRoutesGroupsTab4).length === 0) {
                throw new Error('NO_ROUTE_SOURCE');
            }

            window.tab4Loaded = true;
            saveTab4RouteCache();
            updateTab4View();

            // 車站與全量 route-stop 只在進入詳情/範圍篩選時需要，改為背景預載，令查詢列表先出現。
            runSoon(() => {
                if (window.globalStopsList.length === 0) {
                    fetchJsonCached('https://data.etabus.gov.hk/v1/transport/kmb/stop', { ttl: 86400000, timeout: 12000 }).then(stopsData => {
                        window.globalStopsList = stopsData.data || [];
                        window.globalStopsList.forEach(s => { window.globalStopsMap[s.stop] = s.name_tc; });
                    }).catch(e => {});
                }
            });
            
        } catch(e) {
            console.warn('Tab 4 init failed', e);
            toggleSkeleton('tab4-skeleton', false);
            const errorHtml = '<span class="error" style="padding:20px; display:block;">載入失敗：暫時無法連接九巴、城巴及專線小巴開放數據。請稍後重試。</span>';
            if (target) target.innerHTML = errorHtml;
            else container.innerHTML = `<div class="route-list-wrapper" id="tab4-routes-append-target">${errorHtml}</div>`;
            container.style.display = 'block';
        } finally {
            setTab4Loading(false);
        }
    }


    function onTab4Search() {
        window.tab4SearchText = document.getElementById('route-search-input').value.trim().toUpperCase();
        routeKeyboardSync();
        clearTimeout(window.tab4SearchTimeout);
        window.tab4SearchTimeout = setTimeout(() => updateTab4View(), 140);
    }


    const TAB4_PAGE_SIZE = 20;
    let tab4EtaObserver = null;
    const tab4EtaObservedKeys = new Set();

    function resetTab4EtaObserver() {
        if (tab4EtaObserver) tab4EtaObserver.disconnect();
        tab4EtaObserver = null;
        tab4EtaObservedKeys.clear();
    }

    function getTab4EtaObserver() {
        if (tab4EtaObserver || !('IntersectionObserver' in window)) return tab4EtaObserver;
        const root = document.getElementById('tab-4');
        tab4EtaObserver = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                const key = entry.target && entry.target.dataset ? entry.target.dataset.routeKey : '';
                tab4EtaObserver.unobserve(entry.target);
                if (key) {
                    tab4EtaObservedKeys.delete(key);
                    scheduleTab4EtaChecks([key]);
                }
            });
        }, { root, rootMargin: '450px 0px', threshold: 0.01 });
        return tab4EtaObserver;
    }

    function scheduleTab4EtaChecks(groupKeys) {
        const keys = Array.from(new Set(groupKeys || []));
        const observer = getTab4EtaObserver();
        if (!observer) {
            runSoon(() => fetchAndApplyEtaStatusForTab4Keys(keys));
            return;
        }
        requestAnimationFrame(() => {
            keys.forEach(key => {
                if (tab4EtaObservedKeys.has(key)) return;
                const row = document.getElementById(makeTab4RowId(key));
                if (!row) return;
                tab4EtaObservedKeys.add(key);
                observer.observe(row);
            });
        });
    }


    async function updateTab4View() {
        const container = document.getElementById('tab4-all-routes-container');
        let target = document.getElementById('tab4-routes-append-target');
        if (!target) {
            container.innerHTML = '<div class="route-list-wrapper" id="tab4-routes-append-target"></div>';
            target = document.getElementById('tab4-routes-append-target');
        }
        
        resetTab4EtaObserver();
        target.innerHTML = '';
        window.tab4CurrentPage = 0;
        window.isTab4LoadingMore = false;

        let routeNames = Object.keys(window.allRoutesGroupsTab4);
        const q = window.tab4SearchText;

        routeNames = routeNames.filter(r => {
            const dirs = getTab4DirsByOperator(window.allRoutesGroupsTab4[r]);
            if (dirs.length === 0) return false;
            if (!q) return true;
            const displayName = getRouteDisplayNameForTab4(r).toUpperCase();
            const isRouteCodeQuery = /^[A-Z0-9]+$/.test(q);
            if (isRouteCodeQuery) {
                // 車號鍵盤輸入採用逐字前綴匹配：第 1 個字對第 1 個字，第 2 個字對第 2 個字，如此類推。
                return r.toUpperCase().startsWith(q) || displayName.startsWith(q);
            }
            return r.toUpperCase().includes(q) || displayName.includes(q) || dirs.some(d =>
                (d.orig_tc && d.orig_tc.includes(q)) ||
                (d.dest_tc && d.dest_tc.includes(q)) ||
                (d.operatorName && d.operatorName.includes(q))
            );
        });

        const filteredGroups = {};
        for (let r of routeNames) filteredGroups[r] = getTab4DirsByOperator(window.allRoutesGroupsTab4[r]);

        window.tab4FilteredGroups = filteredGroups;
        window.tab4DisplayRoutes = Object.keys(filteredGroups).sort(sortRouteGroupKeysTab4);
        routeKeyboardSync();

        toggleSkeleton('tab4-skeleton', false);
        container.style.display = 'block';
        
        if (window.tab4DisplayRoutes.length === 0) {
            target.innerHTML = `<div class="status-msg" style="padding: 40px;">找不到符合條件的路線。</div>`;
        } else {
            await loadMoreTab4Routes();
        }
    }


    async function loadMoreTab4Routes() {
        if (window.isTab4LoadingMore) return;
        if (window.tab4CurrentPage * TAB4_PAGE_SIZE >= window.tab4DisplayRoutes.length) return;
        
        window.isTab4LoadingMore = true;

        const start = window.tab4CurrentPage * TAB4_PAGE_SIZE;
        const end = start + TAB4_PAGE_SIZE;
        const chunkNames = window.tab4DisplayRoutes.slice(start, end);

        // 小巴方向資料改為背景補齊：先顯示路線號碼，方向載入後即時更新該列。
        const pendingGmbKeys = chunkNames.filter(key => {
            const dirs = window.allRoutesGroupsTab4[key] || [];
            return dirs.some(d => d.isGmb && (d.needsGmbDetail || !d.routeId || !d.routeSeq || /點擊載入方向資料|詳情|^方向\s*\d+$/.test(String(d.dest_tc || ''))));
        });
        if (pendingGmbKeys.length) {
            ensureGmbDirectionsLoadedForKeys(pendingGmbKeys).then(updatedKeys => {
                (updatedKeys || []).forEach(key => {
                    const row = document.getElementById(makeTab4RowId(key));
                    if (!row) return;
                    const dirs = window.tab4FilteredGroups[key] || getTab4DirsByOperator(window.allRoutesGroupsTab4[key]);
                    row.outerHTML = generateRouteRowHtml(key, dirs, false, false);
                    fetchAndApplyEtaStatusForTab4Keys([key]);
                });
            }).catch(e => console.warn('GMB visible direction refresh failed', e));
        }

        let html = '';
        chunkNames.forEach(rName => {
            let dirs = window.tab4FilteredGroups[rName] || getTab4DirsByOperator(window.allRoutesGroupsTab4[rName]);
            html += generateRouteRowHtml(rName, dirs, false, false);
        });

        document.getElementById('tab4-routes-append-target').insertAdjacentHTML('beforeend', html);
        window.tab4CurrentPage++;
        window.isTab4LoadingMore = false;

        scheduleTab4EtaChecks(chunkNames);
    }


    async function citybusDirectionHasEtaTab4(item) {
        const dir = item.dir || {};
        const boundCode = dir.bound === 'O' ? 'O' : 'I';
        const ctbBound = boundCode === 'O' ? 'outbound' : 'inbound';
        const stops = await getRouteStopsCached(dir.route, ctbBound, true);
        if (!stops || stops.length === 0) return false;

        const chunkSize = 8;
        for (let i = 0; i < stops.length; i += chunkSize) {
            const chunk = stops.slice(i, i + chunkSize);
            const results = await Promise.allSettled(chunk.map(async s => {
                const etaObj = await fetchJsonCached(`https://rt.data.gov.hk/v2/transport/citybus/eta/CTB/${s.stop}/${dir.route}`, { ttl: 15000, timeout: 4500 });
                return !!(etaObj && etaObj.data && etaObj.data.some(e => e.dir === boundCode && e.eta));
            }));
            if (results.some(r => r.status === 'fulfilled' && r.value === true)) return true;
        }
        return false;
    }

    async function gmbDirectionHasEtaTab4(item) {
        const dir = item.dir || {};
        const bound = dir.bound === 'I' ? 'inbound' : 'outbound';
        const detail = await resolveGmbDirectionForDetail(dir.route, dir.gmbRegion, dir.routeId, dir.routeSeq, bound);
        const stops = await getGmbRouteStopsForDetail(detail.routeId, detail.routeSeq);
        if (!stops || stops.length === 0) return false;

        const chunkSize = 8;
        for (let i = 0; i < stops.length; i += chunkSize) {
            const chunk = stops.slice(i, i + chunkSize);
            const results = await Promise.allSettled(chunk.map(async s => {
                const etaList = await fetchGmbEtaForStop(detail.routeId, detail.routeSeq, s.seq);
                return etaList.length > 0;
            }));
            if (results.some(r => r.status === 'fulfilled' && r.value === true)) return true;
        }
        return false;
    }

    async function fetchAndApplyCitybusEtaTab4(items) {
        if (!items || items.length === 0) return;
        setTab4Loading(true);
        try {
            const chunkSize = 4;
            for (let i = 0; i < items.length; i += chunkSize) {
                const chunk = items.slice(i, i + chunkSize);
                const results = await Promise.allSettled(chunk.map(async item => {
                    const hasEta = await citybusDirectionHasEtaTab4(item);
                    return { ...item, hasEta };
                }));
                results.forEach(res => {
                    if (res.status === 'fulfilled') setTab4DirEtaStatus(res.value.statusKey, res.value.hasEta);
                    else console.warn('Citybus ETA status failed', res.reason);
                });
            }
        } finally {
            setTab4Loading(false);
        }
    }

    async function fetchAndApplyGmbEtaTab4(items) {
        if (!items || items.length === 0) return;
        setTab4Loading(true);
        try {
            const chunkSize = 4;
            for (let i = 0; i < items.length; i += chunkSize) {
                const chunk = items.slice(i, i + chunkSize);
                const results = await Promise.allSettled(chunk.map(async item => {
                    const hasEta = await gmbDirectionHasEtaTab4(item);
                    return { ...item, hasEta };
                }));
                results.forEach(res => {
                    if (res.status === 'fulfilled') setTab4DirEtaStatus(res.value.statusKey, res.value.hasEta);
                    else console.warn('GMB ETA status failed', res.reason);
                });
            }
        } finally {
            setTab4Loading(false);
        }
    }

    function fetchAndApplyEtaStatusForTab4Keys(groupKeys) {
        const kmbRoutes = new Set();
        const ctbItems = [];
        const gmbItems = [];

        (groupKeys || []).forEach(rName => {
            const dirs = window.tab4FilteredGroups[rName] || getTab4DirsByOperator(window.allRoutesGroupsTab4[rName]);
            (dirs || []).forEach(dir => {
                const statusKey = makeTab4DirStatusKey(rName, dir);
                if (isTab4DirEtaStatusFresh(statusKey, 15000)) return;

                if (dir.isGmb) {
                    if (dir.needsGmbDetail || !dir.routeId || !dir.routeSeq || /點擊載入方向資料|詳情|^方向\s*\d+$/.test(String(dir.dest_tc || ''))) return;
                    gmbItems.push({ rName, dir, statusKey });
                } else if (dir.isCitybus) {
                    ctbItems.push({ rName, dir, statusKey });
                } else {
                    kmbRoutes.add(dir.route || rName);
                }
            });
        });

        if (kmbRoutes.size) fetchAndApplyEtaTab4([...kmbRoutes]);
        if (ctbItems.length) fetchAndApplyCitybusEtaTab4(ctbItems);
        if (gmbItems.length) fetchAndApplyGmbEtaTab4(gmbItems);
    }


    async function fetchAndApplyEtaTab4(routes) {
        if (!routes || routes.length === 0) return;
        setTab4Loading(true);
        try {
            const chunkSize = 10;
            for (let i = 0; i < routes.length; i += chunkSize) {
                const chunk = routes.slice(i, i + chunkSize);
                const etaPromises = chunk.map(route => 
                    fetchJsonCached(`https://data.etabus.gov.hk/v1/transport/kmb/route-eta/${route}/1`, { ttl: 15000, timeout: 6000 })
                        .then(data => ({ route, data }))
                        .catch(err => ({ route, error: err }))
                );
                
                const etaResults = await Promise.all(etaPromises);
                etaResults.forEach(res => {
                    if (res.data && res.data.data) {
                        let hasO = false;
                        let hasI = false;
                        res.data.data.forEach(e => {
                            if (e.eta) {
                                if (e.dir === 'O') hasO = true;
                                if (e.dir === 'I') hasI = true;
                            }
                        });
                        
                        setTab4DirEtaStatus(`${res.route}-O`, hasO);
                        setTab4DirEtaStatus(`${res.route}-I`, hasI);
                        window.routeEtaStatusTab4[`${res.route}-_ts`] = Date.now();
                    }
                });
            }
        } finally {
            setTab4Loading(false);
        }
    }


    document.getElementById('tab-4').addEventListener('scroll', function() {
        if (this.style.display !== 'none' && document.getElementById('tab4-route-list-view').style.display !== 'none') {
            window.tab4ListScrollTop = this.scrollTop;
            if (this.scrollHeight - this.scrollTop <= this.clientHeight + 400) {
                loadMoreTab4Routes();
            }
        }
    });

    // ==========================================
    // 共用：目錄繪製與單向透明度 UI
    // ==========================================
    function renderCatalogHTML(groupsData, containerId, isTab3) {
        const allDisplayRoutes = Object.keys(groupsData);
        allDisplayRoutes.sort((a, b) => a.localeCompare(b, undefined, {numeric: true, sensitivity: 'base'}));

        let activeHtml = '';
        let inactiveHtml = '';

        allDisplayRoutes.forEach(rName => {
            let dirs = groupsData[rName];
            
            let isRowInactive = false;
            if (isTab3) {
                let hasAnyEta = false;
                dirs.forEach(d => {
                    const boundCode = d.bound === 'O' ? 'O' : 'I';
                    if (d.isCitybus || window.routeEtaStatusTab3[`${rName}-${boundCode}`]) hasAnyEta = true;
                });
                isRowInactive = !hasAnyEta;
            }

            let rowHtml = generateRouteRowHtml(rName, dirs, isRowInactive, isTab3);
            
            if (isRowInactive) inactiveHtml += rowHtml;
            else activeHtml += rowHtml;
        });

        let finalHtml = `<div class="route-list-wrapper">`;
        finalHtml += activeHtml;
        
        if (inactiveHtml !== '') {
            finalHtml += `
            <div style="background: var(--bg-color); padding: 12px 16px; font-size: 0.85rem; font-weight: 700; color: var(--text-sub); border-bottom: 1px solid var(--separator); display:flex; align-items:center;">
                <div style="flex:1; height:1px; background:var(--separator); margin-right:12px;"></div>
                暫無班次 / 暫停服務
                <div style="flex:1; height:1px; background:var(--separator); margin-left:12px;"></div>
            </div>
            <div>
                ${inactiveHtml}
            </div>
            `;
        }
        finalHtml += `</div>`;
        
        document.getElementById(containerId).innerHTML = finalHtml;
    }

    function makeTab4RowId(rName) {
        return 'tab4-row-' + String(rName || '').replace(/[^A-Za-z0-9_-]/g, '_');
    }

    function makeTab4SafeDomId(value) {
        return String(value || '').replace(/[^A-Za-z0-9_-]/g, '_');
    }

    function makeTab4DirStatusKey(rName, dir) {
        dir = dir || {};
        const rawBound = String(dir.bound || 'O');
        const boundCode = rawBound === 'O' ? 'O' : (rawBound === 'I' ? 'I' : rawBound);
        const routeCode = String(dir.route || dir.displayRoute || rName || '').toUpperCase();

        if (dir.isGmb) {
            const region = String(dir.gmbRegion || '').toUpperCase();
            const routeId = String(dir.routeId || 'NOID');
            const routeSeq = String(dir.routeSeq || dir.bound || boundCode || 'NOSEQ');
            return `GMB-${region}-${routeCode}-${routeId}-${routeSeq}`;
        }

        if (dir.isCitybus) {
            return `CTB-${routeCode}-${boundCode}`;
        }

        return `${routeCode}-${boundCode}`;
    }

    function makeTab4DirId(rName, dir) {
        return 'route-dir-' + makeTab4SafeDomId(makeTab4DirStatusKey(rName, dir));
    }

    function applyTab4DirEtaVisual(statusKey, hasEta) {
        const el = document.getElementById('route-dir-' + makeTab4SafeDomId(statusKey));
        if (!el) return;
        el.style.opacity = hasEta ? '1' : '0.35';
        el.style.filter = hasEta ? 'none' : 'grayscale(100%)';
        el.style.transition = 'all 0.3s';
    }

    function setTab4DirEtaStatus(statusKey, hasEta) {
        if (!statusKey) return;
        window.routeEtaStatusTab4[statusKey] = !!hasEta;
        window.routeEtaStatusTab4[`${statusKey}-_ts`] = Date.now();
        applyTab4DirEtaVisual(statusKey, !!hasEta);
    }

    function isTab4DirEtaStatusFresh(statusKey, ttl = 15000) {
        const ts = window.routeEtaStatusTab4[`${statusKey}-_ts`] || 0;
        return Date.now() - ts < ttl;
    }

    function generateRouteRowHtml(rName, dirs, isRowInactive, isTab3) {
        dirs = dirs || [];
        let dir1 = dirs.find(d => d.bound === 'O') || dirs[0];
        let dir2 = dirs.find(d => d.bound === 'I') || (dirs.length > 1 ? dirs[1] : null);
        const displayRouteName = (dirs[0] && dirs[0].displayRoute) ? dirs[0].displayRoute : rName;

        let operatorText = '九巴';
        if (displayRouteName.startsWith('A') || displayRouteName.startsWith('NA')) operatorText = '龍運';
        if (dirs[0] && dirs[0].isCitybus) operatorText = '城巴';
        if (dirs[0] && dirs[0].isGmb) operatorText = dirs[0].operatorName || '專線小巴';
        if (!(dirs[0] && dirs[0].isGmb) && ['112','116','118','102','104','111','115','115P','117','171','601','603','619','671','680','681','690','904','905','907D','914','930','948','962','969'].includes(displayRouteName)) operatorText = '城巴+九巴';

        let badgeColor = 'var(--text-main)'; 
        if (operatorText.includes('龍運')) badgeColor = '#E67E22'; 
        if (operatorText.includes('城巴')) badgeColor = '#F1C40F';
        if (operatorText.includes('小巴')) badgeColor = 'var(--gmb-green)';

        function makeDirBlock(dir) {
            if(!dir) return `<div class="route-dir-empty"></div>`;
            const boundStr = dir.bound === 'O' ? 'outbound' : 'inbound';
            const boundCode = dir.bound === 'O' ? 'O' : 'I';
            
            let dirOpacityStyle = '';
            if (!isRowInactive) { 
                let hasEta = true;
                if (isTab3) {
                    if (!dir.isCitybus && !dir.isGmb) {
                        hasEta = window.routeEtaStatusTab3[`${rName}-${boundCode}`];
                        if (!hasEta) dirOpacityStyle = 'opacity: 0.35; filter: grayscale(100%);';
                    }
                } else {
                    const statusKey = makeTab4DirStatusKey(rName, dir);
                    hasEta = window.routeEtaStatusTab4[statusKey];
                    if (hasEta === false) dirOpacityStyle = 'opacity: 0.35; filter: grayscale(100%); transition: all 0.3s;';
                    else dirOpacityStyle = 'opacity: 1; filter: none; transition: all 0.3s;';
                }
            }

            let nearbyHtml = dir.nearbyHint ? `<div class="dir-nearby-hint">${dir.nearbyHint}</div>` : '';
            let blockId = !isTab3 ? `id="${makeTab4DirId(rName, dir)}"` : '';
            const routeArg = escapeJsArg(dir.route);
            const destArg = escapeJsArg(dir.dest_tc);
            const badgeArg = escapeJsArg(badgeColor);
            const regionArg = escapeJsArg(dir.gmbRegion || '');
            const routeIdArg = escapeJsArg(dir.routeId || '');
            const routeSeqArg = escapeJsArg(dir.routeSeq || '');
            const isGenericDirectionLabel = dir.isGmb && /^方向\s*\d+$/.test(String(dir.dest_tc || ''));
            const directionPrefixHtml = isGenericDirectionLabel ? '' : '<span class="dir-prefix">往</span>';

            return `
            <div ${blockId} class="route-dir-block" style="${dirOpacityStyle}" onclick="showRouteStops('${routeArg}', '${boundStr}', '${destArg}', ${dir.isCitybus || false}, '${badgeArg}', ${isTab3}, ${dir.isGmb || false}, '${regionArg}', '${routeIdArg}', '${routeSeqArg}')">
                <div class="dir-dest-container">
                    ${directionPrefixHtml}
                    <span class="dir-dest">${dir.dest_tc}</span>
                </div>
                ${nearbyHtml}
            </div>`;
        }

        let rowStyle = isRowInactive ? 'opacity: 0.45; filter: grayscale(50%);' : '';

        const rowIdAttr = !isTab3 ? `id="${makeTab4RowId(rName)}" data-route-key="${escapeHtml(rName)}"` : '';

        return `
        <div ${rowIdAttr} class="route-list-row" style="${rowStyle}">
            <div class="route-list-left">
                <div class="route-list-num" style="color: ${badgeColor};">${displayRouteName}</div>
                <div class="route-list-op">${operatorText}</div>
            </div>
            <div class="route-list-right">
                ${makeDirBlock(dir1)}
                ${dir2 ? '<div class="route-dir-divider"></div>' + makeDirBlock(dir2) : ''}
            </div>
        </div>`;
    }

    // ==========================================
    // Tab 4 詳情頁：保存清單位置 + 即時切換另一方向
    // ==========================================
    function normalizeTab4BoundCode(bound) {
        const b = String(bound || '').toLowerCase();
        if (b === 'i' || b === 'inbound') return 'I';
        if (b === 'o' || b === 'outbound') return 'O';
        return String(bound || 'O');
    }

    function tab4DirectionMatchesContext(dir, ctx) {
        if (!dir || !ctx) return false;
        if (!!dir.isGmb !== !!ctx.isGmb) return false;
        if (!!dir.isCitybus !== !!ctx.isCitybus) return false;
        const dirRoute = String(dir.route || dir.displayRoute || '').toUpperCase();
        const ctxRoute = String(ctx.route || '').toUpperCase();
        if (dirRoute && ctxRoute && dirRoute !== ctxRoute) return false;
        if (ctx.isGmb && ctx.gmbRegion && dir.gmbRegion && String(dir.gmbRegion) !== String(ctx.gmbRegion)) return false;
        return true;
    }

    function tab4IsCurrentDirection(dir, ctx) {
        if (!tab4DirectionMatchesContext(dir, ctx)) return false;
        if (ctx.isGmb && ctx.gmbRouteId && ctx.gmbRouteSeq && dir.routeId && dir.routeSeq) {
            return String(dir.routeId) === String(ctx.gmbRouteId) && String(dir.routeSeq) === String(ctx.gmbRouteSeq);
        }
        return normalizeTab4BoundCode(dir.bound) === normalizeTab4BoundCode(ctx.bound);
    }

    function getTab4DirectionsForDetailContext(ctx) {
        if (!ctx) return [];
        const groups = window.allRoutesGroupsTab4 || {};
        const routeUpper = String(ctx.route || '').toUpperCase();
        const candidateKeys = [];
        if (ctx.isGmb && ctx.gmbRegion) candidateKeys.push(`GMB-${ctx.gmbRegion}-${ctx.route}`);
        candidateKeys.push(ctx.route);

        for (const key of candidateKeys) {
            if (groups[key] && groups[key].some(d => tab4DirectionMatchesContext(d, ctx))) return groups[key];
        }

        for (const dirs of Object.values(groups)) {
            if ((dirs || []).some(d => tab4DirectionMatchesContext(d, ctx))) return dirs || [];
            if ((dirs || []).some(d => String(d.route || d.displayRoute || '').toUpperCase() === routeUpper)) return dirs || [];
        }
        return [];
    }

    function getTab4OppositeDirection(ctx) {
        const dirs = getTab4DirectionsForDetailContext(ctx).filter(d => tab4DirectionMatchesContext(d, ctx));
        if (dirs.length < 2) return null;

        const currentBound = normalizeTab4BoundCode(ctx.bound);
        const oppositeBound = currentBound === 'O' ? 'I' : (currentBound === 'I' ? 'O' : '');
        if (oppositeBound) {
            const exact = dirs.find(d => normalizeTab4BoundCode(d.bound) === oppositeBound);
            if (exact) return exact;
        }
        return dirs.find(d => !tab4IsCurrentDirection(d, ctx)) || null;
    }

    function updateTab4OppositeDirectionButton(ctx) {
        const btn = document.getElementById('tab4-detail-opposite-btn');
        if (!btn) return;
        window.tab4DetailContext = ctx || null;
        const opposite = getTab4OppositeDirection(ctx);
        if (!opposite) {
            btn.style.display = 'none';
            btn.textContent = '↔ 另一方向';
            btn.title = '未有另一方向資料';
            return;
        }
        const dest = String(opposite.dest_tc || '').trim();
        btn.textContent = dest ? `↔ 往${dest}` : '↔ 另一方向';
        btn.title = dest ? `即時查看另一方向：往${dest}` : '即時查看另一方向';
        btn.style.display = 'inline-block';
    }

    async function switchTab4DetailOppositeDirection() {
        const ctx = window.tab4DetailContext;
        const opposite = getTab4OppositeDirection(ctx);
        if (!ctx || !opposite) return;
        const boundStr = normalizeTab4BoundCode(opposite.bound) === 'I' ? 'inbound' : 'outbound';
        await showRouteStops(
            opposite.route || ctx.route,
            boundStr,
            opposite.dest_tc || '',
            !!opposite.isCitybus,
            ctx.badgeColor || 'var(--text-main)',
            false,
            !!opposite.isGmb,
            opposite.gmbRegion || '',
            opposite.routeId || '',
            opposite.routeSeq || '',
            true
        );
    }

    // ==========================================
    // 共用：路線詳情與實時 ETA
    // ==========================================
    async function showRouteStops(route, bound, dest, isCitybus, badgeColor, isTab3, isGmb = false, gmbRegion = '', gmbRouteId = '', gmbRouteSeq = '', keepTab4ListScroll = false) {
        const prefix = isTab3 ? 'tab3-' : 'tab4-';
        let resolvedDestForFavorites = dest;
        let resolvedGmbRegionForFavorites = gmbRegion;
        let resolvedGmbRouteIdForFavorites = gmbRouteId;
        let resolvedGmbRouteSeqForFavorites = gmbRouteSeq;
        const tab4ScrollEl = !isTab3 ? document.getElementById('tab-4') : null;
        const tab4ListView = !isTab3 ? document.getElementById('tab4-route-list-view') : null;
        if (!isTab3 && !keepTab4ListScroll && tab4ScrollEl && tab4ListView && tab4ListView.style.display !== 'none') {
            window.tab4ListScrollTop = tab4ScrollEl.scrollTop;
        }
        if (!isTab3) {
            updateTab4OppositeDirectionButton({ route, bound, dest, isCitybus: !!isCitybus, isGmb: !!isGmb, gmbRegion, gmbRouteId, gmbRouteSeq, badgeColor });
        }
        
        document.getElementById(`${prefix}route-list-view`).style.display = 'none';
        document.getElementById(`${prefix}route-detail-view`).style.display = 'block';
        if (tab4ScrollEl) tab4ScrollEl.scrollTop = 0;
        
        const numEl = document.getElementById(`${prefix}detail-route-num`);
        numEl.innerText = route;
        numEl.style.color = badgeColor || 'var(--text-main)';
        const initialDestLabel = isGmb && /^方向\s*\d+$/.test(String(dest || '')) ? `${dest}・載入中` : `往 ${dest}`;
        document.getElementById(`${prefix}detail-route-dest`).innerText = initialDestLabel;
        
        const container = document.getElementById(`${prefix}detail-stops-container`);
        container.innerHTML = '';
        toggleSkeleton(`${prefix}detail-stops-skeleton`, true);

        try {
            let stopsData = { data: [] };
            let etaMap = {};
            let detailEtaStatusKey = '';
            const boundCode = bound === 'outbound' ? 'O' : 'I';

            if (isGmb) {
                const gmbDetail = await resolveGmbDirectionForDetail(route, gmbRegion, gmbRouteId, gmbRouteSeq, bound);
                resolvedGmbRegionForFavorites = gmbDetail.region || gmbRegion;
                resolvedGmbRouteIdForFavorites = gmbDetail.routeId;
                resolvedGmbRouteSeqForFavorites = gmbDetail.routeSeq;
                if (gmbDetail.dest_tc) resolvedDestForFavorites = gmbDetail.dest_tc;
                if (!isTab3) {
                    updateTab4OppositeDirectionButton({ route, bound, dest: resolvedDestForFavorites, isCitybus: !!isCitybus, isGmb: true, gmbRegion: resolvedGmbRegionForFavorites, gmbRouteId: gmbDetail.routeId, gmbRouteSeq: gmbDetail.routeSeq, badgeColor });
                }
                detailEtaStatusKey = makeTab4DirStatusKey('', { route, bound: boundCode, isGmb: true, gmbRegion: resolvedGmbRegionForFavorites, routeId: gmbDetail.routeId, routeSeq: gmbDetail.routeSeq });
                if (gmbDetail.dest_tc) document.getElementById(`${prefix}detail-route-dest`).innerText = `往 ${gmbDetail.dest_tc}`;
                stopsData.data = await getGmbRouteStopsForDetail(gmbDetail.routeId, gmbDetail.routeSeq);

                const etaPromises = stopsData.data.map(async (s) => {
                    try {
                        const etaList = await fetchGmbEtaForStop(gmbDetail.routeId, gmbDetail.routeSeq, s.seq);
                        if (etaList.length) etaMap[String(s.seq)] = etaList;
                    } catch(err) {}
                });
                await Promise.all(etaPromises);

            } else if (isCitybus) {
                detailEtaStatusKey = makeTab4DirStatusKey('', { route, bound: boundCode, isCitybus: true });
                let ctbBound = bound === 'outbound' ? 'outbound' : 'inbound';
                stopsData.data = await getRouteStopsCached(route, ctbBound, true);
                
                const etaPromises = stopsData.data.map(async (s) => {
                    try {
                        let etaObj = await fetchJsonCached(`https://rt.data.gov.hk/v2/transport/citybus/eta/CTB/${s.stop}/${route}`, { ttl: 12000, timeout: 5000 });
                        if (etaObj && etaObj.data) {
                            etaObj.data.forEach(e => {
                                if (e.dir === boundCode && e.eta) {
                                    let seqStr = String(s.seq);
                                    if (!etaMap[seqStr]) etaMap[seqStr] = [];
                                    etaMap[seqStr].push(e.eta);
                                }
                            });
                        }
                    } catch(err){}
                });
                await Promise.all(etaPromises);

            } else {
                detailEtaStatusKey = makeTab4DirStatusKey('', { route, bound: boundCode });
                stopsData.data = await getRouteStopsCached(route, bound, false);

                const etaObj = await fetchJsonCached(`https://data.etabus.gov.hk/v1/transport/kmb/route-eta/${route}/1`, { ttl: 12000, timeout: 6000 });

                if (etaObj && etaObj.data) {
                    etaObj.data.forEach(e => {
                        if (e.dir === boundCode && e.eta) {
                            let seqStr = String(e.seq);
                            if (!etaMap[seqStr]) etaMap[seqStr] = [];
                            etaMap[seqStr].push(e.eta);
                        }
                    });
                }
            }

            let processedStops = stopsData.data.map(s => {
                let stopEtas = etaMap[String(s.seq)] || [];
                let sortedEtas = stopEtas.sort((a, b) => new Date(a) - new Date(b)).slice(0, 3);
                return { ...s, sortedEtas };
            });

            let activeStops = processedStops.filter(s => s.sortedEtas.length > 0);
            let inactiveStops = processedStops.filter(s => s.sortedEtas.length === 0);
            if (!isTab3 && detailEtaStatusKey) setTab4DirEtaStatus(detailEtaStatusKey, activeStops.length > 0);
            
            let html = '<div style="background: var(--bg-color); min-height: 100%; padding-bottom: 20px;">';

            if (activeStops.length > 0) {
                html += '<div style="background: var(--card-bg); border-top: 1px solid var(--separator); box-shadow: 0 4px 12px rgba(0,0,0,0.04); margin-bottom: 24px;">';
                
                activeStops.forEach((s) => {
                    let stopName = s.name_tc || window.globalStopsMap[s.stop] || s.stop;
                    let isTargetStation = isTab3 && targetKeywords.some(kw => stopName.includes(kw));
                    let badge = isTargetStation ? `<span style="font-size:0.75rem; background:#34C759; color:white; padding:2px 8px; border-radius:6px; margin-left:8px; vertical-align:middle; font-weight:600;">目標車站</span>` : '';
                    let bgStyle = isTargetStation ? 'background: rgba(52,199,89,0.05); border-left: 4px solid #34C759;' : 'background: var(--card-bg); border-left: 4px solid transparent;';
                    
                    let etaHtml = generateEtaHtml(s.sortedEtas);
                    let favoriteBtn = '';
                    if (!isTab3) {
                        favoriteBtn = renderStopFavoriteButton(makeFavoriteStopPayload({
                            route,
                            routeDisplay: route,
                            bound,
                            dest: resolvedDestForFavorites,
                            isCitybus,
                            isGmb,
                            gmbRegion: resolvedGmbRegionForFavorites,
                            gmbRouteId: resolvedGmbRouteIdForFavorites,
                            gmbRouteSeq: resolvedGmbRouteSeqForFavorites,
                            seq: s.seq,
                            stopId: s.stop,
                            stopName,
                            badgeColor
                        }));
                    }

                    html += `
                    <div style="padding: 16px 16px 16px 12px; border-bottom: 1px solid var(--separator); ${bgStyle} display: flex; flex-direction: column; justify-content: center;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div style="flex: 1; padding-right: 12px; font-size: 1.05rem; font-weight: 700; color: var(--text-main); line-height: 1.3;">
                                <span style="display:inline-block; width:24px; font-size:0.85rem; font-weight:600; color:var(--text-sub); text-align:left;">${s.seq}.</span>
                                ${stopName} ${badge}
                            </div>
                            <div style="display: flex; align-items: center; white-space: nowrap; margin-left: auto;">
                                ${etaHtml}
                                ${favoriteBtn}
                            </div>
                        </div>
                    </div>`;
                });
                html += '</div>';
            } else {
                html += '<div class="status-msg" style="padding: 20px;">目前沒有營運中的班次。</div>';
            }

            if (inactiveStops.length > 0) {
                html += `
                <div style="background: var(--bg-color); padding: 12px 16px; font-size: 0.85rem; font-weight: 700; color: var(--text-sub); border-bottom: 1px solid var(--separator); border-top: 1px solid var(--separator); display:flex; align-items:center;">
                    <div style="flex:1; height:1px; background:var(--separator); margin-right:12px;"></div>
                    暫停服務 / 未有班次之車站
                    <div style="flex:1; height:1px; background:var(--separator); margin-left:12px;"></div>
                </div>
                <div style="background: var(--card-bg); opacity: 0.55;">
                `;

                inactiveStops.forEach((s) => {
                    let stopName = s.name_tc || window.globalStopsMap[s.stop] || s.stop;
                    let favoriteBtn = '';
                    if (!isTab3) {
                        favoriteBtn = renderStopFavoriteButton(makeFavoriteStopPayload({
                            route,
                            routeDisplay: route,
                            bound,
                            dest: resolvedDestForFavorites,
                            isCitybus,
                            isGmb,
                            gmbRegion: resolvedGmbRegionForFavorites,
                            gmbRouteId: resolvedGmbRouteIdForFavorites,
                            gmbRouteSeq: resolvedGmbRouteSeqForFavorites,
                            seq: s.seq,
                            stopId: s.stop,
                            stopName,
                            badgeColor
                        }));
                    }
                    html += `
                    <div style="padding: 12px 16px 12px 12px; border-bottom: 1px solid var(--separator);">
                        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                            <div style="font-size: 0.95rem; font-weight: 600; color: var(--text-sub); line-height: 1.4; flex:1; min-width:0;">
                                <span style="display:inline-block; width:26px; font-size:0.85rem; font-weight:600;">${s.seq}.</span>
                                <span>${stopName}</span>
                            </div>
                            ${favoriteBtn}
                        </div>
                    </div>`;
                });
                html += '</div>';
            }
            
            html += '</div>';

            toggleSkeleton(`${prefix}detail-stops-skeleton`, false);
            container.innerHTML = html;

        } catch(e) {
            console.error(e);
            toggleSkeleton(`${prefix}detail-stops-skeleton`, false);
            container.innerHTML = '<div class="status-msg error" style="padding: 30px;">無法載入車站或預報時間，請重試。</div>';
        }
    }

    function backToRouteList(tabId) {
        const isTab4 = (tabId || currentTab) === 4;
        const prefix = isTab4 ? 'tab4-' : 'tab3-';
        document.getElementById(`${prefix}route-list-view`).style.display = 'block';
        document.getElementById(`${prefix}route-detail-view`).style.display = 'none';
        if (isTab4) {
            const btn = document.getElementById('tab4-detail-opposite-btn');
            if (btn) btn.style.display = 'none';
            window.tab4DetailContext = null;
            const scrollEl = document.getElementById('tab-4');
            const targetScrollTop = Number(window.tab4ListScrollTop || 0);
            if (scrollEl) {
                const restoreScroll = () => {
                    scrollEl.scrollTop = targetScrollTop;
                    setTimeout(() => { scrollEl.scrollTop = targetScrollTop; }, 0);
                };
                if (window.requestAnimationFrame) requestAnimationFrame(restoreScroll);
                else setTimeout(restoreScroll, 0);
            }
        }
    }

    initSettings();
    renderAppVersion();

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && document.getElementById('settings-modal').classList.contains('open')) {
            closeSettings();
        }
    });

    // Pause the 30-second ETA polling while the tab is hidden to reduce battery/network use.
    let refreshLoopTimer = null;
    const stopRefreshLoop = () => {
        if (refreshLoopTimer) clearInterval(refreshLoopTimer);
        refreshLoopTimer = null;
    };
    const startRefreshLoop = () => {
        stopRefreshLoop();
        if (document.hidden) return;
        refreshAll();
        refreshLoopTimer = setInterval(() => {
            if (!document.hidden) refreshAll();
        }, 30000);
    };

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopRefreshLoop();
        else startRefreshLoop();
    });

    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js?v=6.2.0', { updateViaCache: 'none' }).catch(err => {
                console.warn('Service worker registration failed:', err);
            });
        });
    }

    // Allow first paint before starting network-heavy ETA refreshes.
    if (window.requestAnimationFrame) {
        requestAnimationFrame(() => setTimeout(startRefreshLoop, 0));
    } else {
        setTimeout(startRefreshLoop, 0);
    }
