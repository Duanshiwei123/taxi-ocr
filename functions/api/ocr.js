/**
 * 打车发票 & 加班记录核验系统 - Cloudflare Pages Function
 * 路由: /api/ocr
 */

let baiduAccessToken = null;
let baiduTokenExpireTime = 0;

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

function getWordValue(field) {
  if (!field) return '';
  if (Array.isArray(field) && field.length > 0) {
    return field[0].word || field[0] || '';
  }
  if (typeof field === 'string') return field;
  if (field.word) return field.word;
  return '';
}

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
    /[\u00A5\uFFE5]\s*(\d+\.?\d*)/g,
    /(\d+\.?\d*)\s*[\u5143\u5757]/g,
    /\u91D1\u989D[\uFF1A:](\d+\.?\d*)/g,
    /\u603B\u8BA1[\uFF1A:](\d+\.?\d*)/g,
    /\u5408\u8BA1[\uFF1A:](\d+\.?\d*)/g,
    /\u8D39\u7528[\uFF1A:](\d+\.?\d*)/g,
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
  const full = text.match(/(\d{4})[.\-/\u5E74](\d{1,2})[.\-/\u6708](\d{1,2})/);
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
    .replace(/\u5E74/g, '-').replace(/\u6708/g, '-').replace(/\u65E5/g, '').replace(/\//g, '-');
  const p = s.split('-');
  if (p.length === 3) {
    return `${p[0]}-${p[1].padStart(2, '0')}-${p[2].padStart(2, '0')}`;
  }
  return s;
}

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
      type: '\u5176\u4ED6', invoice_no: '', raw: rawText,
    };

    let extractedDate = '';
    let extractedTime = '';
    let extractedAmount = '';

    if (type === 'taxi_receipt') {
      parsed.type = '\u51FA\u79DF\u8F66';
      extractedDate = getWordValue(result.Date);
      extractedTime = getWordValue(result.Time) ||
        (getWordValue(result.PickupTime) + (getWordValue(result.DropoffTime) ? '-' + getWordValue(result.DropoffTime) : ''));
      extractedAmount = getWordValue(result.TotalFare) || getWordValue(result.Fare);
      parsed.origin = getWordValue(result.PickupLocation) || getWordValue(result.Location);
      parsed.destination = getWordValue(result.DropoffLocation) || '';
      parsed.invoice_no = getWordValue(result.InvoiceNum) || getWordValue(result.InvoiceCode);

    } else if (type === 'taxi_online_ticket') {
      parsed.type = '\u7F51\u7EA6\u8F66';
      const items = result.items || [];
      if (items.length > 0) {
        const firstItem = items[0];
        extractedDate = getWordValue(firstItem.pickup_date) || getWordValue(result.application_date);
        extractedTime = getWordValue(firstItem.pickup_time) || '';
        extractedAmount = getWordValue(firstItem.fare) || getWordValue(result.total_fare);
        parsed.origin = getWordValue(firstItem.start_place) || '';
        parsed.destination = getWordValue(firstItem.destination_place) || '';
      }
      parsed.invoice_no = '';

    } else if (type === 'vat_invoice') {
      parsed.type = '\u589E\u503C\u7A0E\u53D1\u7968';
      extractedDate = getWordValue(result.InvoiceDate);
      extractedAmount = getWordValue(result.TotalAmount);
      parsed.invoice_no = getWordValue(result.InvoiceNum) || getWordValue(result.InvoiceCode);

    } else {
      parsed.type = type;
    }

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

    // ── Fallback: extract origin / destination from raw text if API returned empty ──
    if (!parsed.origin || !parsed.destination) {
      const flatRaw = (rawText || '').replace(/\n/g, ' ').replace(/\s+/g, ' ');
      if (!parsed.origin) {
        const om = flatRaw.match(/起点[\uFF1A:\s]+([^\s终点\d元]{2,30})/i);
        if (om && om[1]) parsed.origin = om[1].trim();
      }
      if (!parsed.destination) {
        const dm = flatRaw.match(/终点[\uFF1A:\s]+([^\s起点\d元]{2,30})/i);
        if (dm && dm[1]) parsed.destination = dm[1].trim();
      }
    }

    results.push(parsed);
  });

  return results;
}

function parseGeneralOcrResult(data) {
  const words = data.words_result || [];
  const fullText = words.map(w => w.words).join('\n');
  const flatText = fullText.replace(/\n/g, ' ').replace(/\s+/g, ' ');

  const result = {
    date: '', time: '', amount: '',
    origin: '', destination: '',
    type: '\u7F51\u7EA6\u8F66', invoice_no: '', raw: fullText,
  };

  const rawDate = extractValidDateFromText(fullText);
  if (rawDate && isValidDate(rawDate)) result.date = rawDate;

  const rawAmt = extractValidAmountFromText(fullText);
  result.amount = rawAmt;

  const rawTime = extractValidTimeFromText(fullText);
  if (rawTime) {
    const rangeMatch = fullText.match(/(\d{1,2}:\d{2})\s*[-~\u81F3]\s*(\d{1,2}:\d{2})/);
    if (rangeMatch && isValidTime(rangeMatch[1]) && isValidTime(rangeMatch[2])) {
      result.time = `${rangeMatch[1]}-${rangeMatch[2]}`;
    } else if (isValidTime(rawTime)) {
      result.time = rawTime;
    }
  }

  // ── Extract origin / destination from OCR text ──
  // 策略1: 按行查找表头+数据行的表格格式（如高德行程单）
  const lines = fullText.split('\n');
  let headerLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/起点/.test(lines[i])) { headerLineIdx = i; break; }
  }
  if (headerLineIdx >= 0 && headerLineIdx + 1 < lines.length) {
    const dataLine = lines[headerLineIdx + 1];
    if (/^\s*\d/.test(dataLine)) {
      const parts = dataLine.trim().split(/\s+/).filter(p => p);
      const candidates = parts.filter(p => {
        if (/^\d+$/.test(p)) return false;
        if (/^\d{4}[-./]\d{1,2}[-./]\d{1,2}$/.test(p)) return false;
        if (/^\d{1,2}:\d{2}$/.test(p)) return false;
        if (/\d+(\.\d+)?元?$/.test(p)) return false;
        if (/^(序号|服务商|车型|城市|金额|及时|阳光|特惠|经济)$/.test(p)) return false;
        return true;
      });
      // 取含地点特征字的中文片段作为地址候选
      const addrCandidates = candidates.filter(c =>
        /[\u4e00-\u9fa5]{2,}/.test(c) &&
        /(大厦|楼|园|区|广场|机场|站|路|街|口|门|中心|科技|南区|北区)/.test(c)
      );
      if (addrCandidates.length >= 2) {
        result.origin = addrCandidates[0];
        result.destination = addrCandidates[1];
      } else if (candidates.length >= 2) {
        const chineseCandidates = candidates.filter(c => /[\u4e00-\u9fa5]/.test(c));
        if (chineseCandidates.length >= 2) {
          result.origin = chineseCandidates[chineseCandidates.length - 2];
          result.destination = chineseCandidates[chineseCandidates.length - 1];
        }
      }
    }
  }

  // 策略2: 冒号格式 "起点：xxx" / "终点：xxx"
  if (!result.origin || !result.destination) {
    if (!result.origin) {
      const om = flatText.match(/起点[\uFF1A:\s]+([^\s终点\d元金额]{2,40})/i);
      if (om) result.origin = om[1].trim().replace(/[：:，,。]$/, '');
    }
    if (!result.destination) {
      const dm = flatText.match(/终点[\uFF1A:\s]+([^\s起点\d元金额]{2,40})/i);
      if (dm) result.destination = dm[1].trim().replace(/[：:，,。]$/, '');
    }
  }

  console.log('[parseGeneral] origin:', JSON.stringify(result.origin), 'dest:', JSON.stringify(result.destination));

  return [result];
}

// ── 统一姓名提取: 同时提取英文v_ID + 中文姓名 ──
function extractEmployeeName(text) {
  if (!text) return '';
  const flatText = text.replace(/\n/g, ' ').replace(/\s+/g, ' ');
  const parts = [];

  // 1. 提取英文 v_ / v- ID
  const vMatch = (text.match(/v[_\-][a-zA-Z0-9_]+/i) || [])[0];
  if (vMatch) parts.push(vMatch.replace(/v-/i, 'v_').toLowerCase());

  // 2. 括号格式: v_xxx（中文）或 v_xxx(中文)
  const parenMatch = flatText.match(/v_[a-zA-Z0-9_]+\s*[（(]([\u4e00-\u9fa5]+)[）)]/);
  if (parenMatch && !parts.includes(parenMatch[1])) parts.push(parenMatch[1]);

  // 3. 从申请人/姓名字段提取中文
  if (parts.length < 2) {
    const cnPatterns = [
      /申请人[\uFF1A:\s]*[a-zA-Z0-9_\s]*[（(]?([\u4e00-\u9fa5]+)[）)]?/,
      /姓名[\uFF1A:\s]*[a-zA-Z0-9_\s]*[（(]?([\u4e00-\u9fa5]+)[）)]?/,
      /员工[\uFF1A:\s]*[a-zA-Z0-9_\s]*[（(]?([\u4e00-\u9fa5]+)[）)]?/,
    ];
    for (const p of cnPatterns) {
      const m = flatText.match(p);
      if (m && m[1] && !parts.includes(m[1])) { parts.push(m[1]); break; }
    }
  }

  // 兜底: 独立行的v_
  if (parts.length === 0) {
    const vLineMatch = text.match(/^v[_\-][a-zA-Z0-9_]+$/m);
    if (vLineMatch) parts.push(vLineMatch[0].replace(/v-/i, 'v_').toLowerCase());
  }
  if (parts.length === 0) {
    const fallbackPatterns = [
      /申请人[\uFF1A:\s]+([a-zA-Z0-9_\u4e00-\u9fa5]+)/,
      /姓名[\uFF1A:\s]+([a-zA-Z0-9_\u4e00-\u9fa5]+)/,
    ];
    for (const p of fallbackPatterns) {
      const m = flatText.match(p);
      if (m) { parts.push(m[1]); break; }
    }
  }

  return parts.join(' ');
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

// ─── Pages Function 入口 ───────────────────────────────────────────────────

export async function onRequestPost(context) {
  const { request, env } = context;

  const BAIDU_API_KEY = env.BAIDU_API_KEY;
  const BAIDU_SECRET_KEY = env.BAIDU_SECRET_KEY;

  if (!BAIDU_API_KEY || !BAIDU_SECRET_KEY) {
    return new Response(JSON.stringify({ error: 'Server misconfigured: missing API keys' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let formData;
  try {
    formData = await request.formData();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid form data' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const file = formData.get('image');
  const ocrType = formData.get('type') || 'invoice';

  if (!file) {
    return new Response(JSON.stringify({ error: 'No image received' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let base64;
  try {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    base64 = btoa(binary);
    console.log(`[OCR] Processing: ${file.name || 'unknown'}, type: ${ocrType}, size: ${bytes.byteLength} bytes`);
  } catch (e) {
    console.error('[OCR] Base64 encode error:', e);
    return new Response(JSON.stringify({ error: 'Base64 encode failed: ' + e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

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
            `\u7C7B\u578B: ${p.type}\n\u65E5\u671F: ${p.date}\n\u65F6\u95F4: ${p.time}\n\u91D1\u989D: ${p.amount}\n\u8D77\u70B9: ${p.origin}\n\u7EC8\u70B9: ${p.destination}`
          ).join('\n\n');
          console.log('[OCR] Financial OCR success, type:', financialData[0].type);
        }
      }

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
    return new Response(JSON.stringify({ error: e.message, stack: e.stack }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}

export async function onRequestOptions(context) {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
