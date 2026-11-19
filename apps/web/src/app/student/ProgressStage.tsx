import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";

import { api } from "../../lib/api";

type ProgressData = Awaited<ReturnType<typeof api.courseProgress>>;
type MasteryRow = Awaited<ReturnType<typeof api.conceptMastery>>[number];
type Misconception = Awaited<ReturnType<typeof api.myMisconceptions>>[number];
type PlanItem = Awaited<ReturnType<typeof api.studyPlan>>[number];
export type CheckMode = "teach-back" | "retention";

const WRONG = "#E8907F";

const STATUS: Record<MasteryRow["status"], { label: string; order: number }> = {
  needs_review: { label: "Needs review", order: 0 },
  developing: { label: "Developing", order: 1 },
  verified_once: { label: "Checked once", order: 2 },
  strong: { label: "Strong", order: 3 },
  not_started: { label: "Not started", order: 4 },
};

function shortDate(iso: string | null) {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function capitalise(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function isDue(iso: string | null) {
  return Boolean(iso && new Date(iso).getTime() <= Date.now());
}

type Step =
  | { key: string; kind: "retention" | "teach-back"; concept: string; detail: string; misconception: Misconception }
  | { key: string; kind: "plan"; concept: string; detail: string; plan: PlanItem };

export default function ProgressStage({ courseId, courseName, accessToken, onGoQuiz, onPractice, renderCheck }: {
  courseId: string;
  courseName: string;
  accessToken: string;
  onGoQuiz: () => void;
  onPractice: (concept: string) => void;
  renderCheck: (args: { misconception: Misconception; mode: CheckMode; onClose: () => void; onComplete: () => Promise<void> }) => ReactNode;
}) {
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [mastery, setMastery] = useState<MasteryRow[]>([]);
  const [misconceptions, setMisconceptions] = useState<Misconception[]>([]);
  const [planItems, setPlanItems] = useState<PlanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [check, setCheck] = useState<{ misconception: Misconception; mode: CheckMode } | null>(null);
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    setLoading(true);
    void Promise.all([
      api.courseProgress(courseId, accessToken),
      api.conceptMastery(courseId, accessToken),
      api.myMisconceptions(courseId, accessToken),
      api.studyPlan(courseId, accessToken),
    ]).then(([data, conceptRows, misconceptionRows, studyPlan]) => {
      setProgress(data);
      setMastery(conceptRows);
      setMisconceptions(misconceptionRows);
      setPlanItems(studyPlan);
    }).catch(error => toast.error(error instanceof Error ? error.message : "Could not load progress."))
      .finally(() => setLoading(false));
  }, [courseId, accessToken]);

  const toggleDone = async (id: string) => {
    const item = planItems.find(plan => plan.id === id);
    if (!item) return;
    const completed = item.status !== "completed";
    setPlanItems(previous => previous.map(plan => plan.id === id
      ? { ...plan, status: completed ? "completed" : "pending", completed_at: completed ? new Date().toISOString() : null } : plan));
    try {
      await api.updateStudyPlanItem(courseId, id, completed, accessToken);
    } catch (error) {
      setPlanItems(previous => previous.map(plan => plan.id === id ? item : plan));
      toast.error(error instanceof Error ? error.message : "Could not update your study plan.");
    }
  };

  const refreshLearningEvidence = async () => {
    const [conceptRows, misconceptionRows] = await Promise.all([
      api.conceptMastery(courseId, accessToken),
      api.myMisconceptions(courseId, accessToken),
    ]);
    setMastery(conceptRows);
    setMisconceptions(misconceptionRows);
  };

  const steps = useMemo<Step[]>(() => {
    const retention: Step[] = [];
    const teachBack: Step[] = [];
    misconceptions.forEach(item => {
      const retentionDue = item.learning_status === "verified" && item.retention_status !== "retained"
        && (item.retention_status === "due" || isDue(item.retention_due_at));
      if (retentionDue) {
        retention.push({ key: `r-${item.id}`, kind: "retention", concept: item.concept, misconception: item,
          detail: "You explained this correctly before. A short check shows whether it has stuck." });
      } else if (item.learning_status !== "verified") {
        teachBack.push({ key: `t-${item.id}`, kind: "teach-back", concept: item.concept, misconception: item, detail: item.explanation });
      }
    });
    const plans: Step[] = planItems
      .filter(plan => plan.status !== "completed")
      .sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime())
      .map(plan => ({ key: `p-${plan.id}`, kind: "plan", concept: plan.concept, plan,
        detail: capitalise(plan.action.replace(/^Teacher assigned:\s*/, "").replace(/^Prerequisite first:\s*/, "")) }));
    return [...retention, ...teachBack, ...plans];
  }, [misconceptions, planItems]);

  const cleared = misconceptions.filter(item => item.learning_status === "verified"
    && !steps.some(step => step.kind !== "plan" && step.misconception.id === item.id));
  const donePlans = planItems.filter(plan => plan.status === "completed");
  const concepts = [...mastery].sort((a, b) => STATUS[a.status].order - STATUS[b.status].order
    || (a.mastery_score ?? 101) - (b.mastery_score ?? 101));

  const primaryButton = "inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-[var(--eb-text)] px-4 text-sm font-semibold text-[var(--eb-ink)]";
  const quietButton = "inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-[var(--eb-line)] px-4 text-sm text-[var(--eb-text-soft)] hover:text-[var(--eb-text)]";

  if (loading) return (
    <div className="eb-stage min-h-[calc(100vh-3.5rem)] px-5 py-10 sm:px-10">
      <div role="status" className="mx-auto flex max-w-[860px] flex-col gap-3">
        <span className="text-[15px] text-[var(--eb-text-soft)]">Loading your progress</span>
        <span aria-hidden="true" className="relative block h-[3px] max-w-[360px] overflow-hidden rounded-sm bg-[var(--eb-line-soft)]">
          <span className="eb-seek absolute inset-y-0 w-2/5 bg-[linear-gradient(90deg,transparent,var(--eb-text-muted),transparent)]" />
        </span>
      </div>
    </div>
  );
  if (!progress) return (
    <div className="eb-stage min-h-[calc(100vh-3.5rem)] px-5 py-10 sm:px-10">
      <p className="mx-auto m-0 max-w-[860px] text-[var(--eb-text-soft)]">Your progress couldn’t be loaded. Refresh the page to try again.</p>
    </div>
  );

  const headline = steps.length === 0 ? "You’re up to date" : `${steps.length} thing${steps.length === 1 ? "" : "s"} to do next`;
  const summary = progress.quiz_count === 0
    ? "No quizzes yet."
    : `${progress.quiz_count} quiz${progress.quiz_count === 1 ? "" : "zes"} taken, ${progress.average_score}% on average, best ${progress.best_score}%.`;

  return (
    <div className="eb-stage min-h-[calc(100vh-3.5rem)] px-5 py-8 sm:px-10">
      <div className="mx-auto flex max-w-[860px] flex-col gap-12">
        <header className="flex flex-col gap-2">
          <span className="text-sm text-[var(--eb-text-muted)]">{courseName}</span>
          <h1 className="m-0 text-[36px] font-semibold leading-[1.1] tracking-[-0.025em]">{headline}</h1>
          <p className="m-0 text-[15px] text-[var(--eb-text-muted)]">{summary}</p>
        </header>

        <section aria-label="Next steps" className="flex flex-col gap-3">
          {steps.length === 0 && (
            <div className="flex flex-col items-start gap-3 rounded-xl border border-[var(--eb-line-soft)] px-5 py-5">
              <span className="text-[var(--eb-text-soft)]">Nothing is waiting for you. A quiz is the quickest way to find what to work on next.</span>
              <button type="button" onClick={onGoQuiz} className={primaryButton}>Take a quiz</button>
            </div>
          )}
          {steps.map(step => {
            const overdue = step.kind === "plan" && isDue(step.plan.due_at);
            const when = step.kind === "plan" ? shortDate(step.plan.due_at) : null;
            const label = step.kind === "plan"
              ? (step.plan.action.startsWith("Teacher assigned:") ? "From your teacher"
                : step.plan.action.startsWith("Prerequisite first:") ? "Learn this first" : "Study plan")
              : step.kind === "retention" ? "Follow-up check"
              : step.misconception.learning_status === "improving" ? "Getting there" : "Explain it in your own words";
            return (
              <div key={step.key} className="flex flex-wrap items-center gap-4 rounded-xl border border-[var(--eb-line-soft)] bg-[var(--eb-raised-2)] px-5 py-4">
                <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-1">
                  <span className="text-[13px] text-[var(--eb-text-muted)]">
                    {label}
                    {when && <span style={overdue ? { color: WRONG } : undefined}>{overdue ? `, overdue since ${when}` : `, due ${when}`}</span>}
                  </span>
                  <span className="text-[17px] font-semibold">{step.concept}</span>
                  <span className="text-[15px] leading-snug text-[var(--eb-text-soft)]">{step.detail}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {step.kind === "retention" && (
                    <button type="button" onClick={() => setCheck({ misconception: step.misconception, mode: "retention" })} className={primaryButton}>Start check</button>
                  )}
                  {step.kind === "teach-back" && (
                    <button type="button" onClick={() => setCheck({ misconception: step.misconception, mode: "teach-back" })} className={primaryButton}>Explain it</button>
                  )}
                  {step.kind === "plan" && (
                    <>
                      <button type="button" onClick={() => onPractice(step.plan.concept)} className={primaryButton}>Practise now</button>
                      <button type="button" onClick={() => void toggleDone(step.plan.id)} className={quietButton}>Mark done</button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {(steps.some(step => step.kind !== "plan")) && (
            <span className="text-[13px] text-[var(--eb-text-muted)]">Checks use AI only when you start one.</span>
          )}
          {donePlans.length > 0 && (
            <div className="flex flex-col gap-2 pt-1">
              <button type="button" onClick={() => setShowDone(open => !open)} aria-expanded={showDone}
                className="min-h-10 self-start text-sm text-[var(--eb-text-soft)] underline underline-offset-4">
                {showDone ? "Hide" : "Show"} {donePlans.length} finished study task{donePlans.length === 1 ? "" : "s"}
              </button>
              {showDone && donePlans.map(plan => (
                <div key={plan.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-2.5 text-[15px] text-[var(--eb-text-muted)] shadow-[0_0_0_1px_var(--eb-line-soft)]">
                  <span className="flex items-center gap-2"><Check size={15} aria-hidden="true" />{plan.concept}</span>
                  <button type="button" onClick={() => void toggleDone(plan.id)} className="min-h-10 text-sm underline underline-offset-4">Undo</button>
                </div>
              ))}
            </div>
          )}
        </section>

        {cleared.length > 0 && (
          <section aria-label="Cleared up" className="flex flex-col gap-3">
            <h2 className="m-0 text-lg font-semibold">Cleared up</h2>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {cleared.map(item => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 shadow-[0_0_0_1px_var(--eb-line-soft)]">
                  <span className="flex items-center gap-2.5 font-medium">
                    <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--eb-text)] text-[var(--eb-ink)]"><Check size={13} strokeWidth={3} /></span>
                    {item.concept}
                  </span>
                  <span className="text-sm text-[var(--eb-text-muted)]">
                    {item.retention_status === "retained" ? "Still clear at the follow-up check"
                      : shortDate(item.retention_due_at) ? `Follow-up check on ${shortDate(item.retention_due_at)}` : "Explained correctly"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-label="What you know" className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="m-0 text-lg font-semibold">What you know</h2>
            <span className="text-sm text-[var(--eb-text-muted)]">From your quiz answers and explanations. Weakest first.</span>
          </div>
          {concepts.length === 0 ? (
            <p className="m-0 rounded-xl border border-dashed border-[var(--eb-line)] px-5 py-5 text-[var(--eb-text-soft)]">
              Take a quiz or ask a question in Course Q&amp;A to start building this.
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {concepts.map(item => {
                const score = item.mastery_score === null || !item.evidence_sufficient ? null : Math.round(item.mastery_score);
                const evidence = [
                  item.total_answers > 0 ? `${item.correct_answers} of ${item.total_answers} quiz answers right` : null,
                  item.completed_teach_backs > 0 ? `${item.completed_teach_backs} explanation${item.completed_teach_backs === 1 ? "" : "s"}` : null,
                  item.open_misconceptions > 0 ? `${item.open_misconceptions} open mix-up${item.open_misconceptions === 1 ? "" : "s"}` : null,
                ].filter(Boolean).join(", ");
                return (
                  <li key={item.concept} className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-[var(--eb-line-soft)] py-4 last:border-b-0">
                    <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1">
                      <span className="font-semibold">{item.concept}</span>
                      <span className="text-[13px] text-[var(--eb-text-muted)]">
                        {STATUS[item.status].label}
                        {item.review_due && item.status !== "needs_review" && <span style={{ color: WRONG }}>, review due</span>}
                        {evidence && `. ${evidence}`}
                      </span>
                    </div>
                    <div className="flex flex-[1_1_200px] items-center gap-3">
                      <span aria-hidden="true" className="block h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--eb-line-soft)]">
                        <span className="block h-full rounded-full bg-[var(--eb-text-soft)]" style={{ width: `${score ?? 0}%` }} />
                      </span>
                      <span className="min-w-12 whitespace-nowrap text-right text-sm tabular-nums text-[var(--eb-text-soft)]">
                        {score === null ? "Too early" : `${score}%`}
                      </span>
                    </div>
                    <button type="button" onClick={() => onPractice(item.concept)} className={quietButton}>Practise</button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-label="Quiz history" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="m-0 text-lg font-semibold">Quiz history</h2>
            <button type="button" onClick={onGoQuiz} className="min-h-10 text-sm text-[var(--eb-text-soft)] underline underline-offset-4 hover:text-[var(--eb-text)]">Take a quiz</button>
          </div>
          {progress.attempts.length === 0 ? (
            <p className="m-0 text-[var(--eb-text-soft)]">No quizzes yet.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {progress.attempts.map(attempt => (
                <li key={attempt.id} className="flex items-center gap-4 border-b border-[var(--eb-line-soft)] py-3 last:border-b-0">
                  <span className="w-14 text-lg font-semibold tabular-nums">{attempt.correct}/{attempt.total}</span>
                  <span className="min-w-0 flex-1 truncate text-[15px]">{attempt.title}</span>
                  <span className="shrink-0 text-sm text-[var(--eb-text-muted)]">{shortDate(attempt.completed_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {check && renderCheck({
        misconception: check.misconception,
        mode: check.mode,
        onClose: () => setCheck(null),
        onComplete: refreshLearningEvidence,
      })}
    </div>
  );
}
