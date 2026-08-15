'use strict';

const APP_VERSION = '6.7.9';

function renderAppVersion() {
    const el = document.getElementById('app-version-value');
    if (el) el.textContent = `v${APP_VERSION}`;
}

let settingsReturnFocus = null;

function setSettingsCacheView(showCache) {
        const modal = document.getElementById('settings-modal');
        if (!modal) return;
        modal.classList.toggle('cache-view', !!showCache);
        const mainPage = document.getElementById('settings-main-page');
        const cachePage = document.getElementById('cache-status-panel');
        if (mainPage) mainPage.setAttribute('aria-hidden', showCache ? 'true' : 'false');
        if (cachePage) cachePage.setAttribute('aria-hidden', showCache ? 'false' : 'true');
        const backBtn = document.getElementById('settings-back-btn');
        if (backBtn) backBtn.hidden = !showCache;
        const title = document.getElementById('settings-title');
        if (title) title.textContent = showCache ? '快取狀態' : '設定';
    }

    function openSettings() {
        settingsReturnFocus = document.activeElement;
        document.getElementById('modal-overlay').classList.add('open');
        const modal = document.getElementById('settings-modal');
        modal.classList.add('open');
        setSettingsCacheView(false);
        renderAppVersion();
        requestAnimationFrame(() => {
            const closeButton = modal.querySelector('.close-btn');
            if (closeButton) closeButton.focus({ preventScroll: true });
        });
    }
    function openCacheStatus() {
        setSettingsCacheView(true);
        refreshCacheIndicators(false);
        requestAnimationFrame(() => {
            const backButton = document.getElementById('settings-back-btn');
            if (backButton) backButton.focus({ preventScroll: true });
        });
    }
    function closeCacheStatus() {
        setSettingsCacheView(false);
    }
    function closeSettings() {
        document.getElementById('modal-overlay').classList.remove('open');
        document.getElementById('settings-modal').classList.remove('open');
        setSettingsCacheView(false);
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
        nlb: ['nlb-route.json'],
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

    function getLocalCachedStationCounts() {
        const result = { citybus: 0, nlb: 0, gmb: 0 };
        const citybusStops = new Set();
        const gmbStops = new Set();
        const nlbStops = new Set();
        const prefix = 'psk_transport_static_json_v1::';
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (!key || !key.startsWith(prefix)) continue;
                let url = '';
                try { url = decodeURIComponent(key.slice(prefix.length)); } catch (e) { continue; }
                const isCitybusRouteStop = /rt\.data\.gov\.hk\/v2\/transport\/citybus\/route-stop\/CTB\//i.test(url);
                const isGmbRouteStop = /data\.etagmb\.gov\.hk\/route-stop\//i.test(url);
                const isNlbRouteStop = /rt\.data\.gov\.hk\/v2\/transport\/nlb\/stop\.php\?action=list/i.test(url);
                if (!isCitybusRouteStop && !isGmbRouteStop && !isNlbRouteStop) continue;
                const raw = localStorage.getItem(key);
                if (!raw) continue;
                let stored;
                try { stored = JSON.parse(raw); } catch (e) { continue; }
                if (!stored || !stored.time || (Date.now() - Number(stored.time)) >= 86400000) continue;
                const payload = stored.data;
                if (isCitybusRouteStop) {
                    const rows = payload && Array.isArray(payload.data) ? payload.data : [];
                    rows.forEach(item => {
                        const stopId = item && (item.stop || item.stop_id || item.id);
                        if (stopId) citybusStops.add(String(stopId));
                    });
                } else if (isNlbRouteStop) {
                    const rows = payload && Array.isArray(payload.stops) ? payload.stops : [];
                    rows.forEach(item => {
                        const stopId = item && (item.stopId || item.stop_id || item.id);
                        if (stopId) nlbStops.add(String(stopId));
                    });
                } else {
                    const rows = payload && payload.data && Array.isArray(payload.data.route_stops)
                        ? payload.data.route_stops
                        : (payload && Array.isArray(payload.data) ? payload.data : []);
                    rows.forEach(item => {
                        const stopId = item && (item.stop_id || item.stop || item.id || item.name_tc);
                        if (stopId) gmbStops.add(String(stopId));
                    });
                }
            }
        } catch (e) {
            console.warn('Unable to count locally cached stations', e);
        }
        result.citybus = citybusStops.size;
        result.nlb = nlbStops.size;
        result.gmb = gmbStops.size;
        return result;
    }

    function getCacheLoadedCounts(meta, operator) {
        const declared = meta && meta.loadedCounts && meta.loadedCounts[operator];
        const datasets = (meta && meta.datasets) || {};
        let routeNumbers = Number(declared && declared.routeNumbers);
        let stations = Number(declared && declared.stations);

        if (!Number.isFinite(routeNumbers)) {
            if (operator === 'kmb') routeNumbers = Number(datasets['kmb-route.json'] && datasets['kmb-route.json'].routeNumbers);
            if (operator === 'citybus') routeNumbers = Number(datasets['ctb-route.json'] && datasets['ctb-route.json'].routeNumbers);
            if (operator === 'nlb') routeNumbers = Number(datasets['nlb-route.json'] && datasets['nlb-route.json'].routeNumbers);
            if (operator === 'gmb') {
                routeNumbers = ['HKI', 'KLN', 'NT'].reduce((sum, region) => {
                    const item = datasets[`gmb-route-${region}.json`];
                    const n = Number(item && item.routeNumbers);
                    return sum + (Number.isFinite(n) ? n : 0);
                }, 0);
            }
        }
        if (!Number.isFinite(stations)) {
            stations = operator === 'kmb' ? Number(datasets['kmb-stop.json'] && datasets['kmb-stop.json'].stations) : 0;
        }

        // Backwards compatibility with v6.5 metadata until the next daily Action refresh.
        if (!Number.isFinite(routeNumbers) || routeNumbers <= 0) {
            if (operator === 'kmb') routeNumbers = Number(datasets['kmb-route.json'] && datasets['kmb-route.json'].records) || 0;
            if (operator === 'citybus') routeNumbers = Number(datasets['ctb-route.json'] && datasets['ctb-route.json'].records) || 0;
            if (operator === 'nlb') routeNumbers = Number(datasets['nlb-route.json'] && datasets['nlb-route.json'].records) || 0;
            if (operator === 'gmb') {
                routeNumbers = ['HKI', 'KLN', 'NT'].reduce((sum, region) => sum + (Number(datasets[`gmb-route-${region}.json`] && datasets[`gmb-route-${region}.json`].records) || 0), 0);
            }
        }
        if ((!Number.isFinite(stations) || stations <= 0) && operator === 'kmb') {
            stations = Number(datasets['kmb-stop.json'] && datasets['kmb-stop.json'].records) || 0;
        }
        if (!Number.isFinite(stations) || stations < 0) stations = 0;

        const localStations = getLocalCachedStationCounts();
        if (operator === 'citybus') stations = Math.max(stations, localStations.citybus);
        if (operator === 'nlb') stations = Math.max(stations, localStations.nlb);
        if (operator === 'gmb') stations = Math.max(stations, localStations.gmb);
        return { routeNumbers: Math.max(0, routeNumbers || 0), stations: Math.max(0, stations || 0) };
    }

    function setCacheIndicator(operator, info, isStaleServiceDay = false, counts = null) {
        const row = document.getElementById(`cache-status-${operator}`);
        if (!row) return;
        const dot = row.querySelector('.cache-status-dot');
        const countsEl = row.querySelector('.cache-status-counts');
        let status = info && info.status ? info.status : 'fail';
        if (isStaleServiceDay && status === 'success') status = 'partial';

        if (dot) dot.className = `cache-status-dot ${status}`;
        if (countsEl) {
            const routeNumbers = counts && Number.isFinite(Number(counts.routeNumbers)) ? Number(counts.routeNumbers) : null;
            const stations = counts && Number.isFinite(Number(counts.stations)) ? Number(counts.stations) : null;
            countsEl.textContent = `號碼 ${routeNumbers === null ? '--' : routeNumbers.toLocaleString('zh-HK')} · 車站 ${stations === null ? '--' : stations.toLocaleString('zh-HK')}`;
        }
    }

    function setAllCacheIndicatorsFailed(message) {
        ['kmb', 'citybus', 'nlb', 'gmb'].forEach(operator => {
            setCacheIndicator(operator, { status: 'fail', fresh: 0, available: 0, total: CACHE_OPERATOR_DATASETS[operator].length }, false, null);
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
        ['kmb', 'citybus', 'nlb', 'gmb'].forEach(operator => {
            const row = document.getElementById(`cache-status-${operator}`);
            if (!row) return;
            const dot = row.querySelector('.cache-status-dot');
            const counts = row.querySelector('.cache-status-counts');
            if (dot) dot.className = 'cache-status-dot unknown';
            if (counts) counts.textContent = '號碼 -- · 車站 --';
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

            ['kmb', 'citybus', 'nlb', 'gmb'].forEach(operator => {
                setCacheIndicator(operator, computeCacheOperatorStatus(meta, operator), isStaleServiceDay, getCacheLoadedCounts(meta, operator));
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
        ['https://rt.data.gov.hk/v2/transport/nlb/route.php?action=list', './data/nlb-route.json'],
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
               /rt\.data\.gov\.hk\/v2\/transport\/citybus\/stop\/[^/?]+/i.test(u) ||
               /rt\.data\.gov\.hk\/v2\/transport\/nlb\/stop\.php\?action=list/i.test(u);
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

        if (tabId !== 4) collapseFloatingRouteSearch();
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
            if (/\/eta(?:\/|$)|\/route-eta\/|\/eta\/route-stop\/|estimatedArrivals|getSchedule\.php/i.test(String(key))) {
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

        let jobs = [];
        if (tabId === 1) {
            jobs = [fetchKMB_PokYin(), fetchGMB('28A'), fetchGMB('28S'), fetchMTR_Uni()];
        } else if (tabId === 2) {
            jobs = [fetchMTR_Return(), fetchKMB_Uni()];
        } else if (tabId === 3) {
            jobs = [refreshFavoritesEta(), refreshFavoritesFare()];
        } else if (tabId === 4) {
            const listView = document.getElementById('tab4-route-list-view');
            if (!listView || listView.style.display === 'none') return;
            const displayedCount = Math.max(0, Number(window.tab4CurrentPage || 0) * TAB4_PAGE_SIZE);
            const displayedKeys = (window.tab4DisplayRoutes || []).slice(0, displayedCount);
            const visibleKeys = getTab4VisibleRouteKeys(displayedKeys, 180);
            if (!visibleKeys.length) return;
            jobs = [fetchAndApplyEtaStatusForTab4Keys(visibleKeys, force)];
        } else {
            return;
        }

        let completedJobs = 0;
        const totalJobs = Math.max(1, jobs.length);
        const showRefreshProgress = () => {
            if (!updateEl || currentTab !== tabId) return;
            const percent = Math.min(100, Math.round((completedJobs / totalJobs) * 100));
            updateEl.innerText = `更新中 ${percent}%`;
        };
        showRefreshProgress();
        const trackedJobs = jobs.map(job => Promise.resolve(job).finally(() => {
            completedJobs += 1;
            showRefreshProgress();
        }));

        const task = Promise.allSettled(trackedJobs).then(results => {
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
                const stopNamesPromise = ensureKmbStopNamesLoaded().catch(e => {
                    console.warn('KMB stop names failed, using stop IDs as fallback', e);
                    return [];
                });

                if (window.globalRouteStops) {
                    await stopNamesPromise;
                    const stops = enrichKmbRouteStopList(getKmbStopsFromIndex(route, boundCode));
                    window.routeStopsCache[key] = stops;
                    return stops;
                }

                // Fetch the selected route-stop list and the daily global stop-name
                // index in parallel. Previously these were serial, making first entry
                // into a KMB route noticeably slower even when the daily cache existed.
                const routeStopsPromise = fetchJsonCached(`https://data.etabus.gov.hk/v1/transport/kmb/route-stop/${route}/${bound}/1`, { ttl: 86400000, timeout: 10000 });
                const [data] = await Promise.all([routeStopsPromise, stopNamesPromise]);
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
    window.tab4OperatorFilter = 'KMB';
    window.tab4SourceStatus = { kmb: false, ctb: false, nlb: false, gmb: false };
    window.tab4StopSearchIndex = null;
    window.tab4StopSearchIndexLoading = null;
    window.tab4StopSearchQueryCache = new Map();
    window.routeKeyboardForceTextInput = false;
    window.routeSearchFloatingOpen = false;
    window.routeSearchNativeMode = false;
    window.routeSearchSuggestionTimer = null;
    window.routeSearchBubbleDragging = false;
    window.tab4GrayNoService = false;
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
    const TAB4_ROUTE_CACHE_KEY = 'psk_transport_tab4_route_groups_v4';
    const TAB4_ROUTE_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

    function safeLocalStorageGet(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }

    function safeLocalStorageSet(key, value) {
        try { localStorage.setItem(key, value); return true; }
        catch (e) { console.warn('localStorage save failed', key, e); return false; }
    }


    // ==========================================
    // 車資：運輸署 GTFS fare_attributes 壓縮索引
    // 每個站顯示「由此站上車至本方向終點」的公布車資。
    // ==========================================
    let routeFareIndexPromise = null;

    function normalizeFareMatchText(value) {
        return String(value || '')
            .toUpperCase()
            .replace(/<BR\s*\/?\s*>/gi, ' ')
            .replace(/[，,。．·・:：;；()（）\[\]【】{}「」『』<>《》\-—–_\/\\|\s]/g, '')
            .trim();
    }

    function normalizeFareNumber(value) {
        if (value === null || value === undefined || value === '') return null;
        const n = Number(value);
        return Number.isFinite(n) && n >= 0 ? n : null;
    }

    function formatFareAmount(value) {
        const n = normalizeFareNumber(value);
        return n === null ? '$--' : `$${n.toFixed(2)}`;
    }

    async function loadRouteFareIndex() {
        if (routeFareIndexPromise) return routeFareIndexPromise;
        routeFareIndexPromise = (async () => {
            const dayKey = getHongKongServiceDayKey(6);
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 12000);
            try {
                const res = await fetch(`./data/route-fares.json?day=${encodeURIComponent(dayKey)}`, {
                    signal: controller.signal,
                    cache: 'default'
                });
                if (!res.ok) throw new Error(`Fare index HTTP ${res.status}`);
                const data = parseJsonTextSafely(await res.text());
                if (!data || typeof data !== 'object' || !data.routes || !data.lookup) {
                    throw new Error('Fare index payload invalid');
                }
                return data;
            } finally {
                clearTimeout(timer);
            }
        })().catch(err => {
            routeFareIndexPromise = null;
            console.warn('Route fare index unavailable', err);
            return null;
        });
        return routeFareIndexPromise;
    }

    function getFareOperatorCode({ isCitybus, isGmb, isNlb }) {
        if (isGmb) return 'GMB';
        if (isNlb) return 'NLB';
        if (isCitybus) return 'CTB';
        return 'KMB';
    }

    function getFareBoundNumber({ bound, isGmb, gmbRouteSeq }) {
        if (isGmb && (String(gmbRouteSeq) === '1' || String(gmbRouteSeq) === '2')) return String(gmbRouteSeq);
        return getFavoriteBoundCode(bound) === 'I' ? '2' : '1';
    }

    function chooseFareRoute(index, {
        route, bound, dest, isCitybus, isGmb, isNlb, gmbRouteId, gmbRouteSeq, stopCount, requiredSeq
    }) {
        if (!index || !index.routes) return null;
        const routeCode = String(route || '').trim().toUpperCase();
        const operator = getFareOperatorCode({ isCitybus, isGmb, isNlb });
        const expectedBoundNo = getFareBoundNumber({ bound, isGmb, gmbRouteSeq });
        const boundCandidates = expectedBoundNo === '2' ? ['2', '1'] : ['1', '2'];
        let routeIds = [];

        if (isGmb && gmbRouteId && index.routes[String(gmbRouteId)]) {
            routeIds = [String(gmbRouteId)];
        } else {
            routeIds = (index.lookup && index.lookup[`${operator}:${routeCode}`]) || [];
        }

        const normalizedDest = normalizeFareMatchText(dest);
        let best = null;
        let bestScore = -Infinity;
        routeIds.forEach(routeId => {
            const entry = index.routes[String(routeId)];
            if (!entry || !entry.d) return;
            boundCandidates.forEach(boundNo => {
                const dir = entry.d[boundNo];
                if (!dir || !dir.f) return;

                // Normally O/I maps to TD bound 1/2. Keep that as the default,
                // but allow the opposite bound to win when the official stop count
                // or requested stop sequence clearly matches better.
                let score = boundNo === expectedBoundNo ? 40 : 0;
                const count = Number(stopCount || 0);
                const officialCount = Number(dir.c || 0);
                if (count > 0 && officialCount > 0) {
                    if (count === officialCount) score += 100;
                    else score -= Math.min(60, Math.abs(count - officialCount) * 5);
                }
                if (normalizedDest) {
                    const longName = normalizeFareMatchText(entry.l);
                    if (longName && longName.includes(normalizedDest)) score += 25;
                }
                if (requiredSeq && Object.prototype.hasOwnProperty.call(dir.f, String(requiredSeq))) score += 35;
                if (String(entry.r || '').toUpperCase() === routeCode) score += 10;

                if (score > bestScore) {
                    bestScore = score;
                    best = { routeId: String(routeId), entry, dir, boundNo };
                }
            });
        });
        return best;
    }

    async function getRouteFareMap(params) {
        const index = await loadRouteFareIndex();
        if (!index) return {};
        const chosen = chooseFareRoute(index, params || {});
        if (!chosen || !chosen.dir || !chosen.dir.f) return {};
        return { ...chosen.dir.f };
    }

    function updateStopFareLabels(container, fareMap) {
        if (!container) return;
        container.querySelectorAll('[data-stop-fare-seq]').forEach(el => {
            const seq = el.getAttribute('data-stop-fare-seq') || '';
            el.textContent = formatFareAmount(fareMap && fareMap[seq]);
        });
    }

    // ==========================================
    // 時間表：運輸署 GTFS 公布總站開出時間 / 班次頻率
    // 固定班次顯示逐班時間；frequencies.txt 只顯示時段 + headway，
    // 不把頻率資料展開成假精確的逐班時間。
    // ==========================================
    let routeTimetableIndexPromise = null;
    let timetableReturnFocus = null;

    async function loadRouteTimetableIndex() {
        if (routeTimetableIndexPromise) return routeTimetableIndexPromise;
        routeTimetableIndexPromise = (async () => {
            const dayKey = getHongKongServiceDayKey(6);
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 15000);
            try {
                const res = await fetch(`./data/route-timetables.json?day=${encodeURIComponent(dayKey)}`, {
                    signal: controller.signal,
                    cache: 'default'
                });
                if (!res.ok) throw new Error(`Timetable index HTTP ${res.status}`);
                const data = parseJsonTextSafely(await res.text());
                if (!data || typeof data !== 'object' || !data.routes || !data.lookup || !data.c || !data.x) {
                    throw new Error('Timetable index payload invalid');
                }
                return data;
            } finally {
                clearTimeout(timer);
            }
        })().catch(err => {
            routeTimetableIndexPromise = null;
            console.warn('Route timetable index unavailable', err);
            return null;
        });
        return routeTimetableIndexPromise;
    }

    function getTimetableWeekdayIndex(dayKey) {
        const date = new Date(`${dayKey}T12:00:00+08:00`);
        const sundayZero = date.getUTCDay();
        return (sundayZero + 6) % 7; // Monday = 0 ... Sunday = 6
    }

    function isTimetableServiceActive(index, serviceId, dayKey) {
        if (!index || !serviceId || !dayKey) return false;
        const compactDate = String(dayKey).replace(/-/g, '');
        const exception = index.x && index.x[compactDate] && Number(index.x[compactDate][serviceId]);
        if (exception === 1) return true;
        if (exception === 2) return false;

        const calendar = index.c && index.c[serviceId];
        if (!calendar) return false;
        if (calendar.s && compactDate < String(calendar.s)) return false;
        if (calendar.e && compactDate > String(calendar.e)) return false;
        const weekdayIndex = getTimetableWeekdayIndex(dayKey);
        return String(calendar.m || '').charAt(weekdayIndex) === '1';
    }

    function timetableClockMinutes(value) {
        const m = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
        if (!m) return Number.POSITIVE_INFINITY;
        return Number(m[1]) * 60 + Number(m[2]);
    }

    function formatTimetableClock(value) {
        const m = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
        if (!m) return escapeHtml(String(value || ''));
        const hour = Number(m[1]);
        const minute = Number(m[2]);
        if (hour >= 24) {
            return `${String(hour % 24).padStart(2, '0')}:${String(minute).padStart(2, '0')}<span class="timetable-next-day">翌日</span>`;
        }
        return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }

    function formatTimetableHeadway(seconds) {
        const n = Number(seconds);
        if (!Number.isFinite(n) || n <= 0) return '';
        if (n < 60) return `每 ${Math.round(n)} 秒`;
        const minutes = n / 60;
        return Number.isInteger(minutes) ? `每 ${minutes} 分鐘` : `每 ${minutes.toFixed(1)} 分鐘`;
    }

    function chooseTimetableRoute(index, {
        route, bound, dest, isCitybus, isGmb, isNlb, gmbRouteId, gmbRouteSeq, stopCount
    }) {
        if (!index || !index.routes) return null;
        const routeCode = String(route || '').trim().toUpperCase();
        const operator = getFareOperatorCode({ isCitybus, isGmb, isNlb });
        const expectedBoundNo = getFareBoundNumber({ bound, isGmb, gmbRouteSeq });
        const boundCandidates = expectedBoundNo === '2' ? ['2', '1'] : ['1', '2'];
        let routeIds = [];

        if (isGmb && gmbRouteId && index.routes[String(gmbRouteId)]) {
            routeIds = [String(gmbRouteId)];
        } else {
            routeIds = (index.lookup && index.lookup[`${operator}:${routeCode}`]) || [];
        }

        const normalizedDest = normalizeFareMatchText(dest);
        let best = null;
        let bestScore = -Infinity;
        routeIds.forEach(routeId => {
            const entry = index.routes[String(routeId)];
            if (!entry || !entry.d) return;
            boundCandidates.forEach(boundNo => {
                const dir = entry.d[boundNo];
                if (!dir || !dir.s) return;
                let score = boundNo === expectedBoundNo ? 40 : 0;
                const count = Number(stopCount || 0);
                const officialCount = Number(dir.c || 0);
                if (count > 0 && officialCount > 0) {
                    if (count === officialCount) score += 100;
                    else score -= Math.min(60, Math.abs(count - officialCount) * 5);
                }
                if (normalizedDest) {
                    const longName = normalizeFareMatchText(entry.l);
                    if (longName && longName.includes(normalizedDest)) score += 25;
                }
                if (String(entry.r || '').toUpperCase() === routeCode) score += 10;
                if (score > bestScore) {
                    bestScore = score;
                    best = { routeId: String(routeId), entry, dir, boundNo };
                }
            });
        });
        return best;
    }

    async function getRouteTimetable(params, dayKey = getHongKongServiceDayKey(6)) {
        const index = await loadRouteTimetableIndex();
        if (!index) return { unavailable: true, dayKey };
        const chosen = chooseTimetableRoute(index, params || {});
        if (!chosen || !chosen.dir || !chosen.dir.s) return { notFound: true, index, dayKey };

        const fixed = new Set();
        const ranges = new Map();
        const activeServices = [];
        for (const [serviceId, schedule] of Object.entries(chosen.dir.s)) {
            if (!isTimetableServiceActive(index, serviceId, dayKey)) continue;
            activeServices.push(serviceId);
            (schedule.t || []).forEach(time => fixed.add(String(time)));
            (schedule.f || []).forEach(range => {
                if (!Array.isArray(range) || range.length < 3) return;
                ranges.set(`${range[0]}|${range[1]}|${range[2]}`, [String(range[0]), String(range[1]), Number(range[2])]);
            });
        }

        const times = [...fixed].sort((a, b) => timetableClockMinutes(a) - timetableClockMinutes(b));
        const frequencyRanges = [...ranges.values()].sort((a, b) =>
            timetableClockMinutes(a[0]) - timetableClockMinutes(b[0]) ||
            timetableClockMinutes(a[1]) - timetableClockMinutes(b[1]) ||
            Number(a[2]) - Number(b[2])
        );
        return {
            dayKey,
            times,
            frequencyRanges,
            activeServices,
            routeId: chosen.routeId,
            boundNo: chosen.boundNo,
            sourceUpdatedAt: index.updatedAt || ''
        };
    }

    function mergeTimetableSchedules(dir, serviceIds) {
        const fixed = new Set();
        const ranges = new Map();
        (serviceIds || []).forEach(serviceId => {
            const schedule = dir && dir.s && dir.s[serviceId];
            if (!schedule) return;
            (schedule.t || []).forEach(time => fixed.add(String(time)));
            (schedule.f || []).forEach(range => {
                if (!Array.isArray(range) || range.length < 3) return;
                ranges.set(`${range[0]}|${range[1]}|${range[2]}`, [String(range[0]), String(range[1]), Number(range[2])]);
            });
        });
        return {
            times: [...fixed].sort((a, b) => timetableClockMinutes(a) - timetableClockMinutes(b)),
            frequencyRanges: [...ranges.values()].sort((a, b) =>
                timetableClockMinutes(a[0]) - timetableClockMinutes(b[0]) ||
                timetableClockMinutes(a[1]) - timetableClockMinutes(b[1]) ||
                Number(a[2]) - Number(b[2])
            )
        };
    }

    function timetableScheduleSignature(data) {
        return JSON.stringify([
            (data && data.times) || [],
            (data && data.frequencyRanges) || []
        ]);
    }

    function serviceIdsForRegularWeekday(index, chosen, weekdayIndex) {
        const compactNow = getHongKongServiceDayKey(6).replace(/-/g, '');
        return Object.keys((chosen && chosen.dir && chosen.dir.s) || {}).filter(serviceId => {
            const calendar = index && index.c && index.c[serviceId];
            if (!calendar) return false;
            if (calendar.s && compactNow < String(calendar.s)) return false;
            if (calendar.e && compactNow > String(calendar.e)) return false;
            return String(calendar.m || '').charAt(weekdayIndex) === '1';
        });
    }

    function formatTimetableWeekdayGroup(indices) {
        const list = [...new Set(indices || [])].sort((a, b) => a - b);
        if (list.length === 5 && list.every((v, i) => v === i)) return '星期一至五';
        const names = ['星期一','星期二','星期三','星期四','星期五','星期六','星期日'];
        if (list.length === 1) return names[list[0]] || '';
        const groups = [];
        let start = null;
        let prev = null;
        const flush = () => {
            if (start === null) return;
            if (start === prev) groups.push(names[start]);
            else if (prev === start + 1) groups.push(`${names[start]}、${names[prev]}`);
            else groups.push(`${names[start]}至${String(names[prev]).replace('星期','')}`);
            start = prev = null;
        };
        list.forEach(idx => {
            if (start === null) { start = prev = idx; return; }
            if (idx === prev + 1) { prev = idx; return; }
            flush();
            start = prev = idx;
        });
        flush();
        return groups.join('、');
    }

    function makeTimetableRegularPatterns(index, chosen) {
        const patterns = [];
        // Keep the familiar Hong Kong timetable categories: weekdays are grouped
        // only when their published schedules are genuinely identical; Saturday
        // and Sunday remain explicit categories even when the times happen to match.
        const weekdayBuckets = new Map();
        for (let weekdayIndex = 0; weekdayIndex <= 4; weekdayIndex++) {
            const services = serviceIdsForRegularWeekday(index, chosen, weekdayIndex);
            const schedule = mergeTimetableSchedules(chosen.dir, services);
            const signature = timetableScheduleSignature(schedule);
            if (!weekdayBuckets.has(signature)) weekdayBuckets.set(signature, { indices: [], ...schedule, activeServices: services });
            weekdayBuckets.get(signature).indices.push(weekdayIndex);
        }
        weekdayBuckets.forEach(bucket => patterns.push({
            label: formatTimetableWeekdayGroup(bucket.indices),
            indices: bucket.indices,
            times: bucket.times,
            frequencyRanges: bucket.frequencyRanges,
            activeServices: bucket.activeServices
        }));
        [5, 6].forEach(weekdayIndex => {
            const services = serviceIdsForRegularWeekday(index, chosen, weekdayIndex);
            const schedule = mergeTimetableSchedules(chosen.dir, services);
            patterns.push({
                label: formatTimetableWeekdayGroup([weekdayIndex]),
                indices: [weekdayIndex],
                times: schedule.times,
                frequencyRanges: schedule.frequencyRanges,
                activeServices: services
            });
        });
        return patterns;
    }

    function findTimetableHolidayPattern(index, chosen, regularPatterns) {
        const relevantServices = new Set(Object.keys((chosen && chosen.dir && chosen.dir.s) || {}));
        if (!relevantServices.size) return null;
        const regularByWeekday = new Map();
        (regularPatterns || []).forEach(pattern => (pattern.indices || []).forEach(idx => regularByWeekday.set(idx, pattern)));
        const counts = new Map();
        const samples = new Map();
        for (const [compactDate, changes] of Object.entries((index && index.x) || {})) {
            if (!/^\d{8}$/.test(compactDate) || !changes || typeof changes !== 'object') continue;
            const dayKey = `${compactDate.slice(0,4)}-${compactDate.slice(4,6)}-${compactDate.slice(6,8)}`;
            const weekdayIndex = getTimetableWeekdayIndex(dayKey);
            if (weekdayIndex === 6) continue;
            const affected = Object.keys(changes).some(serviceId => relevantServices.has(serviceId));
            if (!affected) continue;
            // Public-holiday / territory-wide substitutions affect a shared set of
            // calendar services. Ignore tiny one-off edits when deriving a generic label.
            if (Object.keys(changes).length < 3) continue;
            const services = [...relevantServices].filter(serviceId => isTimetableServiceActive(index, serviceId, dayKey));
            const schedule = mergeTimetableSchedules(chosen.dir, services);
            const signature = timetableScheduleSignature(schedule);
            const regular = regularByWeekday.get(weekdayIndex);
            if (regular && signature === timetableScheduleSignature(regular)) continue;
            counts.set(signature, (counts.get(signature) || 0) + 1);
            if (!samples.has(signature)) samples.set(signature, { ...schedule, activeServices: services, dayKey });
        }
        if (!counts.size) return null;
        const [bestSignature, bestCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
        const sample = samples.get(bestSignature);
        return sample ? { ...sample, signature: bestSignature, occurrences: bestCount } : null;
    }

    async function getRouteTimetablePatterns(params) {
        const index = await loadRouteTimetableIndex();
        if (!index) return { unavailable: true };
        const chosen = chooseTimetableRoute(index, params || {});
        if (!chosen || !chosen.dir || !chosen.dir.s) return { notFound: true, index };
        const patterns = makeTimetableRegularPatterns(index, chosen);
        const holiday = findTimetableHolidayPattern(index, chosen, patterns);
        if (holiday) {
            const sunday = patterns.find(pattern => (pattern.indices || []).includes(6));
            if (sunday && timetableScheduleSignature(sunday) === holiday.signature) {
                sunday.label = `${sunday.label}及公眾假期`;
                sunday.holidayDerived = true;
            } else {
                patterns.push({
                    label: '公眾假期／特別服務日',
                    indices: [],
                    times: holiday.times,
                    frequencyRanges: holiday.frequencyRanges,
                    activeServices: holiday.activeServices,
                    holidayDerived: true
                });
            }
        }
        return {
            patterns,
            routeId: chosen.routeId,
            boundNo: chosen.boundNo,
            sourceUpdatedAt: index.updatedAt || ''
        };
    }

    function addTimetableServiceDays(dayKey, offset) {
        const date = new Date(`${dayKey}T12:00:00+08:00`);
        date.setUTCDate(date.getUTCDate() + Number(offset || 0));
        return date.toISOString().slice(0, 10);
    }

    function getTimetableSevenDayKeys() {
        const first = getHongKongServiceDayKey(6);
        return Array.from({ length: 7 }, (_, i) => addTimetableServiceDays(first, i));
    }

    function formatTimetableServiceDate(dayKey) {
        const m = String(dayKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) return String(dayKey || '');
        const labels = ['日','一','二','三','四','五','六'];
        const date = new Date(`${dayKey}T12:00:00+08:00`);
        return `${Number(m[2])}月${Number(m[3])}日（星期${labels[date.getUTCDay()]}）`;
    }

    function openTimetableModalShell(ctx) {
        const overlay = document.getElementById('timetable-overlay');
        const modal = document.getElementById('timetable-modal');
        const title = document.getElementById('timetable-title');
        const subtitle = document.getElementById('timetable-subtitle');
        const content = document.getElementById('timetable-content');
        if (!overlay || !modal || !content) return false;
        timetableReturnFocus = document.activeElement;
        if (title) title.textContent = `${ctx.route || ''} 時間表`;
        if (subtitle) subtitle.textContent = ctx.dest ? `往 ${ctx.dest}` : '';
        content.innerHTML = '<div class="timetable-loading">載入官方時間表…</div>';
        overlay.classList.add('open');
        modal.classList.add('open');
        requestAnimationFrame(() => {
            const closeBtn = modal.querySelector('.timetable-close-btn');
            if (closeBtn) closeBtn.focus({ preventScroll: true });
        });
        return true;
    }

    function closeRouteTimetable() {
        const overlay = document.getElementById('timetable-overlay');
        const modal = document.getElementById('timetable-modal');
        if (overlay) overlay.classList.remove('open');
        if (modal) modal.classList.remove('open');
        if (timetableReturnFocus && typeof timetableReturnFocus.focus === 'function') {
            timetableReturnFocus.focus({ preventScroll: true });
        }
        timetableReturnFocus = null;
    }

    function renderTimetablePatternBlock(data, patternIndex) {
        const label = data && data.label ? data.label : '服務日';
        let html = `<section class="timetable-day-card${patternIndex === 0 ? ' timetable-day-card-today' : ''}"><div class="timetable-date"><strong>${escapeHtml(label)}</strong><span>總站開出</span></div>`;
        if (!data.times.length && !data.frequencyRanges.length) {
            html += '<div class="timetable-day-empty">沒有公布班次。</div>';
        } else {
            if (data.times.length) {
                html += '<div class="timetable-section"><h3>固定開出時間</h3><div class="timetable-time-grid">';
                data.times.forEach(time => { html += `<div class="timetable-time-chip">${formatTimetableClock(time)}</div>`; });
                html += '</div></div>';
            }
            if (data.frequencyRanges.length) {
                html += '<div class="timetable-section"><h3>班次頻率</h3><div class="timetable-frequency-list">';
                data.frequencyRanges.forEach(([start, end, headway]) => {
                    html += `<div class="timetable-frequency-row"><span class="timetable-frequency-time">${formatTimetableClock(start)}–${formatTimetableClock(end)}</span><span>${escapeHtml(formatTimetableHeadway(headway))}</span></div>`;
                });
                html += '</div></div>';
            }
        }
        html += '</section>';
        return html;
    }

    async function showRouteTimetableForContext(ctx) {
        if (!ctx || !ctx.route || !openTimetableModalShell(ctx)) return;
        const content = document.getElementById('timetable-content');
        try {
            const result = await getRouteTimetablePatterns(ctx);
            if (!content || !document.getElementById('timetable-modal')?.classList.contains('open')) return;
            if (result.unavailable) {
                content.innerHTML = '<div class="timetable-empty">時間表資料尚未建立。<br><span>部署後請執行一次每日交通資料更新。</span></div>';
                return;
            }
            if (result.notFound || !Array.isArray(result.patterns)) {
                content.innerHTML = '<div class="timetable-empty">未能配對此方向的官方時間表。</div>';
                return;
            }
            const visiblePatterns = result.patterns.filter(pattern => pattern.times.length || pattern.frequencyRanges.length);
            if (!visiblePatterns.length) {
                content.innerHTML = '<div class="timetable-empty">未有公布可顯示的總站開出時間。</div>';
                return;
            }
            let html = '<div class="timetable-week-intro">按服務日類別 · 總站公布開出時間</div>';
            visiblePatterns.forEach((pattern, idx) => { html += renderTimetablePatternBlock(pattern, idx); });
            html += '<div class="timetable-note">資料按運輸署 GTFS 的星期服務規則及例外服務日整理；只有實際時間完全相同的平日才會合併為「星期一至五」。如公眾假期採用星期日服務，會合併顯示為「星期日及公眾假期」。實際開車時間仍可能因交通或營運調動而有差異。</div>';
            content.innerHTML = html;
        } catch (err) {
            console.warn('Show route timetable failed', err);
            if (content) content.innerHTML = '<div class="timetable-empty">暫時無法載入時間表，請稍後再試。</div>';
        }
    }

    async function showRouteTimetable() {
        return showRouteTimetableForContext(window.tab4DetailContext);
    }

    async function showQuickKmbTimetable(route, dest = '') {
        const routeCode = String(route || '').trim();
        if (!routeCode) return;
        const bound = 'outbound';
        let stopCount = 0;
        try {
            const stops = await getRouteStopsCached(routeCode, bound, false);
            stopCount = (stops || []).length;
        } catch (e) {}
        return showRouteTimetableForContext({ route: routeCode, bound, dest, isCitybus: false, isGmb: false, isNlb: false, stopCount });
    }

    async function showQuickGmbTimetable(routeCode) {
        const cfg = GMB_CONFIGS[String(routeCode || '').toUpperCase()];
        if (!cfg) return;
        try {
            const resolved = await resolveGmbRouteStop(cfg);
            const stops = await getGmbRouteStopsForDetail(resolved.routeId, resolved.routeSeq);
            return showRouteTimetableForContext({
                route: cfg.routeCode,
                bound: String(resolved.routeSeq) === '2' ? 'inbound' : 'outbound',
                dest: resolved.destName || cfg.displayDest,
                isCitybus: false,
                isGmb: true,
                isNlb: false,
                gmbRegion: cfg.region,
                gmbRouteId: resolved.routeId,
                gmbRouteSeq: resolved.routeSeq,
                stopCount: (stops || []).length
            });
        } catch (err) {
            const shellCtx = { route: cfg.routeCode, dest: cfg.displayDest };
            if (openTimetableModalShell(shellCtx)) {
                const content = document.getElementById('timetable-content');
                if (content) content.innerHTML = '<div class="timetable-empty">暫時無法配對此小巴方向的時間表。</div>';
            }
        }
    }

    function showFavoriteTimetableFromEncoded(encoded) {
        try {
            const fav = normalizeFavoriteStop(JSON.parse(decodeURIComponent(encoded)));
            return showRouteTimetableForContext({
                route: fav.route,
                bound: fav.bound,
                dest: fav.dest,
                isCitybus: fav.isCitybus,
                isGmb: fav.isGmb,
                isNlb: fav.isNlb,
                gmbRegion: fav.gmbRegion,
                gmbRouteId: fav.gmbRouteId,
                gmbRouteSeq: fav.gmbRouteSeq,
                nlbRouteId: fav.nlbRouteId,
                nlbPairKey: fav.nlbPairKey,
                stopCount: Number(fav.routeStopCount || 0)
            });
        } catch (err) {
            console.warn('Favorite timetable payload invalid', err);
        }
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
            isNlb: !!fav.isNlb,
            nlbRouteId: String(fav.nlbRouteId || '').trim(),
            nlbPairKey: String(fav.nlbPairKey || '').trim(),
            routeStopCount: Number(fav.routeStopCount || 0),
            gmbRegion: String(fav.gmbRegion || '').trim(),
            gmbRouteId: String(fav.gmbRouteId || fav.routeId || '').trim(),
            gmbRouteSeq: String(fav.gmbRouteSeq || fav.routeSeq || '').trim(),
            badgeColor: String(fav.badgeColor || '').trim(),
            operatorLabel: String(fav.operatorLabel || '').trim(),
            fare: normalizeFareNumber(fav.fare)
        };
        normalized.key = makeFavoriteStopKey(normalized);
        return normalized;
    }

    function makeFavoriteStopKey(fav) {
        const op = fav.isGmb ? 'GMB' : (fav.isNlb ? 'NLB' : (fav.isCitybus ? 'CTB' : 'KMB'));
        const routeCode = String(fav.route || fav.routeDisplay || '').trim().toUpperCase();
        const boundCode = getFavoriteBoundCode(fav.boundCode || fav.bound);
        const gmbPart = fav.isGmb ? `${fav.gmbRegion || ''}:${fav.gmbRouteId || ''}:${fav.gmbRouteSeq || ''}` : '';
        const nlbPart = fav.isNlb ? `${fav.nlbRouteId || ''}:${fav.nlbPairKey || ''}` : '';
        return [op, routeCode, boundCode, gmbPart || nlbPart, String(fav.seq || ''), String(fav.stopId || '')].join('|');
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

    function makeFavoriteStopPayload({ route, routeDisplay, bound, dest, isCitybus, isGmb, isNlb, nlbRouteId, nlbPairKey, routeStopCount, gmbRegion, gmbRouteId, gmbRouteSeq, seq, stopId, stopName, badgeColor, fare }) {
        let operatorLabel = '九巴';
        if (isCitybus) operatorLabel = '城巴';
        if (isGmb) operatorLabel = '專線小巴';
        if (isNlb) operatorLabel = '大嶼山巴士';
        if (!isCitybus && !isGmb && !isNlb && /^N?A/i.test(String(routeDisplay || route || ''))) operatorLabel = '龍運';

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
            isNlb,
            nlbRouteId,
            nlbPairKey,
            routeStopCount,
            gmbRegion,
            gmbRouteId,
            gmbRouteSeq,
            badgeColor,
            operatorLabel,
            fare
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
        if (fav.isNlb) return 'nlb-header';
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

    function makeFavoriteFareDomId(key) {
        return 'favorite-fare-' + makeTab4SafeDomId(key);
    }

    async function getFavoriteFareValue(fav) {
        const normalized = normalizeFavoriteStop(fav);
        const index = await loadRouteFareIndex();
        if (!index) return normalized.fare;
        const chosen = chooseFareRoute(index, {
            route: normalized.route,
            bound: normalized.bound,
            dest: normalized.dest,
            isCitybus: normalized.isCitybus,
            isGmb: normalized.isGmb,
            isNlb: normalized.isNlb,
            gmbRouteId: normalized.gmbRouteId,
            gmbRouteSeq: normalized.gmbRouteSeq,
            requiredSeq: normalized.seq
        });
        const value = chosen && chosen.dir && chosen.dir.f
            ? normalizeFareNumber(chosen.dir.f[String(normalized.seq)])
            : null;
        return value === null ? normalized.fare : value;
    }

    async function refreshFavoritesFare() {
        const favorites = getFavoriteStops();
        if (favorites.length === 0) return;
        let changed = false;
        await mapWithConcurrency(favorites, 4, async fav => {
            const el = document.getElementById(makeFavoriteFareDomId(fav.key));
            if (!el) return;
            try {
                const fare = await getFavoriteFareValue(fav);
                el.textContent = formatFareAmount(fare);
                if (normalizeFareNumber(fare) !== null && normalizeFareNumber(fav.fare) !== normalizeFareNumber(fare)) {
                    fav.fare = normalizeFareNumber(fare);
                    changed = true;
                }
            } catch (e) {
                console.warn('Favorite fare refresh failed', fav, e);
                el.textContent = formatFareAmount(fav.fare);
            }
        });
        if (changed) saveFavoriteStops(favorites);
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

        if (normalized.isNlb) {
            if (!normalized.nlbRouteId || !normalized.stopId) return [];
            return fetchNlbEtaForStop(normalized.nlbRouteId, normalized.stopId);
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
            const fareId = makeFavoriteFareDomId(fav.key);
            return `
            <div class="card favorite-card" data-favorite-key="${escapeHtml(fav.key)}">
                <div class="card-header ${getFavoriteHeaderClass(fav)}">
                    <span class="icon">${getFavoriteIcon(fav)}</span>
                    <span class="card-title timetable-link" onclick="showFavoriteTimetableFromEncoded('${encodeFavoriteStopPayload(fav)}')" title="查看服務日時間表">${escapeHtml(fav.routeDisplay || fav.route)}</span>
                    <span class="favorite-route-meta">${escapeHtml(fav.operatorLabel || '')}</span>
                    ${renderFavoriteStarButton(fav)}
                </div>
                <div class="card-content favorite-card-content">
                    <div class="favorite-stop-name">${escapeHtml(fav.stopName)}</div>
                    <div id="${fareId}" class="favorite-stop-fare">${formatFareAmount(fav.fare)}</div>
                    <div class="favorite-stop-meta">往 ${escapeHtml(fav.dest || '')}</div>
                    <div id="${etaId}" class="favorite-card-eta"><div class="status-msg" style="padding: 8px 0; text-align:left;">更新中 0%</div></div>
                </div>
            </div>`;
        }).join('');

        refreshFavoritesEta();
        refreshFavoritesFare();
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
            window.tab4SourceStatus = cached.sourceStatus || { kmb: true, ctb: true, nlb: false, gmb: true };
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
            // 路線總表未有方向／站名時，只放一個非方向式載入項目。
            // 可見列會隨即讀取路線詳情及 route-stop，完成後直接改成實際站名。
            addGmbDirectionToTab4(groupKey, {
                route: routeCode,
                displayRoute: routeCode,
                bound: 'O',
                orig_tc: regionLabel,
                dest_tc: '載入站名…',
                isCitybus: false,
                isGmb: true,
                gmbRegion: region,
                routeId,
                routeSeq: '',
                needsGmbDetail: true,
                gmbPlaceholder: true,
                operatorName: `${regionLabel}專線小巴`
            });
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
        const data = await fetchJsonCached(`https://data.etagmb.gov.hk/route/${encodeURIComponent(region)}/${encodeURIComponent(routeCode)}`, { ttl: 86400000, timeout: 10000 });
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

        const stopData = await fetchJsonCached(`https://data.etagmb.gov.hk/route-stop/${encodeURIComponent(routeId)}/${encodeURIComponent(routeSeq)}`, { ttl: 86400000, timeout: 10000 });
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

    function parseNlbRouteName(value) {
        const raw = String(value || '').trim();
        const parts = raw.split(/\s*(?:>|＞|→)\s*/).map(v => v.trim()).filter(Boolean);
        return { orig: parts[0] || '', dest: parts.slice(1).join(' > ') || '' };
    }

    function normalizeNlbTerminalName(value) {
        return normalizeFareMatchText(String(value || '').replace(/[（(][^）)]*[）)]/g, ''));
    }

    function mergeNlbRoutesIntoTab4(payload) {
        const list = payload && Array.isArray(payload.routes) ? payload.routes : [];
        const byRoute = new Map();
        list.forEach(item => {
            const routeNo = String(item && item.routeNo || '').trim().toUpperCase();
            if (!routeNo || !item || !item.routeId) return;
            if (!byRoute.has(routeNo)) byRoute.set(routeNo, []);
            const names = parseNlbRouteName(item.routeName_c || item.routeName_e || '');
            byRoute.get(routeNo).push({ ...item, routeNo, ...names });
        });

        let groupsAdded = 0;
        for (const [routeNo, variants] of byRoute) {
            const unused = new Set(variants.map((_, i) => i));
            variants.forEach((item, idx) => {
                if (!unused.has(idx)) return;
                unused.delete(idx);
                const aOrig = normalizeNlbTerminalName(item.orig);
                const aDest = normalizeNlbTerminalName(item.dest);
                let reverseIdx = -1;
                for (const candidateIdx of unused) {
                    const candidate = variants[candidateIdx];
                    if (aOrig && aDest && normalizeNlbTerminalName(candidate.orig) === aDest && normalizeNlbTerminalName(candidate.dest) === aOrig) {
                        reverseIdx = candidateIdx;
                        break;
                    }
                }
                const pair = [item];
                if (reverseIdx >= 0) {
                    pair.push(variants[reverseIdx]);
                    unused.delete(reverseIdx);
                }
                const groupKey = `NLB-${routeNo}-${item.routeId}`;
                window.allRoutesGroupsTab4[groupKey] = pair.map((variant, dirIdx) => ({
                    route: routeNo,
                    displayRoute: routeNo,
                    bound: dirIdx === 0 ? 'O' : 'I',
                    orig_tc: variant.orig || '',
                    dest_tc: variant.dest || variant.routeName_c || '詳情',
                    isCitybus: false,
                    isGmb: false,
                    isNlb: true,
                    nlbRouteId: String(variant.routeId),
                    nlbPairKey: groupKey,
                    overnightRoute: Number(variant.overnightRoute || 0),
                    specialRoute: Number(variant.specialRoute || 0),
                    operatorName: '大嶼山巴士'
                }));
                groupsAdded++;
            });
        }
        return groupsAdded;
    }

    async function loadNlbRoutesForTab4() {
        const payload = await fetchJsonCached('https://rt.data.gov.hk/v2/transport/nlb/route.php?action=list', { ttl: 3600000, timeout: 12000 });
        return mergeNlbRoutesIntoTab4(payload);
    }

    async function getNlbRouteStopsForDetail(routeId) {
        const url = `https://rt.data.gov.hk/v2/transport/nlb/stop.php?action=list&routeId=${encodeURIComponent(routeId)}`;
        const payload = await fetchJsonCached(url, { ttl: 86400000, timeout: 10000 });
        const rows = payload && Array.isArray(payload.stops) ? payload.stops : [];
        return rows.map((item, idx) => ({
            seq: String(idx + 1),
            stop: String(item.stopId || item.stop_id || idx + 1),
            name_tc: String(item.stopName_c || item.stopName_tc || item.stopName_s || item.stopName_e || item.stopId || ''),
            fare: normalizeFareNumber(item.fare),
            fareHoliday: normalizeFareNumber(item.fareHoliday)
        }));
    }

    function isHongKongSunday() {
        try {
            return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Hong_Kong', weekday: 'short' }).format(new Date()) === 'Sun';
        } catch (e) {
            return new Date(Date.now() + 8 * 3600000).getUTCDay() === 0;
        }
    }

    function getNlbFareMapFromStops(stops) {
        const holidayStyle = isHongKongSunday();
        const map = {};
        (stops || []).forEach(stop => {
            const value = holidayStyle && normalizeFareNumber(stop.fareHoliday) !== null ? stop.fareHoliday : stop.fare;
            if (normalizeFareNumber(value) !== null) map[String(stop.seq)] = normalizeFareNumber(value);
        });
        return map;
    }

    function extractNlbEtaRows(payload) {
        if (!payload || typeof payload !== 'object') return [];
        if (Array.isArray(payload.estimatedArrivals)) return payload.estimatedArrivals;
        if (payload.data && Array.isArray(payload.data.estimatedArrivals)) return payload.data.estimatedArrivals;
        if (Array.isArray(payload.data)) return payload.data;
        return [];
    }

    async function fetchNlbEtaForStop(routeId, stopId) {
        const url = `https://rt.data.gov.hk/v2/transport/nlb/stop.php?action=estimatedArrivals&routeId=${encodeURIComponent(routeId)}&stopId=${encodeURIComponent(stopId)}&language=zh`;
        const payload = await fetchJsonCached(url, { ttl: 12000, timeout: 6000 });
        return extractNlbEtaRows(payload)
            .map(item => item && (item.estimatedArrivalTime || item.eta || item.timestamp))
            .filter(Boolean);
    }

    async function enrichGmbDirectionsWithTerminalStopNames(directions) {
        const dirs = (directions || []).map(dir => ({ ...dir }));
        await mapWithConcurrency(dirs, 4, async dir => {
            if (!dir.isGmb || !dir.routeId || !dir.routeSeq) return;
            try {
                const stops = await getGmbRouteStopsForDetail(dir.routeId, dir.routeSeq);
                if (!stops || stops.length === 0) return;
                const first = stops[0];
                const last = stops[stops.length - 1];
                const firstName = getGmbText(first && first.name_tc, first && first.stop_name_tc, first && first.stop);
                const lastName = getGmbText(last && last.name_tc, last && last.stop_name_tc, last && last.stop);
                if (firstName) dir.orig_tc = firstName;
                if (lastName) dir.dest_tc = lastName;
                dir.gmbPlaceholder = false;
            } catch (error) {
                console.warn('GMB terminal stop name failed', dir.route, dir.routeSeq, error);
            }
        });
        return dirs;
    }

    async function ensureGmbDirectionsLoadedForKeys(groupKeys) {
        const updatedKeys = [];
        const keys = [...new Set((groupKeys || []).filter(key => {
            const dirs = window.allRoutesGroupsTab4[key] || [];
            if (!dirs.some(d => d.isGmb)) return false;
            if (window.gmbDirectionsLoadedKeys[key]) return false;
            // 小巴清單直接用 route-stop 的首／尾站名，而不是「方向 1／2」或模糊方向文字。
            // 因此每個首次出現在畫面的 GMB 路線都補一次詳情及終點站名，之後由本機快取重用。
            return true;
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
                    let detailDirs = buildGmbDirectionsFromDetailRoutes(detailRoutes, region, routeCode)
                        .filter(d => d.route && String(d.route).toUpperCase() === String(routeCode).toUpperCase());
                    detailDirs = await enrichGmbDirectionsWithTerminalStopNames(detailDirs);

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

    // 非同步狀態計數器。v6.7.7 起取消巴士／小巴查詢頁的藍色橫向 loading bar。
    window.tab4ActiveFetches = 0;
    function setTab4Loading(isActive) {
        if (isActive) window.tab4ActiveFetches++;
        else window.tab4ActiveFetches = Math.max(0, window.tab4ActiveFetches - 1);
    }

    function updateTab4SourceStatus() {
        const el = document.getElementById('tab4-source-status');
        if (!el) return;
        const missing = [];
        if (!window.tab4SourceStatus.kmb) missing.push('九巴');
        if (!window.tab4SourceStatus.ctb) missing.push('城巴');
        if (!window.tab4SourceStatus.nlb) missing.push('嶼巴');
        if (!window.tab4SourceStatus.gmb) missing.push('小巴');
        if (missing.length === 0 || missing.length === 4) el.innerText = '';
        else el.innerText = `${missing.join('、')}暫未載入${location.protocol === 'file:' ? '，建議用本地伺服器開啟' : ''}`;
    }

    function getTab4DirsByOperator(dirs) {
        if (window.tab4OperatorFilter === 'KMB') return (dirs || []).filter(d => !d.isCitybus && !d.isGmb && !d.isNlb);
        if (window.tab4OperatorFilter === 'CTB') return (dirs || []).filter(d => d.isCitybus && !d.isGmb && !d.isNlb);
        if (window.tab4OperatorFilter === 'NLB') return (dirs || []).filter(d => d.isNlb);
        if (window.tab4OperatorFilter === 'GMB') return (dirs || []).filter(d => d.isGmb);
        return dirs || [];
    }

    const TAB4_GRAY_NO_SERVICE_KEY = 'psk_tab4_gray_no_service_v1';

    function toggleTab4NoServiceGray(enabled, persist = true) {
        window.tab4GrayNoService = !!enabled;
        const tab = document.getElementById('tab-4');
        const toggle = document.getElementById('tab4-gray-no-service-toggle');
        if (tab) tab.classList.toggle('tab4-gray-no-service', window.tab4GrayNoService);
        if (toggle && toggle.checked !== window.tab4GrayNoService) toggle.checked = window.tab4GrayNoService;
        if (persist) {
            try { localStorage.setItem(TAB4_GRAY_NO_SERVICE_KEY, window.tab4GrayNoService ? '1' : '0'); } catch (e) {}
        }
    }

    function initTab4NoServiceGrayToggle() {
        let enabled = false; // first-use default: OFF
        try { enabled = localStorage.getItem(TAB4_GRAY_NO_SERVICE_KEY) === '1'; } catch (e) {}
        toggleTab4NoServiceGray(enabled, false);
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

    function setRouteSearchFloatingOpen(open) {
        const panel = document.getElementById('route-search-panel');
        const fab = document.getElementById('route-search-fab');
        window.routeSearchFloatingOpen = !!open;
        if (panel) {
            panel.classList.toggle('open', !!open);
            panel.setAttribute('aria-hidden', open ? 'false' : 'true');
        }
        if (fab) {
            fab.classList.toggle('hidden', !!open);
            fab.setAttribute('aria-expanded', open ? 'true' : 'false');
        }
        const backdrop = document.getElementById('route-search-backdrop');
        if (backdrop) backdrop.setAttribute('aria-hidden', open ? 'false' : 'true');
        document.body.classList.toggle('route-search-open', !!open);
        if (!open) {
            hideRouteKeyboard();
            hideRouteSearchSuggestions();
            const input = document.getElementById('route-search-input');
            if (input && document.activeElement === input) input.blur();
            window.routeSearchNativeMode = false;
            document.body.classList.remove('route-search-native');
            document.documentElement.style.setProperty('--native-keyboard-offset', '0px');
            const panel = document.getElementById('route-search-panel');
            if (panel) { panel.style.top = ''; panel.style.bottom = ''; }
        }
    }

    function openFloatingRouteSearch() {
        if (currentTab !== 4) return;
        setRouteSearchFloatingOpen(true);
        window.routeKeyboardForceTextInput = false;
        window.routeSearchNativeMode = false;
        document.body.classList.remove('route-search-native');
        const input = document.getElementById('route-search-input');
        if (input) input.setAttribute('inputmode', 'none');
        showRouteKeyboard();
    }

    function collapseFloatingRouteSearch() {
        setRouteSearchFloatingOpen(false);
    }

    function syncCustomRouteSearchPosition() {
        if (!window.routeSearchFloatingOpen || window.routeSearchNativeMode) return;
        const panel = document.getElementById('route-search-panel');
        const keyboard = document.getElementById('route-keyboard');
        if (!panel || !keyboard || !keyboard.classList.contains('open')) return;
        const rect = keyboard.getBoundingClientRect();
        const viewportHeight = Math.max(1, Number(window.innerHeight || document.documentElement.clientHeight || 0));
        const gap = 7;
        panel.style.top = 'auto';
        panel.style.bottom = `${Math.max(8, Math.round(viewportHeight - rect.top + gap))}px`;
    }

    function showRouteKeyboard() {
        if (currentTab !== 4) return;
        setRouteSearchFloatingOpen(true);
        const input = document.getElementById('route-search-input');
        if (input) input.setAttribute('inputmode', 'none');
        window.routeSearchNativeMode = false;
        window.routeKeyboardForceTextInput = false;
        document.body.classList.remove('route-search-native');
        const panel = document.getElementById('route-search-panel');
        if (panel) { panel.style.top = ''; panel.style.bottom = ''; }
        buildRouteKeyboard();
        routeKeyboardSync();
        const keyboard = document.getElementById('route-keyboard');
        if (!keyboard) return;
        keyboard.classList.add('open');
        keyboard.setAttribute('aria-hidden', 'false');
        document.body.classList.add('route-keyboard-open');
        requestAnimationFrame(() => {
            syncCustomRouteSearchPosition();
            requestAnimationFrame(syncCustomRouteSearchPosition);
        });
        // The keypad itself slides up for ~220 ms. Re-sync after the transition so
        // the search field finishes directly above the keypad instead of using its
        // off-screen starting position.
        const settleSearchStack = () => syncCustomRouteSearchPosition();
        keyboard.addEventListener('transitionend', settleSearchStack, { once: true });
        setTimeout(settleSearchStack, 260);
    }

    function syncNativeKeyboardOffset() {
        if (!window.routeSearchNativeMode) return;
        const panel = document.getElementById('route-search-panel');
        if (!panel) return;
        const vv = window.visualViewport;
        if (vv) {
            const panelHeight = Math.max(54, panel.offsetHeight || 0);
            const visibleBottom = Number(vv.offsetTop || 0) + Number(vv.height || 0);
            const top = Math.max(8, visibleBottom - panelHeight - 10);
            panel.style.top = `${Math.round(top)}px`;
            panel.style.bottom = 'auto';
        } else {
            panel.style.top = 'auto';
            panel.style.bottom = '10px';
        }
    }

    function activateNativeRouteSearch(event) {
        if (event) event.stopPropagation();
        if (currentTab !== 4) return;
        setRouteSearchFloatingOpen(true);
        const input = document.getElementById('route-search-input');
        if (!input) return;
        window.routeSearchViewportBaseline = Math.max(Number(window.routeSearchViewportBaseline || 0), Number(window.innerHeight || 0), Number(document.documentElement.clientHeight || 0));
        window.routeKeyboardForceTextInput = true;
        window.routeSearchNativeMode = true;
        hideRouteKeyboard();
        document.body.classList.add('route-search-native');
        input.setAttribute('inputmode', 'text');
        // iOS/Android need a fresh focus after inputmode changes before showing the native IME.
        if (document.activeElement !== input) {
            setTimeout(() => {
                try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
                setTimeout(syncNativeKeyboardOffset, 60);
            }, 0);
        } else {
            setTimeout(syncNativeKeyboardOffset, 30);
        }
    }

    function showStationTextKeyboard() {
        activateNativeRouteSearch();
    }

    function onTab4SearchBlur() {
        setTimeout(() => {
            const input = document.getElementById('route-search-input');
            if (!input || document.activeElement === input) return;
            if (window.routeSearchNativeMode) {
                window.routeSearchNativeMode = false;
                document.body.classList.remove('route-search-native');
                document.documentElement.style.setProperty('--native-keyboard-offset', '0px');
                const panel = document.getElementById('route-search-panel');
                if (panel) { panel.style.top = ''; panel.style.bottom = ''; }
            }
        }, 100);
    }

    function hideRouteKeyboard() {
        const keyboard = document.getElementById('route-keyboard');
        if (keyboard) {
            keyboard.classList.remove('open');
            keyboard.setAttribute('aria-hidden', 'true');
        }
        document.body.classList.remove('route-keyboard-open');
        if (!window.routeSearchNativeMode) {
            const panel = document.getElementById('route-search-panel');
            if (panel) {
                panel.style.top = 'auto';
                panel.style.bottom = 'calc(var(--tab-bar-height) + 18px + env(safe-area-inset-bottom))';
            }
        }
    }

    function hideRouteSearchSuggestions() {
        const box = document.getElementById('route-search-suggestions');
        if (!box) return;
        box.innerHTML = '';
        box.classList.remove('visible');
    }

    function selectRouteSearchSuggestion(encodedValue) {
        const input = document.getElementById('route-search-input');
        if (!input) return;
        let value = '';
        try { value = decodeURIComponent(String(encodedValue || '')); } catch (e) { value = String(encodedValue || ''); }
        input.value = value;
        onTab4Search();
        hideRouteSearchSuggestions();
        if (window.routeSearchNativeMode) {
            try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
        }
    }

    async function updateRouteSearchSuggestions() {
        const input = document.getElementById('route-search-input');
        const box = document.getElementById('route-search-suggestions');
        if (!input || !box || !window.routeSearchFloatingOpen) return;
        const raw = input.value.trim();
        const isRouteCode = /^[A-Z0-9]+$/i.test(raw);
        if (!raw || isRouteCode) {
            hideRouteSearchSuggestions();
            return;
        }
        const normalized = normalizeTab4StationSearchText(raw);
        if (!normalized) {
            hideRouteSearchSuggestions();
            return;
        }
        const index = await ensureTab4StopSearchIndexLoaded();
        if (raw !== input.value.trim() || !window.routeSearchFloatingOpen) return;
        const candidates = (index || [])
            .filter(item => item && String(item.n || '').includes(normalized))
            .map(item => {
                const name = String(item.d || item.n || '').trim();
                const normalizedName = String(item.n || '');
                const at = normalizedName.indexOf(normalized);
                const routeCount = Array.isArray(item.r) ? item.r.length : 0;
                return { name, routeCount, score: (at === 0 ? 0 : 100 + at) + Math.min(99, Math.max(0, name.length - raw.length)) };
            })
            .filter(item => item.name)
            .sort((a, b) => a.score - b.score || b.routeCount - a.routeCount || a.name.localeCompare(b.name, 'zh-HK'))
            .slice(0, 6);
        if (!candidates.length) {
            hideRouteSearchSuggestions();
            return;
        }
        box.innerHTML = candidates.map(item => {
            const encoded = encodeURIComponent(item.name).replace(/'/g, '%27');
            return `<button type="button" class="route-search-suggestion" onpointerdown="event.preventDefault();event.stopPropagation()" onclick="selectRouteSearchSuggestion('${encoded}')"><span>📍 ${escapeHtml(item.name)}</span><small>${item.routeCount} 條路線</small></button>`;
        }).join('');
        box.classList.add('visible');
    }

    function scheduleRouteSearchSuggestions() {
        clearTimeout(window.routeSearchSuggestionTimer);
        window.routeSearchSuggestionTimer = setTimeout(() => updateRouteSearchSuggestions().catch(err => console.warn('Route search suggestions failed', err)), 120);
    }

    function initFloatingRouteSearch() {
        const fab = document.getElementById('route-search-fab');
        if (!fab || fab.dataset.ready === '1') return;
        fab.dataset.ready = '1';
        let drag = null;
        const saveFabPosition = () => {
            const rect = fab.getBoundingClientRect();
            try { localStorage.setItem('psk_route_search_fab_v1', JSON.stringify({ x: rect.left, y: rect.top })); } catch (e) {}
        };
        const placeFab = (x, y) => {
            const rect = fab.getBoundingClientRect();
            const w = rect.width || 58;
            const h = rect.height || 58;
            const maxX = Math.max(8, window.innerWidth - w - 8);
            const maxY = Math.max(8, window.innerHeight - h - 78);
            fab.style.left = `${Math.max(8, Math.min(maxX, x))}px`;
            fab.style.top = `${Math.max(8, Math.min(maxY, y))}px`;
            fab.style.right = 'auto';
            fab.style.bottom = 'auto';
        };
        try {
            const saved = JSON.parse(localStorage.getItem('psk_route_search_fab_v1') || 'null');
            if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) requestAnimationFrame(() => placeFab(saved.x, saved.y));
        } catch (e) {}
        fab.addEventListener('pointerdown', event => {
            if (event.button !== undefined && event.button !== 0) return;
            const rect = fab.getBoundingClientRect();
            drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, x: rect.left, y: rect.top, moved: false };
            window.routeSearchBubbleDragging = false;
            try { fab.setPointerCapture(event.pointerId); } catch (e) {}
        });
        fab.addEventListener('pointermove', event => {
            if (!drag || drag.id !== event.pointerId) return;
            const dx = event.clientX - drag.startX;
            const dy = event.clientY - drag.startY;
            if (Math.hypot(dx, dy) > 6) drag.moved = true;
            if (!drag.moved) return;
            window.routeSearchBubbleDragging = true;
            placeFab(drag.x + dx, drag.y + dy);
        });
        const finish = event => {
            if (!drag || (event && drag.id !== event.pointerId)) return;
            const moved = drag.moved;
            try { fab.releasePointerCapture(drag.id); } catch (e) {}
            drag = null;
            if (moved) saveFabPosition();
            else openFloatingRouteSearch();
            setTimeout(() => { window.routeSearchBubbleDragging = false; }, 0);
        };
        fab.addEventListener('pointerup', finish);
        fab.addEventListener('pointercancel', () => { drag = null; window.routeSearchBubbleDragging = false; });
        fab.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openFloatingRouteSearch();
            }
        });
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', syncNativeKeyboardOffset);
            window.visualViewport.addEventListener('scroll', syncNativeKeyboardOffset);
        }
        window.addEventListener('resize', () => {
            if (fab.style.left) {
                const rect = fab.getBoundingClientRect();
                placeFab(rect.left, rect.top);
            }
            syncNativeKeyboardOffset();
            syncCustomRouteSearchPosition();
        });
    }

    // Search closes when tapping elsewhere. A full-screen backdrop owns outside taps so
    // the touch/click can never fall through into a route row underneath.
    document.addEventListener('pointerdown', event => {
        if (!window.routeSearchFloatingOpen) return;
        const panel = document.getElementById('route-search-panel');
        const keyboard = document.getElementById('route-keyboard');
        const fab = document.getElementById('route-search-fab');
        const backdrop = document.getElementById('route-search-backdrop');
        if ((panel && panel.contains(event.target)) || (keyboard && keyboard.contains(event.target)) || event.target === fab || event.target === backdrop) return;
        event.preventDefault();
        event.stopPropagation();
        collapseFloatingRouteSearch();
    }, true);

    function setRouteKeyboardSearchValue(value) {
        const input = document.getElementById('route-search-input');
        if (!input) return;
        input.value = String(value || '').toUpperCase();
        onTab4Search();
        setTimeout(routeKeyboardSync, 0);
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
        window.tab4SourceStatus = { kmb: false, ctb: false, nlb: false, gmb: false };
        window.gmbDirectionsLoadedKeys = {};

        try {
            const [kmbResult, ctbResult, nlbResult, gmbResult] = await Promise.allSettled([
                fetchJsonCached('https://data.etabus.gov.hk/v1/transport/kmb/route/', { ttl: 3600000, timeout: 12000 }),
                fetchJsonCached('https://rt.data.gov.hk/v2/transport/citybus/route/CTB', { ttl: 3600000, timeout: 12000 }),
                loadNlbRoutesForTab4(),
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

            if (nlbResult.status === 'fulfilled' && Number(nlbResult.value) > 0) {
                window.tab4SourceStatus.nlb = true;
                loadedAnySource = true;
            } else {
                console.warn('NLB route list failed', nlbResult.reason || nlbResult.value);
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
            const [kmbResult, ctbResult, nlbResult, gmbResult] = await Promise.allSettled([
                fetchJsonCached('https://data.etabus.gov.hk/v1/transport/kmb/route/', { ttl: 3600000, timeout: 12000 }),
                // Citybus V1/V1.1 已停止支援；使用 V2 endpoint，避免整個巴士查詢因城巴 API 失敗而中斷。
                fetchJsonCached('https://rt.data.gov.hk/v2/transport/citybus/route/CTB', { ttl: 3600000, timeout: 12000 }),
                loadNlbRoutesForTab4(),
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

            if (nlbResult.status === 'fulfilled' && Number(nlbResult.value) > 0) {
                window.tab4SourceStatus.nlb = true;
                loadedAnySource = true;
            } else {
                console.warn('NLB route list failed', nlbResult.reason || nlbResult.value);
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
            const errorHtml = '<span class="error" style="padding:20px; display:block;">載入失敗：暫時無法連接九巴、城巴、大嶼山巴士及專線小巴開放數據。請稍後重試。</span>';
            if (target) target.innerHTML = errorHtml;
            else container.innerHTML = `<div class="route-list-wrapper" id="tab4-routes-append-target">${errorHtml}</div>`;
            container.style.display = 'block';
        } finally {
            setTab4Loading(false);
        }
    }


    function syncTab4SearchClearButton() {
        const input = document.getElementById('route-search-input');
        const clearButton = document.getElementById('route-search-clear');
        if (!clearButton) return;
        const hasValue = Boolean(input && input.value);
        clearButton.classList.toggle('visible', hasValue);
        clearButton.setAttribute('aria-hidden', hasValue ? 'false' : 'true');
        clearButton.tabIndex = hasValue ? 0 : -1;
    }

    function clearTab4Search() {
        const input = document.getElementById('route-search-input');
        if (!input) return;
        window.routeKeyboardForceTextInput = false;
        window.routeSearchNativeMode = false;
        document.body.classList.remove('route-search-native');
        input.setAttribute('inputmode', 'none');
        input.value = '';
        onTab4Search();
        hideRouteSearchSuggestions();
        if (window.routeSearchFloatingOpen) showRouteKeyboard();
    }

    function onTab4Search() {
        window.tab4SearchText = document.getElementById('route-search-input').value.trim().toUpperCase();
        syncTab4SearchClearButton();
        routeKeyboardSync();
        scheduleRouteSearchSuggestions();
        clearTimeout(window.tab4SearchTimeout);
        window.tab4SearchTimeout = setTimeout(() => updateTab4View(), 140);
    }


    function normalizeTab4StationSearchText(value) {
        return String(value || '')
            .toUpperCase()
            .replace(/<BR\s*\/?\s*>/gi, '|')
            .replace(/\[[^\]]+\]/g, ' ')
            .replace(/[，,。．·・:：;；()（）\[\]【】{}「」『』<>《》\-—–_\/\\|]/g, ' ')
            .replace(/\s+/g, '')
            .trim();
    }

    async function ensureTab4StopSearchIndexLoaded() {
        if (Array.isArray(window.tab4StopSearchIndex)) return window.tab4StopSearchIndex;
        if (window.tab4StopSearchIndexLoading) return window.tab4StopSearchIndexLoading;

        const status = document.getElementById('tab4-source-status');
        if (status) status.innerText = '載入中途站索引…';
        setTab4Loading(true);
        const dayKey = getHongKongServiceDayKey(6);
        window.tab4StopSearchIndexLoading = fetch(`./data/stop-search-index.json?day=${encodeURIComponent(dayKey)}`, { cache: 'default' })
            .then(async res => {
                if (!res.ok) throw new Error(`stop-search-index HTTP ${res.status}`);
                const data = parseJsonTextSafely(await res.text());
                window.tab4StopSearchIndex = Array.isArray(data && data.stations) ? data.stations : [];
                window.tab4StopSearchQueryCache.clear();
                return window.tab4StopSearchIndex;
            })
            .catch(error => {
                console.warn('Intermediate-stop search index unavailable', error);
                window.tab4StopSearchIndex = [];
                return [];
            })
            .finally(() => {
                window.tab4StopSearchIndexLoading = null;
                setTab4Loading(false);
                updateTab4SourceStatus();
            });
        return window.tab4StopSearchIndexLoading;
    }

    function getTab4IntermediateStopMatch(query) {
        const normalized = normalizeTab4StationSearchText(query);
        if (!normalized || !Array.isArray(window.tab4StopSearchIndex)) {
            return { tokens: new Set(), gmbCodes: new Set(), matchedStations: 0 };
        }
        const cached = window.tab4StopSearchQueryCache.get(normalized);
        if (cached) return cached;

        const tokens = new Set();
        const gmbCodes = new Set();
        let matchedStations = 0;
        window.tab4StopSearchIndex.forEach(item => {
            if (!item || !String(item.n || '').includes(normalized) || !Array.isArray(item.r)) return;
            matchedStations++;
            item.r.forEach(rawToken => {
                const token = String(rawToken || '').toUpperCase();
                if (!token) return;
                tokens.add(token);
                const parts = token.split(':');
                if (parts[0] === 'GMB' && parts[1]) gmbCodes.add(parts[1]);
            });
        });
        const result = { tokens, gmbCodes, matchedStations };
        window.tab4StopSearchQueryCache.set(normalized, result);
        return result;
    }

    function tab4DirMatchesIntermediateStop(dir, match) {
        if (!dir || !match || !match.tokens || match.tokens.size === 0) return false;
        const routeCode = String(dir.route || dir.displayRoute || '').toUpperCase();
        if (!routeCode) return false;
        if (dir.isGmb) {
            if (!match.gmbCodes.has(routeCode)) return false;
            const routeId = String(dir.routeId || '').toUpperCase();
            // GTFS GMB route_id 與專線小巴 API route_id 對應；有 route_id 時用精確比對，
            // 避免同一小巴號碼在港島／九龍／新界重覆而誤中。
            if (routeId) return match.tokens.has(`GMB:${routeCode}:${routeId}`);
            return true;
        }
        if (dir.isNlb) return match.tokens.has(`NLB:${routeCode}`);
        if (dir.isCitybus) return match.tokens.has(`CTB:${routeCode}`);
        return match.tokens.has(`KMB:${routeCode}`);
    }

    async function enrichGmbStationSearchCandidates(match) {
        if (!match || match.gmbCodes.size === 0) return;
        if (window.tab4OperatorFilter !== 'GMB' && window.tab4OperatorFilter !== 'ALL') return;
        const candidateKeys = Object.keys(window.allRoutesGroupsTab4 || {}).filter(key => {
            const dirs = window.allRoutesGroupsTab4[key] || [];
            return dirs.some(d => d.isGmb && match.gmbCodes.has(String(d.route || d.displayRoute || '').toUpperCase()));
        });
        if (candidateKeys.length) await ensureGmbDirectionsLoadedForKeys(candidateKeys);
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

    function getTab4VisibleRouteKeys(groupKeys, margin = 180) {
        const keys = Array.from(new Set(groupKeys || []));
        const root = document.getElementById('tab-4');
        if (!root || keys.length === 0) return [];
        const rootRect = root.getBoundingClientRect();
        const top = rootRect.top - margin;
        const bottom = rootRect.bottom + margin;
        const visible = keys.filter(key => {
            const row = document.getElementById(makeTab4RowId(key));
            if (!row) return false;
            const rect = row.getBoundingClientRect();
            return rect.bottom >= top && rect.top <= bottom;
        });
        // On the first paint some browsers report a zero-height scrolling root.
        // Checking the first few rows is still better than waiting for an observer callback.
        return visible.length ? visible : keys.slice(0, Math.min(4, keys.length));
    }

    function scheduleTab4EtaChecks(groupKeys) {
        // Check rows already on screen immediately. Off-screen rows stay lazy so
        // Citybus does not need to scan every stop of twenty routes at once.
        const keys = Array.from(new Set(groupKeys || []));
        if (!keys.length) return;
        const immediateKeys = getTab4VisibleRouteKeys(keys, 220);
        fetchAndApplyEtaStatusForTab4Keys(immediateKeys, true);

        const immediateSet = new Set(immediateKeys);
        const remaining = keys.filter(key => !immediateSet.has(key));
        const observer = getTab4EtaObserver();
        if (!observer || !remaining.length) return;
        requestAnimationFrame(() => {
            remaining.forEach(key => {
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
        const isRouteCodeQuery = Boolean(q && /^[A-Z0-9]+$/.test(q));
        let intermediateMatch = { tokens: new Set(), gmbCodes: new Set(), matchedStations: 0 };

        if (q && !isRouteCodeQuery) {
            await ensureTab4StopSearchIndexLoaded();
            // 使用者可能在索引下載期間已經改咗搜尋字；舊查詢唔應覆蓋新結果。
            if (q !== window.tab4SearchText) return;
            intermediateMatch = getTab4IntermediateStopMatch(q);
            await enrichGmbStationSearchCandidates(intermediateMatch);
            if (q !== window.tab4SearchText) return;
            routeNames = Object.keys(window.allRoutesGroupsTab4);
        }

        routeNames = routeNames.filter(r => {
            const dirs = getTab4DirsByOperator(window.allRoutesGroupsTab4[r]);
            if (dirs.length === 0) return false;
            if (!q) return true;
            const displayName = getRouteDisplayNameForTab4(r).toUpperCase();
            if (isRouteCodeQuery) {
                // 車號鍵盤輸入採用逐字前綴匹配：第 1 個字對第 1 個字，第 2 個字對第 2 個字，如此類推。
                return r.toUpperCase().startsWith(q) || displayName.startsWith(q);
            }
            const directTextMatch = r.toUpperCase().includes(q) || displayName.includes(q) || dirs.some(d =>
                (d.orig_tc && d.orig_tc.includes(q)) ||
                (d.dest_tc && d.dest_tc.includes(q)) ||
                (d.operatorName && d.operatorName.includes(q))
            );
            const intermediateStopMatch = dirs.some(d => tab4DirMatchesIntermediateStop(d, intermediateMatch));
            return directTextMatch || intermediateStopMatch;
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
            return !window.gmbDirectionsLoadedKeys[key] && dirs.some(d => d.isGmb);
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

    async function nlbDirectionHasEtaTab4(item) {
        const dir = item.dir || {};
        if (!dir.nlbRouteId) return false;
        const stops = await getNlbRouteStopsForDetail(dir.nlbRouteId);
        if (!stops || stops.length === 0) return false;
        const probeStops = stops.length <= 6 ? stops : [stops[0], ...stops.slice(1, 3), ...stops.slice(-3)];
        const results = await Promise.allSettled(probeStops.map(s => fetchNlbEtaForStop(dir.nlbRouteId, s.stop)));
        return results.some(result => result.status === 'fulfilled' && result.value && result.value.length > 0);
    }

    async function fetchAndApplyNlbEtaTab4(items) {
        if (!items || items.length === 0) return;
        const chunkSize = 4;
        for (let i = 0; i < items.length; i += chunkSize) {
            const chunk = items.slice(i, i + chunkSize);
            const results = await Promise.allSettled(chunk.map(async item => ({ ...item, hasEta: await nlbDirectionHasEtaTab4(item) })));
            results.forEach(result => {
                if (result.status === 'fulfilled') setTab4DirEtaStatus(result.value.statusKey, result.value.hasEta);
            });
        }
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

    function fetchAndApplyEtaStatusForTab4Keys(groupKeys, force = false) {
        const kmbRoutes = new Set();
        const ctbItems = [];
        const nlbItems = [];
        const gmbItems = [];

        (groupKeys || []).forEach(rName => {
            const dirs = window.tab4FilteredGroups[rName] || getTab4DirsByOperator(window.allRoutesGroupsTab4[rName]);
            (dirs || []).forEach(dir => {
                const statusKey = makeTab4DirStatusKey(rName, dir);
                if (!force && isTab4DirEtaStatusFresh(statusKey, 15000)) return;

                if (dir.isGmb) {
                    // GMB has no cheap route-level ETA endpoint. Do not probe every
                    // stop from the directory; it delays the route the user actually opens.
                    return;
                } else if (dir.isNlb) {
                    nlbItems.push({ rName, dir, statusKey });
                } else if (dir.isCitybus) {
                    ctbItems.push({ rName, dir, statusKey });
                } else {
                    kmbRoutes.add(dir.route || rName);
                }
            });
        });

        const jobs = [];
        if (kmbRoutes.size) jobs.push(fetchAndApplyEtaTab4([...kmbRoutes]));
        if (ctbItems.length) jobs.push(fetchAndApplyCitybusEtaTab4(ctbItems));
        if (nlbItems.length) jobs.push(fetchAndApplyNlbEtaTab4(nlbItems));
        return Promise.allSettled(jobs);
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
                    if (d.isCitybus || d.isNlb || window.routeEtaStatusTab3[`${rName}-${boundCode}`]) hasAnyEta = true;
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

        if (dir.isNlb) {
            return `NLB-${routeCode}-${String(dir.nlbRouteId || 'NOID')}`;
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
        el.classList.toggle('no-service', !hasEta);
        el.setAttribute('data-eta-available', hasEta ? '1' : '0');
        el.title = hasEta ? '' : '此方向暫無班次';
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
        if (dirs[0] && dirs[0].isNlb) operatorText = '大嶼山巴士';
        if (dirs[0] && dirs[0].isGmb) operatorText = dirs[0].operatorName || '專線小巴';
        if (!(dirs[0] && dirs[0].isGmb) && ['112','116','118','102','104','111','115','115P','117','171','601','603','619','671','680','681','690','904','905','907D','914','930','948','962','969'].includes(displayRouteName)) operatorText = '城巴+九巴';

        // Route number colour follows the operator identity. KMB (including
        // joint KMB/Citybus routes) is red; LWB remains orange, Citybus yellow,
        // and GMB green.
        let badgeColor = operatorText.includes('九巴') ? 'var(--kmb-red)' : 'var(--text-main)';
        if (operatorText.includes('龍運')) badgeColor = '#E67E22';
        if (operatorText === '城巴') badgeColor = '#F1C40F';
        if (operatorText === '大嶼山巴士') badgeColor = 'var(--nlb-green)';
        if (operatorText.includes('小巴')) badgeColor = 'var(--gmb-green)';

        function makeDirBlock(dir) {
            if(!dir) return `<div class="route-dir-empty"></div>`;
            const boundStr = dir.bound === 'O' ? 'outbound' : 'inbound';
            const boundCode = dir.bound === 'O' ? 'O' : 'I';
            
            let noServiceClass = '';
            let noServiceTitle = '';
            if (!isRowInactive) {
                let hasEta = true;
                if (isTab3) {
                    if (!dir.isCitybus && !dir.isGmb && !dir.isNlb) {
                        hasEta = window.routeEtaStatusTab3[`${rName}-${boundCode}`];
                        if (!hasEta) {
                            noServiceClass = ' no-service';
                            noServiceTitle = ' title="此方向暫無班次"';
                        }
                    }
                } else {
                    const statusKey = makeTab4DirStatusKey(rName, dir);
                    hasEta = window.routeEtaStatusTab4[statusKey];
                    if (hasEta === false) {
                        noServiceClass = ' no-service';
                        noServiceTitle = ' title="此方向暫無班次" data-eta-available="0"';
                    } else if (hasEta === true) {
                        noServiceTitle = ' data-eta-available="1"';
                    }
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
            const nlbRouteIdArg = escapeJsArg(dir.nlbRouteId || '');
            const nlbPairKeyArg = escapeJsArg(dir.nlbPairKey || '');
            const isGmbPlaceholder = !!(dir.isGmb && dir.gmbPlaceholder);
            const directionPrefixHtml = isGmbPlaceholder ? '' : '<span class="dir-prefix">往</span>';
            const clickAttr = isGmbPlaceholder ? '' : `onclick="showRouteStops('${routeArg}', '${boundStr}', '${destArg}', ${dir.isCitybus || false}, '${badgeArg}', ${isTab3}, ${dir.isGmb || false}, '${regionArg}', '${routeIdArg}', '${routeSeqArg}', false, ${dir.isNlb || false}, '${nlbRouteIdArg}', '${nlbPairKeyArg}')"`;
            const placeholderClass = isGmbPlaceholder ? ' route-dir-loading' : '';

            return `
            <div ${blockId} class="route-dir-block${placeholderClass}${noServiceClass}"${noServiceTitle} ${clickAttr}>
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
        if (!!dir.isNlb !== !!ctx.isNlb) return false;
        if (!!dir.isCitybus !== !!ctx.isCitybus) return false;
        const dirRoute = String(dir.route || dir.displayRoute || '').toUpperCase();
        const ctxRoute = String(ctx.route || '').toUpperCase();
        if (dirRoute && ctxRoute && dirRoute !== ctxRoute) return false;
        if (ctx.isGmb && ctx.gmbRegion && dir.gmbRegion && String(dir.gmbRegion) !== String(ctx.gmbRegion)) return false;
        if (ctx.isNlb && ctx.nlbPairKey && dir.nlbPairKey && String(dir.nlbPairKey) !== String(ctx.nlbPairKey)) return false;
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
        if (ctx.isNlb && ctx.nlbPairKey) candidateKeys.push(ctx.nlbPairKey);
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
        const destEl = document.getElementById('tab4-detail-opposite-dest');
        if (!btn) return;
        window.tab4DetailContext = ctx || null;
        const opposite = getTab4OppositeDirection(ctx);
        if (!opposite) {
            btn.style.display = 'none';
            if (destEl) destEl.textContent = '另一方向';
            btn.title = '未有另一方向資料';
            return;
        }
        const dest = String(opposite.dest_tc || '').trim();
        if (destEl) destEl.textContent = dest ? `往 ${dest}` : '另一方向';
        btn.title = dest ? `即時查看對面線：往${dest}` : '即時查看另一方向';
        btn.style.display = 'flex';
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
            true,
            !!opposite.isNlb,
            opposite.nlbRouteId || '',
            opposite.nlbPairKey || ''
        );
    }

    // ==========================================
    // 共用：路線詳情與實時 ETA
    // ==========================================
    function renderRouteDetailStopsView({
        container, stops, etaMap, etaLoading, route, bound, dest, isCitybus, isGmb, isNlb,
        gmbRegion, gmbRouteId, gmbRouteSeq, nlbRouteId, nlbPairKey, routeStopCount, badgeColor, isTab3, fareMap
    }) {
        const processedStops = (stops || []).map(s => {
            const stopEtas = (etaMap && etaMap[String(s.seq)]) || [];
            const sortedEtas = [...stopEtas].sort((a, b) => new Date(a) - new Date(b)).slice(0, 3);
            return { ...s, sortedEtas };
        });

        if (processedStops.length === 0) {
            container.innerHTML = '<div class="status-msg error" style="padding:30px;">未能取得車站資料。</div>';
            return { activeCount: 0 };
        }

        const shouldShowFare = true;
        const renderStopFare = s => shouldShowFare
            ? `<div class="route-stop-fare" data-stop-fare-seq="${escapeHtml(String(s.seq || ''))}">${formatFareAmount(fareMap && fareMap[String(s.seq)])}</div>`
            : '';

        const renderFavoriteButton = (s, stopName) => {
            if (isTab3) return '';
            return renderStopFavoriteButton(makeFavoriteStopPayload({
                route,
                routeDisplay: route,
                bound,
                dest,
                isCitybus,
                isGmb,
                isNlb,
                nlbRouteId,
                nlbPairKey,
                routeStopCount,
                gmbRegion,
                gmbRouteId,
                gmbRouteSeq,
                seq: s.seq,
                stopId: s.stop,
                stopName,
                badgeColor,
                fare: fareMap && fareMap[String(s.seq)]
            }));
        };

        let html = '<div style="background:var(--bg-color);min-height:100%;padding-bottom:20px;">';

        if (etaLoading) {
            html += '<div class="detail-eta-loading">車站已載入 · ETA 更新中 0%</div>';
            html += '<div style="background:var(--card-bg);border-top:1px solid var(--separator);">';
            processedStops.forEach(s => {
                const stopName = s.name_tc || window.globalStopsMap[s.stop] || s.stop;
                const isTargetStation = isTab3 && targetKeywords.some(kw => String(stopName).includes(kw));
                const badge = isTargetStation ? '<span style="font-size:0.75rem;background:#34C759;color:white;padding:2px 8px;border-radius:6px;margin-left:8px;vertical-align:middle;font-weight:600;">目標車站</span>' : '';
                const bgStyle = isTargetStation ? 'background:rgba(52,199,89,0.05);border-left:4px solid #34C759;' : 'background:var(--card-bg);border-left:4px solid transparent;';
                const favoriteBtn = renderFavoriteButton(s, stopName);
                html += `
                <div style="padding:14px 16px 14px 12px;border-bottom:1px solid var(--separator);${bgStyle}">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                        <div style="flex:1;min-width:0;padding-right:8px;font-size:1rem;font-weight:700;color:var(--text-main);line-height:1.3;">
                            <span style="display:inline-block;width:24px;font-size:0.85rem;font-weight:600;color:var(--text-sub);">${escapeHtml(s.seq)}.</span>
                            ${escapeHtml(stopName)} ${badge}
                            ${renderStopFare(s)}
                        </div>
                        <div style="display:flex;align-items:center;white-space:nowrap;margin-left:auto;">
                            <span class="detail-eta-pending">更新中 0%</span>${favoriteBtn}
                        </div>
                    </div>
                </div>`;
            });
            html += '</div></div>';
            container.innerHTML = html;
            refreshFavoriteButtonStates();
            return { activeCount: 0 };
        }

        // Keep the official stop sequence intact.  A stop with no current ETA is
        // no longer moved to a separate "suspended / no departures" section;
        // it stays in place and is dimmed directly in the route list.
        let activeCount = 0;
        html += '<div style="background:var(--card-bg);border-top:1px solid var(--separator);box-shadow:0 4px 12px rgba(0,0,0,0.04);">';
        processedStops.forEach(s => {
            const stopName = s.name_tc || window.globalStopsMap[s.stop] || s.stop;
            const hasEta = s.sortedEtas.length > 0;
            if (hasEta) activeCount++;

            const isTargetStation = isTab3 && targetKeywords.some(kw => String(stopName).includes(kw));
            const badge = isTargetStation ? '<span style="font-size:0.75rem;background:#34C759;color:white;padding:2px 8px;border-radius:6px;margin-left:8px;vertical-align:middle;font-weight:600;">目標車站</span>' : '';
            const rowBg = isTargetStation ? 'background:rgba(52,199,89,0.05);border-left:4px solid #34C759;' : 'background:var(--card-bg);border-left:4px solid transparent;';
            const inactiveStyle = '';
            const nameColor = 'var(--text-main)';
            const etaHtml = hasEta
                ? generateEtaHtml(s.sortedEtas)
                : '<span style="font-size:0.82rem;color:var(--text-sub);font-weight:600;">暫無班次</span>';
            const favoriteBtn = renderFavoriteButton(s, stopName);

            html += `
            <div style="padding:16px 16px 16px 12px;border-bottom:1px solid var(--separator);${rowBg}${inactiveStyle}display:flex;flex-direction:column;justify-content:center;transition:opacity 0.25s,filter 0.25s;">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                    <div style="flex:1;min-width:0;padding-right:12px;font-size:1.05rem;font-weight:700;color:${nameColor};line-height:1.3;">
                        <span style="display:inline-block;width:24px;font-size:0.85rem;font-weight:600;color:var(--text-sub);text-align:left;">${escapeHtml(s.seq)}.</span>
                        ${escapeHtml(stopName)} ${badge}
                        ${renderStopFare(s)}
                    </div>
                    <div style="display:flex;align-items:center;white-space:nowrap;margin-left:auto;">${etaHtml}${favoriteBtn}</div>
                </div>
            </div>`;
        });
        html += '</div>';

        html += '</div>';
        container.innerHTML = html;
        refreshFavoriteButtonStates();
        return { activeCount };
    }

    function updateRouteDetailEtaProgress(container, completed, total) {
        if (!container || !total) return;
        const percent = Math.max(0, Math.min(100, Math.round((completed / total) * 100)));
        const heading = container.querySelector('.detail-eta-loading');
        if (heading) heading.textContent = `車站已載入 · ETA 更新中 ${percent}%`;
        container.querySelectorAll('.detail-eta-pending').forEach(el => {
            el.textContent = `更新中 ${percent}%`;
        });
    }

    async function showRouteStops(route, bound, dest, isCitybus, badgeColor, isTab3, isGmb = false, gmbRegion = '', gmbRouteId = '', gmbRouteSeq = '', keepTab4ListScroll = false, isNlb = false, nlbRouteId = '', nlbPairKey = '') {
        if (!isTab3) collapseFloatingRouteSearch();
        const prefix = isTab3 ? 'tab3-' : 'tab4-';
        const requestSeq = (window.routeDetailRequestSeq = (window.routeDetailRequestSeq || 0) + 1);
        const isCurrentRequest = () => window.routeDetailRequestSeq === requestSeq;
        let resolvedDestForFavorites = dest;
        let resolvedGmbRegionForFavorites = gmbRegion;
        let resolvedGmbRouteIdForFavorites = gmbRouteId;
        let resolvedGmbRouteSeqForFavorites = gmbRouteSeq;
        let resolvedNlbRouteIdForFavorites = nlbRouteId;
        let resolvedNlbPairKeyForFavorites = nlbPairKey;
        const tab4ScrollEl = !isTab3 ? document.getElementById('tab-4') : null;
        const tab4ListView = !isTab3 ? document.getElementById('tab4-route-list-view') : null;
        if (!isTab3 && !keepTab4ListScroll && tab4ScrollEl && tab4ListView && tab4ListView.style.display !== 'none') {
            window.tab4ListScrollTop = tab4ScrollEl.scrollTop;
        }
        if (!isTab3) {
            updateTab4OppositeDirectionButton({ route, bound, dest, isCitybus: !!isCitybus, isGmb: !!isGmb, isNlb: !!isNlb, gmbRegion, gmbRouteId, gmbRouteSeq, nlbRouteId, nlbPairKey, badgeColor });
        }

        document.getElementById(`${prefix}route-list-view`).style.display = 'none';
        document.getElementById(`${prefix}route-detail-view`).style.display = 'block';
        if (tab4ScrollEl) tab4ScrollEl.scrollTop = 0;

        const numEl = document.getElementById(`${prefix}detail-route-num`);
        numEl.innerText = route;
        numEl.style.color = badgeColor || 'var(--text-main)';
        const initialDestLabel = isGmb && /^(載入站名|方向\s*\d+)/.test(String(dest || '')) ? '載入站名…' : `往 ${dest}`;
        document.getElementById(`${prefix}detail-route-dest`).innerText = initialDestLabel;

        const container = document.getElementById(`${prefix}detail-stops-container`);
        container.innerHTML = '';
        toggleSkeleton(`${prefix}detail-stops-skeleton`, true);

        try {
            let stops = [];
            const etaMap = {};
            let fareMap = {};
            let detailEtaStatusKey = '';
            const boundCode = bound === 'outbound' ? 'O' : 'I';
            let gmbDetail = null;

            // Phase 1: only load static stop data. Do not wait for live ETA before
            // showing the route. This is the key fast-path for cached routes.
            if (isGmb) {
                gmbDetail = await resolveGmbDirectionForDetail(route, gmbRegion, gmbRouteId, gmbRouteSeq, bound);
                resolvedGmbRegionForFavorites = gmbDetail.region || gmbRegion;
                resolvedGmbRouteIdForFavorites = gmbDetail.routeId;
                resolvedGmbRouteSeqForFavorites = gmbDetail.routeSeq;
                if (gmbDetail.dest_tc) resolvedDestForFavorites = gmbDetail.dest_tc;
                if (!isTab3) {
                    updateTab4OppositeDirectionButton({ route, bound, dest: resolvedDestForFavorites, isCitybus: !!isCitybus, isGmb: true, gmbRegion: resolvedGmbRegionForFavorites, gmbRouteId: gmbDetail.routeId, gmbRouteSeq: gmbDetail.routeSeq, badgeColor });
                }
                detailEtaStatusKey = makeTab4DirStatusKey('', { route, bound: boundCode, isGmb: true, gmbRegion: resolvedGmbRegionForFavorites, routeId: gmbDetail.routeId, routeSeq: gmbDetail.routeSeq });
                if (gmbDetail.dest_tc) document.getElementById(`${prefix}detail-route-dest`).innerText = `往 ${gmbDetail.dest_tc}`;
                stops = await getGmbRouteStopsForDetail(gmbDetail.routeId, gmbDetail.routeSeq);
            } else if (isNlb) {
                detailEtaStatusKey = makeTab4DirStatusKey('', { route, bound: boundCode, isNlb: true, nlbRouteId: resolvedNlbRouteIdForFavorites });
                stops = await getNlbRouteStopsForDetail(resolvedNlbRouteIdForFavorites);
                fareMap = getNlbFareMapFromStops(stops);
            } else if (isCitybus) {
                detailEtaStatusKey = makeTab4DirStatusKey('', { route, bound: boundCode, isCitybus: true });
                stops = await getRouteStopsCached(route, bound === 'outbound' ? 'outbound' : 'inbound', true);
            } else {
                detailEtaStatusKey = makeTab4DirStatusKey('', { route, bound: boundCode });
                stops = await getRouteStopsCached(route, bound, false);
            }

            if (!isCurrentRequest()) return;

            // Keep the timetable context aligned with the direction that was actually
            // resolved (especially GMB route_id/route_seq) and include the official
            // stop count as an extra guard against O/I vs GTFS bound mismatches.
            if (!isTab3) {
                updateTab4OppositeDirectionButton({
                    route, bound, dest: resolvedDestForFavorites, isCitybus: !!isCitybus, isGmb: !!isGmb, isNlb: !!isNlb,
                    gmbRegion: resolvedGmbRegionForFavorites, gmbRouteId: resolvedGmbRouteIdForFavorites,
                    gmbRouteSeq: resolvedGmbRouteSeqForFavorites, nlbRouteId: resolvedNlbRouteIdForFavorites,
                    nlbPairKey: resolvedNlbPairKeyForFavorites, badgeColor, stopCount: stops.length
                });
            }

            // Fare lookup is static and independent of ETA. Start it immediately,
            // but do not block the stop list. When ready, update the fare labels in-place.
            if (!isNlb || Object.keys(fareMap).length === 0) {
                getRouteFareMap({
                    route,
                    bound,
                    dest: resolvedDestForFavorites,
                    isCitybus: !!isCitybus,
                    isGmb: !!isGmb,
                    isNlb: !!isNlb,
                    gmbRouteId: resolvedGmbRouteIdForFavorites,
                    gmbRouteSeq: resolvedGmbRouteSeqForFavorites,
                    stopCount: stops.length
                }).then(map => {
                    fareMap = map || {};
                    if (isCurrentRequest()) updateStopFareLabels(container, fareMap);
                    return fareMap;
                }).catch(err => {
                    console.warn('Route fare load failed', err);
                    return {};
                });
            }

            toggleSkeleton(`${prefix}detail-stops-skeleton`, false);
            renderRouteDetailStopsView({
                container, stops, etaMap, etaLoading: true, route, bound,
                dest: resolvedDestForFavorites, isCitybus, isGmb, isNlb,
                gmbRegion: resolvedGmbRegionForFavorites,
                gmbRouteId: resolvedGmbRouteIdForFavorites,
                gmbRouteSeq: resolvedGmbRouteSeqForFavorites,
                nlbRouteId: resolvedNlbRouteIdForFavorites,
                nlbPairKey: resolvedNlbPairKeyForFavorites,
                routeStopCount: stops.length,
                badgeColor, isTab3, fareMap
            });

            // Phase 2: fetch live ETA in the background. GMB/Citybus are capped to
            // six concurrent stop requests so opening a route does not flood the API.
            let etaCompleted = 0;
            const etaTotal = (isGmb || isCitybus || isNlb) ? Math.max(1, stops.length) : 1;
            updateRouteDetailEtaProgress(container, 0, etaTotal);
            if (isGmb && gmbDetail) {
                await mapWithConcurrency(stops, 6, async s => {
                    try {
                        const etaList = await fetchGmbEtaForStop(gmbDetail.routeId, gmbDetail.routeSeq, s.seq);
                        if (etaList.length) etaMap[String(s.seq)] = etaList;
                    } catch (err) {
                    } finally {
                        etaCompleted += 1;
                        if (isCurrentRequest()) updateRouteDetailEtaProgress(container, etaCompleted, etaTotal);
                    }
                });
            } else if (isNlb) {
                await mapWithConcurrency(stops, 6, async s => {
                    try {
                        const etaList = await fetchNlbEtaForStop(resolvedNlbRouteIdForFavorites, s.stop);
                        if (etaList.length) etaMap[String(s.seq)] = etaList;
                    } catch (err) {
                    } finally {
                        etaCompleted += 1;
                        if (isCurrentRequest()) updateRouteDetailEtaProgress(container, etaCompleted, etaTotal);
                    }
                });
            } else if (isCitybus) {
                await mapWithConcurrency(stops, 6, async s => {
                    try {
                        const etaObj = await fetchJsonCached(`https://rt.data.gov.hk/v2/transport/citybus/eta/CTB/${s.stop}/${route}`, { ttl: 12000, timeout: 5000 });
                        if (etaObj && etaObj.data) {
                            etaObj.data.forEach(e => {
                                if (e.dir === boundCode && e.eta) {
                                    const seqStr = String(s.seq);
                                    if (!etaMap[seqStr]) etaMap[seqStr] = [];
                                    etaMap[seqStr].push(e.eta);
                                }
                            });
                        }
                    } catch (err) {
                    } finally {
                        etaCompleted += 1;
                        if (isCurrentRequest()) updateRouteDetailEtaProgress(container, etaCompleted, etaTotal);
                    }
                });
            } else {
                const etaObj = await fetchJsonCached(`https://data.etabus.gov.hk/v1/transport/kmb/route-eta/${route}/1`, { ttl: 12000, timeout: 6000 });
                if (etaObj && etaObj.data) {
                    etaObj.data.forEach(e => {
                        if (e.dir === boundCode && e.eta) {
                            const seqStr = String(e.seq);
                            if (!etaMap[seqStr]) etaMap[seqStr] = [];
                            etaMap[seqStr].push(e.eta);
                        }
                    });
                }
                etaCompleted = 1;
                if (isCurrentRequest()) updateRouteDetailEtaProgress(container, etaCompleted, etaTotal);
            }

            if (!isCurrentRequest()) return;
            const result = renderRouteDetailStopsView({
                container, stops, etaMap, etaLoading: false, route, bound,
                dest: resolvedDestForFavorites, isCitybus, isGmb, isNlb,
                gmbRegion: resolvedGmbRegionForFavorites,
                gmbRouteId: resolvedGmbRouteIdForFavorites,
                gmbRouteSeq: resolvedGmbRouteSeqForFavorites,
                nlbRouteId: resolvedNlbRouteIdForFavorites,
                nlbPairKey: resolvedNlbPairKeyForFavorites,
                routeStopCount: stops.length,
                badgeColor, isTab3, fareMap
            });
            if (!isTab3 && detailEtaStatusKey) setTab4DirEtaStatus(detailEtaStatusKey, result.activeCount > 0);
        } catch (e) {
            if (!isCurrentRequest()) return;
            console.error(e);
            toggleSkeleton(`${prefix}detail-stops-skeleton`, false);
            container.innerHTML = '<div class="status-msg error" style="padding:30px;">無法載入車站或預報時間，請重試。</div>';
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

    function preventAppZoomAndSelection() {
        document.addEventListener('dblclick', event => event.preventDefault(), { passive: false });
        ['gesturestart', 'gesturechange', 'gestureend'].forEach(type => {
            document.addEventListener(type, event => event.preventDefault(), { passive: false });
        });
        document.addEventListener('selectstart', event => event.preventDefault(), { passive: false });
        document.addEventListener('dragstart', event => event.preventDefault(), { passive: false });
    }

    preventAppZoomAndSelection();
    initFloatingRouteSearch();
    initTab4NoServiceGrayToggle();
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
            navigator.serviceWorker.register('./sw.js?v=6.7.9', { updateViaCache: 'none' }).catch(err => {
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
