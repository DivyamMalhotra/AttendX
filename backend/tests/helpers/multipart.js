/** Multipart request through a logged-in test session. files: [{ buf, name, type, field? }] */
function multipart(agent, method, url, fields = {}, files = []) {
  let req = agent.raw[method](url).set('X-CSRF-Token', agent.csrf);
  Object.entries(fields).forEach(([k, v]) => { req = req.field(k, typeof v === 'string' ? v : JSON.stringify(v)); });
  files.forEach(f => { req = req.attach(f.field || 'files', f.buf, { filename: f.name, contentType: f.type }); });
  return req;
}

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const DOCX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64)]);
const file = (name = 'work.pdf', buf = PDF, type = 'application/pdf', field) => ({ buf, name, type, field });

const countFiles = dir => {
  const fs = require('fs'); const path = require('path');
  const base = path.join(process.env.UPLOAD_DIR, dir);
  return fs.existsSync(base) ? fs.readdirSync(base).length : 0;
};

module.exports = { multipart, PDF, PNG, DOCX, file, countFiles };
