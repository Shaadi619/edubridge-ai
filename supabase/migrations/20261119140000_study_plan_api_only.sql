-- Students changed their own study-plan rows directly, which let them mark
-- assigned practice as done without doing it. The app updates these rows
-- through the API (service role) after checking the request, so students
-- keep read access only.
drop policy if exists "students update own study plan" on public.study_plan_items;
