# Transport App v6.1.0

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

設定頁會讀取 `data/transport-meta.json`，顯示 KMB / Citybus / GMB 每日快取健康狀態：

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
