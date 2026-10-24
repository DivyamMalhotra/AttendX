const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** HTML-escapes untrusted text before it is placed in an e-mail or any generated markup. */
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ENT[c]);

/** Strips CR/LF so user text can never inject headers into an e-mail subject or similar fields. */
const singleLine = value => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();

module.exports = { escapeHtml, singleLine };
