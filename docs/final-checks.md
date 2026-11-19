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

- [x] (19 Nov, teacher side; student still to confirm the message arrives) "Draft a message with AI" opens the follow-up dialog (uses AI tokens): the draft loads, fields are editable, Escape and Close work, "Send to …" assigns it and the student sees the message.
- [ ] A student entering the join code appears under "waiting to join"; "Let in" and "Turn down" both work.
- [ ] A Show Your Work upload with a confident, course-backed misconception appears under "uploads to check"; "Agree, add to their record" and "Not a problem" both work.
- [ ] Post an announcement (with and without "Keep it at the top") and delete it; students see it.
- [x] (19 Nov) "Copy" copies the join code.

## Sign-in, settings and brand

- [ ] Student: Join Course finds a course by code, "Ask to join" sends a request, "Cancel request" works, and a code that doesn't exist shows the "No course has that code" message.
- [ ] Student Settings: edit and save the profile, change quiz difficulty, flip both switches, and check each change survives a reload.
- [x] (19 Nov; "Keep the ticked ones" and adding a topic not tried, to leave your topics unchanged) Teacher Settings: "Suggest topics" (uses AI tokens) shows topics and an order with ticks; "Keep the ticked ones" saves them; adding a topic, saving an order and removing it all work.
- [ ] Sign up a new teacher and a new student end to end (sign-up, email confirmation if enabled, the "waiting for approval" screen, admin approval).
- [x] (19 Nov, page source; phone icon not seen on a phone) The favicon and phone home-screen icon show the uB monogram.

## Found during the checks (19 November)

- Fixed: teacher pages reset to "Loading courses…" when the tab regained focus.
- Fixed: AI follow-up drafts showed internal IDs and jargon, and couldn't be stopped while loading.
- Fixed: topic-suggestion summary was jargon and cut off.
- Fixed: "Your courses" showed "0 students" for other courses.
- Not built yet: there is no way to remove a topic once added.
- Slow: an AI follow-up draft takes about 30 to 40 seconds; topic suggestions about a minute.

### Student side (signed in as a student in Chrome)

- Works: notifications show the follow-up and the announcement; the pinned announcement shows in Machine Learning.
- Works: Show Your Work is hidden in Machine Learning, where the teacher left it off.
- Works: Join Course rejects a wrong code and says "already in" for Advanced AI.
- Works: Settings changes (difficulty, switch, profile) save and come back after reload.
- Works: Show Your Work caught both planted mistakes (steps 3 and 6), cited pages 62 and 14, and said the teacher reviews it first.
- Fixed: the source panel said "This excerpt is unavailable" for Show Your Work citations.
- Fixed: the source panel scrolled away from long feedback, so a clicked citation lit a line off screen. It now stays in view (Show Your Work and Quiz).
- Fixed: Settings showed "0 quizzes taken" before the count loaded.
- Fixed: the join-code box had no proper name for screen readers.
- Still open: the notifications panel uses the old light style; "Join a Course" appears both in the header and on the page; the page strip can show the same page twice.

### Teacher side, second pass

- Works: deleting the test announcement removes it from the course.
- Works: "Agree, add to their record" on a Show Your Work upload clears it from "uploads to check" and adds the mistake to the student's record.
- Works: the Show Your Work switch saves and survives a reload (Machine Learning turned on, checked, turned back off).
- Fixed: once after switching accounts the app showed a blank page. If the account details fail to load, it now says so and offers "Try again" and "Sign out".
- Fixed: Analytics and the course summary didn't count an agreed upload until the page was reloaded.
- Fixed: the upload quote showed doubled quotation marks.
- Fixed: mistake titles like "sequential processing misconception" now read "Sequential processing".
- Still open: an agreed upload adds a new mistake even when the student already has an open one on the same idea (here "Sequential vs. parallel processing").
