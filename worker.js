/**
 * 打车发票 & 加班记录核验系统 - Cloudflare Worker 后端
 * 替代原 server.js (Express 版本)
 *
 * 部署：wrangler deploy
 * 配置密钥：wrangler secret put BAIDU_API_KEY / BAIDU_SECRET_KEY
 */

// ─── 百度 OCR access_token 缓存（Worker 全局缓存，每次冷启动重置）───
let baiduAccessToken = null;
let baiduTokenExpireTime = 0;

// 获取百度 OCR access_token
async function getBaiduAccessToken(apiKey, secretKey) {
  const now = Date.now();
  if (baiduAccessToken && now < baiduTokenExpireTime - 5 * 60 * 1000) {
    return baiduAccessToken;
  }

  const url = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${apiKey}&client_secret=${secretKey}`;
  const resp = await fetch(url, { method: 'POST' });
  if (!resp.ok) throw new Error('Failed to get Baidu access_token: ' + await resp.text());
  const data = await resp.json();

  if (data.error) {
    throw new Error(`Baidu Auth Error: ${data.error} - ${data.error_description || ''}`);
  }

  baiduAccessToken = data.access_token;
  baiduTokenExpireTime = now + (data.expires_in || 2592000) * 1000;
  console.log('[Baidu] access_token obtained, expires in', data.expires_in, 'seconds');
  return baiduAccessToken;
}

// 调用百度 OCR API
async function callBaiduApi(token, apiPath, body) {
  const url = `https://aip.baidubce.com${apiPath}?access_token=${token}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!resp.ok) throw new Error(`Baidu OCR API error: HTTP ${resp.status}`);
  return await resp.json();
}

// 从百度 OCR 结果字段中提取文字
function getWordValue(field) {
  if (!field) return '';
  if (Array.isArray(field) && field.length > 0) {
    return field[0].word || field[0] || '';
  }
  if (typeof field === 'string') return field;
  if (field.word) return field.word;
  return '';
}

// ─── 校验工具 ────────────────────────────────────────────────────────────

function isValidAmount(val) {
  const n = parseFloat(val);
  if (isNaN(n)) return false;
  if (n < 5 || n > 500) return false;
  const s = String(val).replace(/[^\d]/g, '');
  if (s.length > 6) return false;
  return true;
}

function isValidTime(val) {
  if (!val) return false;
  const m = String(val).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return false;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  return h >= 0 && h <= 23 && min >= 0 && min <= 59;
}

function isValidDate(val) {
  if (!val) return '';
  const m = String(val).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  return val;
}

function extractValidAmountFromText(text) {
  if (!text) return '';
  const patterns = [
    /[¥￥]\s*(\d+\.?\d*)/g,
    /(\d+\.?\d*)\s*[元块]/g,
    /金额[：:](\d+\.?\d*)/g,
    /总计[：:](\d+\.?\d*)/g,
    /合计[：:](\d+\.?\d*)/g,
    /费用[：:](\d+\.?\d*)/g,
  ];
  for (const p of patterns) {
    const matches = [...text.matchAll(p)];
    for (const m of matches) {
      const v = parseFloat(m[1]);
      if (v >= 5 && v <= 500 && String(m[1]).replace(/[^\d]/g, '').length <= 6) {
        return String(v);
      }
    }
  }
  const allNums = text.match(/(\d{1,3}\.?\d*)/g);
  if (allNums) {
    for (const n of allNums) {
      const v = parseFloat(n);
      if (v >= 5 && v <= 500 && String(n).replace(/[^\d]/g, '').length <= 6) return String(v);
    }
  }
  return '';
}

function extractValidTimeFromText(text) {
  if (!text) return '';
  const matches = text.match(/(\d{1,2}:\d{2})/g);
  if (!matches) return '';
  for (const t of matches) {
    if (isValidTime(t)) return t;
  }
  return '';
}

function extractValidDateFromText(text) {
  if (!text) return '';
  const full = text.match(/(\d{4})[.\-/年](\d{1,2})[.\-/月](\d{1,2})/);
  if (full) {
    const m = parseInt(full[2], 10);
    const d = parseInt(full[3], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${full[1]}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  const short = text.match(/(\d{1,2})[.\-/](\d{1,2})/);
  if (short) {
    const m = parseInt(short[1], 10);
    const d = parseInt(short[2], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${new Date().getFullYear()}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  return '';
}

function normalizeDateStr(val) {
  if (!val) return '';
  const s = String(val).trim()
    .replace(/年/g, '-').replace(/月/g, '-').replace(/日/g, '').replace(/\//g, '-');
  const p = s.split('-');
  if (p.length === 3) {
    return `${p[0]}-${p[1].padStart(2, '0')}-${p[2].padStart(2, '0')}`;
  }
  return s;
}

// Clean up origin/destination: strip trailing date+time that Baidu OCR sometimes appends
function cleanAddressField(val) {
  if (!val || typeof val !== 'string') return val || '';
  let s = val.trim();
  // Pattern 1: "地址2026-04-2322:39" (date+time stuck to end)
  s = s.replace(/\d{4}[-./]\d{1,2}[-./]\d{1,2}\s*\d{1,2}:\d{2}$/, '');
  // Pattern 2: "地址 2026-04-23 22:39" (date+time with space)
  s = s.replace(/\s+\d{4}[-./]\d{1,2}[-./]\d{1,2}\s+\d{1,2}:\d{2}\s*$/, '');
  // Pattern 3: just trailing date "地址2026-04-23"
  s = s.replace(/\d{4}[-./]\d{1,2}[-./]\d{1,2}$/, '');
  return s.trim();
}

// ─── 解析百度财务票据 OCR 结果 ────────────────────────────────────────────

function parseMultipleInvoiceResult(data) {
  const results = [];

  if (!data.words_result || !Array.isArray(data.words_result)) {
    console.warn('[OCR] No words_result found, fallback to general OCR');
    return null;
  }

  data.words_result.forEach(item => {
    const type = item.type || '';
    const result = item.result || {};
    const rawText = JSON.stringify(item, null, 2);

    let parsed = {
      date: '', time: '', amount: '',
      origin: '', destination: '',
      type: '其他', invoice_no: '', raw: rawText,
    };

    let extractedDate = '';
    let extractedTime = '';
    let extractedAmount = '';

    if (type === 'taxi_receipt') {
      parsed.type = '出租车';
      extractedDate = getWordValue(result.Date);
      extractedTime = getWordValue(result.Time) ||
        (getWordValue(result.PickupTime) + (getWordValue(result.DropoffTime) ? '-' + getWordValue(result.DropoffTime) : ''));
      extractedAmount = getWordValue(result.TotalFare) || getWordValue(result.Fare);
      parsed.origin = cleanAddressField(getWordValue(result.PickupLocation) || getWordValue(result.Location));
      parsed.destination = cleanAddressField(getWordValue(result.DropoffLocation) || '');
      parsed.invoice_no = getWordValue(result.InvoiceNum) || getWordValue(result.InvoiceCode);

    } else if (type === 'taxi_online_ticket') {
      parsed.type = '网约车';
      const items = result.items || [];
      if (items.length > 0) {
        const firstItem = items[0];
        extractedDate = getWordValue(firstItem.pickup_date) || getWordValue(result.application_date);
        extractedTime = getWordValue(firstItem.pickup_time) || '';
        extractedAmount = getWordValue(firstItem.fare) || getWordValue(result.total_fare);
        parsed.origin = cleanAddressField(getWordValue(firstItem.start_place) || '');
        parsed.destination = cleanAddressField(getWordValue(firstItem.destination_place) || '');
      }
      parsed.invoice_no = '';

    } else if (type === 'vat_invoice') {
      parsed.type = '增值税发票';
      extractedDate = getWordValue(result.InvoiceDate);
      extractedAmount = getWordValue(result.TotalAmount);
      parsed.invoice_no = getWordValue(result.InvoiceNum) || getWordValue(result.InvoiceCode);

    } else {
      parsed.type = type;
    }

    // 校验 & fallback：金额
    if (extractedAmount) {
      const cleaned = String(extractedAmount).replace(/[^\d.]/g, '');
      if (isValidAmount(cleaned)) {
        parsed.amount = cleaned;
      } else {
        console.warn('[OCR] Amount validation failed:', extractedAmount, '- trying fallback');
        parsed.amount = extractValidAmountFromText(rawText);
        if (!parsed.amount) console.warn('[OCR] No valid amount found in raw text');
      }
    } else {
      parsed.amount = extractValidAmountFromText(rawText);
    }

    // 校验 & fallback：日期
    if (extractedDate) {
      const normalized = normalizeDateStr(extractedDate);
      if (isValidDate(normalized)) {
        parsed.date = normalized;
      } else {
        console.warn('[OCR] Date validation failed:', extractedDate, '- trying fallback');
        parsed.date = extractValidDateFromText(rawText);
      }
    } else {
      parsed.date = extractValidDateFromText(rawText);
    }

    // 校验 & fallback：时间
    if (extractedTime) {
      const timeParts = extractedTime.match(/(\d{1,2}:\d{2})/g);
      if (timeParts && timeParts.length >= 2) {
        const s = timeParts[0], e = timeParts[timeParts.length - 1];
        if (isValidTime(s) && isValidTime(e)) {
          parsed.time = `${s}-${e}`;
        }
      } else if (timeParts && timeParts.length === 1 && isValidTime(timeParts[0])) {
        parsed.time = timeParts[0];
      } else {
        parsed.time = extractValidTimeFromText(rawText);
      }
    } else {
      parsed.time = extractValidTimeFromText(rawText);
    }

    results.push(parsed);
  });

  return results;
}

// ─── 解析通用 OCR 结果 ─────────────────────────────────────────────────────

function parseGeneralOcrResult(data) {
  const words = data.words_result || [];
  const fullText = words.map(w => w.words).join('\n');

  const result = {
    date: '', time: '', amount: '',
    origin: '', destination: '',
    type: '网约车', invoice_no: '', raw: fullText,
  };

  const rawDate = extractValidDateFromText(fullText);
  if (rawDate && isValidDate(rawDate)) result.date = rawDate;

  const rawAmt = extractValidAmountFromText(fullText);
  result.amount = rawAmt;

  const rawTime = extractValidTimeFromText(fullText);
  if (rawTime) {
    const rangeMatch = fullText.match(/(\d{1,2}:\d{2})\s*[-~至]\s*(\d{1,2}:\d{2})/);
    if (rangeMatch && isValidTime(rangeMatch[1]) && isValidTime(rangeMatch[2])) {
      result.time = `${rangeMatch[1]}-${rangeMatch[2]}`;
    } else if (isValidTime(rawTime)) {
      result.time = rawTime;
    }
  }

  return [result];
}

// ─── 解析加班记录 OCR 结果 ────────────────────────────────────────────────

function extractEmployeeName(text) {
  if (!text) return '';
  const flatText = text.replace(/\n/g, ' ').replace(/\s+/g, ' ');

  const vMatch = text.match(/v[_\-][a-zA-Z0-9_]+/i);
  if (vMatch) return vMatch[0].replace(/v-/i, 'v_').toLowerCase();

  const patterns = [
    /申请人[：:\s]+([a-zA-Z0-9_\u4e00-\u9fa5]+)/,
    /姓名[：:\s]+([a-zA-Z0-9_\u4e00-\u9fa5]+)/,
    /员工[：:\s]+([a-zA-Z0-9_\u4e00-\u9fa5]+)/,
    /员工姓名[：:\s]+([a-zA-Z0-9_\u4e00-\u9fa5]+)/,
    /工号[：:\s]+([a-zA-Z0-9_]+)/,
  ];
  for (const p of patterns) {
    const m = flatText.match(p);
    if (m) return m[1];
  }

  const vLineMatch = text.match(/^v[_\-][a-zA-Z0-9_]+$/m);
  if (vLineMatch) return vLineMatch[0].replace(/v-/i, 'v_').toLowerCase();

  return '';
}

function parseOvertimeOcrResult(data) {
  const words = data.words_result || [];
  const fullText = words.map(w => w.words).join('\n');

  console.log('[OCR] Overtime raw text:', fullText);

  const employeeName = extractEmployeeName(fullText);
  console.log('[OCR] Extracted employee name:', employeeName);

  const dateMap = new Map();
  const lines = fullText.split('\n');

  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let dateStr = '';
    let year = '', month = '', day = '';

    let dateMatch = trimmed.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:\D|$)/);
    if (dateMatch) {
      year = dateMatch[1];
      month = dateMatch[2].padStart(2, '0');
      day = dateMatch[3].padStart(2, '0');
    } else {
      dateMatch = trimmed.match(/^(\d{1,2})[.\-/](\d{1,2})(?=\d{2}:\d{2})/);
      if (dateMatch) {
        const m = parseInt(dateMatch[1], 10);
        const d = parseInt(dateMatch[2], 10);
        if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
          year = String(new Date().getFullYear());
          month = String(m).padStart(2, '0');
          day = String(d).padStart(2, '0');
        }
      }
    }

    if (!year) return;
    dateStr = `${year}-${month}-${day}`;

    const timeMatches = trimmed.match(/(\d{1,2}:\d{2})/g);
    if (!dateMap.has(dateStr)) {
      dateMap.set(dateStr, { times: [], rawLines: [] });
    }
    const entry = dateMap.get(dateStr);
    if (timeMatches) entry.times.push(...timeMatches);
    entry.rawLines.push(trimmed);
  });

  const results = [];
  const sortedDates = Array.from(dateMap.keys()).sort();

  sortedDates.forEach(dateStr => {
    const validDate = isValidDate(dateStr);
    if (!validDate) {
      console.warn('[OCR] Skipping invalid date:', dateStr);
      return;
    }

    const entry = dateMap.get(dateStr);
    const times = [...new Set(entry.times)];
    times.sort();

    let startTime = '', endTime = '', timeRange = '', hours = '';

    if (times.length >= 2) {
      startTime = times[0];
      endTime = times[times.length - 1];
      if (!isValidTime(startTime)) startTime = '';
      if (!isValidTime(endTime)) endTime = '';
      if (startTime && endTime) {
        timeRange = `${startTime}-${endTime}`;
        const startParts = startTime.split(':').map(Number);
        const endParts = endTime.split(':').map(Number);
        const startMinutes = startParts[0] * 60 + startParts[1];
        let endMinutes = endParts[0] * 60 + endParts[1];
        if (endMinutes < startMinutes) endMinutes += 24 * 60;
        hours = ((endMinutes - startMinutes) / 60).toFixed(1);
      }
    } else if (times.length === 1) {
      startTime = times[0];
      if (!isValidTime(startTime)) startTime = '';
      timeRange = startTime;
    }

    results.push({
      date: dateStr, time: timeRange,
      start_time: startTime, end_time: endTime,
      hours, employee: employeeName,
      raw: entry.rawLines.join('\n'),
    });
  });

  if (results.length === 0) {
    results.push({
      date: '', time: '', start_time: '', end_time: '', hours: '',
      raw: fullText,
    });
  }

  console.log('[OCR] Parsed overtime records:', results.length);
  return results;
}

// ─── 百度 OCR 调用封装 ───────────────────────────────────────────────────

async function callBaiduFinancialOcr(imageBase64, token) {
  const body = new URLSearchParams();
  body.append('image', imageBase64);
  body.append('location', 'false');

  const result = await callBaiduApi(token, '/rest/2.0/ocr/v1/multiple_invoice', body.toString());

  if (result && result.error_code) {
    console.error('[OCR] multiple_invoice error:', result.error_code, result.error_msg);
    return null;
  }
  return result;
}

async function callBaiduGeneralOcr(imageBase64, token) {
  const body = new URLSearchParams();
  body.append('image', imageBase64);

  const result = await callBaiduApi(token, '/rest/2.0/ocr/v1/accurate_basic', body.toString());

  if (result && result.error_code) {
    console.error('[OCR] general OCR error:', result.error_code, result.error_msg);
    throw new Error(`Baidu OCR error: ${result.error_msg}`);
  }
  return result;
}

// ─── 主请求处理 ──────────────────────────────────────────────────────────

async function handleOcrRequest(request, env) {
  // 只接受 POST
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  // 获取密钥（从 Worker Secrets 读取）
  const BAIDU_API_KEY = env.BAIDU_API_KEY;
  const BAIDU_SECRET_KEY = env.BAIDU_SECRET_KEY;

  if (!BAIDU_API_KEY || !BAIDU_SECRET_KEY) {
    return new Response(JSON.stringify({ error: 'Server misconfigured: missing API keys' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  // 解析 FormData
  let formData;
  try {
    formData = await request.formData();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid form data' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const file = formData.get('image');
  const ocrType = formData.get('type') || 'invoice';

  if (!file) {
    return new Response(JSON.stringify({ error: 'No image received' }), {
    status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  // 将文件转为 base64
  const arrayBuffer = await file.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

  console.log(`[OCR] Processing: ${file.name || 'unknown'}, type: ${ocrType}`);

  let parsedResults = [];
  let rawText = '';
  let actualType = ocrType;

  try {
    if (ocrType === 'overtime') {
      console.log('[OCR] Using General OCR for overtime records...');
      const token = await getBaiduAccessToken(BAIDU_API_KEY, BAIDU_SECRET_KEY);
      const generalResult = await callBaiduGeneralOcr(base64, token);
      const overtimeData = parseOvertimeOcrResult(generalResult);

      parsedResults = overtimeData;
      const words = generalResult.words_result || [];
      rawText = words.map(w => w.words).join('\n');
      actualType = 'overtime';
      console.log('[OCR] Overtime OCR success, records:', overtimeData.length);

    } else {
      console.log('[OCR] Using Financial OCR for invoices...');
      const token = await getBaiduAccessToken(BAIDU_API_KEY, BAIDU_SECRET_KEY);
      const financialResult = await callBaiduFinancialOcr(base64, token);

      if (financialResult) {
        const financialData = parseMultipleInvoiceResult(financialResult);
        if (financialData && financialData.length > 0) {
          parsedResults = financialData;
          actualType = 'financial';
          rawText = financialData.map(p =>
            `类型: ${p.type}\n日期: ${p.date}\n时间: ${p.time}\n金额: ${p.amount}\n起点: ${p.origin}\n终点: ${p.destination}`
          ).join('\n\n');
          console.log('[OCR] Financial OCR success, type:', financialData[0].type);
        }
      }

      // fallback 到通用 OCR
      if (!parsedResults || parsedResults.length === 0) {
        console.log('[OCR] Financial OCR failed, fallback to general OCR...');
        const token2 = await getBaiduAccessToken(BAIDU_API_KEY, BAIDU_SECRET_KEY);
        const generalResult = await callBaiduGeneralOcr(base64, token2);
        const generalData = parseGeneralOcrResult(generalResult);
        parsedResults = generalData;
        const words = generalResult.words_result || [];
        rawText = words.map(w => w.words).join('\n');
        actualType = 'general';
      }
    }

    const mainResult = parsedResults[0] || {};
    return new Response(JSON.stringify({
      content: JSON.stringify(mainResult),
      type: actualType,
      raw: rawText,
      allResults: parsedResults,
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });

  } catch (e) {
    console.error('[OCR Error]', e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}

// ─── Worker 入口 ──────────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    // 处理 CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    const url = new URL(request.url);

    // 健康检查
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', time: new Date().toISOString() }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // OCR 接口
    if (url.pathname === '/api/ocr') {
      return await handleOcrRequest(request, env);
    }

    // 兜底：返回前端 HTML（仅当 Worker 也托管前端时）
    // 实际部署时前端走 Cloudflare Pages，此处返回 404
    return new Response('Not Found', { status: 404 });
  },
};
