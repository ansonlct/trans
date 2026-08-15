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

function gtfsAgencyOperators(agencyId) {
  const id = String(agencyId || '').trim().toUpperCase();
  if (id === 'KMB' || id === 'LWB') return ['KMB'];
  if (id === 'CTB') return ['CTB'];
  if (id === 'GMB') return ['GMB'];
  if (id === 'KMB+CTB' || id === 'LWB+CTB') return ['KMB', 'CTB'];
  return [];
}

async function buildStopSearchIndex() {
  const gtfsUrl = 'https://static.data.gov.hk/td/pt-headway-tc/gtfs.zip';
  const workDir = await mkdtemp(join(tmpdir(), 'psk-gtfs-'));
  const zipPath = join(workDir, 'gtfs.zip');
  try {
    console.log(`stop-search-index.json: downloading GTFS (${gtfsUrl})`);
    await writeFile(zipPath, await fetchBuffer(gtfsUrl, 3));
    await execFileAsync('unzip', ['-oq', zipPath, 'routes.txt', 'trips.txt', 'stops.txt', 'stop_times.txt', '-d', workDir], {
      maxBuffer: 1024 * 1024
    });

    const routeMeta = new Map();
    await readCsvRows(join(workDir, 'routes.txt'), row => {
      const routeId = String(row.route_id || '').trim();
      const routeCode = String(row.route_short_name || '').trim().toUpperCase();
      const operators = gtfsAgencyOperators(row.agency_id);
      if (routeId && routeCode && operators.length) routeMeta.set(routeId, { routeId, routeCode, operators });
    });

    const tripRoute = new Map();
    await readCsvRows(join(workDir, 'trips.txt'), row => {
      const tripId = String(row.trip_id || '').trim();
      const routeId = String(row.route_id || '').trim();
      if (tripId && routeMeta.has(routeId)) tripRoute.set(tripId, routeId);
    });

    const stopNames = new Map();
    await readCsvRows(join(workDir, 'stops.txt'), row => {
      const stopId = String(row.stop_id || '').trim();
      const normalizedName = normalizeStopSearchText(row.stop_name);
      if (stopId && normalizedName) stopNames.set(stopId, normalizedName);
    });

    const stopRoutes = new Map();
    await readCsvRows(join(workDir, 'stop_times.txt'), row => {
      const stopId = String(row.stop_id || '').trim();
      if (!stopNames.has(stopId)) return;
      const routeId = tripRoute.get(String(row.trip_id || '').trim());
      const meta = routeMeta.get(routeId);
      if (!meta) return;
      let set = stopRoutes.get(stopId);
      if (!set) {
        set = new Set();
        stopRoutes.set(stopId, set);
      }
      for (const operator of meta.operators) {
        // GMB route numbers can repeat across HKI/KLN/NT.  Keep the official
        // route_id in the token so the client can disambiguate after loading
        // that small set of candidate GMB route details.
        if (operator === 'GMB') set.add(`${operator}:${meta.routeCode}:${meta.routeId}`);
        else set.add(`${operator}:${meta.routeCode}`);
      }
    });

    // Merge physical stop IDs that normalize to the same station name.  The client
    // only needs a compact reverse index: station text -> operator/route numbers.
    const merged = new Map();
    const operatorStations = { KMB: new Set(), CTB: new Set(), GMB: new Set() };
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
        gmbStations: operatorStations.GMB.size
      }
    };
    await writeFile('data/stop-search-index.json', JSON.stringify(payload));
    console.log(`stop-search-index.json: ${stations.length} station names; KMB ${operatorStations.KMB.size}, CTB ${operatorStations.CTB.size}, GMB ${operatorStations.GMB.size}`);
    return { available: true, fresh: true, stats: payload.stats, source: gtfsUrl };
  } catch (error) {
    const previousAvailable = await fileExists('data/stop-search-index.json');
    console.warn(`stop-search-index.json: refresh failed; ${previousAvailable ? 'keeping previous index' : 'no previous index'} (${error.message})`);
    let stats = { stationNames: 0, kmbStations: 0, citybusStations: 0, gmbStations: 0 };
    if (previousAvailable) {
      try {
        const previous = JSON.parse(await readFile('data/stop-search-index.json', 'utf8'));
        stats = { ...stats, ...(previous.stats || {}) };
      } catch {}
    }
    return { available: previousAvailable, fresh: false, stale: previousAvailable, stats, source: null, error: String(error?.message || error) };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function countPayload(payload) {
  if (!payload) return 0;
  if (Array.isArray(payload)) return payload.length;
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
    gmbRouteDetail: 'lazy-per-route',
    stopSearch: 'daily-gtfs-reverse-index',
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
