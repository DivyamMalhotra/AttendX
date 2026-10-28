import { renderDutyLeaveReview } from '../shared/dutyLeaveReview.js';

export default function render(args) {
  return renderDutyLeaveReview({ ...args, unassigned: true, subtitle: 'Pending requests whose student has no mentor. Assign a mentor under People → Mentors so a teacher can decide them. The Administrator does not decide leave.' });
}
