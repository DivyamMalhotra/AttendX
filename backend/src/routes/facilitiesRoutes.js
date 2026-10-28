const express = require('express');
const ctrl = require('../controllers/facilitiesController');
const validate = require('../middleware/validate');
const { requirePermission: need } = require('../middleware/permissions');
const v = require('../validators/facilities');

/** Library desk, mounted at /api/admin/library behind a console role. */
const library = express.Router();
const lib = need('library.manage');
library.get('/books', lib, validate(v.bookList), ctrl.books);
library.post('/books', lib, validate(v.bookAdd), ctrl.addBook);
library.post('/books/:id/copies', lib, validate(v.copiesAdd), ctrl.addCopies);
library.get('/loans', lib, validate(v.loanList), ctrl.loans);
library.post('/issue', lib, validate(v.issue), ctrl.issue);
library.post('/return', lib, validate(v.returnBook), ctrl.returnBook);
library.post('/loans/:id/lost', lib, validate(v.id), ctrl.lost);

module.exports = { library };
