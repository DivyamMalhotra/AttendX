const fs = require('fs');
const PDFDocument = require('pdfkit');
const { config } = require('../config/env');
const { formatINR } = require('../utils/money');

// Built-in PDF fonts cannot render the rupee sign, so amounts are printed as "INR 1,25,000.00".
const money = paise => formatINR(paise).replace('₹', 'INR ');
const dateTime = d => new Date(d).toLocaleString('en-IN', { timeZone: config.timezone, dateStyle: 'medium', timeStyle: 'short' });

/** Renders a receipt snapshot to a PDF buffer. The snapshot, not live data, is the source of truth. */
function renderReceipt(receipt) {
  const s = receipt.snapshot;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Fee Receipt ${receipt.receiptNo}` } });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = 48; const width = doc.page.width - 96;
    let y = 48;

    if (config.receiptLogoPath && fs.existsSync(config.receiptLogoPath)) {
      try { doc.image(config.receiptLogoPath, left, y, { fit: [56, 56] }); } catch (e) { /* unreadable logo: skip */ }
    }
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#152b47').text(s.institution.name, left + 68, y + 4, { width: width - 68 });
    if (s.institution.address) doc.font('Helvetica').fontSize(9).fillColor('#6b7280').text(s.institution.address, left + 68, doc.y, { width: width - 68 });
    y = Math.max(doc.y, y + 60) + 12;
    doc.moveTo(left, y).lineTo(left + width, y).strokeColor('#e5e7eb').stroke();
    y += 14;

    doc.font('Helvetica-Bold').fontSize(14).fillColor('#101828').text('FEE PAYMENT RECEIPT', left, y);
    doc.font('Helvetica').fontSize(10).fillColor('#374151');
    const meta = [['Receipt No.', receipt.receiptNo], ['Transaction ID', s.transactionId], ['Gateway order', s.providerOrderId],
      ['Gateway payment', s.providerPaymentId || '-'], ['Payment date', dateTime(s.paidAt)]];
    y = doc.y + 8;
    meta.forEach(([k, v]) => { doc.font('Helvetica-Bold').text(k, left, y, { width: 120, continued: false }); doc.font('Helvetica').text(String(v), left + 130, y, { width: width - 130 }); y = doc.y + 4; });

    y += 8;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#152b47').text('Student', left, y);
    doc.font('Helvetica').fontSize(10).fillColor('#374151');
    y = doc.y + 4;
    [['Name', s.student.name], ['Roll No.', s.student.rollNo],
      ...(s.category && s.category !== 'semester'
        ? [['Charge', s.description || s.category]]
        : [['Course', [s.course, s.specialization].filter(Boolean).join(' - ') || '-'], ['Semester', `Semester ${s.semesterNumber}`], ['Academic session', s.academicSession]])].forEach(([k, v]) => {
      doc.font('Helvetica-Bold').text(k, left, y, { width: 120 }); doc.font('Helvetica').text(String(v), left + 130, y, { width: width - 130 }); y = doc.y + 4;
    });

    y += 10;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#152b47').text(s.category && s.category !== 'semester' ? 'Charge' : 'Semester fee', left, y);
    y = doc.y + 6;
    doc.font('Helvetica').fontSize(10).fillColor('#374151');
    const row = (label, value, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').text(label, left, y, { width: width - 140 });
      doc.text(value, left + width - 140, y, { width: 140, align: 'right' });
      y = Math.max(doc.y, y + 14) + 3;
    };
    s.fee.components.forEach(c => row(c.name, money(c.amountPaise)));
    s.fee.adjustments.forEach(a => row(`${a.kind === 'concession' ? 'Less' : 'Add'}: ${a.label}`, `${a.kind === 'concession' ? '-' : '+'}${money(a.amountPaise)}`));
    doc.moveTo(left, y).lineTo(left + width, y).strokeColor('#e5e7eb').stroke(); y += 6;
    row(s.category && s.category !== 'semester' ? 'Total amount payable' : 'Total semester fee payable', money(s.fee.totalPayablePaise), true);
    row('Total paid up to this receipt', money(s.totalPaidAfterPaise));
    row('Outstanding balance', money(s.balanceAfterPaise));

    y += 10;
    doc.rect(left, y, width, 44).fillColor('#ecfdf5').fill();
    doc.fillColor('#16a34a').font('Helvetica-Bold').fontSize(11).text('AMOUNT PAID IN THIS TRANSACTION', left + 12, y + 8);
    doc.fontSize(15).text(money(s.amountPaise), left + 12, y + 8, { width: width - 24, align: 'right' });
    y += 62;

    if (s.simulated) {
      doc.fillColor('#dc2626').font('Helvetica-Bold').fontSize(11)
        .text('SIMULATED TEST PAYMENT - NOT A REAL TRANSACTION. No money was moved and this receipt has no financial validity.', left, y, { width });
      y = doc.y + 8;
    }
    doc.fillColor('#99a1af').font('Helvetica').fontSize(8)
      .text('This is a computer generated receipt issued for a verified payment and does not require a signature.', left, y, { width });
    doc.end();
  });
}

module.exports = { renderReceipt };
