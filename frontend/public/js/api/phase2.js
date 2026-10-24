/** Endpoints added with the campus-management modules. Same rule as endpoints.js: pages never build URLs. */
import { api, download } from './client.js';

export const accessApi = {
  permissions: () => api.get('/api/admin/access/permissions'),
  roles: () => api.get('/api/admin/access/roles'),
  createRole: body => api.post('/api/admin/access/roles', body),
  updateRole: (id, body) => api.patch(`/api/admin/access/roles/${id}`, body),
  staff: () => api.get('/api/admin/access/staff'),
  createStaff: body => api.post('/api/admin/access/staff', body),
  updateStaff: (id, body) => api.patch(`/api/admin/access/staff/${id}`, body),
  departments: () => api.get('/api/admin/access/departments'),
  createDepartment: body => api.post('/api/admin/access/departments', body),
  updateDepartment: (id, body) => api.patch(`/api/admin/access/departments/${id}`, body),
  setSectionDepartment: (id, departmentId) => api.put(`/api/admin/access/sections/${id}/department`, { departmentId })
};

export const timetableApi = {
  list: sectionId => api.get('/api/timetable', { sectionId }),
  create: body => api.post('/api/timetable', body),
  detail: id => api.get(`/api/timetable/${id}`),
  addEntry: (id, body) => api.post(`/api/timetable/${id}/entries`, body),
  removeEntry: (id, entryId) => api.del(`/api/timetable/${id}/entries/${entryId}`),
  approve: id => api.post(`/api/timetable/${id}/approve`),
  generate: body => api.post('/api/timetable/generate', body),
  mine: () => api.get('/api/timetable/mine'),
  unmarked: () => api.get('/api/timetable/unmarked'),
  today: query => api.get('/api/faculty/today', query),
  openClass: id => api.post(`/api/faculty/sessions/${id}/open`),
  cancelClass: (id, reason) => api.post(`/api/faculty/sessions/${id}/cancel`, { reason }),
  resolve: (id, body) => api.post(`/api/faculty/sessions/${id}/resolve`, body),
  studentWeek: () => api.get('/api/student/timetable')
};

export const qrApi = {
  start: (id, minutes) => api.post(`/api/faculty/sessions/${id}/qr`, minutes ? { minutes } : {}),
  current: id => api.get(`/api/faculty/sessions/${id}/qr`),
  scans: id => api.get(`/api/faculty/sessions/${id}/qr/scans`),
  close: id => api.post(`/api/faculty/sessions/${id}/qr/close`),
  scan: body => api.post('/api/student/qr-attendance', body),
  openForStudent: () => api.get('/api/student/qr-attendance/open')
};

export const examsApi = {
  policy: () => api.get('/api/admin/exams/grading-policy'),
  savePolicy: body => api.put('/api/admin/exams/grading-policy', body),
  list: query => api.get('/api/admin/exams', query),
  create: body => api.post('/api/admin/exams', body),
  update: (id, body) => api.patch(`/api/admin/exams/${id}`, body),
  remove: id => api.del(`/api/admin/exams/${id}`),
  sheet: id => api.get(`/api/admin/exams/${id}/marks`),
  review: (id, body) => api.post(`/api/admin/exams/${id}/review`, body),
  lock: id => api.post(`/api/admin/exams/${id}/lock`),
  publish: id => api.post(`/api/admin/exams/${id}/publish`),
  reopen: (id, reason) => api.post(`/api/admin/exams/${id}/reopen`, { reason }),
  adminReportCard: (studentId, query) => download(`/api/admin/exams/report-card/${studentId}`, 'report-card.pdf', query),
  facultyList: () => api.get('/api/faculty/exams'),
  facultySheet: id => api.get(`/api/faculty/exams/${id}/marks`),
  saveMarks: (id, body) => api.put(`/api/faculty/exams/${id}/marks`, body),
  submit: id => api.post(`/api/faculty/exams/${id}/submit`),
  myResults: () => api.get('/api/student/results'),
  myReportCard: query => download('/api/student/report-card', 'report-card.pdf', query)
};

export const noticeApi = {
  feed: query => api.get('/api/announcements', query),
  read: id => api.post(`/api/announcements/${id}/read`),
  manage: () => api.get('/api/announcements/manage'),
  create: formData => api.upload('/api/announcements', formData),
  update: (id, body) => api.patch(`/api/announcements/${id}`, body),
  publish: id => api.post(`/api/announcements/${id}/publish`),
  withdraw: id => api.post(`/api/announcements/${id}/withdraw`),
  stats: id => api.get(`/api/announcements/${id}/stats`),
  attachment: (kind, id, index, name) => download(`/api/files/${kind}/${id}/${index}`, name || 'attachment')
};

export const leaveTypesApi = {
  list: () => api.get('/api/admin/leave-types'),
  create: body => api.post('/api/admin/leave-types', body),
  update: (id, body) => api.patch(`/api/admin/leave-types/${id}`, body),
  forStudent: () => api.get('/api/student/leave-types')
};

export const courseworkApi = {
  // faculty
  assignments: () => api.get('/api/faculty/assignments'),
  createAssignment: formData => api.upload('/api/faculty/assignments', formData),
  updateAssignment: (id, body) => api.patch(`/api/faculty/assignments/${id}`, body),
  publishAssignment: id => api.post(`/api/faculty/assignments/${id}/publish`),
  closeAssignment: id => api.post(`/api/faculty/assignments/${id}/close`),
  submissions: id => api.get(`/api/faculty/assignments/${id}/submissions`),
  grade: (id, studentId, body) => api.put(`/api/faculty/assignments/${id}/submissions/${studentId}/grade`, body),
  release: id => api.post(`/api/faculty/assignments/${id}/release`),
  materials: query => api.get('/api/faculty/materials', query),
  addMaterial: formData => api.upload('/api/faculty/materials', formData),
  removeMaterial: id => api.del(`/api/faculty/materials/${id}`),
  // student
  mine: () => api.get('/api/student/assignments'),
  submit: (id, formData) => api.upload(`/api/student/assignments/${id}/submit`, formData),
  myMaterials: query => api.get('/api/student/materials', query),
  file: (kind, id, index, name) => download(`/api/files/${kind}/${id}/${index}`, name || 'file')
};

export const mentorApi = {
  students: () => api.get('/api/mentor/students'),
  followUps: () => api.get('/api/mentor/followups'),
  overview: id => api.get(`/api/mentor/students/${id}/overview`),
  timeline: (id, query) => api.get(`/api/mentor/students/${id}/timeline`, query),
  notes: id => api.get(`/api/mentor/students/${id}/notes`),
  addNote: (id, body) => api.post(`/api/mentor/students/${id}/notes`, body),
  updateNote: (noteId, body) => api.patch(`/api/mentor/notes/${noteId}`, body),
  // administration
  assign: body => api.post('/api/admin/mentoring/assign', body),
  assignments: () => api.get('/api/admin/mentoring/assignments'),
  history: id => api.get(`/api/admin/mentoring/history/${id}`),
  parents: query => api.get('/api/admin/mentoring/parents', query),
  createParent: body => api.post('/api/admin/mentoring/parents', body),
  linkParent: body => api.post('/api/admin/mentoring/parents/links', body),
  revokeLink: (id, reason) => api.post(`/api/admin/mentoring/parents/links/${id}/revoke`, { reason }),
  adminTimeline: (id, query) => api.get(`/api/admin/mentoring/students/${id}/timeline`, query)
};

export const parentApi = {
  children: () => api.get('/api/parent/children'),
  view: (id, area) => api.get(`/api/parent/children/${id}/${area}`),
  timeline: (id, query) => api.get(`/api/parent/children/${id}/timeline`, query)
};

export const timelineApi = { mine: query => api.get('/api/student/timeline', query) };

export const libraryApi = {
  books: query => api.getPage('/api/admin/library/books', query),
  addBook: body => api.post('/api/admin/library/books', body),
  addCopies: (id, count) => api.post(`/api/admin/library/books/${id}/copies`, { count }),
  loans: query => api.getPage('/api/admin/library/loans', query),
  issue: body => api.post('/api/admin/library/issue', body),
  returnBook: body => api.post('/api/admin/library/return', body),
  lost: id => api.post(`/api/admin/library/loans/${id}/lost`),
  mine: () => api.get('/api/student/library')
};

export const hostelApi = {
  hostels: () => api.get('/api/admin/hostel/hostels'),
  saveHostel: body => api.post('/api/admin/hostel/hostels', body),
  updateHostel: (id, body) => api.patch(`/api/admin/hostel/hostels/${id}`, body),
  rooms: id => api.get(`/api/admin/hostel/hostels/${id}/rooms`),
  addRooms: (id, groups) => api.post(`/api/admin/hostel/hostels/${id}/rooms`, { groups }),
  updateRoom: (id, body) => api.patch(`/api/admin/hostel/rooms/${id}`, body),
  allocations: query => api.getPage('/api/admin/hostel/allocations', query),
  allocate: body => api.post('/api/admin/hostel/allocations', body),
  checkIn: id => api.post(`/api/admin/hostel/allocations/${id}/check-in`),
  end: (id, reason) => api.post(`/api/admin/hostel/allocations/${id}/end`, { reason }),
  transfer: (id, body) => api.post(`/api/admin/hostel/allocations/${id}/transfer`, body),
  mine: () => api.get('/api/student/hostel')
};

export const financeApi = {
  refunds: query => api.getPage('/api/admin/fees/refunds', query),
  requestRefund: body => api.post('/api/admin/fees/refunds', body),
  approveRefund: (id, note) => api.post(`/api/admin/fees/refunds/${id}/approve`, { note }),
  rejectRefund: (id, note) => api.post(`/api/admin/fees/refunds/${id}/reject`, { note }),
  retryRefund: id => api.post(`/api/admin/fees/refunds/${id}/retry`),
  policy: () => api.get('/api/admin/fees/late-fee-policy'),
  savePolicy: body => api.put('/api/admin/fees/late-fee-policy', body),
  lateFees: query => api.getPage('/api/admin/fees/late-fees', query),
  runLateFees: () => api.post('/api/admin/fees/late-fees/run'),
  waive: (id, reason) => api.post(`/api/admin/fees/late-fees/${id}/waive`, { reason }),
  myRefunds: () => api.get('/api/fees/refunds')
};

export const analyticsApi = {
  overview: query => api.get('/api/admin/analytics/overview', query),
  atRisk: query => api.getPage('/api/admin/analytics/at-risk', query),
  exportAtRisk: () => download('/api/admin/analytics/at-risk', 'at-risk-students.csv', { format: 'csv' })
};

export const dataApi = {
  imports: () => api.get('/api/admin/data/imports'),
  preview: (kind, formData) => api.upload(`/api/admin/data/imports/${kind}/preview`, formData),
  batch: id => api.get(`/api/admin/data/imports/${id}`),
  confirm: (id, skipInvalid) => api.post(`/api/admin/data/imports/${id}/confirm`, { skipInvalid: Boolean(skipInvalid) }),
  cancel: id => api.post(`/api/admin/data/imports/${id}/cancel`),
  template: kind => download(`/api/admin/data/imports/templates/${kind}`, `${kind}-template.csv`),
  exportCsv: kind => download(`/api/admin/data/export/${kind}`, `${kind}.csv`)
};

export const systemApi = {
  jobs: () => api.get('/api/admin/system/jobs'),
  runJob: name => api.post(`/api/admin/system/jobs/${name}/run`),
  backups: () => api.get('/api/admin/system/backups'),
  createBackup: () => api.post('/api/admin/system/backups'),
  verifyBackup: id => api.post(`/api/admin/system/backups/${id}/verify`)
};
