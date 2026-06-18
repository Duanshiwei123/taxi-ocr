const fs = require('fs');
const path = process.argv[2];
if (!path) { console.log('用法: node extract_inputtext.js <文件路径>'); process.exit(1); }

const content = fs.readFileSync(path, 'utf8');
const lines = content.split('\n').filter(l => l.trim());

console.log(`总行数: ${lines.length}\n`);

// 提取所有 InputText 字段的值
const inputTexts = new Set();
const allChineseText = [];

lines.forEach((line, idx) => {
  try {
    const obj = JSON.parse(line);
    const msg = obj['@message'] || '';
    
    // 方法1: 从 JSON 片段中提取 InputText
    const match1 = msg.match(/"inputText"\s*:\s*"([^"]*)"/i);
    if (match1 && match1[1]) {
      inputTexts.add(match1[1]);
    }
    
    // 方法2: 提取 InputText: 后面的内容（Go 格式）
    const match2 = msg.match(/InputText\s*:\s*([^\s\}]+)/);
    if (match2 && match2[1] && match2[1] !== '0') {
      // 检查是否包含中文字符
      if (/[\u4e00-\u9fff]/.test(match2[1])) {
        inputTexts.add(match2[1]);
      }
    }
    
    // 提取所有中文（用于拼接）
    const chineseMatches = msg.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]+/g);
    if (chineseMatches) {
      allChineseText.push(...chineseMatches);
    }
  } catch(e) {}
});

console.log('===== 提取到的 InputText 字段值（去重后）=====');
let count = 0;
inputTexts.forEach(text => {
  count++;
  console.log(`\n[${count}] ${text}`);
});

console.log(`\n\n===== 所有中文内容拼接（去重后，共 ${allChineseText.filter((v,i,a) => a.indexOf(v)===i).length} 个不同片段）=====`);
const uniqueChinese = [...new Set(allChineseText)];
console.log(uniqueChinese.join(''));
