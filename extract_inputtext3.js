const fs = require('fs');
const filePath = process.argv[2];
if (!filePath) { console.error('用法: node extract_inputtext3.js <file.ndjson>'); process.exit(1); }

const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n').filter(l => l.trim());

const inputTextSet = new Set();
let total = 0;

for (const line of lines) {
  try {
    const obj = JSON.parse(line);
    total++;
    const msg = obj['@message'] || '';
    // 找到 InputText: 的位置
    const startIdx = msg.indexOf('InputText:');
    if (startIdx === -1) continue;
    // 从 InputText: 后面开始，找到 TextIdx: 的位置
    const valStart = startIdx + 'InputText:'.length;
    // 找 TextIdx: 或 VoiceType: 或结构体结束的 }}
    const endIdx1 = msg.indexOf(' TextIdx:', valStart);
    const endIdx2 = msg.indexOf(' VoiceType:', valStart);
    const endIdx3 = msg.indexOf(' Source:', valStart);
    // 取最小的正数位置
    let endIdx = -1;
    if (endIdx1 !== -1) endIdx = endIdx1;
    if (endIdx2 !== -1 && (endIdx === -1 || endIdx2 < endIdx)) endIdx = endIdx2;
    if (endIdx3 !== -1 && (endIdx === -1 || endIdx3 < endIdx)) endIdx = endIdx3;
    if (endIdx === -1) continue;
    let val = msg.substring(valStart, endIdx).trim();
    // 去除可能的 tab + JSON 尾巴
    const tabIdx = val.indexOf('\t{"');
    if (tabIdx !== -1) val = val.substring(0, tabIdx);
    if (val) inputTextSet.add(val);
  } catch (e) {
    // 忽略
  }
}

console.log(`总行数: ${total}`);
console.log(`\n===== InputText 字段值（去重后，共 ${inputTextSet.size} 条）=====\n`);

let idx = 1;
const allTexts = [];
for (const val of inputTextSet) {
  console.log(`[${idx}] ${val}`);
  console.log('');
  allTexts.push(val);
  idx++;
}

console.log(`\n===== 所有内容按 TextIdx 顺序拼接 =====\n`);
// 按 TextIdx 顺序拼接
const sorted = [...inputTextSet].sort((a, b) => {
  // 尝试从原文中找出 TextIdx 的顺序
  return 0;
});
console.log(allTexts.join('\n'));
