alter table public.student_concept_mastery
  add column if not exists completed_teach_backs integer not null default 0
    check (completed_teach_backs >= 0),
  add column if not exists verified_teach_backs integer not null default 0
    check (verified_teach_backs >= 0);

with verification_evidence as (
  select
    m.course_id,
    m.student_id,
    lower(m.concept) as concept_key,
    count(*) filter (where v.completed_at is not null)::integer as completed_count,
    count(*) filter (where v.verdict = 'corrected')::integer as verified_count
  from public.misconceptions m
  join public.misconception_verifications v on v.misconception_id = m.id
  group by m.course_id, m.student_id, lower(m.concept)
), open_evidence as (
  select
    course_id,
    student_id,
    lower(concept) as concept_key,
    count(*) filter (where learning_status <> 'verified')::integer as open_count
  from public.misconceptions
  group by course_id, student_id, lower(concept)
)
update public.student_concept_mastery mastery
set
  completed_teach_backs = coalesce(verification.completed_count, 0),
  verified_teach_backs = coalesce(verification.verified_count, 0),
  open_misconceptions = coalesce(open_items.open_count, 0),
  mastery_score = case
    when mastery.total_answers + 2 * coalesce(verification.completed_count, 0) = 0 then 0
    else least(
      case when coalesce(open_items.open_count, 0) > 0 then 49 else 100 end,
      round(
        100.0 * (mastery.correct_answers + 2 * coalesce(verification.verified_count, 0) + 1)
        / (mastery.total_answers + 2 * coalesce(verification.completed_count, 0) + 2),
        2
      )
    )
  end,
  confidence = least(
    0.95,
    (mastery.total_answers + 2 * coalesce(verification.completed_count, 0)) / 6.0
  ),
  updated_at = now()
from verification_evidence verification
full join open_evidence open_items
  on open_items.course_id = verification.course_id
  and open_items.student_id = verification.student_id
  and open_items.concept_key = verification.concept_key
where mastery.course_id = coalesce(verification.course_id, open_items.course_id)
  and mastery.student_id = coalesce(verification.student_id, open_items.student_id)
  and lower(mastery.concept) = coalesce(verification.concept_key, open_items.concept_key);

update public.student_concept_mastery mastery
set
  completed_teach_backs = 0,
  verified_teach_backs = 0,
  open_misconceptions = 0,
  mastery_score = case
    when mastery.total_answers = 0 then 0
    else round(100.0 * (mastery.correct_answers + 1) / (mastery.total_answers + 2), 2)
  end,
  confidence = least(0.95, mastery.total_answers / 6.0),
  updated_at = now()
where not exists (
  select 1 from public.misconceptions m
  where m.course_id = mastery.course_id
    and m.student_id = mastery.student_id
    and lower(m.concept) = lower(mastery.concept)
);
