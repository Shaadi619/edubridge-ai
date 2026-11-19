import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";

import { api, type CourseDigitalTwin } from "../../lib/api";
import { useScopedQuery } from "../useScopedRequest";
import { friendlyConcept } from "./TodayStage";

type Analytics = Awaited<ReturnType<typeof api.teacherCourseAnalytics>>;
type Journeys = Awaited<ReturnType<typeof api.teacherMasteryJourneys>>;
type View = "class" | "mistakes" | "progress" | "setup";

const VIEWS: { id: View; label: string; question: string }[] = [
  { id: "class", label: "How the class is doing", question: "Quiz scores by topic and by student." },
  { id: "mistakes", label: "Common mistakes", question: "Misunderstandings spotted in students’ questions, quizzes and explanations." },
  { id: "progress", label: "Fixing mistakes", question: "Whether each mistake has been put right, and whether it stayed fixed." },
  { id: "setup", label: "Course setup", question: "Whether every topic has material, quiz questions and links to other topics." },
];

const WRONG = "#E8907F";
const PRIORITY: Record<"high" | "medium" | "low", { label: string; color: string }> = {
  high: { label: "Fix first", color: WRONG },
  medium: { label: "Worth doing", color: "var(--eb-text)" },
  low: { label: "Nice to have", color: "var(--eb-text-muted)" },
};

/** Some problems describe one question; reword them when they cover several. */
const GROUP_DETAIL: Record<string, string> = {
  unmapped_concept: "Each of these questions is labelled with a topic that isn’t in your course’s topic list, so its results don’t count towards any topic. The label is shown under each question.",
};

function date(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long" });
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

function Section({ title, note, children, action }: { title: string; note?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex max-w-[64ch] flex-col gap-1">
          <h2 className="m-0 text-[19px] font-semibold tracking-[-0.01em]">{title}</h2>
          {note && <p className="m-0 text-[15px] leading-relaxed text-[var(--eb-text-muted)]">{note}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function ScoreRow({ label, score, detail }: { label: string; score: number; detail?: ReactNode }) {
  const low = score < 50;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 border-b border-[var(--eb-line-soft)] py-3 last:border-0 sm:grid-cols-[minmax(160px,34%)_minmax(0,1fr)_3.5rem]">
      <span className="min-w-0 text-[15px]">{label}</span>
      <span aria-hidden="true" className="order-3 col-span-2 block h-2 overflow-hidden rounded-full bg-[var(--eb-line-soft)] sm:order-none sm:col-span-1">
        <span className="block h-full rounded-full" style={{ width: `${Math.max(2, score)}%`, background: low ? WRONG : "var(--eb-text-soft)" }} />
      </span>
      <span className="text-right text-[15px] font-semibold tabular-nums" style={{ color: low ? WRONG : undefined }}>{score}%</span>
      {detail && <span className="order-4 col-span-2 text-sm text-[var(--eb-text-muted)] sm:col-span-3">{detail}</span>}
    </li>
  );
}

function Loading({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="flex flex-col gap-3 py-6 text-[15px] text-[var(--eb-text-soft)]">
      {children}
      <span aria-hidden="true" className="relative block h-[3px] max-w-[320px] overflow-hidden rounded-sm bg-[var(--eb-line-soft)]">
        <span className="eb-seek absolute inset-y-0 w-2/5 bg-[linear-gradient(90deg,transparent,var(--eb-text-muted),transparent)]" />
      </span>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="m-0 max-w-[60ch] text-[15px] leading-relaxed text-[var(--eb-text-muted)]">{children}</p>;
}

// ── How the class is doing ───────────────────────────────────────────────

function ClassView({ analytics }: { analytics: Analytics }) {
  const topics = [...analytics.topic_scores].sort((a, b) => a.score - b.score);
  const students = [...analytics.students].sort((a, b) => a.progress - b.progress);
  const tested = students.filter(student => student.quizzes > 0);
  return (
    <div className="flex flex-col gap-10">
      <p className="m-0 max-w-[60ch] text-[17px] leading-relaxed">
        {tested.length === 0
          ? `${plural(analytics.active_students, "student")} enrolled. No one has finished a quiz yet, so there are no scores to show.`
          : `${plural(analytics.active_students, "student")} enrolled, ${tested.length} with quiz results. The class average is ${analytics.average_score}%.`}
      </p>
      <Section title="Topics, weakest first" note="The class’s average score on quiz questions about each topic. Scores under 50% are marked.">
        {topics.length ? (
          <ul className="m-0 list-none p-0">{topics.map(topic => <ScoreRow key={topic.topic} label={friendlyConcept(topic.topic)} score={topic.score} />)}</ul>
        ) : <Empty>Topic scores appear once students answer quiz questions.</Empty>}
      </Section>
      <Section title="Students, lowest score first" note="Each student’s average across the quizzes they’ve taken.">
        {students.length ? (
          <ul className="m-0 list-none p-0">
            {students.map(student => (
              <ScoreRow key={student.id} label={student.name} score={student.progress} detail={
                student.quizzes === 0 ? "Hasn’t taken a quiz yet" : (
                  <>
                    {plural(student.quizzes, "quiz", "quizzes")}
                    {student.weak.length > 0 && `. Finding hard: ${student.weak.slice(0, 3).map(friendlyConcept).join(", ")}`}
                    {student.overdue_tasks > 0 && `. ${plural(student.overdue_tasks, "study task")} overdue`}
                  </>
                )} />
            ))}
          </ul>
        ) : <Empty>No students have joined this course yet.</Empty>}
      </Section>
    </div>
  );
}

// ── Common mistakes ──────────────────────────────────────────────────────

function MistakesView({ analytics, courseId, accessToken, focusedId, focusKey }: {
  analytics: Analytics; courseId: string; accessToken: string; focusedId?: string; focusKey: number;
}) {
  const [dealtWith, setDealtWith] = useState<string[]>([]);
  const [showing, setShowing] = useState<"open" | "addressed">("open");
  const [saving, setSaving] = useState<string | null>(null);
  const log = analytics.misconceptions.map(item => dealtWith.includes(item.id) ? { ...item, status: "addressed" as const } : item);
  const open = log.filter(item => item.status === "open");
  const done = log.filter(item => item.status === "addressed");
  const listed = showing === "open" ? open : done;

  useEffect(() => {
    if (!focusedId) return;
    const item = log.find(entry => entry.id === focusedId);
    if (item) setShowing(item.status);
    const timer = window.setTimeout(() => document.getElementById(`mistake-${focusedId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedId, focusKey]);

  const markDealtWith = async (id: string) => {
    setSaving(id);
    try {
      await api.addressMisconception(courseId, id, accessToken);
      setDealtWith(current => [...current, id]);
      toast.success("Marked as dealt with");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That couldn’t be saved. Try again.");
    } finally {
      setSaving(null);
    }
  };

  const download = () => {
    const cell = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const rows = log.map(item => [item.student, friendlyConcept(item.concept), item.explanation, date(item.created_at), item.status === "open" ? "Still open" : "Dealt with"].map(cell).join(","));
    const blob = new Blob([`Student,Topic,What went wrong,Spotted on,Status\n${rows.join("\n")}`], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob); link.download = "common-mistakes.csv"; link.click();
    URL.revokeObjectURL(link.href);
  };

  const network = analytics.misconception_network;
  const names = new Map(network.nodes.map(node => [node.id, friendlyConcept(node.concept)]));
  const pairs = [...network.edges].sort((a, b) => b.shared_students - a.shared_students).slice(0, 6);
  const hub = network.hub_concept ? names.get(network.hub_concept) : null;

  return (
    <div className="flex flex-col gap-10">
      <Section title={open.length ? `${plural(open.length, "mistake")} still to go over` : "No open mistakes"}
        note="Spotted by the tutor, in quizzes and when students explain an idea back. Once you’ve gone over one with the student, mark it as dealt with."
        action={log.length > 0 ? <button type="button" onClick={download} className="min-h-10 rounded-lg border border-[var(--eb-line)] px-3 text-sm text-[var(--eb-text-soft)] hover:text-[var(--eb-text)]">Download as a spreadsheet</button> : undefined}>
        {log.length > 0 && (
          <div role="group" aria-label="Show" className="flex gap-1.5">
            {([["open", `Still open (${open.length})`], ["addressed", `Dealt with (${done.length})`]] as const).map(([id, label]) => (
              <button key={id} type="button" aria-pressed={showing === id} onClick={() => setShowing(id)}
                className={`min-h-9 rounded-lg px-3 text-sm transition-colors ${showing === id ? "bg-[var(--eb-text)] font-semibold text-[var(--eb-ink)]" : "border border-[var(--eb-line)] text-[var(--eb-text-soft)] hover:text-[var(--eb-text)]"}`}>
                {label}
              </button>
            ))}
          </div>
        )}
        {listed.length ? (
          <ul className="m-0 flex list-none flex-col p-0">
            {listed.map(item => (
              <li key={item.id} id={`mistake-${item.id}`}
                className="flex flex-col gap-2 border-b border-[var(--eb-line-soft)] py-4 last:border-0 sm:flex-row sm:items-start sm:gap-6"
                style={item.id === focusedId ? { boxShadow: "inset 3px 0 0 var(--eb-text)", paddingLeft: 14 } : undefined}>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-[16px] font-semibold">{friendlyConcept(item.concept)}</span>
                  <span className="text-sm text-[var(--eb-text-muted)]">{item.student}, {date(item.created_at)}</span>
                  <p className="m-0 mt-1 max-w-[70ch] text-[15px] leading-relaxed text-[var(--eb-text-soft)]">{item.explanation}</p>
                </div>
                {item.status === "open" ? (
                  <button type="button" disabled={saving === item.id} onClick={() => void markDealtWith(item.id)}
                    className="min-h-10 shrink-0 self-start rounded-lg border border-[var(--eb-line)] px-3 text-sm text-[var(--eb-text-soft)] hover:border-[var(--eb-text-muted)] hover:text-[var(--eb-text)] disabled:opacity-50">
                    {saving === item.id ? "Saving…" : "Mark as dealt with"}
                  </button>
                ) : <span className="shrink-0 text-sm text-[var(--eb-text-muted)]">Dealt with</span>}
              </li>
            ))}
          </ul>
        ) : <Empty>{log.length ? (showing === "open" ? "Everything spotted so far has been dealt with." : "Nothing has been marked as dealt with yet.") : "Nothing spotted yet. Mistakes show up here as students use the tutor, take quizzes and explain ideas back."}</Empty>}
      </Section>

      {pairs.length > 0 && (
        <Section title="Mistakes that go together" note="When the same students struggle with two topics, it can help to teach them together.">
          {hub && (
            <p className="m-0 max-w-[64ch] rounded-xl border border-[var(--eb-line)] bg-[var(--eb-raised-2)] px-4 py-3 text-[15px] leading-relaxed">
              <span className="font-semibold">Start with {hub}.</span> It’s linked to more of the other mistakes than any other topic. That doesn’t prove it causes them, but going over it first may help with the rest.
            </p>
          )}
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[15px] text-[var(--eb-text-soft)]">
            {pairs.map(edge => (
              <li key={`${edge.source}-${edge.target}`}>
                {plural(edge.shared_students, "student")} had trouble with both <span className="text-[var(--eb-text)]">{names.get(edge.source)}</span> and <span className="text-[var(--eb-text)]">{names.get(edge.target)}</span>.
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

// ── Fixing mistakes ──────────────────────────────────────────────────────

const STEPS = [
  { label: "Spotted", note: "The mistake was noticed." },
  { label: "Explained it back", note: "The student tried explaining the idea in their own words." },
  { label: "Got it right", note: "Their explanation showed they now understand." },
  { label: "Still right later", note: "A follow-up check a few days later showed it stuck." },
];

function stepReached(journey: Journeys["journeys"][number]) {
  if (journey.retention_status === "retained") return 3;
  if (journey.learning_status === "verified") return 2;
  if (journey.teach_back_attempts > 0 || journey.learning_status === "improving") return 1;
  return 0;
}

function ProgressView({ data, loading }: { data: Journeys | null; loading: boolean }) {
  if (loading) return <Loading>Loading each mistake’s progress…</Loading>;
  if (!data) return <Empty>Progress couldn’t be loaded. Try opening this view again.</Empty>;
  const { summary, journeys } = data;
  return (
    <div className="flex flex-col gap-8">
      {journeys.length === 0 ? (
        <p className="m-0 text-[17px]">No mistakes have been spotted yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="m-0 max-w-[64ch] text-[17px] leading-relaxed">
            {`${plural(journeys.length, "mistake")} tracked: ${summary.detected} not worked on yet, ${summary.improving} being worked on, ${summary.verified} put right, and ${summary.retained} still right at a later check.`}
          </p>
          <p className="m-0 max-w-[64ch] text-sm text-[var(--eb-text-muted)]">Similar mistakes by the same student are counted once here, so this number can be lower than on Common mistakes.</p>
        </div>
      )}
      <ol aria-label="What each step means" className="m-0 grid list-none gap-3 p-0 sm:grid-cols-4">
        {STEPS.map((step, index) => (
          <li key={step.label} className="flex flex-col gap-1 border-t border-[var(--eb-line)] pt-3">
            <span className="text-sm font-semibold">{index + 1}. {step.label}</span>
            <span className="text-sm leading-relaxed text-[var(--eb-text-muted)]">{step.note}</span>
          </li>
        ))}
      </ol>
      {journeys.length ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {journeys.map(journey => {
            const reached = stepReached(journey);
            const forgot = journey.retention_status === "needs_review";
            return (
              <li key={journey.id} className="flex flex-col gap-3 border-b border-[var(--eb-line-soft)] py-5 last:border-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[16px] font-semibold">{friendlyConcept(journey.concept)}</span>
                    <span className="text-sm text-[var(--eb-text-muted)]">{journey.student}, spotted {date(journey.created_at)}</span>
                  </div>
                  <span className="text-right text-sm text-[var(--eb-text-soft)]">
                    {journey.mastery_score === null || !journey.evidence_sufficient
                      ? "Not enough answers yet to judge understanding"
                      : <>Understanding: <span className="font-semibold text-[var(--eb-text)]">{Math.round(journey.mastery_score)}%</span>, from {plural(journey.total_answers, "answer")}</>}
                  </span>
                </div>
                <ol aria-label={`Progress: ${STEPS[reached].label}`} className="m-0 flex list-none flex-wrap items-center gap-x-2 gap-y-1 p-0 text-sm">
                  {STEPS.map((step, index) => (
                    <li key={step.label} className="flex items-center gap-2" style={{ color: index <= reached ? "var(--eb-text)" : "var(--eb-text-muted)", fontWeight: index === reached ? 600 : 400 }}>
                      <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: index <= reached ? "var(--eb-text)" : "var(--eb-line)" }} />
                      {step.label}
                      {index < STEPS.length - 1 && <span aria-hidden="true" className="h-px w-5 bg-[var(--eb-line)]" />}
                    </li>
                  ))}
                </ol>
                {forgot && <span className="text-sm" style={{ color: WRONG }}>Got this wrong again at the follow-up check. Worth another look.</span>}
                {journey.retention_status === "due" && <span className="text-sm text-[var(--eb-text-soft)]">A follow-up check is due.</span>}
                {journey.latest_feedback && <p className="m-0 max-w-[70ch] text-[15px] leading-relaxed text-[var(--eb-text-soft)]"><span className="text-[var(--eb-text)]">Latest feedback to the student:</span> {journey.latest_feedback}</p>}
              </li>
            );
          })}
        </ul>
      ) : <Empty>Each mistake’s progress will appear here once something has been spotted.</Empty>}
    </div>
  );
}

// ── Course setup ─────────────────────────────────────────────────────────

function SetupView({ data, loading }: { data: CourseDigitalTwin | null; loading: boolean }) {
  const [pathId, setPathId] = useState<string | null>(null);
  if (loading) return <Loading>Checking each topic against your material and quizzes…</Loading>;
  if (!data) return <Empty>The course check couldn’t be loaded. Try opening this view again.</Empty>;
  const topics = data.topics;
  const covered = topics.filter(topic => topic.material_sources.length > 0).length;
  const quizzed = topics.filter(topic => topic.assessment_questions > 0).length;
  const linked = topics.filter(topic => topic.prerequisites.length || topic.unlocks.length || topics.length <= 1).length;
  const paths = data.simulated_learners ?? [];
  const path = paths.find(item => item.id === pathId) ?? paths[0];
  const audit = data.assessment_audit;
  const rank = { high: 0, medium: 1, low: 2 } as const;
  const problems = Object.values(audit.questions.reduce<Record<string, {
    code: string; label: string; detail: string; recommendation: string; severity: "high" | "medium" | "low";
    questions: typeof audit.questions;
  }>>((groups, question) => {
    question.issues.forEach(issue => {
      const group = groups[issue.code] ??= { code: issue.code, label: issue.label, detail: issue.detail, recommendation: issue.recommendation, severity: issue.severity, questions: [] };
      group.questions.push(question);
    });
    return groups;
  }, {})).sort((a, b) => rank[a.severity] - rank[b.severity] || b.questions.length - a.questions.length);

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[30px] font-semibold tracking-[-0.02em]">Your course is {data.summary.readiness}% set up</p>
        <p className="m-0 max-w-[64ch] text-[15px] leading-relaxed text-[var(--eb-text-muted)]">
          A topic is fully set up when your material covers it, quiz questions check it, and it’s linked to the topics that come before or after it.
        </p>
        {topics.length > 0 && (
          <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0 text-[16px]">
            <li>{covered} of {plural(topics.length, "topic")} covered in your material</li>
            <li>{quizzed} of {topics.length} checked by quiz questions</li>
            <li>{linked} of {topics.length} linked to other topics</li>
          </ul>
        )}
      </div>

      {data.gaps.length > 0 && (
        <Section title="What to fix" note="Worked out from your topics, material and quizzes. Most important first.">
          <ul className="m-0 flex list-none flex-col p-0">
            {data.gaps.slice(0, 10).map((gap, index) => (
              <li key={`${gap.kind}-${gap.topic}-${index}`} className="flex flex-col gap-1 border-b border-[var(--eb-line-soft)] py-3 last:border-0 sm:flex-row sm:gap-5">
                <span className="w-28 shrink-0 text-sm font-medium" style={{ color: PRIORITY[gap.severity].color }}>{PRIORITY[gap.severity].label}</span>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[15px]"><span className="font-semibold">{gap.topic ? friendlyConcept(gap.topic) : "Whole course"}:</span> {gap.message}</span>
                  <span className="text-sm text-[var(--eb-text-soft)]">{gap.recommendation}</span>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Quiz questions to review"
        note={audit.total_questions
          ? `${plural(audit.total_questions, "question")} checked for common problems, like two choices being the same. ${audit.flagged_questions ? `${audit.flagged_questions} could be improved, grouped by problem below.` : "None stood out."} You’re still the judge of whether each one is right.`
          : "Once there are quizzes, their questions are checked here for common problems."}>
        {problems.length > 0 && (
          <ul className="m-0 flex list-none flex-col p-0">
            {problems.map(problem => (
              <li key={problem.code} className="border-b border-[var(--eb-line-soft)] last:border-0">
                <details className="group py-3">
                  <summary className="flex cursor-pointer list-none items-start gap-4">
                    <span className="w-28 shrink-0 pt-0.5 text-sm font-medium" style={{ color: PRIORITY[problem.severity].color }}>{PRIORITY[problem.severity].label}</span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-[15px]"><span className="font-semibold">{problem.label}</span>, {plural(problem.questions.length, "question")}</span>
                      <span className="text-sm text-[var(--eb-text-soft)]">{GROUP_DETAIL[problem.code] && problem.questions.length > 1 ? GROUP_DETAIL[problem.code] : problem.detail}</span>
                      <span className="text-sm text-[var(--eb-text-soft)]"><span className="text-[var(--eb-text)]">What to do:</span> {problem.recommendation}</span>
                    </span>
                    <span className="mt-0.5 flex shrink-0 items-center gap-1 text-sm text-[var(--eb-text-muted)]">
                      Show questions<ChevronDown size={16} aria-hidden="true" className="transition-transform group-open:rotate-180" />
                    </span>
                  </summary>
                  <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0 sm:ml-32">
                    {problem.questions.slice(0, 12).map(question => (
                      <li key={question.question_id} className="flex flex-col gap-0.5 text-[15px]">
                        <span>{question.prompt}</span>
                        <span className="text-sm text-[var(--eb-text-muted)]">From “{question.quiz_title}”, labelled {friendlyConcept(question.concept)}</span>
                      </li>
                    ))}
                    {problem.questions.length > 12 && <li className="text-sm text-[var(--eb-text-muted)]">And {problem.questions.length - 12} more.</li>}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Topic by topic" note="Where each topic stands. “Average score” only counts students who have answered questions on it.">
        {topics.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-[15px]">
              <thead>
                <tr className="text-sm text-[var(--eb-text-muted)]">
                  {["Topic", "In your material", "Quiz questions", "Builds on", "Students tested", "Average score"].map(label => (
                    <th key={label} scope="col" className="border-b border-[var(--eb-line)] py-2 pr-4 font-medium">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {topics.map(topic => (
                  <tr key={topic.id} className="align-top">
                    <th scope="row" className="border-b border-[var(--eb-line-soft)] py-3 pr-4 font-semibold">{friendlyConcept(topic.name)}</th>
                    <td className="border-b border-[var(--eb-line-soft)] py-3 pr-4">
                      {topic.material_sources.length
                        ? <span className="flex flex-col gap-0.5"><span>Yes</span>{topic.material_sources.slice(0, 2).map((source, index) => <span key={index} className="text-sm text-[var(--eb-text-muted)]">{source.document_title.replace(/\.(pdf|pptx?|docx?)$/i, "")}{source.page_number ? `, ${source.source_kind === "slide" ? "slide" : "page"} ${source.page_number}` : ""}</span>)}</span>
                        : <span style={{ color: WRONG }}>Not found</span>}
                    </td>
                    <td className="border-b border-[var(--eb-line-soft)] py-3 pr-4" style={{ color: topic.assessment_questions ? undefined : WRONG }}>{topic.assessment_questions || "None"}</td>
                    <td className="border-b border-[var(--eb-line-soft)] py-3 pr-4 text-[var(--eb-text-soft)]">{topic.prerequisites.length ? topic.prerequisites.map(friendlyConcept).join(", ") : "Nothing"}</td>
                    <td className="border-b border-[var(--eb-line-soft)] py-3 pr-4">{topic.students_with_evidence}</td>
                    <td className="border-b border-[var(--eb-line-soft)] py-3 pr-4">{topic.average_mastery == null ? <span className="text-[var(--eb-text-muted)]">None yet</span> : `${topic.average_mastery}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>This course has no topics yet. Add them in Settings, or let EduBridge suggest them from your material.</Empty>}
      </Section>

      {data.materials.length > 0 && (
        <Section title="What each document covers">
          <ul className="m-0 flex list-none flex-col p-0">
            {data.materials.map(material => (
              <li key={material.id} className="flex flex-col gap-0.5 border-b border-[var(--eb-line-soft)] py-3 last:border-0">
                <span className="text-[15px] font-semibold">{material.title.replace(/\.(pdf|pptx?|docx?)$/i, "")}</span>
                <span className="text-sm text-[var(--eb-text-soft)]">
                  {material.matched_topics.length ? `Covers ${material.matched_topics.map(friendlyConcept).join(", ")}` : "Doesn’t clearly match any of your topics"}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {path && (
        <Section title="Try a student’s path" note="The order a student would work through your topics, depending on what they already know. This is an example worked out from how your topics link together. It doesn’t use or change any real student’s data.">
          <div role="group" aria-label="Example student" className="flex flex-wrap gap-1.5">
            {paths.map(item => (
              <button key={item.id} type="button" aria-pressed={item.id === path.id} onClick={() => setPathId(item.id)}
                className={`min-h-9 rounded-lg px-3 text-sm transition-colors ${item.id === path.id ? "bg-[var(--eb-text)] font-semibold text-[var(--eb-ink)]" : "border border-[var(--eb-line)] text-[var(--eb-text-soft)] hover:text-[var(--eb-text)]"}`}>
                {item.label}
              </button>
            ))}
          </div>
          <p className="m-0 text-[15px] text-[var(--eb-text-soft)]">{path.summary}</p>
          {path.next_steps.length ? (
            <ol className="m-0 flex list-none flex-col gap-3 p-0">
              {path.next_steps.map((step, index) => (
                <li key={step.topic} className="flex gap-3">
                  <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--eb-line)] text-[13px] font-semibold text-[var(--eb-text-soft)]">{index + 1}</span>
                  <span className="flex flex-col gap-0.5 pt-0.5">
                    <span className="text-[15px] font-semibold">{friendlyConcept(step.topic)}</span>
                    <span className="text-sm" style={{ color: step.has_material && step.assessment_questions ? "var(--eb-text-muted)" : WRONG }}>{step.experience}</span>
                  </span>
                </li>
              ))}
            </ol>
          ) : <Empty>There’s nothing left for this student to learn in your topic list.</Empty>}
          {path.teacher_checks.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">Things you could do</span>
              <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[15px] text-[var(--eb-text-soft)]">{path.teacher_checks.map(check => <li key={check}>{check}</li>)}</ul>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────

export default function AnalyticsStage({ course, analytics, loading, accessToken, focusedMisconceptionId, focusKey }: {
  course: { id: string; name: string };
  analytics: Analytics | null;
  loading: boolean;
  accessToken: string;
  focusedMisconceptionId?: string;
  focusKey: number;
}) {
  const [view, setView] = useState<View>("class");
  const loadJourneys = useCallback((signal: AbortSignal) => api.teacherMasteryJourneys(course.id, accessToken, signal), [course.id, accessToken]);
  const loadSetup = useCallback((signal: AbortSignal) => api.teacherCourseDigitalTwin(course.id, accessToken, signal), [course.id, accessToken]);
  const journeys = useScopedQuery(view === "progress" ? course.id : null, loadJourneys, "Progress on mistakes couldn’t be loaded.");
  const setup = useScopedQuery(view === "setup" ? course.id : null, loadSetup, "The course check couldn’t be loaded.");

  useEffect(() => { if (focusedMisconceptionId) setView("mistakes"); }, [focusedMisconceptionId, focusKey]);

  const current = useMemo(() => VIEWS.find(item => item.id === view)!, [view]);

  return (
    <section aria-label="Analytics" className="eb-stage overflow-hidden rounded-2xl">
      <header className="flex flex-col gap-5 px-6 pb-5 pt-7 sm:px-8">
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 text-[26px] font-semibold tracking-[-0.015em]">Analytics</h1>
          <p className="m-0 text-[15px] text-[var(--eb-text-soft)]">{course.name}. {current.question}</p>
        </div>
        <nav aria-label="Analytics views" className="-mx-1 flex gap-1 overflow-x-auto px-1">
          {VIEWS.map(item => (
            <button key={item.id} type="button" aria-current={item.id === view ? "page" : undefined} onClick={() => setView(item.id)}
              className={`min-h-10 shrink-0 rounded-lg px-3.5 text-[15px] transition-colors ${item.id === view ? "bg-[var(--eb-raised)] font-semibold text-[var(--eb-text)]" : "text-[var(--eb-text-soft)] hover:text-[var(--eb-text)]"}`}>
              {item.label}
            </button>
          ))}
        </nav>
      </header>
      <div key={view} className="eb-rise border-t border-[var(--eb-line-soft)] px-6 py-8 sm:px-8">
        {(view === "class" || view === "mistakes") && (loading
          ? <Loading>Adding up quiz results and mistakes. This can take a little while.</Loading>
          : !analytics ? <Empty>Analytics couldn’t be loaded. Try refreshing the page.</Empty>
          : view === "class" ? <ClassView analytics={analytics} />
          : <MistakesView analytics={analytics} courseId={course.id} accessToken={accessToken} focusedId={focusedMisconceptionId} focusKey={focusKey} />)}
        {view === "progress" && <ProgressView data={journeys.data} loading={journeys.loading} />}
        {view === "setup" && <SetupView data={setup.data} loading={setup.loading} />}
      </div>
    </section>
  );
}
