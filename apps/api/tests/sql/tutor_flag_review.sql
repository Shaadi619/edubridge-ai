-- Apply all migrations in a disposable database before running this fixture.
begin;
do $$
declare
  t uuid := gen_random_uuid(); s uuid := gen_random_uuid(); other uuid := gen_random_uuid();
  c uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); chat uuid := gen_random_uuid();
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); d uuid := gen_random_uuid();
  msg uuid; original text := 'I think the triangle has four sides. Is that right?';
  snapshot jsonb;
begin
  if has_table_privilege('authenticated','public.tutor_flags','SELECT')
    or has_function_privilege('anon','public.pending_tutor_flags(uuid,uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.review_tutor_flag(uuid,uuid,uuid,text)','EXECUTE') then
    raise exception 'Browser roles can access the private review queue';
  end if;
  insert into auth.users(id,raw_user_meta_data) values
    (t,'{"display_name":"Course teacher"}'),(s,'{"display_name":"Fixture student"}'),(other,'{"display_name":"Other teacher"}');
  insert into public.courses(id,teacher_id,name,subject,enrollment_code)
    values(c,t,'Figures','Math','T-'||c),(c2,other,'Other course','Math','T-'||c2);
  insert into public.conversations(id,course_id,student_id) values(chat,c,s);
  insert into public.student_concept_mastery(course_id,student_id,concept,correct_answers,total_answers,mastery_score)
    values(c,s,'Triangle',4,4,83.33);
  select to_jsonb(m) into snapshot from public.student_concept_mastery m where course_id=c;
  foreach msg in array array[a,b,d] loop
    insert into public.messages(id,conversation_id,author_role,content) values(msg,chat,'student',original);
    insert into public.tutor_flags(source_message_id,course_id,student_id,concept,label,explanation,student_evidence,confidence)
      values(msg,c,s,'triangle','Sides','Triangles have three sides.','four sides',0.92);
  end loop;
  if (select count(*) from public.pending_tutor_flags(c,t) where message=original and student='Fixture student')<>3 then
    raise exception 'Teacher cannot see original student wording'; end if;
  begin perform public.pending_tutor_flags(c,other); raise exception 'Other teacher read queue';
  exception when sqlstate 'PT403' then null; end;
  begin perform public.review_tutor_flag(c,other,a,'confirmed'); raise exception 'Other teacher reviewed';
  exception when sqlstate 'PT403' then null; end;
  begin perform public.review_tutor_flag(c2,other,a,'confirmed'); raise exception 'Cross-course review';
  exception when sqlstate 'PT404' then null; end;
  perform public.review_tutor_flag(c,t,d,'dismissed');
  perform public.review_tutor_flag(c,t,d,'dismissed');
  if exists(select 1 from public.misconceptions where course_id=c) or snapshot is distinct from
      (select to_jsonb(m) from public.student_concept_mastery m where course_id=c) then
    raise exception 'Suspicion or dismissal changed the learning record'; end if;
  perform public.review_tutor_flag(c,t,a,'confirmed');
  perform public.review_tutor_flag(c,t,a,'confirmed');
  if (select count(*) from public.misconceptions where course_id=c and occurrence_count=1 and reviewed_by=t)<>1 then
    raise exception 'Confirmation counted incorrectly'; end if;
  begin perform public.review_tutor_flag(c,t,a,'dismissed'); raise exception 'Conflicting duplicate accepted';
  exception when sqlstate 'PT409' then null; end;
  perform public.review_tutor_flag(c,t,b,'confirmed');
  if not exists(select 1 from public.student_concept_mastery where course_id=c and open_misconceptions=1 and mastery_score=49)
     or not exists(select 1 from public.misconceptions where course_id=c and occurrence_count=2)
     or exists(select 1 from public.pending_tutor_flags(c,t)) then raise exception 'Incorrect mastery or queue'; end if;
end $$;
rollback;
