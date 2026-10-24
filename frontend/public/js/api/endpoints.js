/** One function per backend endpoint, grouped by area. Pages import from here, never build URLs. */
import { api, download, setCsrfToken } from './client.js';

export const authApi = {
  college: code => api.get('/api/auth/college', { code }),
  async login(payload) {
    await api.get('/api/auth/csrf').then(d => setCsrfToken(d.csrfToken));
    const data = await api.post('/api/auth/login', payload);
    setCsrfToken(data.csrfToken);
    return data;
  },
  logout: () => api.post('/api/auth/logout'),
  async me() {
    const data = await api.get('/api/auth/me');
    setCsrfToken(data.csrfToken);
    return data;
  },
  async changePassword(payload) {
    const data = await api.post('/api/auth/change-password', payload);
    setCsrfToken(data.csrfToken);
    return data;
  }
};

export const studentApi = {
  dashboard: () => api.get('/api/student/dashboard'),
  attendance: () => api.get('/api/student/attendance'),
  profile: () => api.get('/api/student/profile'),
  updateProfile: body => api.patch('/api/student/profile', body),
  notifications: query => api.getPage('/api/student/notifications', query),
  markRead: id => api.post(`/api/student/notifications/${id}/read`),
  markAllRead: () => api.post('/api/student/notifications/read-all'),
  dutyLeaves: () => api.get('/api/student/duty-leaves'),
  applyDutyLeave: formData => api.upload('/api/student/duty-leaves', formData),
  cancelDutyLeave: id => api.post(`/api/student/duty-leaves/${id}/cancel`)
};

export const dutyLeaveApi = {
  queue: query => api.getPage('/api/duty-leaves/review', query),
  review: (id, body) => api.post(`/api/duty-leaves/${id}/review`, body),
  document: id => download(`/api/duty-leaves/${id}/document`, 'duty-leave-document')
};

export const facultyApi = {
  subjects: () => api.get('/api/faculty/subjects'),
  lookup: query => api.get('/api/faculty/attendance/lookup', query),
  submit: body => api.put('/api/faculty/attendance/sessions', body),
  session: id => api.get(`/api/faculty/attendance/sessions/${id}`),
  updateSession: (id, body) => api.put(`/api/faculty/attendance/sessions/${id}`, body),
  students: subjectId => api.get(`/api/faculty/subjects/${subjectId}/students`),
  summary: subjectId => api.get(`/api/faculty/subjects/${subjectId}/summary`)
};

export const feesApi = {
  summary: () => api.get('/api/fees/summary'),
  history: () => api.get('/api/fees/history'),
  createOrder: body => api.post('/api/fees/orders', body),
  verify: (orderId, body) => api.post(`/api/fees/orders/${orderId}/verify`, body),
  sync: orderId => api.post(`/api/fees/orders/${orderId}/sync`),
  cancel: orderId => api.post(`/api/fees/orders/${orderId}/cancel`),
  simulate: (orderId, outcome) => api.post(`/api/fees/orders/${orderId}/simulate`, { outcome }),
  receipt: id => download(`/api/fees/receipts/${id}/pdf`, 'receipt.pdf')
};

export const adminApi = {
  overview: () => api.get('/api/admin/overview'),
  sections: () => api.get('/api/admin/sections'),
  createSection: body => api.post('/api/admin/sections', body),
  updateSection: (id, body) => api.patch(`/api/admin/sections/${id}`, body),
  deleteSection: id => api.del(`/api/admin/sections/${id}`),
  setMentor: (id, mentorId) => api.put(`/api/admin/sections/${id}/mentor`, { mentorId }),
  createSubject: (sectionId, body) => api.post(`/api/admin/sections/${sectionId}/subjects`, body),
  updateSubject: (id, body) => api.patch(`/api/admin/subjects/${id}`, body),
  deleteSubject: id => api.del(`/api/admin/subjects/${id}`),
  teachers: () => api.get('/api/admin/teachers'),
  createTeacher: body => api.post('/api/admin/teachers', body),
  updateTeacher: (id, body) => api.patch(`/api/admin/teachers/${id}`, body),
  students: query => api.getPage('/api/admin/students', query),
  createStudent: body => api.post('/api/admin/students', body),
  updateStudent: (id, body) => api.patch(`/api/admin/students/${id}`, body),
  settings: () => api.get('/api/admin/settings'),
  updateSettings: body => api.patch('/api/admin/settings', body),
  academicSessions: () => api.get('/api/admin/academic-sessions'),
  createAcademicSession: body => api.post('/api/admin/academic-sessions', body),
  setCurrentSession: id => api.post(`/api/admin/academic-sessions/${id}/current`),
  attendanceReport: query => api.get('/api/admin/attendance/report', query),
  exportAttendance: query => download('/api/admin/attendance/report', 'attendance-report.csv', { ...query, format: 'csv' }),
  alerts: query => api.getPage('/api/admin/attendance/alerts', query),
  auditLog: query => api.getPage('/api/admin/audit-log', query)
};

export const feeAdminApi = {
  summary: () => api.get('/api/admin/fees/summary'),
  structures: () => api.get('/api/admin/fees/structures'),
  createStructure: body => api.post('/api/admin/fees/structures', body),
  updateStructure: (id, body) => api.patch(`/api/admin/fees/structures/${id}`, body),
  deleteStructure: id => api.del(`/api/admin/fees/structures/${id}`),
  assign: body => api.post('/api/admin/fees/assign', body),
  assignments: query => api.getPage('/api/admin/fees/assignments', query),
  adjust: (id, body) => api.post(`/api/admin/fees/assignments/${id}/adjust`, body),
  transactions: query => api.getPage('/api/admin/fees/transactions', query),
  transaction: id => api.get(`/api/admin/fees/transactions/${id}`),
  exportTransactions: query => download('/api/admin/fees/transactions', 'transactions.csv', { ...query, format: 'csv' }),
  reconcile: id => api.post(`/api/admin/fees/transactions/${id}/reconcile`),
  receipt: id => download(`/api/admin/fees/receipts/${id}/pdf`, 'receipt.pdf'),
  exportOutstanding: query => download('/api/admin/fees/reports/outstanding', 'outstanding-fees.csv', { ...query, format: 'csv' })
};
