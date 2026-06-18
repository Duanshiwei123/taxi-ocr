const { chromium } = require('playwright');

async function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runTest() {
  console.log('=== Starting Logic Test ===\n');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto('http://localhost:3000');
  await page.waitForFunction(() => typeof window.invFiles !== 'undefined', { timeout: 10000 });
  await delay(1000);

  // 模拟用户操作流程
  console.log('Step 1: Initial state');
  let state = await page.evaluate(() => ({
    invFiles: window.invFiles.length,
    invResults: window.invResults.length,
    previewItems: document.querySelectorAll('#invPreview .preview-item').length
  }));
  console.log('  invFiles:', state.invFiles, '| invResults:', state.invResults, '| preview:', state.previewItems);

  // 模拟上传3个文件（直接修改invFiles数组）
  console.log('\nStep 2: Simulate uploading 3 files');
  await page.evaluate(() => {
    // 创建3个模拟的File对象
    for (let i = 0; i < 3; i++) {
      const blob = new Blob(['test'], { type: 'image/jpeg' });
      const file = new File([blob], `invoice_${i}.jpg`, { type: 'image/jpeg' });
      window.invFiles.push(file);
    }
    window.renderInvPreviews();
    window.checkBtn();
  });
  state = await page.evaluate(() => ({
    invFiles: window.invFiles.length,
    invResults: window.invResults.length,
    previewItems: document.querySelectorAll('#invPreview .preview-item').length,
    labelText: document.getElementById('invLabel').textContent
  }));
  console.log('  invFiles:', state.invFiles, '| invResults:', state.invResults, '| preview:', state.previewItems, '| label:', state.labelText);

  // 模拟分析完成（调用startAnalysis中的清空逻辑）
  console.log('\nStep 3: Simulate analysis completion (auto-clear)');
  await page.evaluate(() => {
    // 模拟添加3个结果到invResults
    for (let i = 0; i < 3; i++) {
      window.invResults.push({
        fileName: `invoice_${i}.jpg`,
        date: '2026-05-11',
        time: '22:00',
        amount: '23.50',
        origin: 'A',
        dest: 'B',
        type: '出租车',
        invNo: '',
        employee: '',
        raw: '',
        error: ''
      });
    }
    // 模拟分析完成后的自动清空
    window.invFiles = [];
    window.otFileObj = null;
    document.getElementById('invFiles').value = '';
    document.getElementById('otFile').value = '';
    document.getElementById('invPreview').innerHTML = '';
    document.getElementById('invLabel').textContent = '';
    window.checkBtn();
  });
  state = await page.evaluate(() => ({
    invFiles: window.invFiles.length,
    invResults: window.invResults.length,
    previewItems: document.querySelectorAll('#invPreview .preview-item').length,
    labelText: document.getElementById('invLabel').textContent
  }));
  console.log('  invFiles:', state.invFiles, '| invResults:', state.invResults, '| preview:', state.previewItems, '| label:', state.labelText);

  // 模拟用户点击"清空上传"
  console.log('\nStep 4: User clicks "Clear Upload"');
  await page.evaluate(() => {
    window.clearUpload();
  });
  state = await page.evaluate(() => ({
    invFiles: window.invFiles.length,
    invResults: window.invResults.length,
    previewItems: document.querySelectorAll('#invPreview .preview-item').length,
    labelText: document.getElementById('invLabel').textContent
  }));
  console.log('  invFiles:', state.invFiles, '| invResults:', state.invResults, '| preview:', state.previewItems, '| label:', state.labelText);

  // 模拟再次上传2个文件
  console.log('\nStep 5: Simulate uploading 2 new files');
  await page.evaluate(() => {
    for (let i = 3; i < 5; i++) {
      const blob = new Blob(['test'], { type: 'application/pdf' });
      const file = new File([blob], `invoice_${i}.pdf`, { type: 'application/pdf' });
      window.invFiles.push(file);
    }
    window.renderInvPreviews();
    window.checkBtn();
  });
  state = await page.evaluate(() => ({
    invFiles: window.invFiles.length,
    invResults: window.invResults.length,
    previewItems: document.querySelectorAll('#invPreview .preview-item').length,
    labelText: document.getElementById('invLabel').textContent
  }));
  console.log('  invFiles:', state.invFiles, '| invResults:', state.invResults, '| preview:', state.previewItems, '| label:', state.labelText);

  // 模拟第二次分析完成
  console.log('\nStep 6: Simulate second analysis completion');
  await page.evaluate(() => {
    for (let i = 3; i < 5; i++) {
      window.invResults.push({
        fileName: `invoice_${i}.pdf`,
        date: '2026-05-12',
        time: '23:00',
        amount: '30.00',
        origin: 'C',
        dest: 'D',
        type: '网约车',
        invNo: '',
        employee: '',
        raw: '',
        error: ''
      });
    }
    window.invFiles = [];
    window.otFileObj = null;
    document.getElementById('invFiles').value = '';
    document.getElementById('otFile').value = '';
    document.getElementById('invPreview').innerHTML = '';
    document.getElementById('invLabel').textContent = '';
    window.renderSummaryTable();
    window.checkBtn();
  });
  state = await page.evaluate(() => ({
    invFiles: window.invFiles.length,
    invResults: window.invResults.length,
    previewItems: document.querySelectorAll('#invPreview .preview-item').length,
    summaryRows: document.querySelectorAll('#summaryBody tr[data-idx]').length,
    labelText: document.getElementById('invLabel').textContent
  }));
  console.log('  invFiles:', state.invFiles, '| invResults:', state.invResults, '| preview:', state.previewItems, '| summaryRows:', state.summaryRows, '| label:', state.labelText);

  console.log('\n=== Test Complete ===');
  console.log('\nExpected behavior:');
  console.log('  Step 2: invFiles=3, preview=3 (uploaded 3 files)');
  console.log('  Step 3: invFiles=0, invResults=3, preview=0 (auto-cleared after analysis)');
  console.log('  Step 4: invFiles=0, invResults=3, preview=0 (user clicked clear)');
  console.log('  Step 5: invFiles=2, preview=2 (uploaded 2 new files)');
  console.log('  Step 6: invFiles=0, invResults=5, preview=0, summaryRows=5 (analysis done)');

  await browser.close();
}

runTest().catch(err => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
