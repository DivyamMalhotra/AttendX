# Roles, routing rules and onboarding

This page records the decisions behind the role model, so nothing has to be guessed from the code.

## The seven roles

Administrator (`admin`), HOD (`hod`), Teacher (`teacher`), Student (`student`), Accounts Clerk (`accounts_clerk`), Exam Cell (`exam_cell`), Parent (`parent`).
These are the only values `User.role` accepts. There is no Mentor, Librarian, Hostel Warden, Registrar, Principal, Super Admin or custom role (custom roles can no longer be created).

### Administrator versus HOD

| | Administrator | HOD |
|---|---|---|
| Purpose | Configures and runs the college ERP | Oversees the academics of assigned departments |
| Count | Exactly **one per college** (a database unique index, `one_admin_per_college`) | Any number, each with assigned departments |
| Scope | Their own college only | Only the departments assigned to that HOD |
| Settings, attendance thresholds | Yes (Admin workspace: Settings) | No |
| Jobs, backups, audit logs | Yes (Admin workspace) | No |
| Staff accounts, parents, mentors, sections, teachers, students, timetables, leave types, announcements | Yes | No |
| Library desk | Yes (there is no Librarian role) | No |
| Departmental attendance reports, analytics, at-risk list, students, examination results, exports | Reads everything in the college | Yes, **department-scoped on the server** |
| Decides leave | Never | Never |
| Sees counselling notes, medical leave, the at-risk list | Never (not implied by `*`) | At-risk only |

A HOD with no department assigned sees nothing. The Administrator is created by `npm run admin:create` (it refuses a second one) and then creates HOD, Accounts Clerk and Exam Cell accounts under *Staff accounts*.

### Other roles

* **Teacher**: Today, My classes, Attendance watch (alerts and at-risk list for their own mentees), Leave requests (their mentees), Examinations of their subjects, Announcements. Mentor is a teacher with `MentorAssignment` records, not a role.
* **Student**: unchanged, including the Install App button.
* **Accounts Clerk**: the Fees workspace and its legacy routes. No attendance pages.
* **Exam Cell**: Examinations and Data (Student Marks upload and export). No attendance.
* **Parent**: a restricted portal (`parent.html`, `/api/parent/*`): the linked child's **published** marks, fee statement, payment (through the same verified payment pipeline) and receipts. Nothing else is routed to a parent.

Permissions of the fixed roles are in `backend/src/config/permissions.js` (`BASE_ROLE_PERMISSIONS`; `DEPARTMENT_ROLES` lists the department-scoped ones). `*` for the Administrator excludes `mentorNotes.view`, `leave.reviewMedical` and `analytics.atRisk`. The Administrator also holds fee permissions through `*`; the interface shows Fees only to the Accounts Clerk, but the server does not hide it from the Administrator, so an Administrator can still be asked to step in on finance.

## Parent-student links

A parent account is created only by the Administrator (*Mentors & parents, Parents*) and always carries a verified link: the student, the relationship and a mandatory note saying how the person was verified. A roll number alone grants nothing. Every `/api/parent/children/:studentId/...` request is resolved through `parentService.authoriseChild`: unlinked, revoked, foreign-college and malformed ids all return 404, so students cannot be enumerated. College settings (`parentVisibility.results`, `.fees`) can switch each area off. Links can be revoked and take effect immediately. No parent is ever invented by a script.

## Migration of existing users

`npm run migrate:roles` (dry run) and `npm run migrate:roles -- --apply`; repeatable, nothing is deleted.

* `hod` -> `admin` for the oldest such account of a college that has no Administrator; further `hod` accounts stay HOD and are listed because they need departments.
* `staff` with the accounts clerk / accounts head role -> `accounts_clerk`; exam cell -> `exam_cell`.
* Every other old account (staff with registrar, principal, hostel warden, librarian, counsellor, mentor roles or no role) is **kept but deactivated** and listed. Parents deactivated by an earlier migration are reactivated when they still hold an active verified link.
* Old built-in Role documents are switched off. Parent links, mentor assignments and history stay.

## Leave routing and dates

A request is routed at submission to the student's current `MentorAssignment`, otherwise the section mentor. **Only that teacher can decide it** (including medical). Other teachers, HODs, the Administrator and the other roles are refused. With no mentor the request stays `pending`, is never auto-approved, and appears read-only under the Administrator's *Unassigned leave* until a mentor is assigned. All steps are audited and the student sees the status.

Dates are stored per day (`DutyLeaveDay`) and applied when numbers are calculated, so approved leave only excuses absences on the chosen dates; raw attendance is never rewritten, and a future-dated approval cannot change earlier days.

## Teacher rules

* **Notifications**: student-facing events (fees, assignments, results, library, attendance standing, leave decisions, mentor assignment) are stored only for students, in `notificationService.notify`, so no producer can leak them. Nothing in the code notified teachers about assignment submissions, fee events or QR scans in the first place; there is **no OTP attendance feature** in this code base. Teachers still receive announcements addressed to them and "attendance not marked" for their own classes.
* **9:00 to 10:00 class "cancelled after 9"**: the requirement is ambiguous and no existing code encodes it. The behaviour implemented, using the timetable `startTime` and the college timezone, is: a teacher cannot cancel a class from its start time onward; they take attendance or close it with *explained / completed without attendance*, which is audited. The Administrator may still cancel. Nothing else about scheduling changed. Please confirm this reading.

## Removed features

* **Hostel** is removed completely: routes, controller, service, model registration, permission, student page, console entry, demo data, analytics figure and tests. Existing hostel collections in the database are left untouched (nothing was deleted); a historical `hostel` fee category value is kept only so old charges still load.
* **Unit Test Copy** does not exist anywhere in this code base (backend, frontend, seeds, docs), so there was nothing to remove. Software unit tests are untouched.
* **Parents section of the HOD** is gone; the Administrator manages parent links.
* Library import and the Library loans export are gone from the Data page. Exports are **Students** and **Student Marks**; marks are uploaded by the Exam Cell through the existing marks import (`marks.upload`).

## Seeding the 5G3 list

```bash
cd backend
npm run seed:5g3 -- --college-code CAMPUS26 --file "C:/path/5G3_Student_List.csv"           # validation + dry run
npm run seed:5g3 -- --college-code CAMPUS26 --file "C:/path/5G3_Student_List.csv" --apply   # writes
```

The parser (`backend/src/utils/studentListCsv.js`) strips the one-cell-per-line quoting and reads serial, 10-digit roll number, name and group. It prints rows / valid / invalid / duplicates / missing fields / groups and **aborts before writing** on any unreadable line, duplicate or invalid roll number, missing field or a group other than 5G3. Students are matched by roll number, so a re-run creates nothing twice, never resets a password and never touches other students. They go into section `5G3` (Semester 5, BE-CSE, AIML).

The list has no e-mail addresses, so each new login is `<rollno>@student.attendx.invalid` (reserved, undeliverable; e-mail and SMS for these accounts are off). Roles the college lacks get one generic account only for Administrator, Teacher, Accounts Clerk and Exam Cell; **no HOD or Parent is created** because that needs real departments or a verified link.

### Credentials file

`backend/credentials/onboarding-<timestamp>.csv`: Name, Roll number / identifier, Role, Username, Temporary password, Must change password on first login. Passwords are 14 random characters, unique, stored only as bcrypt hashes, and must be changed at first login. The folder is git-ignored, the file is owner-only, the web server does not serve it, and no script prints a password. Existing users are never reset or listed. Hand each person only their own row, then delete the file.
