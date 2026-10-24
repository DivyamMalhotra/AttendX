import { renderDutyLeaveReview } from '../shared/dutyLeaveReview.js';

export default function render(args) {
  return renderDutyLeaveReview({ ...args, subtitle: 'All requests in your college. Mentors can also decide on requests from their own sections.' });
}
