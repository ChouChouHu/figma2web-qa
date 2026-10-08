# figma2web QA

**讓網站真正對齊 Figma 設計稿的 AI Agent Skill**：從 Figma 匯出畫板、逐斷點截圖做像素比對並修正、
全解析度回歸驗證，再用「文字塞爆」與真實滾輪捲動找出設計稿看不出來的跑版。

> **English summary** — An agent skill (Claude Code / Codex compatible) for pixel-level QA of a web build
> against Figma frames across all responsive breakpoints. It exports frames from the Figma desktop app via
> computer use, screenshots every page × width with headless Chrome (zero npm dependencies), diffs them
> pixel by pixel to locate the exact row/box that drifts, re-verifies every width after fixes, stress-tests
> text overflow, and runs real mouse-wheel scroll tests to catch scroll traps and clipped content.

---

## 目錄

- [為什麼需要這個 skill](#為什麼需要這個-skill)
- [功能總覽](#功能總覽)
- [安裝](#安裝)
- [環境需求](#環境需求)
- [快速開始](#快速開始)
- [完整流程](#完整流程)
  - [1. 從 Figma 匯出設計稿](#1-從-figma-匯出設計稿)
  - [2. 設定 qa.config.json](#2-設定-qaconfigjson)
  - [3. 逐斷點比對與修正](#3-逐斷點比對與修正)
  - [4. 全解析度回歸驗證](#4-全解析度回歸驗證)
  - [5. 文字溢出與塞爆測試](#5-文字溢出與塞爆測試)
  - [6. 捲動測試](#6-捲動測試)
  - [7. 回報](#7-回報)
- [腳本參考](#腳本參考)
- [設定檔參考](#設定檔參考)
- [Figma → CSS 常見落差](#figma--css-常見落差)
- [疑難排解](#疑難排解)
- [在 CI 使用](#在-ci-使用)
- [限制](#限制)
- [授權](#授權)

---

## 為什麼需要這個 skill

讓 AI 「照設計稿刻畫面」時，最常發生的問題是：

1. **憑感覺寫樣式**：間距差 4px、字級差一級、顏色差一個色階，肉眼並排看不出來。
2. **只對一個斷點**：做完桌機、手機版就是桌機的縮小版；或是修 768 時把 1440 弄壞了。
3. **只對短文案**：設計稿每張卡片的文字剛好放得下，換成真實資料（長地名、長網址）就溢出。
4. **只看靜態畫面**：捲動釘選、內部捲動區、sticky 元素，截圖看起來都對，實際一滑就卡住或內容被截斷。

這個 skill 把「量」這件事交給腳本：每一張截圖都和設計稿逐像素比對，
並且精確指出**第一個開始偏移的那一列**，AI 只需要修那一處，再重新驗證。

## 功能總覽

| 項目 | 做什麼 | 工具 |
|---|---|---|
| 匯出設計稿 | 用 computer use 操作 Figma 桌面版，匯出所有頁面 × 斷點的 PNG | Figma 桌面版 |
| 全頁截圖 | headless Chrome，指定寬度、等資料載入完成、去除開發用浮層、可攔截 API 換成固定資料 | `scripts/shoot.mjs` |
| 像素比對 | 頁高差、差異百分比、卡片位置差，輸出「設計稿｜實作｜差異」三欄比對圖 | `scripts/compare.py report` |
| 找出偏移點 | 逐列比對文字／方塊的 y 座標，第一個 Δ 改變的列就是 bug | `scripts/compare.py bands`、`boxes` |
| 局部放大、取色 | 放大比較同一區域、讀取精確色碼 | `scripts/compare.py zoom`、`color` |
| 溢出檢查 | 有底色或框線的方塊內，文字不可超出；頁面不可有水平捲軸 | 內建於 `shoot.mjs` |
| 文字塞爆 | 所有文字 ×3，或附加一長串不換行字串，再做溢出檢查 | `shoot.mjs --stress` |
| 捲動測試 | 在多個水平位置用真實滾輪從頂捲到底再捲回來，偵測捲動陷阱、內容截斷、到不了頁尾 | `scripts/scroll-test.mjs` |

腳本**沒有任何 npm 依賴**（只用 Node 22 內建的 `WebSocket` 透過 Chrome DevTools Protocol 操作 Chrome）；
比對腳本只需要 Pillow。

## 安裝

### Claude Code

```bash
# 個人（所有專案可用）
git clone https://github.com/ChouChouHu/figma2web-qa ~/.claude/skills/figma2web-qa

# 或只裝在某個專案
git clone https://github.com/ChouChouHu/figma2web-qa .claude/skills/figma2web-qa
```

之後在對話中說「幫我把這幾頁對齊 Figma 設計稿」或輸入 `/figma2web-qa` 即會使用。

### Codex CLI 與其他支援 Agent Skills 的工具

放到該工具讀取 skill 的資料夾，例如：

```bash
git clone https://github.com/ChouChouHu/figma2web-qa .agents/skills/figma2web-qa
```

### 不透過 AI，直接使用腳本

腳本本身是獨立的命令列工具，可以單獨執行（見[腳本參考](#腳本參考)）。

## 環境需求

| 需求 | 說明 |
|---|---|
| Node.js 22 以上 | 需要內建的 `WebSocket` 與 `fetch` |
| Google Chrome 或 Chromium | 自動偵測 macOS／Windows／Linux 預設安裝路徑；其他位置請設 `CHROME_PATH` |
| Python 3 + Pillow | `pip install pillow` |
| Figma 桌面版 | 匯出設計稿用。需要至少「可檢視」權限，且檔案擁有者沒有關閉「Viewers can copy, share, and export」 |
| Computer use | 讓 AI 操作 Figma 桌面版（例如 Claude 的 computer use）。也可以由人手動匯出 |
| 網站在本機跑起來 | 例如 `http://localhost:3000` |

## 快速開始

```bash
# 1. 設計稿放到 qa/design/<page>/<width>.png（見下節）
# 2. 建立設定檔
cp ~/.claude/skills/figma2web-qa/examples/qa.config.json ./qa.config.json   # 再依專案修改

S=~/.claude/skills/figma2web-qa/scripts
# 3. 截圖（含溢出檢查）
node $S/shoot.mjs --config qa.config.json
# 4. 比對
python3 $S/compare.py report --config qa.config.json
# 5. 塞爆測試、捲動測試
node $S/shoot.mjs --config qa.config.json --stress repeat
node $S/shoot.mjs --config qa.config.json --stress unbroken
node $S/scroll-test.mjs --config qa.config.json --width 1440 --shots
```

建議把 `qa/` 加進 `.gitignore`（設計稿截圖、比對圖不需要進版控）。

---

## 完整流程

### 1. 從 Figma 匯出設計稿

**先確認哪些頁面是交付稿。** 很多 Figma 檔案同時有草稿區、原型、實驗頁，
在草稿上量到的數值不算數，節點也可能已被刪除。請先問使用者或看設計交付文件。

**畫板命名**：把每個畫板命名為 `<page>/<width>`，例如 `home/390`、`home/1440`。
Figma 匯出時，名稱中的 `/` 會變成資料夾，匯出後直接得到 `home/390.png` 的結構。
如果不能改名，匯出後再整理成 `qa/design/<page>/<width>.png` 即可（路徑格式可在設定檔改）。

**匯出步驟**（AI 透過 computer use 執行，或由人手動操作）：

1. 開啟 Figma 桌面版，切到交付頁面。
2. 在左側圖層面板選取要匯出的畫板（Shift 可多選；選取一個 section 後按 Enter 會選取其所有子層）。
3. 右側面板最下方 **Export** → 按 `+` → 格式 **PNG**、倍率 **1x**（1 px = 1 CSS px，比對最準）。
4. 按 **Export N layers** → 存檔視窗中按 `⌘⇧G`（Windows：直接在路徑列輸入）輸入 `你的專案/qa/design`。

給 AI 操作時的經驗：

- 存檔視窗是系統元件，「背景操作模式」常常點不到，需要切換成全螢幕控制。
- 在存檔視窗的檔案清單上點一下取得焦點，再輸入 `~` 會直接開啟「前往資料夾」欄位，比快捷鍵穩定。
- 一次匯出一頁（該頁所有斷點）存到各自的資料夾，比一次匯出全部更不容易出錯。
- 匯出後一定要用檔案系統確認張數與尺寸。

**畫板外有留白？** 如果選取的是 section 而不是畫板本身，匯出圖會帶外框留白，執行：

```bash
python3 scripts/compare.py trim qa/design 390,768,1024,1440,1920
```

寬度已經等於斷點寬度的圖會被略過；其餘會裁掉四周與左上角同色的留白。

**為什麼不用 Figma REST API 下載圖片？** View／Collab 席位的 API 額度極少（每月個位數請求，
被 429 後要等上數天），而且圖片 API 輸出的是 Figma 伺服器的算繪結果。
桌面版匯出不吃額度，數量不限。若真的要用 API，**不要先打小請求探測額度**，一次把所有節點帶齊。

### 2. 設定 qa.config.json

完整欄位見[設定檔參考](#設定檔參考)。重點：

- **`busySelectors`**：頁面「還在載入」的標記（骨架、`aria-busy`、地圖載入中）。截圖會等這些都消失。
- **`localStorage`**：預先寫入，例如關掉 Cookie 同意橫幅，否則會蓋住頁面下緣。
- **`removeSelectors`**：截圖前移除的開發用浮層（Next.js 的 `nextjs-portal`、Vercel toolbar 等）。
- **`mocks`**：資料驅動的頁面（列表、詳情、首頁的最新消息）**一定要**用和設計稿相同內容的固定資料。
  真實資料的文字長度、筆數不同，換行與頁高就不可能相同，比對結果會被資料差異淹沒。
  做法：照設計稿把標題、時間、地點等文字填進一份 API 回應 JSON，用 `mocks` 攔截該 API。

### 3. 逐斷點比對與修正

**一次只處理一個寬度，從最小的開始。**

```bash
node scripts/shoot.mjs --config qa.config.json --widths 390
python3 scripts/compare.py report --config qa.config.json --widths 390
```

`report` 輸出：

```
page                     width design h  live h     Δh  diff%   boxes max box Δ
about                      390     3702    3703     +1  17.7%   7/7           1
pricing                    390     2420    2511    +91  12.3%   5/5          88
```

- **Δh**：頁高差。±1～2px 屬於抗鋸齒，可視為一致。
- **diff%**：像素不同的比例。圖片、影片、地圖等內容不同時本來就會偏高，**只看趨勢，不要追到 0**。
- **boxes**：沿頁面中線找到的卡片／區塊數（設計稿／實作），**max box Δ** 是位置或高度的最大差。
- 另外輸出 `qa/shots-compare/<page>/<width>.png`：左＝設計稿、中＝實作、右＝差異（紅色為不同）。

**找出偏移點**：

```bash
# 每張卡片的上緣與高度，找出第一張不同的
python3 scripts/compare.py boxes qa/design/pricing/390.png qa/shots/pricing/390.png

# 在那張卡片的範圍內（x 16–374、y 600–1200）逐列比對
python3 scripts/compare.py bands qa/design/pricing/390.png qa/shots/pricing/390.png 16 374 600 1200
```

`bands` 輸出每一列文字／方塊的起訖 y、高度、與上一列的間距，以及設計稿與實作的 Δy：

```
         design    h  gap |            live    h  gap | Δy
    737-772        35      |    737-772        35      | +0
    793-809        16   21 |    793-809        16   21 | +0
    877-893        16   20 |    873-889        16   16 | -4     ← 段落間距少了 4px
    901-917        16    8 |    897-913        16    8 | -4
```

**Δy 第一次改變的那一列就是問題所在**（上例：段落間距設計稿 20、實作 16）。
修好後，後面所有列會一起歸零。

**讀精確數值**：

```bash
python3 scripts/compare.py zoom qa/design/x/390.png qa/shots/x/390.png 0 600 390 200 3   # 放大 3 倍
python3 scripts/compare.py color qa/design/x/390.png 120 640                              # #1E293B  rgb(30,41,59)
```

**修正原則**：

- 只用量到的數值；換算成專案既有的 design token，不要四捨五入到「差不多」。
- 量測對象是**匯出圖**。若專案還有其他來源（舊的 JSON 快取、規格文件）與匯出圖衝突，以較新的匯出圖為準，並告知使用者。
- 修改後重新截圖確認，再往下一處。每完成一頁就 commit。
- 設計稿本身有問題時（文字疊在一起、某斷點漏改）**不要自行發明**，先記錄、最後問使用者。

### 4. 全解析度回歸驗證

**所有寬度都修完之後，一定要重新截圖全部頁面 × 全部寬度。**
響應式樣式彼此影響：為了修 768 改的 `md:` 樣式，可能讓 1024 也跟著變；
共用元件（卡片、按鈕）改了，其他頁面一起變。

```bash
node scripts/shoot.mjs --config qa.config.json
python3 scripts/compare.py report --config qa.config.json
```

任何一個先前已對齊的寬度變差，就是被後來的修改弄壞了。修正後再跑一次完整回歸，直到全部穩定。

### 5. 文字溢出與塞爆測試

`shoot.mjs` **每次截圖都會自動檢查**：

- 每個「看起來是方塊」的元素（有背景色或框線）裡的文字，不可超出方塊的邊界。
- 頁面不可出現水平捲軸。

以下情況會自動略過（屬於刻意設計）：可捲動或裁切的容器（`overflow` 不是 `visible`）、
文字與方塊之間有裁切祖先（`truncate`、`line-clamp`）、視覺隱藏文字（`sr-only`、`aria-hidden`）。

設計稿的文案通常剛好放得下，真實資料不會。所以再跑兩種塞爆模式：

```bash
node scripts/shoot.mjs --config qa.config.json --stress repeat     # 每段文字重複 3 次
node scripts/shoot.mjs --config qa.config.json --stress unbroken   # 每段文字後面加一長串不換行的網址
```

輸出範例：

```
✓ article 390px  h=2513  ⚠️ 2 overflow
    · "Grand Opening Weekend — Downtown Flagship" overflows div.info-card by 0×38px
    · "Source: https://example.com/aVeryLongUnb" overflows footer by 49×0px
```

常見修法：

| 症狀 | 修法 |
|---|---|
| 卡片高度固定，長文字往下溢出 | `height` → `min-height` |
| Grid 用 `grid-rows-2`／`minmax(0,1fr)`，長文字溢出 | 改 `grid-template-rows: 1fr 1fr`（1fr 的下限是內容高度） |
| Flex 子項目長字串撐破容器 | 子項目加 `min-width: 0` |
| 網址、編號等無法斷行 | `overflow-wrap: anywhere` |
| 刻意截斷 | 用 `truncate`／`line-clamp`，並提供完整文字給螢幕閱讀器 |

塞爆模式找到的不一定都要修（例如刻意固定寬度的按鈕），但要列入回報。

### 6. 捲動測試

靜態截圖看不出捲動問題：JavaScript 實作的釘選區塊、內部捲動容器、攔截滾輪的地圖元件，
常常造成「捲不動」、「內容只捲到一半」、「永遠到不了頁尾」。

```bash
node scripts/scroll-test.mjs --config qa.config.json --width 1440 --shots
node scripts/scroll-test.mjs --config qa.config.json --width 1440 --height 700   # 矮視窗再測一次
```

在多個水平位置（預設畫面寬度的 25%／50%／75%，例如地圖上、側欄上）各用真實滾輪事件從頂捲到底、再捲回頂：

```
✓ about @x=0.25  17 steps
✗ report-detail @x=0.75  4 steps  stuck at y=0/300 · no-bottom (y=0/300) · footer "footer" never visible
```

| 結果 | 意義 |
|---|---|
| `stuck` | 連續多次滾輪什麼都沒動，但頁面還沒到底（滾輪被攔截／捲動陷阱） |
| `no-bottom` | 頁面始終到不了最底 |
| `footer … never visible` | 頁尾從未出現在畫面中 |
| `cut` | 游標下的內部捲動容器沒有捲到自己的底部（內容被截斷） |
| `no-top` | 往回捲無法回到頁頂 |

`--shots` 每隔幾步存一張視窗截圖到 `qa/shots-scroll/<page>/`，用來檢查 sticky 元素蓋住內容、
捲動中出現的浮層提示、區塊半渲染等需要肉眼判斷的問題。

### 7. 回報

最後給使用者一張表：每頁 × 每個寬度的剩餘差異與原因，例如：

| 原因 | 處理 |
|---|---|
| 資料與設計稿不同（筆數、文字長度） | 版面結構已逐列比對過，頁高不可比 |
| 設計稿本身瑕疵（文字重疊、溢出畫板、某斷點漏改） | 實作讓容器長高；列出請設計確認 |
| 平台文字排版差異（Figma 與瀏覽器的中文標點斷行、字距） | 無法消除，說明即可 |
| 設計稿有但缺素材（檔案、圖片） | 先放上，列為待辦 |

---

## 腳本參考

### `shoot.mjs`

```
node shoot.mjs --config <file> [--pages a,b] [--widths 390,1440] [--out <dir>] [--stress repeat|unbroken]
```

| 參數 | 說明 |
|---|---|
| `--config` | 設定檔路徑（預設 `qa.config.json`） |
| `--pages` | 只拍指定頁面（`name`，逗號分隔） |
| `--widths` | 只拍指定寬度 |
| `--out` | 輸出資料夾（預設設定檔的 `out`；塞爆模式為 `<out>-stress-<mode>`） |
| `--stress` | `repeat`：文字 ×3；`unbroken`：附加不換行長字串 |

輸出 `<out>/<page>/<width>.png` 與 `<out>/report.json`（每張的頁高、是否載入完成、溢出清單）。
有任何溢出時結束碼為 1。

技術細節：

- 用 `--use-angle=swiftshader` 讓 headless Chrome 能算繪 WebGL（地圖、3D 元件）。
- 強制分頁位於前景並模擬 focus。headless 分頁可能被視為 `hidden`，`requestAnimationFrame` 會停住，
  canvas／WebGL 內容（例如地圖）永遠畫不完。
- 等待條件：`busySelectors` 都消失、`document.fonts.ready`、網路請求連續數次沒有新增。
- 每次都用新的暫存 Chrome profile，結束或中斷時一定關閉 Chrome（殘留程序會占住 port 導致下次卡住）。

### `scroll-test.mjs`

```
node scroll-test.mjs --config <file> [--pages a,b] [--width 1440] [--height 900] [--x 0.25,0.75] [--footer footer] [--shots]
```

| 參數 | 說明 |
|---|---|
| `--width`／`--height` | 視窗大小。至少測一般高度與矮視窗（例如 700） |
| `--x` | 滾輪位置（畫面寬度的比例），用來測試游標停在不同元件上 |
| `--footer` | 頁尾選擇器（預設設定檔的 `footerSelector` 或 `footer`） |
| `--shots` | 每隔幾步存視窗截圖 |

有任何問題時結束碼為 1。

### `compare.py`

| 指令 | 用途 |
|---|---|
| `trim <dir> <widths>` | 裁掉匯出圖四周的同色留白 |
| `report --config <file> [--pages] [--widths]` | 全部頁面 × 寬度的比對表，並輸出三欄比對圖 |
| `boxes <design> <live> [x]` | 沿第 x 欄列出每張卡片的上緣與高度差 |
| `bands <design> <live> x0 x1 [y0 y1 [live_y0]]` | 逐列比對；設計稿與實作在不同 y 時可另指定 `live_y0` 對齊 |
| `zoom <design> <live> x y w h [scale] [live_y]` | 上下排列放大：設計稿／實作／反相差異，輸出 `qa-zoom.png` |
| `color <png> x y` | 取得像素色碼 |

## 設定檔參考

```jsonc
{
  "baseUrl": "http://localhost:3000",          // 網站根網址；也可以是 file:///…/
  "widths": [390, 768, 1024, 1440, 1920],      // 斷點（設計稿畫布寬）
  "height": 900,                               // 視窗高度（全頁截圖不受影響）
  "pages": [
    { "name": "home", "path": "/" },           // name 對應設計稿資料夾名
    { "name": "article", "path": "/articles/detail/?id=123" }
  ],
  "design": "qa/design/{page}/{width}.png",    // 設計稿路徑樣板
  "out": "qa/shots",                           // 截圖輸出
  "localStorage": { "cookie-consent": "accepted" },
  "removeSelectors": ["nextjs-portal"],        // 截圖前移除
  "busySelectors": ["[aria-busy=\"true\"]", ".skeleton"],
  "footerSelector": "footer",
  "settleTimeoutMs": 20000,
  "mocks": [                                   // 網址包含 match 的請求，回應換成 file 內容
    { "match": "/api/articles/123", "file": "qa/fixtures/article-123.json" },
    { "match": "/feed.xml", "file": "qa/fixtures/feed.xml", "contentType": "application/xml" }
  ]
}
```

所有相對路徑都以設定檔所在資料夾為基準。

## Figma → CSS 常見落差

| 現象 | 原因 | 做法 |
|---|---|---|
| 有框線的元件寬高多 2px | Figma 的 stroke 預設畫在框內、不佔尺寸；CSS `border` 會加在尺寸上 | 用 `box-shadow: inset 0 0 0 1px`（Tailwind `ring-1 ring-inset`），或 padding 減 1 |
| 48 高的列表項目實作是 50 | 同上，垂直方向 | `padding-block: 11px` 取代 12 |
| 圖示比文字高 1～2px | inline 元素對齊 baseline，留出字母下緣空間 | 外層 `display:flex; align-items:center` |
| 同一元件在手機版長得完全不同 | 設計稿在小螢幕是另一種版型，不是桌機縮小 | 每個斷點都讀設計稿，不要推測 |
| 間距只在某個斷點不同 | 設計師逐斷點調整 | 用斷點前綴（`md:`、`xl:`）各自設定 |
| 長標題換行位置不同 | Figma 與瀏覽器的中日韓文標點斷行規則不同 | 通常無法消除，回報即可；不要為此硬調寬度（會讓其他寬度跑掉） |
| 圖片顏色差一點 | 色彩描述檔、壓縮 | 用 `color` 指令讀純色區塊，不要從照片取色 |

## 疑難排解

| 問題 | 解法 |
|---|---|
| `Chrome not found` | 設定 `CHROME_PATH` 環境變數 |
| 截圖停在骨架畫面、出現「not settled」 | 把頁面的載入標記加到 `busySelectors`；或加大 `settleTimeoutMs` |
| 地圖或 canvas 一片空白 | 確認元件在無 GPU 環境下不會拋錯；腳本已使用 SwiftShader 與前景模式 |
| 截圖下緣被 Cookie 橫幅蓋住 | 在 `localStorage` 預先寫入同意狀態 |
| 頁面出現開發工具的浮動按鈕 | 加到 `removeSelectors` |
| 腳本卡住不動 | 殘留的 Chrome 程序：`pkill -f figma2web-qa-` 後重跑 |
| 詳情頁需要 id | 在 `pages[].path` 帶入真實或 mock 的 id |
| 比對差異百分比很高 | 影片、地圖、照片內容不同是正常的；看 `boxes`／`bands` 的結構差即可 |

## 在 CI 使用

`shoot.mjs`（有溢出時）與 `scroll-test.mjs`（有捲動問題時）結束碼為 1，可直接放進 CI：

```yaml
- run: npm run build && npx serve out -l 3000 &
- run: node .claude/skills/figma2web-qa/scripts/shoot.mjs --config qa.config.json --stress repeat
- run: node .claude/skills/figma2web-qa/scripts/scroll-test.mjs --config qa.config.json --width 1440
```

## 限制

- 比對以截圖為準，無法判斷 hover、focus 等互動狀態；需要時請另外截取該狀態。
- 抗鋸齒、字型算繪、影片／地圖內容會造成無法消除的像素差，所以以「結構（位置、高度、間距）一致」為驗收標準，而不是 diff 為 0。
- 捲動測試使用滾輪事件；觸控滑動與鍵盤捲動請另外人工確認。
- 匯出設計稿需要 Figma 桌面版與匯出權限。

## 授權

MIT
