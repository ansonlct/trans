import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import readline from 'node:readline';

const execFileAsync = promisify(execFile);

await mkdir('data', { recursive: true });


async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function getHongKongServiceDayKey(cutoffHour = 6, date = new Date()) {
  const shifted = new Date(date.getTime() + (8 - cutoffHour) * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

const headers = {
  accept: 'application/json',
  'user-agent': 'transportations-github-pages-daily-cache/3.0'
};

async function fetchJson(url, retries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(60000)
      });
      if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
      const data = await response.json();
      if (!data || typeof data !== 'object') throw new Error(`${url} returned an invalid JSON payload`);
      return data;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        const delay = 1000 * attempt;
        console.warn(`Attempt ${attempt} failed for ${url}; retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}


async function fetchBuffer(url, retries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(120000)
      });
      if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        const delay = 1500 * attempt;
        console.warn(`Attempt ${attempt} failed for ${url}; retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

function parseCsvLine(line) {
  const out = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        value += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      out.push(value);
      value = '';
    } else {
      value += ch;
    }
  }
  out.push(value);
  return out;
}

async function readCsvRows(path, onRow) {
  const stream = createReadStream(path, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let header = null;
  let rowNo = 0;
  for await (const rawLine of rl) {
    const line = rawLine.replace(/^\uFEFF/, '');
    if (!line) continue;
    const values = parseCsvLine(line);
    if (!header) {
      header = values;
      continue;
    }
    const row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = values[i] ?? '';
    rowNo++;
    const maybePromise = onRow(row, rowNo);
    if (maybePromise && typeof maybePromise.then === 'function') await maybePromise;
  }
  return rowNo;
}

function normalizeStopSearchText(value) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/<BR\s*\/?\s*>/gi, '|')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/[，,。．·・:：;；()（）\[\]【】{}「」『』<>《》\-—–_\/\\|]/g, ' ')
    .replace(/\s+/g, '')
    .trim();
}

function normalizeGtfsClock(value) {
  const m = String(value || '').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return '';
  const hour = Number.parseInt(m[1], 10);
  const minute = Number.parseInt(m[2], 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 47 || minute < 0 || minute > 59) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function compareGtfsClock(a, b) {
  const toMinutes = value => {
    const [h, m] = String(value || '').split(':').map(Number);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  };
  return toMinutes(a) - toMinutes(b);
}

function tripDepartureFromId(tripId) {
  const m = String(tripId || '').match(/-(\d{4})$/);
  if (!m) return '';
  return normalizeGtfsClock(`${m[1].slice(0, 2)}:${m[1].slice(2)}:00`);
}

function gtfsAgencyOperators(agencyId) {
  const id = String(agencyId || '').trim().toUpperCase();
  if (id === 'KMB' || id === 'LWB') return ['KMB'];
  if (id === 'CTB') return ['CTB'];
  if (id === 'GMB') return ['GMB'];
  if (id === 'NLB') return ['NLB'];
  if (id === 'KMB+CTB' || id === 'LWB+CTB') return ['KMB', 'CTB'];
  return [];
}

async function buildStopSearchIndex() {
  const gtfsUrl = 'https://static.data.gov.hk/td/pt-headway-tc/gtfs.zip';
  const workDir = await mkdtemp(join(tmpdir(), 'psk-gtfs-'));
  const zipPath = join(workDir, 'gtfs.zip');
  try {
    console.log(`GTFS indexes (stop search / fares / timetables): downloading ${gtfsUrl}`);
    await writeFile(zipPath, await fetchBuffer(gtfsUrl, 3));
    await execFileAsync('unzip', ['-oq', zipPath, 'routes.txt', 'trips.txt', 'stops.txt', 'stop_times.txt', 'fare_attributes.txt', 'frequencies.txt', 'calendar.txt', 'calendar_dates.txt', '-d', workDir], {
      maxBuffer: 1024 * 1024
    });

    const routeMeta = new Map();
    await readCsvRows(join(workDir, 'routes.txt'), row => {
      const routeId = String(row.route_id || '').trim();
      const routeCode = String(row.route_short_name || '').trim().toUpperCase();
      const operators = gtfsAgencyOperators(row.agency_id);
      if (routeId && routeCode && operators.length) {
        routeMeta.set(routeId, {
          routeId,
          routeCode,
          operators,
          routeLongName: String(row.route_long_name || '').trim()
        });
      }
    });

    // Keep the GTFS bound from trip_id.  TD defines trip_id as
    // route-id + route-bound + service-id + departure-time.
    const tripRoute = new Map();
    const tripRouteBound = new Map();
    const referencedServiceIds = new Set();
    await readCsvRows(join(workDir, 'trips.txt'), row => {
      const tripId = String(row.trip_id || '').trim();
      const routeId = String(row.route_id || '').trim();
      const serviceId = String(row.service_id || '').trim();
      if (!tripId || !routeMeta.has(routeId)) return;
      tripRoute.set(tripId, routeId);
      const prefix = `${routeId}-`;
      const rest = tripId.startsWith(prefix) ? tripId.slice(prefix.length) : '';
      const bound = rest.split('-')[0] || '';
      if (bound === '1' || bound === '2') {
        tripRouteBound.set(tripId, { routeId, bound, serviceId });
        if (serviceId) referencedServiceIds.add(serviceId);
      }
    });

    const stopNames = new Map();
    await readCsvRows(join(workDir, 'stops.txt'), row => {
      const stopId = String(row.stop_id || '').trim();
      const normalizedName = normalizeStopSearchText(row.stop_name);
      if (stopId && normalizedName) stopNames.set(stopId, normalizedName);
    });

    const stopRoutes = new Map();
    const routeBoundStopCount = new Map();
    const tripTerminalDeparture = new Map();
    await readCsvRows(join(workDir, 'stop_times.txt'), row => {
      const tripId = String(row.trip_id || '').trim();
      const stopId = String(row.stop_id || '').trim();
      const routeId = tripRoute.get(tripId);
      const meta = routeMeta.get(routeId);
      if (meta && stopNames.has(stopId)) {
        let set = stopRoutes.get(stopId);
        if (!set) {
          set = new Set();
          stopRoutes.set(stopId, set);
        }
        for (const operator of meta.operators) {
          // GMB route numbers can repeat across HKI/KLN/NT. Keep the official
          // route_id in the token so the client can disambiguate candidates.
          if (operator === 'GMB') set.add(`${operator}:${meta.routeCode}:${meta.routeId}`);
          else set.add(`${operator}:${meta.routeCode}`);
        }
      }

      const routeBound = tripRouteBound.get(tripId);
      const seq = Number.parseInt(String(row.stop_sequence || ''), 10);
      if (routeBound && Number.isFinite(seq) && seq > 0) {
        const key = `${routeBound.routeId}|${routeBound.bound}`;
        if (seq > (routeBoundStopCount.get(key) || 0)) routeBoundStopCount.set(key, seq);
        if (seq === 1 && !tripTerminalDeparture.has(tripId)) {
          const departure = normalizeGtfsClock(row.departure_time || row.arrival_time);
          if (departure) tripTerminalDeparture.set(tripId, departure);
        }
      }
    });

    // Merge physical stop IDs that normalize to the same station name.  The client
    // only needs a compact reverse index: station text -> operator/route numbers.
    const merged = new Map();
    const operatorStations = { KMB: new Set(), CTB: new Set(), NLB: new Set(), GMB: new Set() };
    for (const [stopId, routeTokens] of stopRoutes) {
      const name = stopNames.get(stopId);
      if (!name || !routeTokens || routeTokens.size === 0) continue;
      let set = merged.get(name);
      if (!set) {
        set = new Set();
        merged.set(name, set);
      }
      for (const token of routeTokens) {
        set.add(token);
        const operator = token.split(':', 1)[0];
        if (operatorStations[operator]) operatorStations[operator].add(name);
      }
    }

    const stations = [...merged.entries()]
      .map(([name, tokens]) => ({ n: name, r: [...tokens].sort() }))
      .sort((a, b) => a.n.localeCompare(b.n, 'zh-HK'));

    const payload = {
      updatedAt: new Date().toISOString(),
      source: gtfsUrl,
      sourceFrequency: 'biweekly',
      stations,
      stats: {
        stationNames: stations.length,
        kmbStations: operatorStations.KMB.size,
        citybusStations: operatorStations.CTB.size,
        nlbStations: operatorStations.NLB.size,
        gmbStations: operatorStations.GMB.size
      }
    };
    await writeFile('data/stop-search-index.json', JSON.stringify(payload));
    console.log(`stop-search-index.json: ${stations.length} station names; KMB ${operatorStations.KMB.size}, CTB ${operatorStations.CTB.size}, NLB ${operatorStations.NLB.size}, GMB ${operatorStations.GMB.size}`);

    // Build a much smaller fare index for the browser.  The source fare matrix is
    // OD-based; the app only needs the fare from each boarding stop to the route's
    // destination. Prefer a fare whose OFF_SEQ is the GTFS terminal sequence and
    // otherwise retain the furthest published OFF_SEQ as a safe fallback.
    const fareChoices = new Map();
    await readCsvRows(join(workDir, 'fare_attributes.txt'), row => {
      const fareId = String(row.fare_id || '').trim();
      const price = Number.parseFloat(String(row.price || '').trim());
      const currency = String(row.currency_type || 'HKD').trim().toUpperCase();
      if (!fareId || !Number.isFinite(price) || price < 0 || (currency && currency !== 'HKD')) return;

      const firstDash = fareId.indexOf('-');
      if (firstDash <= 0) return;
      const routeId = fareId.slice(0, firstDash);
      const meta = routeMeta.get(routeId);
      if (!meta) return;
      const parts = fareId.slice(firstDash + 1).split('-');
      if (parts.length < 3) return;
      const bound = String(parts[0] || '').trim();
      const onSeq = Number.parseInt(String(parts[1] || ''), 10);
      const offSeq = Number.parseInt(String(parts[2] || ''), 10);
      if ((bound !== '1' && bound !== '2') || !Number.isFinite(onSeq) || !Number.isFinite(offSeq)) return;

      const terminalSeq = routeBoundStopCount.get(`${routeId}|${bound}`) || 0;
      const exactTerminal = terminalSeq > 0 && offSeq === terminalSeq;
      const key = `${routeId}|${bound}|${onSeq}`;
      const previous = fareChoices.get(key);
      if (!previous || (exactTerminal && !previous.exactTerminal) ||
          (exactTerminal === previous.exactTerminal && offSeq > previous.offSeq)) {
        fareChoices.set(key, { routeId, bound, onSeq, offSeq, price, exactTerminal });
      }
    });

    const fareRoutes = {};
    for (const choice of fareChoices.values()) {
      const meta = routeMeta.get(choice.routeId);
      if (!meta) continue;
      let routeEntry = fareRoutes[choice.routeId];
      if (!routeEntry) {
        routeEntry = fareRoutes[choice.routeId] = {
          r: meta.routeCode,
          a: meta.operators,
          l: meta.routeLongName,
          d: {}
        };
      }
      let dirEntry = routeEntry.d[choice.bound];
      if (!dirEntry) {
        dirEntry = routeEntry.d[choice.bound] = {
          c: Number(routeBoundStopCount.get(`${choice.routeId}|${choice.bound}`) || 0),
          f: {}
        };
      }
      dirEntry.f[String(choice.onSeq)] = Number(choice.price.toFixed(2));
    }

    const fareLookup = {};
    for (const [routeId, entry] of Object.entries(fareRoutes)) {
      for (const operator of entry.a || []) {
        const key = `${operator}:${entry.r}`;
        if (!fareLookup[key]) fareLookup[key] = [];
        fareLookup[key].push(routeId);
      }
    }
    Object.values(fareLookup).forEach(ids => ids.sort((a, b) => String(a).localeCompare(String(b))));

    const farePayload = {
      v: 1,
      updatedAt: new Date().toISOString(),
      source: gtfsUrl,
      routes: fareRoutes,
      lookup: fareLookup,
      stats: {
        routes: Object.keys(fareRoutes).length,
        stopFares: fareChoices.size
      }
    };
    await writeFile('data/route-fares.json', JSON.stringify(farePayload));
    console.log(`route-fares.json: ${farePayload.stats.routes} routes; ${farePayload.stats.stopFares} boarding-stop fares`);

    // Build a compact timetable index. Fixed trips use the published departure
    // time at stop_sequence 1. Trips represented by frequencies.txt are kept as
    // time ranges + headway instead of being expanded into invented departures.
    const tripFrequencyRanges = new Map();
    await readCsvRows(join(workDir, 'frequencies.txt'), row => {
      const tripId = String(row.trip_id || '').trim();
      if (!tripRouteBound.has(tripId)) return;
      const start = normalizeGtfsClock(row.start_time);
      const end = normalizeGtfsClock(row.end_time);
      const headway = Number.parseInt(String(row.headway_secs || ''), 10);
      if (!start || !end || !Number.isFinite(headway) || headway <= 0) return;
      let ranges = tripFrequencyRanges.get(tripId);
      if (!ranges) {
        ranges = [];
        tripFrequencyRanges.set(tripId, ranges);
      }
      ranges.push([start, end, headway]);
    });

    const serviceCalendar = {};
    await readCsvRows(join(workDir, 'calendar.txt'), row => {
      const serviceId = String(row.service_id || '').trim();
      if (!serviceId || !referencedServiceIds.has(serviceId)) return;
      const mask = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']
        .map(key => String(row[key] || '0') === '1' ? '1' : '0').join('');
      serviceCalendar[serviceId] = {
        m: mask,
        s: String(row.start_date || '').trim(),
        e: String(row.end_date || '').trim()
      };
    });

    const serviceExceptions = {};
    await readCsvRows(join(workDir, 'calendar_dates.txt'), row => {
      const serviceId = String(row.service_id || '').trim();
      const date = String(row.date || '').trim();
      const exceptionType = Number.parseInt(String(row.exception_type || ''), 10);
      if (!serviceId || !referencedServiceIds.has(serviceId) || !/^\d{8}$/.test(date) || (exceptionType !== 1 && exceptionType !== 2)) return;
      if (!serviceExceptions[date]) serviceExceptions[date] = {};
      serviceExceptions[date][serviceId] = exceptionType;
    });

    const timetableRoutes = {};
    let fixedDepartureCount = 0;
    let frequencyRangeCount = 0;
    for (const [tripId, trip] of tripRouteBound) {
      const meta = routeMeta.get(trip.routeId);
      if (!meta || !trip.serviceId) continue;
      let routeEntry = timetableRoutes[trip.routeId];
      if (!routeEntry) {
        routeEntry = timetableRoutes[trip.routeId] = {
          r: meta.routeCode,
          a: meta.operators,
          l: meta.routeLongName,
          d: {}
        };
      }
      let dirEntry = routeEntry.d[trip.bound];
      if (!dirEntry) {
        dirEntry = routeEntry.d[trip.bound] = {
          c: Number(routeBoundStopCount.get(`${trip.routeId}|${trip.bound}`) || 0),
          s: {}
        };
      }
      let serviceEntry = dirEntry.s[trip.serviceId];
      if (!serviceEntry) serviceEntry = dirEntry.s[trip.serviceId] = { t: [], f: [] };

      const frequencyRanges = tripFrequencyRanges.get(tripId);
      if (frequencyRanges && frequencyRanges.length) {
        for (const range of frequencyRanges) {
          serviceEntry.f.push(range);
          frequencyRangeCount++;
        }
      } else {
        const departure = tripTerminalDeparture.get(tripId) || tripDepartureFromId(tripId);
        if (departure) {
          serviceEntry.t.push(departure);
          fixedDepartureCount++;
        }
      }
    }

    // Deduplicate times/ranges because several GTFS trips can describe the same
    // public departure pattern. Remove empty service/direction/route records.
    for (const [routeId, routeEntry] of Object.entries(timetableRoutes)) {
      for (const [bound, dirEntry] of Object.entries(routeEntry.d || {})) {
        for (const [serviceId, serviceEntry] of Object.entries(dirEntry.s || {})) {
          serviceEntry.t = [...new Set(serviceEntry.t || [])].sort(compareGtfsClock);
          const rangeMap = new Map();
          for (const range of serviceEntry.f || []) rangeMap.set(`${range[0]}|${range[1]}|${range[2]}`, range);
          serviceEntry.f = [...rangeMap.values()].sort((a, b) => compareGtfsClock(a[0], b[0]) || compareGtfsClock(a[1], b[1]) || a[2] - b[2]);
          if (!serviceEntry.t.length) delete serviceEntry.t;
          if (!serviceEntry.f.length) delete serviceEntry.f;
          if (!serviceEntry.t && !serviceEntry.f) delete dirEntry.s[serviceId];
        }
        if (!Object.keys(dirEntry.s || {}).length) delete routeEntry.d[bound];
      }
      if (!Object.keys(routeEntry.d || {}).length) delete timetableRoutes[routeId];
    }

    const timetableLookup = {};
    for (const [routeId, entry] of Object.entries(timetableRoutes)) {
      for (const operator of entry.a || []) {
        const key = `${operator}:${entry.r}`;
        if (!timetableLookup[key]) timetableLookup[key] = [];
        timetableLookup[key].push(routeId);
      }
    }
    Object.values(timetableLookup).forEach(ids => ids.sort((a, b) => String(a).localeCompare(String(b))));

    const timetablePayload = {
      v: 1,
      updatedAt: new Date().toISOString(),
      source: gtfsUrl,
      routes: timetableRoutes,
      lookup: timetableLookup,
      c: serviceCalendar,
      x: serviceExceptions,
      stats: {
        routes: Object.keys(timetableRoutes).length,
        fixedDepartures: fixedDepartureCount,
        frequencyRanges: frequencyRangeCount
      }
    };
    await writeFile('data/route-timetables.json', JSON.stringify(timetablePayload));
    console.log(`route-timetables.json: ${timetablePayload.stats.routes} routes; ${fixedDepartureCount} fixed departures; ${frequencyRangeCount} frequency ranges`);

    return {
      available: true,
      fresh: true,
      stats: payload.stats,
      fareStats: farePayload.stats,
      fareAvailable: true,
      fareFresh: true,
      timetableStats: timetablePayload.stats,
      timetableAvailable: true,
      timetableFresh: true,
      source: gtfsUrl
    };
  } catch (error) {
    const previousAvailable = await fileExists('data/stop-search-index.json');
    const previousFareAvailable = await fileExists('data/route-fares.json');
    const previousTimetableAvailable = await fileExists('data/route-timetables.json');
    console.warn(`GTFS derived indexes: refresh failed; stop search ${previousAvailable ? 'kept' : 'missing'}, fares ${previousFareAvailable ? 'kept' : 'missing'}, timetables ${previousTimetableAvailable ? 'kept' : 'missing'} (${error.message})`);
    let stats = { stationNames: 0, kmbStations: 0, citybusStations: 0, nlbStations: 0, gmbStations: 0 };
    let fareStats = { routes: 0, stopFares: 0 };
    let timetableStats = { routes: 0, fixedDepartures: 0, frequencyRanges: 0 };
    if (previousAvailable) {
      try {
        const previous = JSON.parse(await readFile('data/stop-search-index.json', 'utf8'));
        stats = { ...stats, ...(previous.stats || {}) };
      } catch {}
    }
    if (previousFareAvailable) {
      try {
        const previous = JSON.parse(await readFile('data/route-fares.json', 'utf8'));
        fareStats = { ...fareStats, ...(previous.stats || {}) };
      } catch {}
    }
    if (previousTimetableAvailable) {
      try {
        const previous = JSON.parse(await readFile('data/route-timetables.json', 'utf8'));
        timetableStats = { ...timetableStats, ...(previous.stats || {}) };
      } catch {}
    }
    return {
      available: previousAvailable,
      fresh: false,
      stale: previousAvailable,
      stats,
      fareStats,
      fareAvailable: previousFareAvailable,
      fareFresh: false,
      fareStale: previousFareAvailable,
      timetableStats,
      timetableAvailable: previousTimetableAvailable,
      timetableFresh: false,
      timetableStale: previousTimetableAvailable,
      source: null,
      error: String(error?.message || error)
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function countPayload(payload) {
  if (!payload) return 0;
  if (Array.isArray(payload)) return payload.length;
  if (Array.isArray(payload.routes)) return payload.routes.length;
  if (Array.isArray(payload.data)) return payload.data.length;
  const data = payload.data;
  if (data && typeof data === 'object') {
    let n = 0;
    for (const value of Object.values(data)) {
      if (Array.isArray(value)) n += value.length;
      else if (value && typeof value === 'object') n += 1;
    }
    return n;
  }
  return Object.keys(payload).length;
}

function extractDatasetStats(filename, payload) {
  const routeNumbers = new Set();
  const stations = new Set();
  const data = payload && payload.data !== undefined ? payload.data : payload;

  const addRoute = value => {
    const code = String(value ?? '').trim().toUpperCase();
    if (code) routeNumbers.add(code);
  };
  const addStation = value => {
    const id = String(value ?? '').trim();
    if (id) stations.add(id);
  };

  if (filename === 'kmb-route.json' && Array.isArray(data)) {
    data.forEach(item => {
      if (item && String(item.service_type || '1') === '1') addRoute(item.route);
    });
  } else if (filename === 'kmb-stop.json' && Array.isArray(data)) {
    data.forEach(item => item && addStation(item.stop || item.stop_id || item.id));
  } else if (filename === 'ctb-route.json' && Array.isArray(data)) {
    data.forEach(item => item && addRoute(item.route || item.route_no || item.route_code));
  } else if (filename === 'nlb-route.json') {
    const rows = payload && Array.isArray(payload.routes) ? payload.routes : [];
    rows.forEach(item => item && addRoute(item.routeNo || item.route_no || item.route));
  } else if (/^gmb-route-(?:HKI|KLN|NT)\.json$/.test(filename)) {
    const visit = value => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (value && typeof value === 'object') {
        const code = value.route_code || value.route || value.route_no || value.routeName;
        if (code) addRoute(code);
        else Object.values(value).forEach(visit);
        return;
      }
      if (typeof value === 'string' || typeof value === 'number') addRoute(value);
    };
    visit(data);
  }

  return { routeNumbers: routeNumbers.size, stations: stations.size };
}

async function saveRequired(filename, urls) {
  let lastError;
  for (const url of urls) {
    try {
      const payload = await fetchJson(url);
      const count = countPayload(payload);
      if (count <= 0) throw new Error(`${url} returned no records`);
      await writeFile(`data/${filename}`, JSON.stringify(payload));
      const stats = extractDatasetStats(filename, payload);
      console.log(`${filename}: ${count} records (${url})`);
      return { filename, count, stats, source: url, required: true, available: true, fresh: true, stale: false };
    } catch (error) {
      lastError = error;
      console.warn(`Source failed for ${filename}: ${error.message}`);
    }
  }
  // Preserve yesterday's file if it exists. A temporary outage from one provider
  // must not prevent the other operators from refreshing or fail the whole Action.
  const previousAvailable = await fileExists(`data/${filename}`);
  let previousCount = 0;
  let previousStats = { routeNumbers: 0, stations: 0 };
  if (previousAvailable) {
    try {
      const previousPayload = JSON.parse(await readFile(`data/${filename}`, 'utf8'));
      previousCount = countPayload(previousPayload);
      previousStats = extractDatasetStats(filename, previousPayload);
    } catch (readError) {
      console.warn(`${filename}: previous cached file exists but could not be counted: ${readError.message}`);
    }
  }
  console.error(`${filename}: all sources failed; ${previousAvailable ? 'using previous cached file.' : 'no previous cached file available.'}`);
  return {
    filename,
    count: previousCount,
    stats: previousStats,
    source: null,
    required: true,
    available: previousAvailable,
    fresh: false,
    stale: previousAvailable,
    error: String(lastError?.message || lastError || 'unknown')
  };
}

async function saveOptional(filename, urls) {
  for (const url of urls) {
    try {
      const payload = await fetchJson(url, 2);
      const count = countPayload(payload);
      if (count <= 0) throw new Error(`${url} returned no records`);
      await writeFile(`data/${filename}`, JSON.stringify(payload));
      const stats = extractDatasetStats(filename, payload);
      console.log(`${filename}: ${count} records (${url})`);
      return { filename, count, stats, source: url, required: false, available: true, fresh: true, stale: false };
    } catch (error) {
      console.warn(`Optional source failed for ${filename}: ${error.message}`);
    }
  }
  await rm(`data/${filename}`, { force: true });
  console.warn(`${filename}: unavailable; web app will use live per-route fallback.`);
  return { filename, count: 0, stats: { routeNumbers: 0, stations: 0 }, source: null, required: false, available: false, fresh: false, stale: false };
}

const jobs = [];

// KMB: global route + stop lists. Aggregate route-stop is intentionally not used
// because it can return HTTP 403 from GitHub Actions.
jobs.push(await saveRequired('kmb-route.json', [
  'https://data.etabus.gov.hk/v1/transport/kmb/route/'
]));
jobs.push(await saveRequired('kmb-stop.json', [
  'https://data.etabus.gov.hk/v1/transport/kmb/stop'
]));
await rm('data/kmb-route-stop.json', { force: true });

// Citybus: only the route index is fetched by GitHub Actions.
// DATA.GOV.HK still documents aggregate V1 stop / route-stop resources, but
// those endpoints currently return HTTP 422 when fetched directly. Route-stop
// and stop details therefore stay lazy in the browser and are cached locally
// for the service day.
jobs.push(await saveRequired('ctb-route.json', [
  'https://rt.data.gov.hk/v2/transport/citybus/route/CTB'
]));
await rm('data/ctb-stop.json', { force: true });
await rm('data/ctb-route-stop.json', { force: true });

// New Lantao Bus: route index is small and real-time. Stops / fares / ETA are
// route-scoped in the official V2 API, so the browser loads them lazily. The TD
// GTFS-derived indexes below also contribute NLB timetable / fare matching.
jobs.push(await saveRequired('nlb-route.json', [
  'https://rt.data.gov.hk/v2/transport/nlb/route.php?action=list'
]));

// Green minibus: the official API exposes route lists by region, not one global
// all-stop file. Cache the three route indexes daily; route details/stops remain
// lazy per selected route and ETA remains live.
for (const region of ['HKI', 'KLN', 'NT']) {
  jobs.push(await saveRequired(`gmb-route-${region}.json`, [
    `https://data.etagmb.gov.hk/route/${region}`
  ]));
}

// One compact cross-operator reverse index powers intermediate-stop search in
// the browser without hundreds of live per-route requests.
const stopSearchIndex = await buildStopSearchIndex();

const requiredJobs = jobs.filter(j => j.required);
const requiredSuccesses = requiredJobs.filter(j => j.available !== false).length;
if (requiredSuccesses === 0) {
  throw new Error('All required static data providers failed; refusing to publish an empty refresh.');
}

const updatedAt = new Date().toISOString();
const serviceDay = getHongKongServiceDayKey(6, new Date(updatedAt));
const summary = Object.fromEntries(jobs.map(j => [j.filename, {
  records: j.count,
  routeNumbers: Number(j.stats?.routeNumbers || 0),
  stations: Number(j.stats?.stations || 0),
  source: j.source,
  required: j.required,
  available: j.available !== false,
  fresh: j.fresh !== false,
  stale: j.stale === true,
  ...(j.error ? { error: j.error } : {})
}]));

summary['stop-search-index.json'] = {
  records: Number(stopSearchIndex.stats?.stationNames || 0),
  stations: Number(stopSearchIndex.stats?.stationNames || 0),
  source: stopSearchIndex.source,
  required: false,
  available: stopSearchIndex.available !== false,
  fresh: stopSearchIndex.fresh === true,
  stale: stopSearchIndex.stale === true,
  ...(stopSearchIndex.error ? { error: stopSearchIndex.error } : {})
};

summary['route-fares.json'] = {
  records: Number(stopSearchIndex.fareStats?.stopFares || 0),
  routeNumbers: Number(stopSearchIndex.fareStats?.routes || 0),
  source: stopSearchIndex.source,
  required: false,
  available: stopSearchIndex.fareAvailable !== false,
  fresh: stopSearchIndex.fareFresh === true,
  stale: stopSearchIndex.fareStale === true,
  ...(stopSearchIndex.error ? { error: stopSearchIndex.error } : {})
};

summary['route-timetables.json'] = {
  records: Number(stopSearchIndex.timetableStats?.fixedDepartures || 0) + Number(stopSearchIndex.timetableStats?.frequencyRanges || 0),
  routeNumbers: Number(stopSearchIndex.timetableStats?.routes || 0),
  source: stopSearchIndex.source,
  required: false,
  available: stopSearchIndex.timetableAvailable !== false,
  fresh: stopSearchIndex.timetableFresh === true,
  stale: stopSearchIndex.timetableStale === true,
  ...(stopSearchIndex.error ? { error: stopSearchIndex.error } : {})
};

function summarizeOperator(files) {
  const entries = files.map(name => summary[name]).filter(Boolean);
  const total = files.length;
  const fresh = entries.filter(item => item.available && item.fresh).length;
  const available = entries.filter(item => item.available).length;
  const status = fresh === total ? 'success' : (available > 0 ? 'partial' : 'fail');
  return { status, fresh, available, total };
}

const operatorStatus = {
  kmb: summarizeOperator(['kmb-route.json', 'kmb-stop.json']),
  citybus: summarizeOperator(['ctb-route.json']),
  nlb: summarizeOperator(['nlb-route.json']),
  gmb: summarizeOperator(['gmb-route-HKI.json', 'gmb-route-KLN.json', 'gmb-route-NT.json'])
};

const loadedCounts = {
  kmb: {
    routeNumbers: summary['kmb-route.json']?.routeNumbers || 0,
    stations: Math.max(summary['kmb-stop.json']?.stations || 0, Number(stopSearchIndex.stats?.kmbStations || 0))
  },
  citybus: {
    routeNumbers: summary['ctb-route.json']?.routeNumbers || 0,
    stations: Number(stopSearchIndex.stats?.citybusStations || 0)
  },
  nlb: {
    routeNumbers: summary['nlb-route.json']?.routeNumbers || 0,
    stations: Number(stopSearchIndex.stats?.nlbStations || 0)
  },
  gmb: {
    routeNumbers: ['HKI', 'KLN', 'NT'].reduce((sum, region) => sum + (summary[`gmb-route-${region}.json`]?.routeNumbers || 0), 0),
    stations: Number(stopSearchIndex.stats?.gmbStations || 0)
  }
};

await writeFile('data/transport-meta.json', JSON.stringify({
  updatedAt,
  serviceDay,
  serviceDayCutoffHKT: '06:00',
  operatorStatus,
  loadedCounts,
  datasets: summary,
  strategies: {
    kmbRouteStop: 'lazy-per-route',
    citybusRouteStop: 'lazy-per-route-browser-daily-cache',
    nlbRouteStop: 'lazy-per-route-browser-daily-cache',
    gmbRouteDetail: 'lazy-per-route',
    stopSearch: 'daily-gtfs-reverse-index',
    fares: 'daily-compact-gtfs-fare-index',
    timetables: 'gtfs-published-terminal-departures-and-headways',
    eta: 'always-live'
  }
}, null, 2) + '\n');

// Keep the old filename for backwards compatibility / easy inspection.
await writeFile('data/kmb-meta.json', JSON.stringify({
  updatedAt,
  records: {
    'kmb-route.json': summary['kmb-route.json']?.records || 0,
    'kmb-stop.json': summary['kmb-stop.json']?.records || 0
  },
  routeStopStrategy: 'lazy-per-route'
}, null, 2) + '\n');

console.log(`Updated all daily static datasets at ${updatedAt}`);
