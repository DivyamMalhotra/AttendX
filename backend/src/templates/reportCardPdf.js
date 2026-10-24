const fs = require('fs');
const PDFDocument = require('pdfkit');
const { config } = require('../config/env');

const date = d => new Date(d).toLocaleDateString('en-IN', { timeZone: config.timezone, day: 'numeric', month: 'short', year: 'numeric' });
const num = v => (v === null || v === undefined ? '-' : String(v));

/** Renders a report card from verified, published results. Nothing is read from unpublished data. */
function renderReportCard({ college, data }) {
  const { profile, semester, cgpa, code, publishedAt } = data;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 44, info: { Title: `Report card - ${profile.rollNo}` } });
    const chunks = [];
    doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const left = 44; const width = doc.page.width - 88;
    let y = 44;

    if (config.receiptLogoPath && fs.existsSync(config.receiptLogoPath)) { try { doc.image(config.receiptLogoPath, left, y, { fit: [52, 52] }); } catch (e) { /* skip unreadable logo */ } }
    doc.font('Helvetica-Bold').fontSize(17).fillColor('#152b47').text(college.name, left + 64, y + 4, { width: width - 64 });
    if (college.address) doc.font('Helvetica').fontSize(9).fillColor('#6b7280').text(college.address, left + 64, doc.y, { width: width - 64 });
    y = Math.max(doc.y, y + 56) + 10;
    doc.moveTo(left, y).lineTo(left + width, y).strokeColor('#e5e7eb').stroke();
    y += 12;
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#101828').text('STATEMENT OF MARKS / REPORT CARD', left, y);
    y = doc.y + 8;

    const info = [
      ['Student', profile.user ? profile.user.name : ''], ['Roll number', profile.rollNo],
      ['Course', [profile.section && profile.section.course, profile.section && profile.section.specialization].filter(Boolean).join(' - ') || '-'],
      ['Section', profile.section ? profile.section.name : '-'],
      ['Academic session', semester.session.name], ['Semester', `Semester ${semester.semesterNumber}`]
    ];
    doc.fontSize(10).fillColor('#374151');
    info.forEach(([k, v]) => { doc.font('Helvetica-Bold').text(k, left, y, { width: 110 }); doc.font('Helvetica').text(String(v), left + 120, y, { width: width - 120 }); y = doc.y + 3; });
    y += 8;

    const cols = [{ t: 'Subject', w: 150 }, { t: 'Examination', w: 110 }, { t: 'Marks', w: 62 }, { t: 'Grade', w: 44 }, { t: 'Credits', w: 44 }, { t: 'Result', w: 55 }];
    doc.rect(left, y, width, 20).fillColor('#f3f4f6').fill();
    let x = left + 4; doc.fillColor('#374151').font('Helvetica-Bold').fontSize(9);
    cols.forEach(c => { doc.text(c.t, x, y + 6, { width: c.w }); x += c.w; });
    y += 24;
    doc.font('Helvetica').fontSize(9).fillColor('#101828');
    for (const e of semester.exams) {
      if (y > doc.page.height - 190) { doc.addPage(); y = 50; }
      const marks = e.state === 'absent' ? 'Absent' : `${num(e.marks)}/${e.maxMarks}`;
      const result = e.state === 'absent' ? 'FAIL' : e.passed ? 'PASS' : 'FAIL';
      const counted = e.countsForGpa ? '' : ' *';
      x = left + 4;
      [`${e.subject}`, `${e.exam}${counted}`, marks, num(e.grade), num(e.credits), result].forEach((val, i) => { doc.text(String(val), x, y, { width: cols[i].w - 4 }); x += cols[i].w; });
      y = Math.max(doc.y, y + 12) + 4;
      doc.moveTo(left, y - 2).lineTo(left + width, y - 2).strokeColor('#f1f2f4').stroke();
    }
    if (semester.exams.some(e => !e.countsForGpa)) { doc.fontSize(8).fillColor('#6b7280').text('* does not count towards GPA', left, y); y = doc.y + 4; }

    y += 10;
    doc.rect(left, y, width, 52).fillColor('#ecfdf5').fill();
    doc.fillColor('#14532d').font('Helvetica-Bold').fontSize(11);
    doc.text(`Semester GPA: ${num(semester.gpa)}`, left + 12, y + 10);
    doc.text(`Cumulative GPA: ${num(cgpa)}`, left + 12, y + 28);
    doc.text(`Credits: ${semester.credits}`, left + 220, y + 10);
    doc.text(`Result: ${semester.status || '-'}`, left + 220, y + 28);
    y += 70;

    doc.fillColor('#6b7280').font('Helvetica').fontSize(8)
      .text(`Published: ${date(publishedAt)}   |   Generated: ${date(new Date())}   |   Verification code: ${code}`, left, y, { width });
    doc.text('Computer generated from published results; verify the code with the college examination cell. No signature required.', left, doc.y + 2, { width });
    doc.end();
  });
}

module.exports = { renderReportCard };
