/**
 * Where the student fee and result pages read from. A student reads their own data (/api/fees, /api/student/results).
 * A parent reuses the very same pages for ONE chosen child, so the base URLs point at the parent portal instead; the
 * server re-checks the verified parent-child link on every one of those requests, so this is convenience, not security.
 */
const KEY = 'attendx.child';
export const scope = { feesBase: '/api/fees', resultsUrl: '/api/student/results' };

export function chooseChild(studentId) {
  try { sessionStorage.setItem(KEY, studentId); } catch (e) { /* the choice just is not remembered */ }
  scope.feesBase = `/api/parent/children/${studentId}/fees`;
  scope.resultsUrl = `/api/parent/children/${studentId}/results`;
}

export function chosenChild() {
  try { return sessionStorage.getItem(KEY); } catch (e) { return null; }
}
