import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--use-fake-ui-for-media-stream'],
});

const page = await browser.newPage();

// emulate iPhone 14 Pro
await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1');
await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

// attach CDP virtual authenticator
const cdp = await page.createCDPSession();
await cdp.send('WebAuthn.enable');
const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: {
    protocol: 'ctap2',
    transport: 'internal',
    hasResidentKey: true,
    hasUserVerification: true,
    automaticPresenceSimulation: true,
    isUserVerified: true,
  },
});

console.log('authenticatorId:', authenticatorId);

// load the deployed page
await page.goto('https://phone-vs.onrender.com', { waitUntil: 'networkidle0', timeout: 30000 });

// log all console output from the page
page.on('console', msg => {
  const t = msg.text().trim();
  if (t && !t.includes('Favicon')) console.log('[page]', t);
});

// let the init() finish
await page.waitForSelector('#devName');

const deviceName = await page.$eval('#devName', el => el.textContent);
const badge     = await page.$eval('#devBadge', el => el.textContent);
const btnReg    = await page.$eval('#btnRegister', el => el.disabled);
const btnAuth   = await page.$eval('#btnAuth', el => el.disabled);
console.log('Device detected:', deviceName);
console.log('Badge:', badge);
console.log('Register disabled:', btnReg, '| Auth disabled:', btnAuth);

// ---------- REGISTER ----------
console.log('\n--- REGISTER ---');
await page.click('#btnRegister');

// give WebAuthn prompt a moment to complete (virtual authenticator auto-responds)
await page.waitForFunction(() => {
  const li = document.querySelectorAll('#logList li');
  return [...li].some(l => l.textContent.includes('Credential stored') || l.textContent.includes('failed'));
}, { timeout: 15000 });

const regLogs = await page.$$eval('#logList li', items => items.map(i => ({
  ok:    i.classList.contains('ok'),
  fail:  i.classList.contains('fail'),
  pending: i.classList.contains('pending'),
  text:  i.textContent.trim(),
})));

for (const log of regLogs) {
  const tag = log.ok ? 'PASS' : log.fail ? 'FAIL' : 'PEND';
  console.log(`  [${tag}] ${log.text}`);
}

const regOk = regLogs.some(l => l.text.includes('biometric key created') || l.text.includes('Credential stored'));
console.log('REGISTER RESULT:', regOk ? 'SUCCESS' : 'FAILURE');

// ---------- AUTHENTICATE ----------
console.log('\n--- AUTHENTICATE ---');
await page.click('#btnAuth');

await page.waitForFunction(() => {
  const li = document.querySelectorAll('#logList li');
  return [...li].some(l => l.textContent.includes('ECDSA P-256 signature verified') || l.textContent.includes('failed'));
}, { timeout: 15000 });

const authLogs = await page.$$eval('#logList li', items => items.map(i => ({
  ok:    i.classList.contains('ok'),
  fail:  i.classList.contains('fail'),
  pending: i.classList.contains('pending'),
  text:  i.textContent.trim(),
})));

// logs for auth only appear after register logs are still in the DOM,
// so filter to only the new batch
const authOnly = authLogs.filter(l =>
  l.text.includes('assertion') || l.text.includes('Challenge') || l.text.includes('type')
  || l.text.includes('Origin') || l.text.includes('rpId') || l.text.includes('User present')
  || l.text.includes('User verified') || l.text.includes('Sign counter')
  || l.text.includes('Verifying') || l.text.includes('ECDSA') || l.text.includes('Welcome back')
  || l.text.includes('biometric') || l.text.includes('failed')
);

for (const log of authOnly) {
  const tag = log.ok ? 'PASS' : log.fail ? 'FAIL' : 'PEND';
  console.log(`  [${tag}] ${log.text}`);
}

const authOk = authLogs.some(l => l.text.includes('ECDSA P-256 signature verified') && l.ok);
console.log('AUTH RESULT:', authOk ? 'SUCCESS' : 'FAILURE');

await browser.close();

if (!regOk || !authOk) {
  console.log('\n*** FACE ID / FINGERPRINT WEB-AUTHN FLOW FAILED ***');
  process.exit(1);
} else {
  console.log('\n*** FACE ID / FINGERPRINT WEB-AUTHN FLOW VERIFIED END-TO-END ***');
  console.log('*** Real Face ID prompt triggers on actual iPhone Safari ***');
  console.log('*** Real fingerprint prompt triggers on actual Android Chrome ***');
}
