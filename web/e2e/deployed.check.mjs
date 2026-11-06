// Read-only (no wallet) E2E against the DEPLOYED testnet contracts: /deals/0 (Settled), /deals/1 (Refunded), /deals/2 (escrow-only Settled), /demo.
// Run: pnpm --filter @tradelock/web build && pnpm --filter @tradelock/web start & pnpm --filter @tradelock/web e2e:deployed
import { chromium } from 'playwright';
const base = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const out = process.argv[2] ?? '.';
const SPECS = [
  {
    id: '0', label: 'Released: supplier paid, buyer owns the goods', seal: 'RELEASED', stamped: true,
    cash: 'Paid to supplier', title: 'Transferred to buyer', holder: '0x6a7d…46ed', escrow: '0x15149d3f55801f7a112a595520de234d8821da76', timeline: 'Created|Funded|Title held|Documents accepted|Settled', current: 'Settled',
  },
  {
    id: '1', label: 'Returned: buyer refunded, supplier holds the bill of lading', seal: 'RETURNED', stamped: false,
    cash: 'Returned to buyer', title: 'Transferred to supplier', holder: '0xefbC…8717', escrow: '0x5a97ed6d6d43a8d1a45ba6680ea2a596dc7afaf6', timeline: 'Created|Funded|Title held|Returned', current: 'Returned',
  },
  {
    id: '2', label: 'Released: supplier paid', seal: 'RELEASED', stamped: true, escrowOnly: true,
    cash: 'Paid to supplier', title: 'No bill of lading in this deal.', timeline: 'Created|Funded|Delivered|Settled', current: 'Settled',
  },
];
const modes = [
  ['light', { colorScheme: 'light', viewport: { width: 1280, height: 900 } }],
  ['dark', { colorScheme: 'dark', viewport: { width: 1280, height: 900 } }],
  ['mobile', { colorScheme: 'light', viewport: { width: 390, height: 844 } }],
];
const browser = await chromium.launch();
const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
for (const s of SPECS) {
  for (const [mode, opts] of modes) {
    const tag = `deal ${s.id} ${mode}`;
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base}/deals/${s.id}`, { waitUntil: 'domcontentloaded' });
    const labelOk = await page.getByText(s.label).waitFor({ timeout: 25_000 }).then(() => true, () => false);
    check(`${tag}: state label`, labelOk);
    let holder = '', beneficiary = '';
    if (!s.escrowOnly) {
      await page
        .waitForFunction(() => {
          const dt = [...document.querySelectorAll('.facts dt')].find((e) => e.textContent === 'Holder (live)');
          return !!dt?.nextElementSibling && dt.nextElementSibling.textContent !== '…';
        }, null, { timeout: 30_000 })
        .catch(() => {});
      const dd = (name) => page.locator('.facts dt', { hasText: name }).locator('xpath=following-sibling::dd[1]');
      holder = (await dd('Holder (live)').innerText()).trim();
      beneficiary = (await dd('Beneficiary (live)').innerText()).trim();
    }
    const text = await page.locator('main').innerText();
    const seal = page.locator('.seal');
    check(`${tag}: seal ${s.seal}${s.stamped ? ' (stamped)' : ''}`, (await seal.innerText()).trim() === s.seal && (await seal.evaluate((e) => e.classList.contains('stamped'))) === s.stamped);
    check(`${tag}: read-only, no action buttons`, text.includes('Read-only view') && (await page.locator('section.actions button').count()) === 0);
    if (!s.escrowOnly) check(`${tag}: live Sepolia holder + beneficiary`, holder === s.holder && beneficiary === s.holder, `holder ${holder}, beneficiary ${beneficiary}`);
    check(`${tag}: cash leg "${s.cash}"`, text.includes(s.cash));
    check(`${tag}: title leg "${s.title}"`, text.includes(s.title));
    const tl = (await page.locator('.timeline li').allInnerTexts()).map((t) => t.trim()).join('|');
    const cur = (await page.locator('.timeline li[aria-current="step"]').innerText()).trim();
    check(`${tag}: timeline ${s.timeline} (current ${s.current})`, tl === s.timeline && cur === s.current, `got ${tl}, current ${cur}`);
    check(`${tag}: ${s.escrowOnly ? 0 : 2} confirmations`, (await page.locator('table.records tbody tr').count()) === (s.escrowOnly ? 0 : 2));
    if (!s.escrowOnly) check(`${tag}: TitleEscrow link`, (await page.locator(`a[href*="${s.escrow}"]`).count()) >= 1);
    await page.waitForTimeout(1500);
    check(`${tag}: wallet button ready`, (await page.locator('header.site button').last().innerText()).trim() === 'Connect NEAR wallet');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${tag}: no horizontal scroll`, overflow <= 0, `overflow ${overflow}px`);
    const relevant = errors.filter((e) => !/favicon/i.test(e));
    check(`${tag}: no console errors`, relevant.length === 0, relevant.slice(0, 3).join(' | '));
    await page.screenshot({ path: `${out}/deal${s.id}-${mode}.png`, fullPage: true });
    await ctx.close();
  }
}
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(`${base}/demo`);
await page.waitForFunction(() => document.querySelectorAll('ul.deal-list li').length === 3 && !document.body.innerText.includes('loading…'), null, { timeout: 25_000 }).catch(() => {});
const demoText = await page.locator('main').innerText();
check('demo: T1 proof links (4)', (await page.locator('ol.steps li a').count()) === 4);
check('demo: deals 0, 1, 2 listed with live state', demoText.includes('Deal 0 · Released') && demoText.includes('Deal 1 · Returned') && demoText.includes('Deal 2 · Released: supplier paid'), demoText.split('\n').filter((l) => l.startsWith('Deal')).join(' | '));
await browser.close();
console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith("✗")).length;
console.log(`${failed} failed of ${results.length}`);
process.exitCode = failed ? 1 : 0;
