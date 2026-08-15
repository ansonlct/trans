# Transport App v6.7.5




## v6.7.5 Route timetable

- In **巴士/小巴**, open any `往 XXXX` direction and tap **時間表** to view the published terminal departure timetable for that direction.
- Fixed GTFS trips are shown as individual terminal departure times.
- GTFS `frequencies.txt` services are shown as a time range plus headway (for example, `07:00–09:00 每 8 分鐘`) instead of inventing exact departures.
- The timetable automatically selects the current Hong Kong service day using `calendar.txt` and `calendar_dates.txt`, including public-holiday exceptions.
- The daily data workflow now also generates `data/route-timetables.json` from the Transport Department GTFS feed.
- Timetable direction matching uses operator, route number, bound, destination, official stop count, and the exact GMB route ID when available.

## v6.7.4 KMB route colour + quiet no-service detail

- KMB route numbers are now shown in KMB red in the route search/list and detail view.
- Removed the extra direction-level no-service sentence; unavailable stops remain grey in-place.

## v6.7.3 GitHub Actions Node 24 compatibility

- GitHub Actions upgraded to `actions/checkout@v7` and `actions/setup-node@v7`.
- Workflow Node.js runtime upgraded from 20 to 24 to remove the Node.js 20 deprecation warning.
- Includes the v6.7.2 fare display and immediate direction-status changes.

## v6.7.2 Fare display / immediate direction status
- 「巴士/小巴」的九巴及專線小巴路線詳情，於每個車站名稱下方顯示由該站上車至本方向終點的公布車資（`$xx.xx`）；沒有公布上車車資的站顯示 `$--`。
- 「收藏」同樣在每個收藏車站名稱下方顯示車資；舊收藏會由每日 fare index 自動補回，不需要重新收藏。
- 每日 GitHub Action 由運輸署 GTFS `fare_attributes.txt` 產生精簡 `data/route-fares.json`，只保留每個上車站到方向終點所需的車資資料。
- 九巴 / 城巴查詢結果中，畫面內可見的「往 XXX」一顯示便立即重新檢查該方向 ETA；畫面外路線才繼續用 IntersectionObserver 延遲檢查。確認該方向沒有班次後立即灰階。
- 路線詳情繼續保留完整官方站序；沒有 ETA 的車站原位灰階並顯示「暫無班次」。


## v6.7.0 Intermediate-stop search
- 巴士/小巴搜尋格同時搜尋路線號碼、起訖站及所有中途站；例如輸入 `博研路` 會列出途經該站的路線。
- 每日 GitHub Action 由運輸署繁體中文 GTFS 產生 `data/stop-search-index.json`，網站只下載一個輕量反向索引，不會搜尋時逐條路線呼叫 API。
- 車號鍵盤新增 `站名⌨️`，手機可切換至系統中文鍵盤；清空搜尋後再次點擊搜尋格會回復車號鍵盤。
- GMB 中途站索引保留官方 `route_id`，處理不同地區重覆小巴路線號碼時可精確辨識。

## v6.6.0 Search clear button / cache loaded counts
- 巴士/小巴搜尋格新增圓形 `×` 清除按鈕；只有輸入內容時顯示。
- 快取狀態取消 Success / Partially success / Fail 文字與圖例，只保留狀態燈。
- 每個營辦商顯示已載入「號碼」及「車站」數目。九巴取每日完整路線/車站數；城巴及小巴車站數會計入裝置已開啟路線的本機 24 小時快取。
- 每日 `transport-meta.json` 新增 `loadedCounts`，並在各 dataset metadata 記錄 routeNumbers / stations。

## v6.5.0 KMB default / bottom keyboard / opposite-route layout / progress percentage
- 巴士/小巴查詢預設選擇九巴。
- 車號鍵盤貼齊屏幕底部；點擊鍵盤及搜尋欄以外位置會自動收起。
- 路線詳情的對面線切換改為獨立全寬藍色按鈕，完整顯示目的地站名並支援換行。
- 手動更新及路線 ETA 載入顯示實際完成百分比。


- GMB route directory no longer shows generic `方向 1` / `方向 2`; visible GMB routes resolve terminal stop names from route-stop data and cache them locally.
- Disabled accidental double-click/double-tap zoom, pinch gesture zoom, text selection, drag selection and tap highlight.
- Cache Status is now a two-page Settings slide: opening slides left; `上一頁` slides right back to Settings.

# 白石角出行 v6.0.0 — GitHub Pages + 九巴 / 城巴 / 專線小巴每日靜態快取

純 GitHub Pages 版本，不需要 Node.js 後端。

## 每日自動更新甚麼？

GitHub Actions 每日香港時間約 **05:30** 更新靜態索引，網站以 **06:00 HKT** 作新一個 service day 分界。

### 九巴

每日預抓：
- `data/kmb-route.json` — 全部路線
- `data/kmb-stop.json` — 全部車站

不再嘗試全量 `route-stop`，因該 aggregate endpoint 在 GitHub Actions / 部分 server 環境可能回 403。只有使用者打開某條九巴路線時才抓該路線/方向的 route-stop。

### 城巴

每日預抓：
- `data/ctb-route.json` — 全部城巴路線（必需）
城巴每日只預先生成 `data/ctb-route.json`（全部城巴路線）。官方舊版 aggregate `stop` / `route-stop` endpoint 現時會回 HTTP 422，所以 workflow 不再白試這兩個來源。

當使用者真正打開某條城巴路線時，網站才使用 V2 per-route / per-stop API；該路線的站序和站點詳情會在瀏覽器保存 24 小時，同一天再次開啟毋須重抓。ETA 仍然即時。

### 專線小巴

每日預抓：
- `data/gmb-route-HKI.json` — 港島路線總表
- `data/gmb-route-KLN.json` — 九龍路線總表
- `data/gmb-route-NT.json` — 新界路線總表

官方 GMB API 沒有一個「全港全部站」總表；route-stop 是按 `route_id / route_seq` 提供，所以路線詳情和站序仍然在真正打開該路線時才抓。

### ETA

**九巴、城巴、專線小巴、港鐵 ETA 全部保持即時。** 每日 cache 只用於靜態路線/車站索引。

## 第一次部署 / 升級

1. 將這個資料夾的全部內容覆蓋到 GitHub repository `main` branch。
2. GitHub Pages 使用 `main` + `/(root)`。
3. 到 **Actions → Update daily transport static data → Run workflow** 手動跑一次。
4. 成功後 `data/` 會出現當日靜態 JSON。

正常最低限度應看到：

```text
kmb-route.json
kmb-stop.json
ctb-route.json
gmb-route-HKI.json
gmb-route-KLN.json
gmb-route-NT.json
transport-meta.json
stop-search-index.json
route-fares.json
```


這兩個檔案缺少不代表 Action 失敗。

## 快取策略

- GitHub Actions：全站共用，每日更新靜態資料一次。
- Service Worker：同一瀏覽器每個 service day 只下載一次相同 `data/*.json?day=YYYY-MM-DD`。
- JavaScript 記憶體 / localStorage：繼續避免同一次使用期間重複請求。
- ETA：短 TTL / 即時 API，不會被 Service Worker 永久 cache。

## Repository 結構

```text
transport-app/
├── .github/workflows/update-transport-data.yml
├── scripts/update-transport-data.mjs
├── assets/app.js
├── assets/styles.css
├── data/.gitkeep
├── index.html
├── manifest.webmanifest
├── sw.js
├── .nojekyll
└── README.md
```

## v4 城巴 422 修正

- 不再請求會回 422 的城巴 aggregate `stop` / `route-stop` URL。
- 城巴 route-stop 與 stop detail 改為按需載入，並在瀏覽器持久快取 24 小時。
- 九巴 per-route route-stop 同樣改為 24 小時持久快取。
- 所有 ETA / 港鐵列車時間仍不會寫入每日靜態快取。


## 設定中的快取狀態燈

設定頁的「快取狀態」按鈕按入後，才會讀取 `data/transport-meta.json`，顯示 KMB / Citybus / GMB 快取健康狀態：

- 綠色 `Success`：該營辦商所有預定每日資料已於今次更新成功。
- 黃色 `Partially success`：只有部分資料更新成功，或今日更新失敗但仍有上一日舊快取可用。
- 紅色 `Fail`：沒有可用快取，或 `transport-meta.json` 無法讀取。

如果狀態檔不是目前 06:00 HKT 服務日，原本的綠燈會降為黃燈並顯示「舊快取」。


## v6.0.0 版本顯示

設定頁新增「版本」一列，顯示目前前端版本號 `v6.0.0`。每次部署新版時更新 `APP_VERSION` 及 Service Worker cache name，可用來確認 GitHub Pages 是否已載入最新版本。


## v6.1.0
- Settings shows KMB / Citybus / GMB cache status indicators.
- Settings shows app version v6.1.0.
- Versioned CSS/JS URLs prevent stale browser assets.
- Service Worker uses network-first for app shell/navigation.
- GitHub Action rebases onto latest main before pushing daily data.


## v6.2.0 performance / UX pass
- Deduplicates identical concurrent API requests.
- Coordinates ETA refreshes and prevents repeated refreshes within 8 seconds.
- Manual refresh now invalidates live ETA memory cache.
- Limits Citybus stop-detail concurrency to 6 and favorite ETA concurrency to 4.
- Loads 20 route rows per page instead of 30.
- ETA availability checks in the route directory are lazy and run only near the viewport.
- Route-search redraw no longer flashes the global loading bar on every keystroke.
- Service Worker separates app/data caches and automatically removes old daily dataset entries.
- Settings dialog supports Escape, focus return, small-screen scrolling and v6.2.0 version display.


## v6.3.0 cache status / route detail performance
- 「每日快取狀態」改為設定頁內的「快取狀態」按鈕；只有按入去先讀取狀態，並移除「重新檢查」。
- 九巴 / 小巴詳情改為先顯示已快取的靜態車站名單，再於背景補上即時 ETA，不再等 ETA 全部完成才顯示頁面。
- 九巴首次打開路線時，站名索引與該路線 route-stop 改為並行載入，減少串行等待。
- 小巴 ETA 改為最多 6 個車站並行，避免一次開數十個請求。
- 小巴路線詳情 / route-stop 本機持久快取由 1 小時延長至 24 小時。
- 路線目錄停止為小巴逐站預查 ETA，避免背景請求與使用者打開詳情互相爭網絡。