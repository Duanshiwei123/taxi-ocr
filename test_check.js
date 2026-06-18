const { chromium } = require('playwright');

async function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runTest() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto('http://localhost:3000');
  await delay(3000);

  const state = await page.evaluate(() => {
    return {
      hasInvFiles: typeof window.invFiles !== 'undefined',
      invFilesType: typeof window.invFiles,
      isArray: Array.isArray(window.invFiles),
      keys: Object.keys(window).filter(k => k.includes('inv') || k.includes('Inv'))
    };
  });

  console.log('Page state:', JSON.stringify(state, null, 2));

  await browser.close();
}

runTest().catch(console.error);
