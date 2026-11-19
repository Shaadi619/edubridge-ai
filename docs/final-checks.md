# Final checks

Things to verify by hand before the redesign branch is merged. Tick each one off once it has been seen working.

## Show Your Work

- [ ] Upload a photo of working with a deliberate mistake (uses AI tokens) and check the feedback screen:
  - steps appear as a numbered sequence, the student's own working in teal and corrections in coral
  - each correction's source button lights the quoted line on the cited page
  - a correction with no matching course quote shows the "couldn't be matched" note
  - a confident misconception backed by course text appears in the teacher's review queue; one without verified text does not
- [ ] Check the same screen at desktop width (source panel beside the feedback) and phone width (panel below, hidden until there's a cited page).
- [ ] Turn the course switch off in teacher Settings and confirm the student tab disappears and the API refuses uploads.
- [ ] Decide whether Show Your Work should stay on for Advanced AI (it was switched on during testing on 19 November).

## Database

- [ ] `20261118200000_show_work_setting.sql` was applied through the Supabase SQL editor on 19 November, so it isn't in Supabase's migration history. It is safe to re-run (`add column if not exists`).

## Teacher Overview

- [ ] "Draft a message with AI" opens the follow-up dialog (uses AI tokens): the draft loads, fields are editable, Escape and Close work, "Send to …" assigns it and the student sees the message.
- [ ] A student entering the join code appears under "waiting to join"; "Let in" and "Turn down" both work.
- [ ] A Show Your Work upload with a confident, course-backed misconception appears under "uploads to check"; "Agree, add to their record" and "Not a problem" both work.
- [ ] Post an announcement (with and without "Keep it at the top") and delete it; students see it.
- [ ] "Copy" copies the join code.
