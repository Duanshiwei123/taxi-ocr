const { chromium } = require('playwright');

async function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runTest() {
  console.log('=== Starting Final Logic Test ===\n');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto('http://localhost:3000');
  await delay(3000);

  // 直接在页面中执行完整的测试逻辑（使用正确的变量访问方式）
  const results = await page.evaluate(async () => {
    const logs = [];

    function log(step, msg) {
      logs.push(`${step}: ${msg}`);
    }

    // Step 1: Initial state (access local variable, not window property)
    log('Step 1', `invFiles=${invFiles.length}, invResults=${invResults.length}`);

    // Step 2: Add 3 files to invFiles
    for (let i = 0; i < 3; i++) {
      const blob = new Blob(['test'], { type: 'image/jpeg' });
      const file = new File([blob], `invoice_${i}.jpg`, { type: 'image/jpeg' });
      invFiles.push(file);
    }
    renderInvPreviews();
    log('Step 2', `After adding 3 files: invFiles=${invFiles.length}, preview items=${document.querySelectorAll('#invPreview .preview-item').length}`);

    // Step 3: Simulate analysis - add to invResults then clear invFiles
    for (let i = 0; i < 3; i++) {
      invResults.push({ fileName: `invoice_${i}.jpg`, date: '2026-05-11', amount: '23.50', type: '出租车' });
    }
    invFiles = [];
    otFileObj = null;
    document.getElementById('invFiles').value = '';
    document.getElementById('invPreview').innerHTML = '';
    document.getElementById('invLabel').textContent = '';
    log('Step 3', `After analysis auto-clear: invFiles=${invFiles.length}, invResults=${invResults.length}, preview=${document.querySelectorAll('#invPreview .preview-item').length}`);

    // Step 4: User clicks clearUpload
    clearUpload();
    log('Step 4', `After clearUpload: invFiles=${invFiles.length}, invResults=${invResults.length}, preview=${document.querySelectorAll('#invPreview .preview-item').length}`);

    // Step 5: Add 2 new files
    for (let i = 3; i < 5; i++) {
      const blob = new Blob(['test'], { type: 'application/pdf' });
      const file = new File([blob], `invoice_${i}.pdf`, { type: 'application/pdf' });
      invFiles.push(file);
    }
    renderInvPreviews();
    log('Step 5', `After adding 2 new files: invFiles=${invFiles.length}, preview=${document.querySelectorAll('#invPreview .preview-item').length}`);

    // Step 6: Second analysis
    for (let i = 3; i < 5; i++) {
      invResults.push({ fileName: `invoice_${i}.pdf`, date: '2026-05-12', amount: '30.00', type: '网约车' });
    }
    invFiles = [];
    renderSummaryTable();
    log('Step 6', `After 2nd analysis: invFiles=${invFiles.length}, invResults=${invResults.length}, summaryRows=${document.querySelectorAll('#summaryBody tr[data-idx]').length}`);

    return logs;
  });

  results.forEach(r => console.log('  ' + r));

  console.log('\n=== Expected Results ===');
  console.log('  Step 2: invFiles=3, preview=3');
  console.log('  Step 3: invFiles=0, invResults=3, preview=0');
  console.log('  Step 4: invFiles=0, invResults=3, preview=0');
  console.log('  Step 5: invFiles=2, preview=2');
  console.log('  Step 6: invFiles=0, invResults=5, summaryRows=5');

  await browser.close();
  console.log('\nTest Complete');
}

runTest().catch(err => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
