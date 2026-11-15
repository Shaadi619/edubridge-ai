alter table public.quiz_attempts add column submission_result jsonb;

create index quiz_attempts_quiz_student_completed_idx
  on public.quiz_attempts (quiz_id, student_id, completed_at, id)
  where completed_at is not null;

create unique index quiz_attempts_one_finalized_submission_idx
  on public.quiz_attempts (quiz_id, student_id)
  where submission_result is not null;

create function public.submit_quiz_once(
  p_course_id uuid,
  p_quiz_id uuid,
  p_student_id uuid,
  p_answers integer[],
  p_confidences integer[]
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_course public.courses%rowtype;
  v_targets text[];
  v_confidences integer[];
  v_attempt uuid;
  v_now timestamptz;
  v_total integer;
  v_correct integer;
  v_score numeric;
  v_gaps text[];
  v_assigned text[];
  v_student_name text;
  v_type text;
  v_title text;
  v_body text;
  v_preference_key text;
  v_metadata jsonb;
  v_result jsonb;
begin
  select * into v_course from public.courses where id = p_course_id;
  if not found then
    raise exception using errcode = 'PT404', message = 'Course not found';
  end if;
  if p_student_id is null or (
    v_course.teacher_id <> p_student_id and not exists (
      select 1 from public.enrollments
      where course_id = p_course_id and student_id = p_student_id and status = 'approved'
    )
  ) then
    raise exception using errcode = 'PT403', message = 'You are not an approved member of this course';
  end if;

  -- Retakes get a new private quiz ID. Lock this quiz before looking up its result
  -- so concurrent submissions observe the first committed attempt.
  select target_concepts into v_targets
  from public.quizzes
  where id = p_quiz_id and course_id = p_course_id and student_id = p_student_id
  for no key update;
  if not found then
    raise exception using errcode = 'PT404', message = 'Quiz not found';
  end if;

  select submission_result into v_result from public.quiz_attempts
  where quiz_id = p_quiz_id and student_id = p_student_id and submission_result is not null;
  if found then
    return v_result;
  end if;

  select count(*)::integer into v_total from public.quiz_questions where quiz_id = p_quiz_id;

  -- Keep historical attempts intact. Replay the earliest complete legacy attempt
  -- when possible. Legacy assignment completion is available only if it raised a notification.
  if v_total > 0 then
    select jsonb_build_object(
      'attempt_id', a.id, 'score', a.score, 'correct', saved.correct, 'total', v_total,
      'assignment_completed', exists (
        select 1 from public.notifications n
        where n.course_id = p_course_id and n.recipient_id = v_course.teacher_id
          and n.metadata @> jsonb_build_object('attempt_id', a.id, 'assignment_completed', true)
      ),
      'confidence_gaps', saved.gaps
    ) into v_result
    from public.quiz_attempts a
    cross join lateral (
      select count(*) as total,
        count(*) filter (where answer.is_correct) as correct,
        count(distinct question.concept) filter (
          where answer.confidence = 3 and answer.is_correct = false
        ) as gaps
      from public.quiz_answers answer
      join public.quiz_questions question on question.id = answer.question_id
      where answer.attempt_id = a.id and question.quiz_id = p_quiz_id
    ) saved
    where a.quiz_id = p_quiz_id and a.student_id = p_student_id
      and a.completed_at is not null and a.score is not null and saved.total = v_total
    order by a.completed_at, a.id
    limit 1;
    if found then
      return v_result;
    end if;
  end if;

  if v_total = 0 or p_answers is null or cardinality(p_answers) <> v_total
    or array_ndims(p_answers) <> 1 then
    raise exception using errcode = 'PT400', message = 'Quiz answers do not match this quiz';
  end if;
  v_confidences := case when coalesce(cardinality(p_confidences), 0) = 0
    then array_fill(null::integer, array[v_total]) else p_confidences end;
  if cardinality(v_confidences) <> v_total or array_ndims(v_confidences) <> 1
    or exists (select 1 from unnest(v_confidences) c where c not between 1 and 3) then
    raise exception using errcode = 'PT400', message = 'Quiz confidence ratings do not match this quiz';
  end if;

  if exists (
    select 1
    from (
      select options, row_number() over (order by position) as idx
      from public.quiz_questions where quiz_id = p_quiz_id
    ) q
    join unnest(p_answers) with ordinality a(answer, idx) using (idx)
    where a.answer < 0 or a.answer >= jsonb_array_length(q.options)
  ) then
    raise exception using errcode = 'PT400', message = 'A selected option does not exist on this quiz';
  end if;

  v_now := clock_timestamp();
  insert into public.quiz_attempts (quiz_id, student_id, started_at)
  values (p_quiz_id, p_student_id, v_now)
  returning id into v_attempt;

  insert into public.quiz_answers (
    attempt_id, question_id, selected_option, is_correct, confidence, answered_at
  )
  select v_attempt, q.id, a.answer, coalesce(a.answer = q.correct_option, false), a.confidence, v_now
  from (
    select id, correct_option, row_number() over (order by position) as idx
    from public.quiz_questions where quiz_id = p_quiz_id
  ) q
  join unnest(p_answers, v_confidences) with ordinality a(answer, confidence, idx) using (idx);

  select count(*) filter (where a.is_correct)::integer,
    coalesce(array_agg(distinct q.concept order by q.concept) filter (
      where a.confidence = 3 and not a.is_correct
    ), array[]::text[])
  into v_correct, v_gaps
  from public.quiz_answers a join public.quiz_questions q on q.id = a.question_id
  where a.attempt_id = v_attempt;
  v_score := round(v_correct * 100.0 / v_total, 2);

  -- Increment evidence under row locks in a consistent concept order.
  insert into public.student_concept_mastery as m (
    course_id, student_id, concept, correct_answers, total_answers, last_practiced_at, updated_at
  )
  select p_course_id, p_student_id, q.concept,
    count(*) filter (where a.is_correct)::integer, count(*)::integer, v_now, v_now
  from public.quiz_answers a join public.quiz_questions q on q.id = a.question_id
  where a.attempt_id = v_attempt
  group by q.concept order by q.concept
  on conflict (course_id, student_id, concept) do update set
    correct_answers = m.correct_answers + excluded.correct_answers,
    total_answers = m.total_answers + excluded.total_answers,
    last_practiced_at = greatest(m.last_practiced_at, excluded.last_practiced_at),
    updated_at = greatest(m.updated_at, excluded.updated_at);

  with scored as (
    select m.id, m.last_practiced_at, m.open_misconceptions,
      round(least(
        case when m.open_misconceptions > 0 then 49 else 100 end,
        100.0 * (m.correct_answers + 2 * m.verified_teach_backs + 1)
          / (m.total_answers + 2 * m.completed_teach_backs + 2)
      ), 2) as score,
      round(least(0.95, (m.total_answers + 2 * m.completed_teach_backs) / 6.0), 3) as confidence
    from public.student_concept_mastery m
    where m.course_id = p_course_id and m.student_id = p_student_id
      and m.concept in (select concept from public.quiz_questions where quiz_id = p_quiz_id)
  )
  update public.student_concept_mastery m set
    mastery_score = scored.score, confidence = scored.confidence,
    review_due_at = scored.last_practiced_at + case
      when scored.open_misconceptions > 0 or scored.score < 60 then interval '2 days'
      when scored.score < 85 then interval '7 days'
      else interval '14 days'
    end
  from scored where m.id = scored.id;

  with completed as (
    update public.study_plan_items p set status = 'completed', completed_at = v_now
    where p.course_id = p_course_id and p.student_id = p_student_id and p.status = 'pending'
      and p.action like 'Teacher assigned:%'
      and (
        p.concept = any(v_targets)
        or p.concept_key in (
          select left(trim(both '-' from regexp_replace(lower(target) collate "C", '[^a-z0-9]+', '-', 'g')), 160)
          from unnest(v_targets) target
        )
      )
    returning p.concept
  )
  select coalesce(array_agg(concept order by concept), array[]::text[]) into v_assigned from completed;

  if cardinality(v_assigned) > 0 or cardinality(v_gaps) > 0 or v_score < 50 then
    select display_name into v_student_name from public.profiles where id = p_student_id;
    v_student_name := coalesce(v_student_name, 'A student');
    v_metadata := jsonb_build_object('attempt_id', v_attempt, 'student_id', p_student_id);
    if cardinality(v_assigned) > 0 then
      v_type := 'quiz';
      v_title := 'Assigned practice completed';
      v_body := format('%s completed the assigned %s practice with a score of %s%%.',
        v_student_name, array_to_string(v_assigned, ', '), round(v_score));
      if cardinality(v_gaps) > 0 then
        v_body := v_body || format(' High-confidence errors appeared in %s.', array_to_string(v_gaps, ', '));
      end if;
      v_metadata := v_metadata || jsonb_build_object('focus_concept', v_assigned[1], 'assignment_completed', true);
    elsif cardinality(v_gaps) > 0 then
      v_type := 'flag';
      v_title := 'Confidence gap detected';
      v_body := format('%s was very confident but incorrect in %s.', v_student_name, array_to_string(v_gaps, ', '));
      v_metadata := v_metadata || '{"confidence_gap": true}'::jsonb;
    else
      v_type := 'flag';
      v_title := 'Student may need support';
      v_body := format('%s scored %s%% on a quiz in %s.', v_student_name, round(v_score), v_course.name);
    end if;
    v_preference_key := case when v_type = 'quiz' then 'quizActivity' else 'flags' end;
    if not exists (
      select 1 from public.user_preferences
      where user_id = v_course.teacher_id and preferences->v_preference_key = 'false'::jsonb
    ) then
      insert into public.notifications (recipient_id, course_id, type, title, body, metadata)
      values (v_course.teacher_id, p_course_id, v_type, v_title, v_body, v_metadata);
    end if;
  end if;

  v_result := jsonb_build_object(
    'attempt_id', v_attempt, 'score', v_score, 'correct', v_correct, 'total', v_total,
    'assignment_completed', cardinality(v_assigned) > 0, 'confidence_gaps', cardinality(v_gaps)
  );
  update public.quiz_attempts set score = v_score, completed_at = v_now, submission_result = v_result
  where id = v_attempt;
  return v_result;
end;
$$;

revoke all on function public.submit_quiz_once(uuid, uuid, uuid, integer[], integer[])
  from public, anon, authenticated;
grant execute on function public.submit_quiz_once(uuid, uuid, uuid, integer[], integer[])
  to service_role;
