// Builds the manual test checklist as a PDF and as a Google Apps Script that creates the Google Form.
// Usage (from neowell-backend): NODE_PATH=$(npm root -g) node docs/testing/build.js
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const dir = __dirname;
const data = JSON.parse(fs.readFileSync(path.join(dir, 'checklist.json'), 'utf8'));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fontDir = process.env.FONT_DIR;
// FONT_DIR is the @expo-google-fonts/nunito package folder (one sub-folder per weight).
const font = (file) => {
  const weight = file.replace(/^Nunito_|\.ttf$/g, '');
  const p = fontDir && path.join(fontDir, weight, file);
  return p && fs.existsSync(p) ? `url(data:font/ttf;base64,${fs.readFileSync(p).toString('base64')})` : 'local(Arial)';
};
const logo = process.env.LOGO && fs.existsSync(process.env.LOGO) ? `<img class="logo" src="data:image/png;base64,${fs.readFileSync(process.env.LOGO).toString('base64')}">` : '';

function html() {
  let n = 0;
  const sections = data.sections
    .map(
      (s) => `<section><h2>${esc(s.title)}</h2><table><thead><tr><th class="num">#</th><th>Check</th><th class="box">Pass</th><th class="box">Fail</th><th class="box">N/T</th><th class="notes">Notes</th></tr></thead><tbody>${s.items
        .map((i) => `<tr><td class="num">${++n}</td><td>${esc(i)}</td><td class="box"><span></span></td><td class="box"><span></span></td><td class="box"><span></span></td><td class="notes"></td></tr>`)
        .join('')}</tbody></table></section>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Nunito;font-weight:400;src:${font('Nunito_400Regular.ttf')}}
@font-face{font-family:Nunito;font-weight:700;src:${font('Nunito_700Bold.ttf')}}
@font-face{font-family:Nunito;font-weight:800;src:${font('Nunito_800ExtraBold.ttf')}}
@page{size:A4;margin:14mm 12mm 16mm}
body{font-family:Nunito,Arial,sans-serif;color:#1E2B3C;font-size:10.5pt;margin:0}
header{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #F0849F;padding-bottom:8px;margin-bottom:10px}
.logo{height:42px}
h1{font-weight:800;font-size:19pt;margin:0;color:#2C6CB5}
.sub{color:#5E6E82;font-size:10pt}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:6px 18px;margin:10px 0 12px}
.meta div{border-bottom:1px solid #9FB3C8;padding:10px 0 2px;color:#5E6E82;font-size:9.5pt}
.setup{background:#EAF3FD;border-radius:10px;padding:8px 12px;margin-bottom:12px}
.setup b{color:#2C6CB5}
.setup ul{margin:4px 0 0 16px;padding:0}.setup li{margin:2px 0}
section{break-inside:auto;margin-bottom:10px}
h2{font-size:12.5pt;font-weight:800;color:#C2446A;margin:12px 0 4px;break-after:avoid}
table{width:100%;border-collapse:collapse;font-size:9.5pt}
thead{display:table-header-group}
th{background:#2C6CB5;color:#fff;font-weight:700;padding:4px 5px;text-align:left}
td{border-bottom:1px solid #DDE7F2;padding:5px;vertical-align:top}
tr{break-inside:avoid}
tbody tr:nth-child(even) td{background:#F7FAFE}
.num{width:22px;color:#5E6E82;text-align:center}
th.num{color:#fff}
.box{width:30px;text-align:center}
.box span{display:inline-block;width:11px;height:11px;border:1.5px solid #2C6CB5;border-radius:2px;margin-top:1px}
.notes{width:120px}
.foot{margin-top:12px;background:#FDEEF2;border-radius:10px;padding:8px 12px;font-size:9.5pt}
.summary{margin-top:12px;break-inside:avoid}.summary h2{margin-top:0}
.lines div{border-bottom:1px solid #9FB3C8;height:22px}
</style></head><body>
<header><div><h1>${esc(data.title)}</h1><div class="sub">${esc(data.version)} · ${n || data.sections.reduce((a, s) => a + s.items.length, 0)} checks</div></div>${logo}</header>
<div class="meta"><div>Tester name:</div><div>Date:</div><div>Device and OS (e.g. Tecno Spark 10, Android 13):</div><div>Role tested (parent / doctor / both):</div></div>
<div class="setup"><b>Before you start</b><ul>${data.setup.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>
${sections}
<div class="foot">${esc(data.notTestable)}</div>
<div class="summary"><h2>Overall comments</h2><div class="lines">${'<div></div>'.repeat(6)}</div></div>
</body></html>`;
}

function appsScript() {
  const json = JSON.stringify(data, null, 2);
  return `/**
 * Creates the "${data.title}" Google Form in your Google Drive.
 * Generated from docs/testing/checklist.json by docs/testing/build.js. Do not edit by hand.
 * How to use: open https://script.google.com, New project, paste this file, run createNeoWellTestForm.
 */
const CHECKLIST = ${json};

function createNeoWellTestForm() {
  const form = FormApp.create(CHECKLIST.title);
  form.setDescription(
    CHECKLIST.version + '\\n\\nBefore you start:\\n- ' + CHECKLIST.setup.join('\\n- ') + '\\n\\n' + CHECKLIST.notTestable,
  );
  form.setProgressBar(true);
  form.setCollectEmail(false);

  form.addTextItem().setTitle('Your name').setRequired(true);
  form.addTextItem().setTitle('Device and OS').setHelpText('e.g. Tecno Spark 10, Android 13, or "web browser"').setRequired(true);
  form.addMultipleChoiceItem().setTitle('Which role did you test?').setChoiceValues(['Parent', 'Doctor', 'Both']).setRequired(true);
  form.addMultipleChoiceItem().setTitle('App language used').setChoiceValues(['English', 'Français', 'Both']).setRequired(true);

  CHECKLIST.sections.forEach(function (section) {
    form.addPageBreakItem().setTitle(section.title);
    form
      .addGridItem()
      .setTitle(section.title + ': results')
      .setHelpText('N/T = not tested')
      .setRows(section.items)
      .setColumns(['Pass', 'Fail', 'N/T']);
    form
      .addParagraphTextItem()
      .setTitle(section.title + ': problems found')
      .setHelpText('For each Fail: what you did, what you expected, what you saw. Mention the check text.');
  });

  form.addPageBreakItem().setTitle('Overall');
  form.addScaleItem().setTitle('How easy was the app to use?').setBounds(1, 5).setLabels('Very hard', 'Very easy');
  form.addParagraphTextItem().setTitle('Overall comments and suggestions');

  const sheet = SpreadsheetApp.create(CHECKLIST.title + ' (responses)');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, sheet.getId());

  Logger.log('Edit the form:   ' + form.getEditUrl());
  Logger.log('Send to testers: ' + form.getPublishedUrl());
  Logger.log('Responses sheet: ' + sheet.getUrl());
}
`;
}

(async () => {
  fs.writeFileSync(path.join(dir, 'neowell-test-form.gs'), appsScript());
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html(), { waitUntil: 'load' });
  await page.pdf({
    path: path.join(dir, 'NeoWell-Manual-Test-Checklist.pdf'),
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: '<div style="font-size:8px;color:#5E6E82;width:100%;text-align:center">NeoWell manual test checklist · page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
    margin: { top: '14mm', bottom: '16mm', left: '12mm', right: '12mm' },
  });
  await browser.close();
  console.log('Wrote NeoWell-Manual-Test-Checklist.pdf and neowell-test-form.gs');
})();
