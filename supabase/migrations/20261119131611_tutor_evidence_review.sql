-- New tutor observations only. Existing student records are not reclassified.
create table public.tutor_flags (
  source_message_id uuid primary key references public.messages(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  concept text not null, label text not null, explanation text not null,
  student_evidence text not null, confidence numeric not null check (confidence between 0 and 1),
  recommended_intervention text, created_at timestamptz not null default now(),
  decision text check (decision in ('confirmed','dismissed')),
  reviewed_by uuid references public.profiles(id) on delete set null, reviewed_at timestamptz
);
create index tutor_flags_pending_idx on public.tutor_flags(course_id,created_at) where decision is null;
alter table public.tutor_flags enable row level security;
revoke all on public.tutor_flags from public, anon, authenticated;
grant select, insert, update on public.tutor_flags to service_role;

create function public.review_tutor_flag(p_course uuid,p_teacher uuid,p_message uuid,p_decision text)
returns text language plpgsql security invoker set search_path='' as $$
declare f public.tutor_flags; m public.misconceptions; needs_count boolean; canonical_concept text;
begin
  if p_decision is null or p_decision not in ('confirmed','dismissed') then raise sqlstate 'PT400' using message='Invalid review decision'; end if;
  perform 1 from public.courses where id=p_course and teacher_id=p_teacher for share;
  if not found then raise sqlstate 'PT403' using message='Only the course teacher can review this flag'; end if;
  select * into f from public.tutor_flags where source_message_id=p_message and course_id=p_course for update;
  if not found then raise sqlstate 'PT404' using message='Flag not found'; end if;
  if f.decision=p_decision then return f.decision; end if;
  if f.decision is not null then raise sqlstate 'PT409' using message='This flag already has a different review decision'; end if;

  if p_decision='confirmed' then
    -- Serialize even the first two confirmations for the same idea.
    perform pg_advisory_xact_lock(hashtextextended(p_course::text || f.student_id::text || lower(f.concept),0));
    select * into m from public.misconceptions where course_id=p_course and student_id=f.student_id
      and lower(concept)=lower(f.concept) and status<>'dismissed'
      order by (status='open' and learning_status<>'verified') desc, created_at desc, id limit 1 for update;
    needs_count := m.id is null or m.learning_status='verified';
    if m.id is null then
      select s.concept into canonical_concept from public.student_concept_mastery s
        where s.course_id=p_course and s.student_id=f.student_id and lower(s.concept)=lower(f.concept)
        order by (s.concept=f.concept) desc, s.concept limit 1;
      insert into public.misconceptions(course_id,student_id,source_message_id,concept,label,explanation,student_evidence,
        confidence,recommended_intervention,reviewed_by,reviewed_at)
      values(p_course,f.student_id,p_message,coalesce(canonical_concept,f.concept),f.label,f.explanation,f.student_evidence,
        f.confidence,f.recommended_intervention,p_teacher,now()) returning * into m;
    else
      update public.misconceptions set source_message_id=p_message, explanation=f.explanation,
        label=f.label, student_evidence=f.student_evidence, confidence=f.confidence, recommended_intervention=f.recommended_intervention,
        occurrence_count=occurrence_count+1,last_detected_at=now(),reviewed_by=p_teacher,reviewed_at=now(),
        status='open',learning_status='open',verified_at=null,
        retention_status='not_scheduled',retention_due_at=null,retained_at=null where id=m.id;
    end if;
    if needs_count then
      insert into public.student_concept_mastery as s(course_id,student_id,concept,open_misconceptions,review_due_at)
      values(p_course,f.student_id,m.concept,1,now()+interval '2 days')
      on conflict(course_id,student_id,concept) do update set open_misconceptions=s.open_misconceptions+1,
        mastery_score=case when s.total_answers+2*s.completed_teach_backs=0 then 0 else least(49,
          round(100.0*(s.correct_answers+2*s.verified_teach_backs+1)/(s.total_answers+2*s.completed_teach_backs+2),2)) end,
        review_due_at=least(s.review_due_at,excluded.review_due_at),updated_at=now();
    end if;
  end if;
  update public.tutor_flags set decision=p_decision,reviewed_by=p_teacher,reviewed_at=now() where source_message_id=p_message;
  return p_decision;
end $$;
revoke all on function public.review_tutor_flag(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.review_tutor_flag(uuid,uuid,uuid,text) to service_role;

create function public.pending_tutor_flags(p_course uuid, p_teacher uuid)
returns table(source_message_id uuid, student text, concept text, explanation text, message text)
language plpgsql stable security invoker set search_path='' as $$
begin
  if not exists (select 1 from public.courses where id=p_course and teacher_id=p_teacher) then
    raise sqlstate 'PT403' using message='Only the course teacher can review tutor observations';
  end if;
  return query select f.source_message_id,p.display_name,f.concept,f.explanation,m.content
    from public.tutor_flags f join public.messages m on m.id=f.source_message_id and m.author_role='student'
    join public.conversations c on c.id=m.conversation_id and c.course_id=f.course_id and c.student_id=f.student_id
    join public.profiles p on p.id=f.student_id
    where f.course_id=p_course and f.decision is null order by f.created_at,f.source_message_id limit 20;
end $$;
revoke all on function public.pending_tutor_flags(uuid,uuid) from public,anon,authenticated;
grant execute on function public.pending_tutor_flags(uuid,uuid) to service_role;
