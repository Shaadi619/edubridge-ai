import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ArrowRight, Check, X } from "lucide-react";

import { api } from "../../lib/api";
import { readQuizDraft, writeQuizDraft } from "../../lib/studentSession";
import { renderText } from "./renderText";
import SourceStage, { type StageCitation } from "./SourceStage";

type GeneratedQuiz = Awaited<ReturnType<typeof api.generateQuiz>>;

const CONFIDENCE = [
  { value: 1, label: "Not sure" },
  { value: 2, label: "Somewhat sure" },
  { value: 3, label: "Very sure" },
];

const WRONG = "#E8907F";

export default function QuizStage({ userId, courseId, courseName, accessToken, onViewProgress, suggestedFocus, onFocusConsumed }: {
  userId: string; courseId: string; courseName: string; accessToken: string;
  onViewProgress: () => void;
  suggestedFocus: string | null;
  onFocusConsumed: () => void;
}) {
  const [initialDraft] = useState(() => readQuizDraft(userId, courseId));
  const [quiz, setQuiz] = useState<GeneratedQuiz | null>(initialDraft?.quiz ?? null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const generationInFlight = useRef(false);
  const [questionIndex, setQuestionIndex] = useState(initialDraft?.questionIndex ?? 0);
  const [answers, setAnswers] = useState<(number | null)[]>(initialDraft?.answers ?? []);
  const [confidences, setConfidences] = useState<(number | null)[]>(initialDraft?.confidences ?? []);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(initialDraft?.selectedAnswer ?? null);
  const [selectedConfidence, setSelectedConfidence] = useState<number | null>(initialDraft?.selectedConfidence ?? null);
  const [showExplanation, setShowExplanation] = useState(initialDraft?.showExplanation ?? false);
  const [showResults, setShowResults] = useState(initialDraft?.showResults ?? false);
  const [practiceTopic, setPracticeTopic] = useState<string | null>(null);
  const [savingAttempt, setSavingAttempt] = useState(false);
  const [replaceQuiz, setReplaceQuiz] = useState(false);
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const submissionInFlight = useRef(false);

  const loadQuiz = async (focusConcept?: string) => {
    if (generationInFlight.current) return;
    generationInFlight.current = true;
    setLoading(true);
    setLoadError(null);
    try {
      const generated = await api.generateQuiz(courseId, accessToken, focusConcept);
      setQuiz(generated);
      setAnswers(Array(generated.questions.length).fill(null));
      setConfidences(Array(generated.questions.length).fill(null));
      setSelectedConfidence(null);
      setQuestionIndex(0);
      setSelectedAnswer(null);
      setShowExplanation(false);
      setShowResults(false);
      setPracticeTopic(null);
      setReplaceQuiz(false);
      setActiveSource(null);
      if (focusConcept) onFocusConsumed();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not generate a quiz.");
    } finally {
      generationInFlight.current = false;
      setLoading(false);
    }
  };

  useLayoutEffect(() => {
    if (!quiz) return;
    writeQuizDraft(userId, courseId, {
      quiz, questionIndex, answers, confidences, selectedAnswer, selectedConfidence, showExplanation, showResults,
    });
  }, [userId, courseId, quiz, questionIndex, answers, confidences, selectedAnswer, selectedConfidence, showExplanation, showResults]);

  const shell = (children: ReactNode) => (
    <div className="eb-stage min-h-[calc(100vh-3.5rem)] px-5 py-8 sm:px-10">{children}</div>
  );
  const primaryButton = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[var(--eb-text)] px-6 font-semibold text-[var(--eb-ink)] transition-opacity disabled:opacity-40";
  const quietButton = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-[var(--eb-line)] px-5 text-[var(--eb-text-soft)] hover:border-[var(--eb-text-muted)] hover:text-[var(--eb-text)] disabled:opacity-40";

  if (loading) return shell(
    <div role="status" className="mx-auto flex max-w-[640px] flex-col gap-3 pt-10">
      <h2 className="m-0 text-[26px] font-semibold tracking-[-0.015em]">Writing questions from your course material</h2>
      <p className="m-0 text-[15px] text-[var(--eb-text-muted)]">Each answer is checked against an exact line in {courseName} before you see it.</p>
      <span aria-hidden="true" className="relative mt-2 block h-[3px] max-w-[360px] overflow-hidden rounded-sm bg-[var(--eb-line-soft)]">
        <span className="eb-seek absolute inset-y-0 w-2/5 bg-[linear-gradient(90deg,transparent,var(--eb-light),transparent)]" />
      </span>
    </div>,
  );

  if (!quiz) return shell(
    <div className="mx-auto flex max-w-[640px] flex-col gap-4 pt-10">
      <h2 className="m-0 text-[30px] font-semibold leading-tight tracking-[-0.02em]">
        {suggestedFocus ? `Practise ${suggestedFocus}` : `Check what you know in ${courseName}`}
      </h2>
      <p className="m-0 max-w-[56ch] text-[16px] leading-relaxed text-[var(--eb-text-soft)]">
        Up to four questions written from your course material. After each answer you’ll see the exact line in your notes that it was checked against.
      </p>
      {loadError && <p role="alert" className="m-0 rounded-xl border border-[rgba(232,144,127,0.4)] bg-[rgba(232,144,127,0.08)] px-4 py-3 text-[15px] text-[var(--eb-text)]">{loadError}</p>}
      <div className="flex flex-col items-start gap-2 pt-2">
        <button type="button" onClick={() => void loadQuiz(suggestedFocus ?? undefined)} className={primaryButton}>
          {loadError ? "Try again" : suggestedFocus ? "Make a practice quiz" : "Make a quiz"}
        </button>
        <span className="text-[13px] text-[var(--eb-text-muted)]">Uses AI to write the questions. Your quiz stays open if you switch sections.</span>
      </div>
    </div>,
  );

  const questions = quiz.questions;
  const q = questions[questionIndex];
  const isLastQuestion = questionIndex === questions.length - 1;
  const isCorrect = selectedAnswer === q.correct_option;
  const correctCount = answers.filter((answer, index) => answer === questions[index].correct_option).length;

  const handleNext = async () => {
    if (submissionInFlight.current) return;
    const newAnswers = [...answers];
    newAnswers[questionIndex] = selectedAnswer;
    setAnswers(newAnswers);
    const newConfidences = [...confidences];
    newConfidences[questionIndex] = selectedConfidence;
    setConfidences(newConfidences);
    if (isLastQuestion) {
      submissionInFlight.current = true;
      setSavingAttempt(true);
      try {
        await api.submitQuiz(courseId, quiz.id, newAnswers, newConfidences, accessToken);
        setShowResults(true);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Quiz score could not be saved.");
      } finally {
        submissionInFlight.current = false;
        setSavingAttempt(false);
      }
    } else {
      setQuestionIndex(index => index + 1);
      setSelectedAnswer(null);
      setSelectedConfidence(null);
      setShowExplanation(false);
      setActiveSource(null);
    }
  };

  if (showResults) {
    const wrongTopics = [...new Set(questions.filter((question, index) => answers[index] !== question.correct_option).map(question => question.concept))];
    return shell(
      <div className="mx-auto flex max-w-[720px] flex-col gap-8">
        {loadError && <p role="alert" className="m-0 rounded-xl border border-[rgba(232,144,127,0.4)] bg-[rgba(232,144,127,0.08)] px-4 py-3">{loadError}</p>}
        <header className="flex flex-col gap-2">
          <span className="text-sm text-[var(--eb-text-muted)]">{quiz.title}</span>
          <h2 className="m-0 text-[40px] font-semibold leading-none tracking-[-0.025em]">{correctCount} of {questions.length} correct</h2>
          <div aria-hidden="true" className="mt-3 flex gap-1.5">
            {questions.map((question, index) => (
              <span key={question.id} className="h-1.5 flex-1 rounded-full"
                style={{ background: answers[index] === question.correct_option ? "var(--eb-light)" : WRONG, opacity: answers[index] === question.correct_option ? 1 : 0.7 }} />
            ))}
          </div>
        </header>

        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {questions.map((question, index) => {
            const right = answers[index] === question.correct_option;
            return (
              <li key={question.id} className="flex gap-3.5 rounded-xl border border-[var(--eb-line-soft)] bg-[var(--eb-raised-2)] px-4 py-3.5">
                <span aria-hidden="true" className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                  style={{ background: right ? "var(--eb-light)" : WRONG, color: "var(--eb-ink)" }}>
                  {right ? <Check size={14} strokeWidth={3} /> : <X size={14} strokeWidth={3} />}
                </span>
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-[13px] text-[var(--eb-text-muted)]">{question.concept}<span className="sr-only">{right ? ", correct" : ", incorrect"}</span></span>
                  <span className="text-[15px] font-medium leading-snug">{question.prompt}</span>
                  {!right && <span className="text-sm text-[var(--eb-text-soft)]">Answer: <span className="font-semibold text-[var(--eb-text)]">{question.options[question.correct_option]}</span></span>}
                  {!right && confidences[index] === 3 && (
                    <span className="text-sm text-[var(--eb-text)]">You were very sure here, so it’s worth reviewing your reasoning.</span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        {wrongTopics.length > 0 && (
          <section aria-label="Topics to review" className="flex flex-col gap-3">
            <h3 className="m-0 text-lg font-semibold">Review next</h3>
            <div className="flex flex-wrap gap-2">
              {wrongTopics.map(topic => (
                <button key={topic} type="button" onClick={() => setPracticeTopic(topic)} aria-pressed={practiceTopic === topic}
                  className={`min-h-11 rounded-lg border px-4 text-sm ${practiceTopic === topic
                    ? "border-[var(--eb-text)] bg-[var(--eb-text)] font-semibold text-[var(--eb-ink)]"
                    : "border-[var(--eb-line)] text-[var(--eb-text-soft)] hover:text-[var(--eb-text)]"}`}>
                  Practise {topic}
                </button>
              ))}
            </div>
            {practiceTopic && (
              <div className="eb-rise flex flex-col gap-3 rounded-xl border border-[var(--eb-line)] bg-[var(--eb-raised-2)] p-4">
                <span className="font-semibold">Make four practice questions on {practiceTopic}?</span>
                <span className="text-sm text-[var(--eb-text-muted)]">This uses AI to write new questions.</span>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void loadQuiz(practiceTopic)} className={primaryButton}>Make practice questions</button>
                  <button type="button" onClick={() => setPracticeTopic(null)} className={quietButton}>Not now</button>
                </div>
              </div>
            )}
          </section>
        )}

        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={onViewProgress} className={primaryButton}>See my progress</button>
          <button type="button" onClick={() => void loadQuiz()} className={quietButton}>Start a new quiz</button>
        </div>
      </div>,
    );
  }

  const stageItems: StageCitation[] = showExplanation
    ? q.citations.filter(citation => citation.chunk_id).map(citation => ({
      key: citation.chunk_id as string, citation, answerText: `${q.options[q.correct_option]} ${q.explanation}`, quote: citation.quote,
    }))
    : [];
  const activeKey = showExplanation ? (activeSource ?? stageItems[0]?.key ?? null) : null;

  return (
    <div className="eb-stage grid min-h-[calc(100vh-3.5rem)] lg:grid-cols-[minmax(0,1fr)_minmax(380px,42%)]">
      <section aria-label="Question" className="flex min-w-0 flex-col gap-7 px-5 py-8 sm:px-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-2">
            <span className="text-sm text-[var(--eb-text-muted)]">Question {questionIndex + 1} of {questions.length}</span>
            <div aria-hidden="true" className="flex gap-1.5">
              {questions.map((question, index) => (
                <span key={question.id} className="h-1.5 w-9 rounded-full transition-colors duration-300"
                  style={{ background: index < questionIndex ? "var(--eb-text-muted)" : index === questionIndex ? "var(--eb-text)" : "var(--eb-line-soft)" }} />
              ))}
            </div>
          </div>
          <button type="button" disabled={savingAttempt} onClick={() => setReplaceQuiz(open => !open)} aria-expanded={replaceQuiz}
            className="min-h-10 rounded-lg border border-[var(--eb-line)] px-3 text-sm text-[var(--eb-text-soft)] hover:text-[var(--eb-text)] disabled:opacity-50">
            {suggestedFocus ? "Start a practice quiz" : "Start a new quiz"}
          </button>
        </div>

        {replaceQuiz && (
          <div className="eb-rise flex flex-col gap-3 rounded-xl border border-[var(--eb-line)] bg-[var(--eb-raised-2)] p-4 text-[15px]">
            <span>A new quiz replaces this unfinished one once its questions are ready.</span>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void loadQuiz(suggestedFocus ?? undefined)} className={primaryButton}>Make a new quiz</button>
              <button type="button" onClick={() => setReplaceQuiz(false)} className={quietButton}>Keep this one</button>
            </div>
          </div>
        )}
        {loadError && <p role="alert" className="m-0 rounded-xl border border-[rgba(232,144,127,0.4)] bg-[rgba(232,144,127,0.08)] px-4 py-3">{loadError}</p>}

        {quiz.prerequisite_concepts.length > 0 && quiz.focus_concept && (
          <div className="flex flex-col gap-1.5 rounded-xl border border-[var(--eb-line-soft)] px-4 py-3">
            <span className="text-sm text-[var(--eb-text-muted)]">This quiz starts with what {quiz.focus_concept} builds on</span>
            <span className="flex flex-wrap items-center gap-1.5 text-[15px]">
              {[...quiz.prerequisite_concepts, quiz.focus_concept].map((concept, index, path) => (
                <span key={`${concept}-${index}`} className="inline-flex items-center gap-1.5">
                  <span className={index === path.length - 1 ? "font-semibold" : "text-[var(--eb-text-soft)]"}>{concept}</span>
                  {index < path.length - 1 && <ArrowRight size={13} aria-hidden="true" className="text-[var(--eb-text-muted)]" />}
                </span>
              ))}
            </span>
          </div>
        )}

        <div key={q.id} className="eb-rise flex max-w-[680px] flex-col gap-6">
          <div className="flex flex-col gap-2">
            <span className="text-sm text-[var(--eb-text-muted)]">{q.concept}</span>
            <h2 className="m-0 text-[22px] font-semibold leading-snug tracking-[-0.01em]">{q.prompt}</h2>
          </div>

          <div role="group" aria-label="Answer options" className="flex flex-col gap-2.5">
            {q.options.map((option, index) => {
              const selected = selectedAnswer === index;
              const right = showExplanation && index === q.correct_option;
              const wrong = showExplanation && selected && !isCorrect;
              const style = right
                ? { borderColor: "var(--eb-light)", background: "rgba(240,185,74,0.12)", boxShadow: "0 0 24px -6px var(--eb-light-glow)" }
                : wrong ? { borderColor: WRONG, background: "rgba(232,144,127,0.08)" }
                : selected ? { borderColor: "var(--eb-text)", background: "var(--eb-raised)" } : undefined;
              return (
                <button key={index} type="button" aria-pressed={selected} disabled={showExplanation && !selected && !right}
                  onClick={() => { if (!showExplanation) setSelectedAnswer(index); }}
                  className="flex min-h-[54px] w-full items-center gap-3.5 rounded-xl border border-[var(--eb-line)] px-4 py-3 text-left text-[16px] transition-[border-color,background,box-shadow] duration-200 hover:border-[var(--eb-text-muted)] disabled:cursor-default disabled:opacity-55 disabled:hover:border-[var(--eb-line)]"
                  style={style}
                >
                  <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-current text-[13px] font-semibold text-[var(--eb-text-soft)]">
                    {String.fromCharCode(65 + index)}
                  </span>
                  <span className="flex-1">{option}</span>
                  {right && <Check size={18} aria-label="Correct answer" className="shrink-0 text-[var(--eb-light)]" />}
                  {wrong && <X size={18} aria-label="Your answer, incorrect" className="shrink-0" style={{ color: WRONG }} />}
                </button>
              );
            })}
          </div>

          {selectedAnswer !== null && !showExplanation && (
            <div className="eb-rise flex flex-col gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="font-semibold">How sure are you?</span>
                <span className="text-sm text-[var(--eb-text-muted)]">Pick before you see the answer. It helps tell a guess from a real misunderstanding.</span>
              </div>
              <div role="group" aria-label="Confidence" className="grid grid-cols-3 gap-2">
                {CONFIDENCE.map(option => (
                  <button key={option.value} type="button" onClick={() => setSelectedConfidence(option.value)} aria-pressed={selectedConfidence === option.value}
                    className={`min-h-11 rounded-lg border px-2 text-sm transition-colors ${selectedConfidence === option.value
                      ? "border-[var(--eb-text)] bg-[var(--eb-text)] font-semibold text-[var(--eb-ink)]"
                      : "border-[var(--eb-line)] text-[var(--eb-text-soft)] hover:text-[var(--eb-text)]"}`}>
                    {option.label}
                  </button>
                ))}
              </div>
              <button type="button" disabled={selectedConfidence === null} onClick={() => setShowExplanation(true)} className={`${primaryButton} self-start`}>
                Check answer
              </button>
            </div>
          )}

          {showExplanation && (
            <div role="status" className="eb-rise flex flex-col gap-3">
              <span className="text-lg font-semibold" style={{ color: isCorrect ? "var(--eb-light)" : WRONG }}>
                {isCorrect ? "Correct" : "Not quite"}
              </span>
              <div className="text-[16px] leading-[1.7] text-[var(--eb-text-soft)] [&_strong]:text-[var(--eb-text)]">{renderText(q.explanation)}</div>
              {!isCorrect && selectedConfidence === 3 && (
                <span className="text-sm font-medium text-[var(--eb-text)]">You were very sure, so this one is worth a second look.</span>
              )}
              <button type="button" onClick={() => void handleNext()} disabled={savingAttempt} className={`${primaryButton} mt-2 self-start`}>
                {savingAttempt ? "Saving your answers…" : isLastQuestion ? "See results" : "Next question"}
              </button>
            </div>
          )}
        </div>
      </section>

      <aside aria-label="Course source" className="min-h-[420px] border-t border-[#26313D] lg:border-l lg:border-t-0">
        <SourceStage
          courseId={courseId}
          items={stageItems}
          activeKey={activeKey}
          onPick={setActiveSource}
          hoverKey={null}
          searching={false}
          hasAnswerWithoutSource={false}
          emptyMessage={showExplanation
            ? "This question wasn’t linked to a passage you can open."
            : "Answer first. The line this question was checked against appears here afterwards."}
          stripCaption="Pages this question comes from"
        />
      </aside>
    </div>
  );
}
