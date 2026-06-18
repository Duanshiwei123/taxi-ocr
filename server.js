require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const BAIDU_API_KEY = process.env.BAIDU_API_KEY;
const BAIDU_SECRET_KEY = process.env.BAIDU_SECRET_KEY;

if (!BAIDU_API_KEY || !BAIDU_SECRET_KEY) {
  console.error('Missing BAIDU_API_KEY or BAIDU_SECRET_KEY in .env file');
  process.exit(1);
}

// Baidu OCR access_token cache
let baiduAccessToken = null;
let baiduTokenExpireTime = 0;

// Get Baidu OCR access_token
async function getBaiduAccessToken() {
  const now = Date.now();
  if (baiduAccessToken && now < baiduTokenExpireTime - 5 * 60 * 1000) {
    return baiduAccessToken;
  }

  const url = 'https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=' + BAIDU_API_KEY + '&client_secret=' + BAIDU_SECRET_KEY;
  const resp = await fetch(url, { method: 'POST' });
  if (!resp.ok) throw new Error('Failed to get Baidu access_token: ' + await resp.text());
  const data = await resp.json();
  
  if (data.error) {
    throw new Error('Baidu Auth Error: ' + data.error + ' - ' + (data.error_description || ''));
  }
  
  baiduAccessToken = data.access_token;
  baiduTokenExpireTime = now + (data.expires_in || 2592000) * 1000;
  console.log('[Baidu] access_token obtained, expires in', data.expires_in, 'seconds');
  return baiduAccessToken;
}

// Call Baidu OCR API
async function callBaiduApi(token, apiPath, body) {
  const url = 'https://aip.baidubce.com' + apiPath + '?access_token=' + token;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body
  });
  if (!resp.ok) throw new Error('Baidu OCR API error: HTTP ' + resp.status);
  return await resp.json();
}

// Helper: get word value from Baidu OCR result field (handles [{"word": "xxx"}] format)
function getWordValue(field) {
  if (!field) return '';
  if (Array.isArray(field) && field.length > 0) {
    return field[0].word || field[0] || '';
  }
  if (typeof field === 'string') return field;
  if (field.word) return field.word;
  return '';
}

// ===================== Validation Helpers =====================

// Check if amount is reasonable for taxi/ride-hailing (5-500 yuan)
function isValidAmount(val) {
  const n = parseFloat(val);
  if (isNaN(n)) return false;
  if (n < 5 || n > 500) return false;
  // Reject long numbers (likely invoice code, not amount)
  const s = String(val).replace(/[^\d]/g, '');
  if (s.length > 6) return false;
  return true;
}

// Check if time string is valid HH:MM (hour 0-23, minute 0-59)
function isValidTime(val) {
  if (!val) return false;
  const m = String(val).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return false;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  return h >= 0 && h <= 23 && min >= 0 && min <= 59;
}

// Check if date is valid (month 1-12, day 1-31), returns normalized date or ''
function isValidDate(val) {
  if (!val) return '';
  const m = String(val).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  return val; // valid, return as-is
}

// Extract a valid amount from raw text (same OCR result), return '' if not found
function extractValidAmountFromText(text) {
  if (!text) return '';
  // Priority patterns: look for explicit amount markers
  const patterns = [
    /[¥￥]\s*(\d+\.?\d*)/g,
    /(\d+\.?\d*)\s*[元块]/g,
    /金额[：:]\s*(\d+\.?\d*)/g,
    /总计[：:]\s*(\d+\.?\d*)/g,
    /合计[：:]\s*(\d+\.?\d*)/g,
    /费用[：:]\s*(\d+\.?\d*)/g,
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
  // Fallback: find any reasonable number in text
  const allNums = text.match(/(\d{1,3}\.?\d*)/g);
  if (allNums) {
    for (const n of allNums) {
      const v = parseFloat(n);
      if (v >= 5 && v <= 500 && String(n).replace(/[^\d]/g, '').length <= 6) return String(v);
    }
  }
  return '';
}

// Extract a valid time from raw text (same OCR result)
function extractValidTimeFromText(text) {
  if (!text) return '';
  const matches = text.match(/(\d{1,2}:\d{2})/g);
  if (!matches) return '';
  for (const t of matches) {
    if (isValidTime(t)) return t;
  }
  return '';
}

// Extract a valid date from raw text (same OCR result), returns normalized date or ''
function extractValidDateFromText(text) {
  if (!text) return '';
  // Try full date: YYYY-MM-DD or YYYY/MM/DD or YYYY年MM月DD日
  const full = text.match(/(\d{4})[.\-/年](\d{1,2})[.\-/月](\d{1,2})/);
  if (full) {
    const m = parseInt(full[2], 10);
    const d = parseInt(full[3], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return full[1] + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    }
  }
  // Try MM-DD or MM/DD (no year)
  const short = text.match(/(\d{1,2})[.\-/](\d{1,2})/);
  if (short) {
    const m = parseInt(short[1], 10);
    const d = parseInt(short[2], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return new Date().getFullYear() + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    }
  }
  return '';
}

// Parse Baidu multiple_invoice result (with validation & fallback)
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
      date: '',
      time: '',
      amount: '',
      origin: '',
      destination: '',
      type: '其他',
      invoice_no: '',
      raw: rawText
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

    // ---- Validate & fallback: Amount ----
    if (extractedAmount) {
      const cleaned = String(extractedAmount).replace(/[^\d.]/g, '');
      if (isValidAmount(cleaned)) {
        parsed.amount = cleaned;
      } else {
        console.warn('[OCR] Amount validation failed:', extractedAmount, '- trying fallback from raw text');
        const fallbackAmt = extractValidAmountFromText(rawText);
        parsed.amount = fallbackAmt; // '' if not found (leave empty, don't use wrong value)
        if (!fallbackAmt) console.warn('[OCR] No valid amount found in raw text, leaving empty');
      }
    } else {
      // No amount extracted, try fallback from raw text
      parsed.amount = extractValidAmountFromText(rawText);
    }

    // ---- Validate & fallback: Date ----
    if (extractedDate) {
      const normalized = normalizeDateStr(extractedDate);
      if (isValidDate(normalized)) {
        parsed.date = normalized;
      } else {
        console.warn('[OCR] Date validation failed:', extractedDate, '- trying fallback from raw text');
        parsed.date = extractValidDateFromText(rawText);
      }
    } else {
      parsed.date = extractValidDateFromText(rawText);
    }

    // ---- Validate & fallback: Time ----
    if (extractedTime) {
      // Clean time: keep only HH:MM-HH:MM format
      const timeParts = extractedTime.match(/(\d{1,2}:\d{2})/g);
      if (timeParts && timeParts.length >= 2) {
        const s = timeParts[0], e = timeParts[timeParts.length - 1];
        if (isValidTime(s) && isValidTime(e)) {
          parsed.time = s + '-' + e;
        } else {
          parsed.time = '';
        }
      } else if (timeParts && timeParts.length === 1 && isValidTime(timeParts[0])) {
        parsed.time = timeParts[0];
      } else {
        // Try fallback from raw text
        parsed.time = extractValidTimeFromText(rawText);
      }
    } else {
      parsed.time = extractValidTimeFromText(rawText);
    }

    results.push(parsed);
  });

  return results;
}

// Helper: normalize date string to YYYY-MM-DD
function normalizeDateStr(val) {
  if (!val) return '';
  const s = String(val).trim()
    .replace(/年/g, '-').replace(/月/g, '-').replace(/日/g, '').replace(/\//g, '-');
  const p = s.split('-');
  if (p.length === 3) {
    return p[0] + '-' + p[1].padStart(2, '0') + '-' + p[2].padStart(2, '0');
  }
  return s;
}

// Clean up origin/destination: strip trailing date+time that Baidu OCR sometimes appends
function cleanAddressField(val) {
  if (!val || typeof val !== 'string') return val || '';
  let s = val.trim();
  // Pattern 1: "地址2026-04-2322:39" (date+time stuck to end, no separator)
  s = s.replace(/\d{4}[-./]\d{1,2}[-./]\d{1,2}\s*\d{1,2}:\d{2}$/, '');
  // Pattern 2: "地址 2026-04-23 22:39" (date+time with space)
  s = s.replace(/\s+\d{4}[-./]\d{1,2}[-./]\d{1,2}\s+\d{1,2}:\d{2}\s*$/, '');
  // Pattern 3: just trailing date "地址2026-04-23"
  s = s.replace(/\d{4}[-./]\d{1,2}[-./]\d{1,2}$/, '');
  return s.trim();
}

// Call Baidu financial document OCR (multiple_invoice API)
async function callBaiduFinancialOcr(imageBase64) {
  const token = await getBaiduAccessToken();
  
  // Use multiple_invoice API (supports all financial documents)
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

// Fallback: use general OCR
async function callBaiduGeneralOcr(imageBase64) {
  const token = await getBaiduAccessToken();
  
  const body = new URLSearchParams();
  body.append('image', imageBase64);
  
  const result = await callBaiduApi(token, '/rest/2.0/ocr/v1/accurate_basic', body.toString());
  
  if (result && result.error_code) {
    console.error('[OCR] general OCR error:', result.error_code, result.error_msg);
    throw new Error('Baidu OCR error: ' + result.error_msg);
  }
  
  return result;
}

// Extract employee name from overtime OCR text
function extractEmployeeName(text) {
  if (!text) return '';
  // Flatten text for cross-line matching
  const flatText = text.replace(/\n/g, ' ').replace(/\s+/g, ' ');

  // Priority 1: v_ / v- prefix pattern (e.g., v_isweduan, v-isweduan)
  const vMatch = text.match(/v[_\-][a-zA-Z0-9_]+/i);
  if (vMatch) return vMatch[0].replace(/v-/i, 'v_').toLowerCase();

  // Priority 2: 申请人 / 姓名 / 员工 / 员工姓名 with flexible separators
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

  // Priority 3: standalone v_ pattern on its own line
  const vLineMatch = text.match(/^v[_\-][a-zA-Z0-9_]+$/m);
  if (vLineMatch) return vLineMatch[0].replace(/v-/i, 'v_').toLowerCase();

  console.log('[OCR] Could not extract employee name from text:', flatText.substring(0, 200));
  return '';
}

// Parse overtime records from general OCR text
function parseOvertimeOcrResult(data) {
  const words = data.words_result || [];
  const fullText = words.map(w => w.words).join('\n');
  
  console.log('[OCR] Overtime raw text:', fullText);
  
  // Extract employee name from full text
  const employeeName = extractEmployeeName(fullText);
  console.log('[OCR] Extracted employee name:', employeeName);
  
  // Use a Map to merge records by date (one record per date row)
  const dateMap = new Map();
  const lines = fullText.split('\n');
  
  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    
    let dateStr = '';
    let year = '', month = '', day = '';
    let dateMatch = null;
    
    // Try 1: Full date with time attached: 2026-05-1118:17 or 2026/05/1118:17
    dateMatch = trimmed.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:\D|$)/);
    if (dateMatch) {
      year = dateMatch[1];
      month = dateMatch[2].padStart(2, '0');
      day = dateMatch[3].padStart(2, '0');
    } else {
      // Try 2: Date without year, time attached: 05-1118:17 or 05/1118:17
      // Make sure it's not matching something like "4.3" (a number)
      dateMatch = trimmed.match(/^(\d{1,2})[.\-/](\d{1,2})(?=\d{2}:\d{2})/);
      if (dateMatch) {
        const m = parseInt(dateMatch[1], 10);
        const d = parseInt(dateMatch[2], 10);
        // Sanity check: month 1-12, day 1-31
        if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
          year = String(new Date().getFullYear());
          month = String(m).padStart(2, '0');
          day = String(d).padStart(2, '0');
        }
      }
    }
    
    if (!year) return; // No date found on this line
    
    dateStr = `${year}-${month}-${day}`;
    
    // Extract all times from this line
    const timeMatches = trimmed.match(/(\d{1,2}:\d{2})/g);
    
    if (!dateMap.has(dateStr)) {
      dateMap.set(dateStr, { times: [], rawLines: [] });
    }
    
    const entry = dateMap.get(dateStr);
    if (timeMatches) {
      entry.times.push(...timeMatches);
    }
    entry.rawLines.push(trimmed);
  });
  
  const results = [];
  
  // Sort dates and build final records (only valid dates)
  const sortedDates = Array.from(dateMap.keys()).sort();
  
  sortedDates.forEach(dateStr => {
    // Validate date before adding to results
    const validDate = isValidDate(dateStr);
    if (!validDate) {
      console.warn('[OCR] Skipping invalid date:', dateStr);
      return; // skip this entry entirely
    }

    const entry = dateMap.get(dateStr);
    const times = [...new Set(entry.times)];
    times.sort();

    let startTime = '';
    let endTime = '';
    let timeRange = '';
    let hours = '';

    if (times.length >= 2) {
      startTime = times[0];
      endTime = times[times.length - 1];
      // Validate times
      if (!isValidTime(startTime)) startTime = '';
      if (!isValidTime(endTime)) endTime = '';
      if (startTime && endTime) {
        timeRange = startTime + '-' + endTime;
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
      date: dateStr,
      time: timeRange,
      start_time: startTime,
      end_time: endTime,
      hours: hours,
      employee: employeeName,
      raw: entry.rawLines.join('\n')
    });
  });
  
  // If no records found with date, return full text for manual review
  if (results.length === 0) {
    results.push({
      date: '',
      time: '',
      start_time: '',
      end_time: '',
      hours: '',
      raw: fullText
    });
  }
  
  console.log('[OCR] Parsed overtime records:', results.length, 'dates:', sortedDates.join(', '));
  return results;
}

// Parse general OCR result (array format, with validation & fallback)
function parseGeneralOcrResult(data) {
  const words = data.words_result || [];
  const fullText = words.map(w => w.words).join('\n');

  const result = {
    date: '',
    time: '',
    amount: '',
    origin: '',
    destination: '',
    type: '网约车',
    invoice_no: '',
    raw: fullText
  };

  // ---- Date: extract + validate + fallback ----
  const rawDate = extractValidDateFromText(fullText);
  if (rawDate && isValidDate(rawDate)) {
    result.date = rawDate;
  }

  // ---- Amount: extract + validate + fallback ----
  const rawAmt = extractValidAmountFromText(fullText);
  result.amount = rawAmt; // already validated inside the function

  // ---- Time: extract + validate + fallback ----
  const rawTime = extractValidTimeFromText(fullText);
  if (rawTime) {
    // Check if we got a time range (HH:MM-HH:MM)
    const rangeMatch = fullText.match(/(\d{1,2}:\d{2})\s*[-~至]\s*(\d{1,2}:\d{2})/);
    if (rangeMatch && isValidTime(rangeMatch[1]) && isValidTime(rangeMatch[2])) {
      result.time = rangeMatch[1] + '-' + rangeMatch[2];
    } else if (isValidTime(rawTime)) {
      result.time = rawTime;
    }
  }

  return [result];
}

// ===================== Express Server =====================

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

// POST /api/ocr
app.post('/api/ocr', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image received' });

    const b64 = req.file.buffer.toString('base64');
    const ocrType = req.body.type || 'invoice'; // 'invoice' or 'overtime'
    
    console.log('[OCR] Processing:', req.file.originalname || 'unknown', '(' + req.file.size + 'bytes), type:', ocrType);

    let parsedResults = [];
    let rawText = '';
    let actualType = ocrType;

    if (ocrType === 'overtime') {
      // Use General OCR for overtime records (no special permission needed)
      console.log('[OCR] Using General OCR for overtime records...');
      const generalResult = await callBaiduGeneralOcr(b64);
      const overtimeData = parseOvertimeOcrResult(generalResult);
      
      parsedResults = overtimeData;
      const words = generalResult.words_result || [];
      rawText = words.map(w => w.words).join('\n');
      actualType = 'overtime';
      console.log('[OCR] Overtime OCR success, records:', overtimeData.length);
    } else {
      // Use Financial OCR for invoices
      console.log('[OCR] Using Financial OCR for invoices...');
      const financialResult = await callBaiduFinancialOcr(b64);
      
      if (financialResult) {
        const financialData = parseMultipleInvoiceResult(financialResult);
        if (financialData && financialData.length > 0) {
          parsedResults = financialData;
          actualType = 'financial';
          rawText = financialData.map(p => {
            return `类型: ${p.type}\n日期: ${p.date}\n时间: ${p.time}\n金额: ${p.amount}\n起点: ${p.origin}\n终点: ${p.destination}`;
          }).join('\n\n');
          console.log('[OCR] Financial OCR success, type:', financialData[0].type);
        }
      }
      
      // Fallback to general OCR
      if (!parsedResults || parsedResults.length === 0) {
        console.log('[OCR] Financial OCR failed, fallback to general OCR...');
        const generalResult = await callBaiduGeneralOcr(b64);
        const generalData = parseGeneralOcrResult(generalResult);
        parsedResults = generalData;
        const words = generalResult.words_result || [];
        rawText = words.map(w => w.words).join('\n');
        actualType = 'general';
      }
    }

    // Return result
    const mainResult = parsedResults[0] || {};
    
    res.json({
      content: JSON.stringify(mainResult),
      type: actualType,
      raw: rawText,
      allResults: parsedResults
    });
    
  } catch (e) {
    console.error('[OCR Error]', e);
    res.status(500).json({ error: e.message });
  }
});

// Fallback: serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('Server started: http://localhost:' + PORT);
  console.log('Baidu OCR enabled: multiple_invoice (financial) + accurate_basic (general)');
});
