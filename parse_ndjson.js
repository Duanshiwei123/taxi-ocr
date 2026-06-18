const fs = require('fs');
const path = process.argv[2];
if (!path) { console.log('用法: node parse_ndjson.js <文件路径>'); process.exit(1); }

const content = fs.readFileSync(path, 'utf8');
const lines = content.split('\n').filter(l => l.trim());

console.log(`总行数: ${lines.length}`);
console.log('前3行原始内容:');
lines.slice(0, 3).forEach((line, i) => {
  console.log(`--- 第${i+1}行 ---`);
  try {
    const obj = JSON.parse(line);
    console.log(JSON.stringify(obj, null, 2).substring(0, 1000));
  } catch(e) {
    console.log(line.substring(0, 500));
  }
});
