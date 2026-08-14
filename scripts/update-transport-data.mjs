import { access, mkdir, rm, writeFile } from 'node:fs/promises';

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

async function saveRequired(filename, urls) {
  let lastError;
  for (const url of urls) {
    try {
      const payload = await fetchJson(url);
      const count = countPayload(payload);
      if (count <= 0) throw new Error(`${url} returned no records`);
      await writeFile(`data/${filename}`, JSON.stringify(payload));
      console.log(`${filename}: ${count} records (${url})`);
      return { filename, count, source: url, required: true, available: true, fresh: true, stale: false };
    } catch (error) {
      lastError = error;
      console.warn(`Source failed for ${filename}: ${error.message}`);
    }
  }
  // Preserve yesterday's file if it exists. A temporary outage from one provider
  // must not prevent the other operators from refreshing or fail the whole Action.
  const previousAvailable = await fileExists(`data/${filename}`);
  console.error(`${filename}: all sources failed; ${previousAvailable ? 'using previous cached file.' : 'no previous cached file available.'}`);
  return {
    filename,
    count: 0,
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
      console.log(`${filename}: ${count} records (${url})`);
      return { filename, count, source: url, required: false, available: true, fresh: true, stale: false };
    } catch (error) {
      console.warn(`Optional source failed for ${filename}: ${error.message}`);
    }
  }
  await rm(`data/${filename}`, { force: true });
  console.warn(`${filename}: unavailable; web app will use live per-route fallback.`);
  return { filename, count: 0, source: null, required: false, available: false, fresh: false, stale: false };
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

const requiredJobs = jobs.filter(j => j.required);
const requiredSuccesses = requiredJobs.filter(j => j.available !== false).length;
if (requiredSuccesses === 0) {
  throw new Error('All required static data providers failed; refusing to publish an empty refresh.');
}

const updatedAt = new Date().toISOString();
const serviceDay = getHongKongServiceDayKey(6, new Date(updatedAt));
const summary = Object.fromEntries(jobs.map(j => [j.filename, {
  records: j.count,
  source: j.source,
  required: j.required,
  available: j.available !== false,
  fresh: j.fresh !== false,
  stale: j.stale === true,
  ...(j.error ? { error: j.error } : {})
}]));

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

await writeFile('data/transport-meta.json', JSON.stringify({
  updatedAt,
  serviceDay,
  serviceDayCutoffHKT: '06:00',
  operatorStatus,
  datasets: summary,
  strategies: {
    kmbRouteStop: 'lazy-per-route',
    citybusRouteStop: 'lazy-per-route-browser-daily-cache',
    gmbRouteDetail: 'lazy-per-route',
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
