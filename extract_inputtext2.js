const fs = require('fs');
const filePath = process.argv[2];
if (!filePath) { console.error('用法: node extract_inputtext2.js <file.ndjson>'); process.exit(1); }

const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n').filter(l => l.trim());

// 收集所有 InputText 值（去重）
const inputTextSet = new Set();
let total = 0;

for (const line of lines) {
  try {
    const obj = JSON.parse(line);
    total++;
    const msg = obj['@message'] || '';
    // 从 @message 中提取 InputText 的值
    // 格式类似：...,"InputText":"xxx",...
    const match = msg.match(/"InputText"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (match) {
      // 还原转义字符
      const val = match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      inputTextSet.add(val);
    }
  } catch (e) {
    // 忽略解析失败的行
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

console.log(`\n===== 所有内容拼接在一起 =====\n`);
console.log(allTexts.join('\n'));
