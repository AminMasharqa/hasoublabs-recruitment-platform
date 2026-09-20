import fs from 'node:fs';

const candidates = ['index.html', 'public/index.html', 'src/app.html'];
const file = candidates.find(fs.existsSync);
if (!file) {
  console.log(JSON.stringify({status: 'blocked', reason: 'No static HTML entry found; inspect framework metadata configuration.'}, null, 2));
  process.exit(0);
}
const html = fs.readFileSync(file, 'utf8');
const checks = {
  documentLanguage: /<html[^>]+lang=["'][^"']+["']/i.test(html),
  title: /<title>\s*[^<]+\s*<\/title>/i.test(html),
  description: /<meta[^>]+name=["']description["'][^>]+content=["'][^"']+["']/i.test(html) || /<meta[^>]+content=["'][^"']+["'][^>]+name=["']description["']/i.test(html),
  viewport: /<meta[^>]+name=["']viewport["']/i.test(html),
  openGraphTitle: /<meta[^>]+property=["']og:title["']/i.test(html),
  openGraphDescription: /<meta[^>]+property=["']og:description["']/i.test(html)
};
console.log(JSON.stringify({file, checks}, null, 2));
