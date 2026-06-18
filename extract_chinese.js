const fs = require('fs');
const path = process.argv[2];
if (!path) { console.log('用法: node extract_chinese.js <文件路径>'); process.exit(1); }

const content = fs.readFileSync(path, 'utf8');
const lines = content.split('\n').filter(l => l.trim());
console.log(`总行数: ${lines.length}`);

// 提取所有 @message 字段中的中文
const allChinese = [];
const targetLines = []; // 包含"唐、宋"等关键词的行

lines.forEach((line, idx) => {
  try {
    const obj = JSON.parse(line);
    const msg = obj['@message'] || '';
    
    // 用正则提取所有中文字符（包括中文标点）
    const chineseChars = msg.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]+/g);
    if (chineseChars && chineseChars.length > 0) {
      allChinese.push(...chineseChars);
    }
    
    // 查找包含关键词的行
    if (msg.match(/唐|宋|北宋|南宋|没问题|为您整理/)) {
      targetLines.push({ idx: idx + 1, msg: msg.substring(0, 500) });
    }
  } catch(e) {
    // 忽略解析错误
  }
});

console.log('\n===== 包含关键词的行 =====');
targetLines.slice(0, 20).forEach(item => {
  console.log(`\n--- 第 ${item.idx} 行 ---`);
  console.log(item.msg);
});

console.log('\n===== 所有中文内容拼接（前5000字）=====');
const combined = allChinese.join('');
console.log(combined.substring(0, 5000));
console.log(`\n... (总计 ${combined.length} 个中文字符)`);
