import puppeteer from 'puppeteer';
import { writeFileSync } from 'fs';

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
  
  // Also get the body markup length
  const bodyHTML = await page.evaluate(() => document.body.innerHTML);
  console.log('BODY LENGTH:', bodyHTML.length);
  
  await page.screenshot({ path: 'screenshot.png' });
  
  await browser.close();
})();
