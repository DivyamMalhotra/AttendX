import { renderDutyLeaveReview } from '../shared/dutyLeaveReview.js';

export default function render(args) {
  return renderDutyLeaveReview({ ...args, subtitle: 'Requests from students in the sections you mentor' });
}
