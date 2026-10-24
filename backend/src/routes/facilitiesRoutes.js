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

/** Hostel office, mounted at /api/admin/hostel behind a console role. */
const hostel = express.Router();
const host = need('hostel.manage');
hostel.get('/hostels', host, ctrl.hostels);
hostel.post('/hostels', host, validate(v.hostelSave), ctrl.saveHostel);
hostel.patch('/hostels/:id', host, validate(v.hostelUpdate), ctrl.updateHostel);
hostel.get('/hostels/:id/rooms', host, validate(v.id), ctrl.rooms);
hostel.post('/hostels/:id/rooms', host, validate(v.rooms), ctrl.addRooms);
hostel.patch('/rooms/:id', host, validate(v.roomUpdate), ctrl.updateRoom);
hostel.get('/allocations', host, validate(v.allocList), ctrl.allocations);
hostel.post('/allocations', host, validate(v.allocate), ctrl.allocate);
hostel.post('/allocations/:id/check-in', host, validate(v.id), ctrl.checkIn);
hostel.post('/allocations/:id/end', host, validate(v.endAlloc), ctrl.end);
hostel.post('/allocations/:id/transfer', host, validate(v.transfer), ctrl.transfer);

module.exports = { library, hostel };
