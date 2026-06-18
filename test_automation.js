const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runTest() {
  console.log('Starting test...');
  const browser = await chromium.launch({ headless: false, slowMo: 500 });
  const context = await browser.newContext();
  const page = await context.newPage();

  // 打开页面
  await page.goto('http://localhost:3000');
  await delay(2000);

  // === 第一轮：上传3张JPG发票 + 加班单 ===
  console.log('\n=== Round 1: Upload 3 invoices + overtime ===');

  // 准备文件路径
  const invFiles = [
    'C:\\Users\\v_isweduan\\CodeBuddy\\20260529115600\\public\\test_data\\inv1.jpg',
    'C:\\Users\\v_isweduan\\CodeBuddy\\20260529115600\\public\\test_data\\inv2.jpg',
    'C:\\Users\\v_isweduan\\CodeBuddy\\20260529115600\\public\\test_data\\inv3.jpg',
  ];
  const otFile = 'C:\\Users\\v_isweduan\\CodeBuddy\\20260529115600\\public\\test_data\\ot1.png';

  // 检查文件是否存在
  for (const f of invFiles) {
    console.log('Invoice exists:', fs.existsSync(f), f);
  }
  console.log('OT exists:', fs.existsSync(otFile), otFile);

  // 上传发票（通过input元素）
  const invInput = await page.locator('#invFiles');
  await invInput.setInputFiles(invFiles);
  await delay(2000);

  // 读取 invFiles 数组长度
  const invCount1 = await page.evaluate(() => window.invFiles.length);
  console.log('After upload 3 invoices, invFiles.length =', invCount1);

  // 上传加班单
  const otInput = await page.locator('#otFile');
  await otInput.setInputFiles(otFile);
  await delay(2000);

  // 检查按钮是否可用
  const btnEnabled = await page.evaluate(() => !document.getElementById('analyzeBtn').disabled);
  console.log('Analyze button enabled:', btnEnabled);

  // 点击分析
  if (btnEnabled) {
    await page.click('#analyzeBtn');
    console.log('Clicked analyze, waiting for completion...');
    // 等待进度条完成
    await page.waitForFunction(() => {
      const label = document.getElementById('progressLabel');
      return label && label.textContent.includes('完成');
    }, { timeout: 120000 });
    await delay(3000);
  }

  // 记录分析后的状态
  const invCountAfterAnalyze = await page.evaluate(() => window.invFiles.length);
  const resultCountAfterAnalyze = await page.evaluate(() => window.invResults.length);
  console.log('After analyze, invFiles.length =', invCountAfterAnalyze);
  console.log('After analyze, invResults.length =', resultCountAfterAnalyze);

  // === 点击清空上传 ===
  console.log('\n=== Clicking Clear Upload ===');
  await page.click('button[onclick="clearUpload()"]');
  await delay(2000);

  const invCountAfterClear = await page.evaluate(() => window.invFiles.length);
  const resultCountAfterClear = await page.evaluate(() => window.invResults.length);
  console.log('After clear, invFiles.length =', invCountAfterClear);
  console.log('After clear, invResults.length =', resultCountAfterClear);

  // 检查区域一预览
  const previewCount = await page.evaluate(() => document.querySelectorAll('#invPreview .preview-item').length);
  console.log('Preview items count after clear:', previewCount);

  // === 第二轮：上传2个PDF发票 + 加班单 ===
  console.log('\n=== Round 2: Upload 2 PDF invoices + overtime ===');

  const pdfFiles = [
    'C:\\Users\\v_isweduan\\Documents\\WXWork\\1688858279664734\\Cache\\File\\2026-05\\滴滴出行行程报销单.pdf',
    'C:\\Users\\v_isweduan\\Documents\\WXWork\\1688858279664734\\Cache\\File\\2026-05\\第三方网约车服务公司_如祺出行行程报销单.pdf',
  ];
  const otFile2 = 'C:\\Users\\v_isweduan\\CodeBuddy\\20260529115600\\public\\test_data\\ot2.png';

  for (const f of pdfFiles) {
    console.log('PDF exists:', fs.existsSync(f), f);
  }
  console.log('OT2 exists:', fs.existsSync(otFile2), otFile2);

  // 上传PDF发票
  await invInput.setInputFiles(pdfFiles);
  await delay(5000); // PDF转换需要时间

  const invCount2 = await page.evaluate(() => window.invFiles.length);
  console.log('After upload 2 PDF invoices, invFiles.length =', invCount2);

  // 上传第二个加班单
  await otInput.setInputFiles(otFile2);
  await delay(2000);

  // 检查按钮
  const btnEnabled2 = await page.evaluate(() => !document.getElementById('analyzeBtn').disabled);
  console.log('Analyze button enabled (round 2):', btnEnabled2);

  // 点击分析
  if (btnEnabled2) {
    await page.click('#analyzeBtn');
    console.log('Clicked analyze (round 2), waiting...');
    await page.waitForFunction(() => {
      const label = document.getElementById('progressLabel');
      return label && label.textContent.includes('完成');
    }, { timeout: 120000 });
    await delay(3000);
  }

  // 最终状态
  const finalInvCount = await page.evaluate(() => window.invFiles.length);
  const finalResultCount = await page.evaluate(() => window.invResults.length);
  console.log('\n=== Final State ===');
  console.log('Final invFiles.length =', finalInvCount);
  console.log('Final invResults.length =', finalResultCount);

  // 检查汇总表行数
  const summaryRows = await page.evaluate(() => document.querySelectorAll('#summaryBody tr[data-idx]').length);
  console.log('Summary table rows:', summaryRows);

  await delay(5000);
  await browser.close();
  console.log('\nTest completed!');
}

runTest().catch(console.error);
