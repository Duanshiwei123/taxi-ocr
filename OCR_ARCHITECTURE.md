# OCR 架构文档

> 本文档描述打车发票与加班记录核验系统的 OCR 方案，供 AI 辅助开发参考。

---

## 1. 概述

本系统使用 **百度智能云 OCR** 作为底层识别引擎，通过自研 Node.js 后端服务对识别结果进行解析、校验和补全，最终在前端展示结构化数据并做日期匹配核验。

**核心能力：**
- 识别出租车发票、网约车行程单、增值税发票
- 识别加班记录截图/照片，提取日期和时长
- 自动校验识别结果（金额、时间、日期合理性）
- 识别失败时自动 fallback 到通用 OCR 重新提取

---

## 2. 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端 | 原生 HTML + CSS + JS | 无框架，单页应用 |
| 后端 | Node.js + Express | RESTful API |
| OCR 引擎 | 百度智能云 OCR | `multiple_invoice` + `accurate_basic` |
| 文件上传 | Multer（内存模式） | 限制 15MB/文件 |
| PDF 处理 | pdfjsLib（前端） | 将 PDF 首页转为 PNG 图片后识别 |
| 环境配置 | dotenv | API Key 管理 |

---

## 3. 架构总览

```
┌─────────────────┐     HTTP POST /api/ocr     ┌──────────────────────┐
│   前端浏览器     │ ─────────────────────────→ │   Node.js 后端服务    │
│  (index.html)   │ ←───────────────────────── │   (server.js)        │
└─────────────────┘    返回 JSON 结果          └──────────┬───────────┘
                                                         │
                                    ┌────────────────────┼────────────────────┐
                                    ↓                                               ↓
                          ┌─────────────────┐                         ┌─────────────────────┐
                          │  百度 OCR API    │                         │  百度 OCR API        │
                          │ multiple_invoice │                         │  accurate_basic      │
                          │ (财务票据专用)    │                         │  (通用高精度)        │
                          └─────────────────┘                         └─────────────────────┘
```

---

## 4. 后端架构（server.js）

### 4.1 环境配置

在 `.env` 文件中配置（**不提交到 Git**）：

```env
BAIDU_API_KEY=你的API_KEY
BAIDU_SECRET_KEY=你的SECRET_KEY
PORT=3000
```

服务端启动时会校验这两个变量，缺失则直接退出。

### 4.2 百度 OCR Access Token 管理

```javascript
let baiduAccessToken = null;
let baiduTokenExpireTime = 0;
```

- Token 通过 `getBaiduAccessToken()` 获取，自动缓存在内存中
- 过期前 5 分钟自动刷新（避免临界过期）
- Token 获取接口：`https://aip.baidubce.com/oauth/2.0/token`

### 4.3 API 端点

#### `POST /api/ocr`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `image` | File | ✅ | 图片文件（支持 PNG/JPG/PDF转换后的图片） |
| `type` | string | ❌ | `invoice`（默认）或 `overtime` |

**响应结构：**

```json
{
  "content": "{...}",       // 第一条结果的 JSON 字符串
  "type": "financial|general|overtime",  // 实际使用的 OCR 类型
  "raw": "原始文本...",      // 便于人工复核的原始识别文本
  "allResults": [...]        // 所有识别结果（多发票时有多条）
}
```

---

### 4.4 发票识别流程（`ocrType = 'invoice'`）

```
输入图片
   │
   ↓
调用 Baidu Financial OCR (multiple_invoice)
   │
   ├─ 成功 → parseMultipleInvoiceResult()
   │           ├─ 校验金额 (isValidAmount)
   │           ├─ 校验时间 (isValidTime)
   │           ├─ 校验日期 (isValidDate)
   │           └─ 校验失败 → extractValidXxxFromText() 从原始文本兜底提取
   │
   └─ 失败/无结果 → fallback 到 General OCR (accurate_basic)
                    └─ parseGeneralOcrResult()
                       └─ 同样经过校验 + 兜底提取
```

#### 支持的发票类型（`multiple_invoice` 返回 `type` 字段）

| type 值 | 说明 | 关键字段 |
|---------|------|---------|
| `taxi_receipt` | 出租车发票 | Date, Time, TotalFare, PickupLocation, DropoffLocation |
| `taxi_online_ticket` | 网约车行程单 | items[].pickup_date/time, start_place, destination_place, fare |
| `vat_invoice` | 增值税发票 | InvoiceDate, TotalAmount, InvoiceNum |

#### 校验与兜底机制

每个字段提取后都会经过校验，校验失败时从 OCR 原始文本的**完整 JSON** 中重新提取：

```javascript
// 金额校验：5 ~ 500 元，且数字长度不超过 6 位（排出发票代码）
function isValidAmount(val) → boolean

// 时间校验：HH:MM 格式，小时 0-23，分钟 0-59
function isValidTime(val) → boolean

// 日期校验：YYYY-MM-DD 格式，月 1-12，日 1-31
function isValidDate(val) → '' | normalizedDate
```

兜底提取支持的关键词模式（金额为例）：
- `¥` 或 `￥` 后接数字
- `元`/`块` 前的数字
- `金额：`/`总计：`/`合计：`/`费用：` 后的数字

---

### 4.5 加班记录识别流程（`ocrType = 'overtime'`）

```
输入图片
   │
   ↓
调用 Baidu General OCR (accurate_basic)
   │
   ↓
parseOvertimeOcrResult()
   │
   ├─ 提取员工姓名 (extractEmployeeName)
   │    Priority 1: v_ / v- 前缀格式（如 v_isweduan）
   │    Priority 2: "申请人"/"姓名"/"员工"/"员工姓名"/"工号" 后的内容
   │    Priority 3: 独立一行的 v_ 格式
   │
   └─ 按行解析，用 Map<dateStr, {times, rawLines}> 合并同一天的多条时间记录
        ├─ 日期格式：YYYY-MM-DD、YYYY/MM/DD、YYYY年MM月DD日、MM-DD
        ├─ 时间格式：HH:MM（一行可提取多个时间，取最早和最晚）
        └─ 计算加班时长：(最晚时间 - 最早时间) / 60 小时
```

---

## 5. 前端架构（public/index.html）

### 5.1 文件上传

- 支持**多选**（发票）和**单选**（加班记录）
- 支持**拖拽上传**
- **PDF 自动转换**：通过 `pdfjsLib` 将 PDF 首页渲染为 Canvas，导出为 PNG Blob 后再上传
- 前端去重：同一文件名+大小的文件不重复添加

### 5.2 OCR 调用

```javascript
// 核心调用函数
async function callOCR(file, prompt) {
  const fd = new FormData();
  fd.append('image', file);
  fd.append('type', prompt === 'overtime' ? 'overtime' : 'invoice');
  const resp = await fetch('/api/ocr', { method: 'POST', body: fd });
  return await resp.json();
}
```

### 5.3 主流程（`startAnalysis()`）

```
1. 过滤重复发票（已分析过的跳过）
   ↓
2. 逐张识别发票（循环调用 /api/ocr?type=invoice）
   ↓
3. 识别加班记录（调用 /api/ocr?type=overtime）
   ↓
4. 日期匹配：将发票日期与加班日期比对，标记 matched
   ↓
5. 渲染结果表格 + 加班凭证（Canvas 绘制）
   ↓
6. 保存快照到 otHistory（支持多批次切换查看）
```

### 5.4 批次隔离机制

- 每次"分析"的记录保存在 `otHistory[]` 快照中
- 每个快照包含：`otRecords`、`otDates`、`matchedDates`、`batchInvs`（本次批次的发票数据）
- 切换 tab 时只渲染对应批次的数据，不会跨批次混杂

---

## 6. 数据结构

### 6.1 发票识别结果（`invResults[]` 中每项）

```typescript
interface InvoiceResult {
  fileName: string;    // 上传时的文件名
  date: string;         // 乘车日期，格式 YYYY-MM-DD
  time: string;         // 乘车时间，格式 HH:MM 或 HH:MM-HH:MM
  amount: string;       // 金额（字符串，如 "25.5"）
  origin: string;       // 上车地点
  destination: string;  // 下车地点
  type: string;         // 类型："出租车" | "网约车" | "增值税发票" | "其他"
  invoice_no: string;   // 发票号码
  matched: boolean;     // 是否与加班日期匹配
  normDate: string;     // 标准化日期（用于匹配）
  employee: string;     // 所属员工姓名（v_ 格式）
  raw: string;          // OCR 原始返回（用于复核）
}
```

### 6.2 加班记录解析结果（`otRecords[]` 中每项）

```typescript
interface OvertimeRecord {
  date: string;         // 加班日期，格式 YYYY-MM-DD
  time: string;         // 时间范围，格式 HH:MM-HH:MM
  start_time: string;   // 开始时间 HH:MM
  end_time: string;     // 结束时间 HH:MM
  hours: string;        // 加班时长（小时，保留1位小数）
  employee: string;     // 员工姓名（v_ 格式）
  raw: string;          // 原始 OCR 文本（用于复核）
}
```

### 6.3 加班凭证快照（`otHistory[]` 中每项）

```typescript
interface OtHistorySnapshot {
  otRecords: OvertimeRecord[];
  otDates: string[];          // 加班日期列表
  matchedDates: string[];     // 匹配到的日期列表
  canvasDataUrl: string;      // Canvas 绘制的凭证图片（base64）
  employeeName: string;       // 员工姓名
  ts: number;                 // 时间戳
  batchInvs: InvoiceResult[]; // 本次批次的发票数据（按批次隔离）
}
```

---

## 7. 部署说明

### 7.1 安装依赖

```bash
npm install
```

`package.json` 中的关键依赖：

```json
{
  "dependencies": {
    "dotenv": "^16.x",
    "express": "^4.x",
    "multer": "^1.x",
    "node-fetch": "^2.x",
    "cors": "^2.x"
  }
}
```

### 7.2 启动服务

```bash
# 开发模式（自动重启）
npm run dev   # 需要安装 nodemon

# 生产模式
npm start
```

服务默认监听 `http://localhost:3000`，端口可通过 `.env` 中的 `PORT` 变量覆盖。

### 7.3 百度 OCR 权限要求

- `multiple_invoice` 需要申请**财务票据 OCR** 权限
- `accurate_basic` 需要申请**通用文字识别（高精度版）** 权限
- 两个 API 的调用量分开计费，fallback 机制可有效降低成本

---

## 8. 关键文件清单

| 文件 | 说明 |
|------|------|
| `server.js` | 后端主文件，OCR 调用 + 结果解析 |
| `public/index.html` | 前端主文件，上传 + OCR 调用 + 结果展示 |
| `.env` | API Key 配置（需自行创建，不提交） |
| `package.json` | 依赖声明 |

---

## 9. 常见问题（供 AI 参考）

**Q：为什么发票金额识别错误？**
A：百度 OCR 可能将长数字（发票代码）误识别为金额。系统通过 `isValidAmount()` 校验（5~500元范围，数字长度≤6位），校验失败会从原始文本中重新提取含 `¥`/`元` 等关键词的金额。

**Q：加班记录识别不到日期？**
A：`parseOvertimeOcrResult()` 支持多种日期格式，但 OCR 质量太差时可能失败。可以检查 `raw` 字段看原始识别结果，必要时手动录入。

**Q：第二批分析后第一批数据变了？**
A：这是已修复的 bug。修复方案：匹配逻辑只处理本次新增发票（`lastAnalysisCount` 索引之后），`renderOtTableBodyOnly()` 只渲染当前批次快照中的 `batchInvs`。

**Q：如何扩展支持更多发票类型？**
A：在 `parseMultipleInvoiceResult()` 的 `if/else if` 链中新增 `type` 判断分支，参照现有逻辑提取对应字段并校验。
