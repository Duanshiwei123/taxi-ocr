const { chromium } = require('playwright');

async function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runTest() {
  console.log('=== Verify Fix: Input Clone/Replace ===\n');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto('http://localhost:3000');
  await delay(3000);

  const results = await page.evaluate(async () => {
    const logs = [];

    function log(step, msg) {
      logs.push(`${step}: ${msg}`);
    }

    // Step 1: Add 3 files
    for (let i = 0; i < 3; i++) {
      const blob = new Blob(['test'], { type: 'image/jpeg' });
      const file = new File([blob], `invoice_${i}.jpg`, { type: 'image/jpeg' });
      invFiles.push(file);
    }
    renderInvPreviews();
    log('Step 1', `Added 3 files: invFiles=${invFiles.length}, preview=${document.querySelectorAll('#invPreview .preview-item').length}`);

    // Step 2: Call clearUpload (uses cloneNode now)
    clearUpload();
    log('Step 2', `After clearUpload: invFiles=${invFiles.length}, preview=${document.querySelectorAll('#invPreview .preview-item').length}`);

    // Step 3: Simulate user selecting 2 new files via input
    // We directly add files to invFiles to simulate onInvChange
    for (let i = 3; i < 5; i++) {
      const blob = new Blob(['test'], { type: 'application/pdf' });
      const file = new File([blob], `invoice_${i}.pdf`, { type: 'application/pdf' });
      invFiles.push(file);
    }
    renderInvPreviews();
    log('Step 3', `Added 2 new files: invFiles=${invFiles.length}, preview=${document.querySelectorAll('#invPreview .preview-item').length}`);

    // Step 4: Simulate analysis completion (uses cloneNode now)
    for (let i = 0; i < 5; i++) {
      invResults.push({ fileName: `invoice_${i}.jpg`, date: '2026-05-11', amount: '23.50', type: '出租车' });
    }
    // Manually call the clear logic from startAnalysis
    invFiles = []; otFileObj = null;
    const oldInvInput2 = document.getElementById('invFiles');
    const newInvInput2 = oldInvInput2.cloneNode(true);
    oldInvInput2.parentNode.replaceChild(newInvInput2, oldInvInput2);
    const oldOtInput2 = document.getElementById('otFile');
    const newOtInput2 = oldOtInput2.cloneNode(true);
    oldOtInput2.parentNode.replaceChild(newOtInput2, oldOtInput2);
    document.getElementById('invPreview').innerHTML = '';
    document.getElementById('invLabel').textContent = '';
    log('Step 4', `After analysis clear: invFiles=${invFiles.length}, preview=${document.querySelectorAll('#invPreview .preview-item').length}`);

    // Step 5: Add 2 more files (3rd round)
    for (let i = 5; i < 7; i++) {
      const blob = new Blob(['test'], { type: 'image/jpeg' });
      const file = new File([blob], `invoice_${i}.jpg`, { type: 'image/jpeg' });
      invFiles.push(file);
    }
    renderInvPreviews();
    log('Step 5', `Added 2 more files (3rd round): invFiles=${invFiles.length}, preview=${document.querySelectorAll('#invPreview .preview-item').length}`);

    return logs;
  });

  results.forEach(r => console.log('  ' + r));

  console.log('\n=== Expected ===');
  console.log('  Step 1: invFiles=3, preview=3');
  console.log('  Step 2: invFiles=0, preview=0');
  console.log('  Step 3: invFiles=2, preview=2');
  console.log('  Step 4: invFiles=0, preview=0');
  console.log('  Step 5: invFiles=2, preview=2');

  await browser.close();
  console.log('\nTest Complete');
}

runTest().catch(err => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
