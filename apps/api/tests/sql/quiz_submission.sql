-- Run against a disposable database with the EduBridge migrations applied.
begin;

create function pg_temp.reject_test_notification() returns trigger language plpgsql as $$
begin
  if current_setting('edubridge.test_fail_notification', true) = 'on' then
    raise exception using errcode = 'P0099', message = 'Induced notification failure';
  end if;
  return new;
end;
$$;
create trigger quiz_submission_rollback_probe
before insert on public.notifications
for each row execute function pg_temp.reject_test_notification();

do $$
declare
  teacher uuid := gen_random_uuid();
  student uuid := gen_random_uuid();
  stranger uuid := gen_random_uuid();
  course uuid := gen_random_uuid();
  quiz uuid := gen_random_uuid();
  legacy_quiz uuid := gen_random_uuid();
  legacy_question uuid := gen_random_uuid();
  legacy_attempt uuid := gen_random_uuid();
  first_result jsonb;
  replay jsonb;
begin
  if has_function_privilege('authenticated', 'public.submit_quiz_once(uuid,uuid,uuid,integer[],integer[])', 'EXECUTE')
    or has_function_privilege('anon', 'public.submit_quiz_once(uuid,uuid,uuid,integer[],integer[])', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.submit_quiz_once(uuid,uuid,uuid,integer[],integer[])', 'EXECUTE') then
    raise exception 'Quiz submission role grant is incorrect';
  end if;

  insert into auth.users (id, raw_user_meta_data) values
    (teacher, '{"display_name":"Test teacher","requested_role":"teacher"}'),
    (student, '{"display_name":"Test student"}'),
    (stranger, '{"display_name":"Another student"}');
  insert into public.courses (id, teacher_id, name, subject, enrollment_code)
  values (course, teacher, 'Test course', 'Biology', 'TEST-' || course);
  insert into public.enrollments (course_id, student_id, status) values
    (course, student, 'approved'), (course, stranger, 'approved');
  insert into public.quizzes (id, course_id, student_id, title, target_concepts, created_by) values
    (quiz, course, student, 'Quiz', array['Plant Energy', 'Auto review'], 'ai'),
    (legacy_quiz, course, student, 'Legacy quiz', array['Plant Energy'], 'ai');
  insert into public.quiz_questions (id, quiz_id, position, prompt, options, correct_option, explanation, concept, difficulty) values
    (gen_random_uuid(), quiz, 0, 'Select the first option.', '["A","B","C","D"]', 0, 'A is first.', 'Plant Energy', 2),
    (gen_random_uuid(), quiz, 1, 'Select the second option.', '["A","B","C","D"]', 1, 'B is second.', 'Plant Energy', 2),
    (legacy_question, legacy_quiz, 0, 'Select the first option.', '["A","B","C","D"]', 0, 'A is first.', 'Plant Energy', 2);
  insert into public.study_plan_items
    (course_id, student_id, concept, concept_key, action, priority, source, due_at) values
    (course, student, 'Plant energy', 'plant-energy', 'Teacher assigned: practice.', 'high', 'mastery', now()),
    (course, student, 'Auto review', 'auto-review', 'Review this concept.', 'high', 'mastery', now()),
    (course, student, 'Unrelated concept', 'unrelated-concept', 'Teacher assigned: practice.', 'high', 'mastery', now());

  begin
    perform public.submit_quiz_once(course, quiz, stranger, array[0, 0], array[2, 3]);
    raise exception 'A different student could submit the quiz';
  exception when sqlstate 'PT404' then null;
  end;
  begin
    perform public.submit_quiz_once(course, quiz, student, array[0, 4], array[2, 3]);
    raise exception 'Out-of-range option was accepted';
  exception when sqlstate 'PT400' then null;
  end;

  perform set_config('edubridge.test_fail_notification', 'on', true);
  begin
    perform public.submit_quiz_once(course, quiz, student, array[0, 0], array[2, 3]);
    raise exception 'Expected a deliberately induced failure';
  exception when sqlstate 'P0099' then null;
  end;
  perform set_config('edubridge.test_fail_notification', 'off', true);
  if exists (select 1 from public.quiz_attempts where quiz_id = quiz)
    or exists (select 1 from public.student_concept_mastery where course_id = course and student_id = student)
    or exists (select 1 from public.study_plan_items where course_id = course and status = 'completed') then
    raise exception 'A failed transaction left partial quiz effects';
  end if;

  first_result := public.submit_quiz_once(course, quiz, student, array[0, 0], array[2, 3]);
  replay := public.submit_quiz_once(course, quiz, student, array[0, 1], array[3, 3]);
  if first_result is distinct from replay
    or not first_result @> '{"score":50,"correct":1,"total":2,"assignment_completed":true,"confidence_gaps":1}'::jsonb then
    raise exception 'The original adjudication was not preserved on retry';
  end if;
  if (select count(*) from public.quiz_attempts where quiz_id = quiz) <> 1
    or (select count(*) from public.quiz_answers where attempt_id = (first_result->>'attempt_id')::uuid) <> 2
    or (select count(*) from public.notifications where course_id = course) <> 1 then
    raise exception 'Retry duplicated a quiz effect';
  end if;
  if not exists (
    select 1 from public.student_concept_mastery
    where course_id = course and student_id = student and concept = 'Plant Energy'
      and total_answers = 2 and correct_answers = 1 and mastery_score = 50 and confidence = 0.333
  ) or (select count(*) from public.study_plan_items where course_id = course and status = 'completed') <> 1 then
    raise exception 'Mastery or assigned practice was updated incorrectly';
  end if;

  insert into public.quiz_attempts (id, quiz_id, student_id, completed_at, score)
  values (legacy_attempt, legacy_quiz, student, now(), 100);
  insert into public.quiz_answers (attempt_id, question_id, selected_option, is_correct)
  values (legacy_attempt, legacy_question, 0, true);
  replay := public.submit_quiz_once(course, legacy_quiz, student, array[1], array[3]);
  if (replay->>'attempt_id')::uuid is distinct from legacy_attempt
    or (select count(*) from public.quiz_attempts where quiz_id = legacy_quiz) <> 1 then
    raise exception 'An existing complete legacy quiz was regraded';
  end if;
end;
$$;

rollback;
