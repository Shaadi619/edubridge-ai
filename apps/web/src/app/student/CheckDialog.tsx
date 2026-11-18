import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";

import { api, type SourceCitation } from "../../lib/api";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog";
import SourceStage, { type StageCitation } from "./SourceStage";

type Misconception = Awaited<ReturnType<typeof api.myMisconceptions>>[number];
type Start = Awaited<ReturnType<typeof api.startTeachBack>>;
type Result = Awaited<ReturnType<typeof api.submitTeachBack>>;

const WRONG = "#E8907F";

export default function CheckDialog({ courseId, courseName, misconception, mode, accessToken, onClose, onComplete }: {
  courseId: string;
  courseName: string;
  misconception: Misconception;
  mode: "teach-back" | "retention";
  accessToken: string;
  onClose: () => void;
  onComplete: () => Promise<void>;
}) {
  const [check, setCheck] = useState<Start | null>(null);
  const [response, setResponse] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const autoStopRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const releaseMicrophone = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (autoStopRef.current !== null) window.clearTimeout(autoStopRef.current);
    autoStopRef.current = null;
  }, []);

  useEffect(() => () => {
    mountedRef.current = false;
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    releaseMicrophone();
  }, [releaseMicrophone]);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setRecordingSeconds(value => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    setLoading(true);
    const start = mode === "retention" ? api.startRetentionCheck : api.startTeachBack;
    void start(courseId, misconception.id, accessToken)
      .then(setCheck)
      .catch(cause => setError(cause instanceof Error ? cause.message : "Could not create the check."))
      .finally(() => setLoading(false));
  }, [accessToken, courseId, misconception.id, mode]);

  const submit = async () => {
    if (!check || response.trim().length < 10) return;
    setSubmitting(true);
    setError(null);
    try {
      const evaluation = mode === "retention"
        ? await api.submitRetentionCheck(courseId, check.verification_id, response.trim(), accessToken)
        : await api.submitTeachBack(courseId, check.verification_id, response.trim(), accessToken);
      setResult(evaluation);
      await onComplete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not check your explanation.");
    } finally {
      setSubmitting(false);
    }
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("This browser can’t record audio. You can still type your explanation.");
      return;
    }
    setError(null);
    setRecordingSeconds(0);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const candidates = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"];
      const mimeType = candidates.find(candidate => MediaRecorder.isTypeSupported(candidate));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      audioChunksRef.current = [];
      recorder.ondataavailable = event => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        releaseMicrophone();
        if (!mountedRef.current) return;
        setRecording(false);
        if (!blob.size) {
          setError("No audio was captured. Check microphone permission and try again.");
          return;
        }
        setTranscribing(true);
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = String(reader.result ?? "");
          const extension = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
          void api.transcribeTeachBack(courseId, {
            filename: `teach-back.${extension}`,
            mime_type: blob.type,
            data_base64: dataUrl.split(",")[1] ?? "",
          }, accessToken).then(({ transcript }) => {
            if (mountedRef.current) setResponse(transcript);
          }).catch(cause => {
            if (mountedRef.current) setError(cause instanceof Error ? cause.message : "Could not transcribe your recording.");
          }).finally(() => {
            if (mountedRef.current) setTranscribing(false);
          });
        };
        reader.onerror = () => {
          setTranscribing(false);
          setError("The browser couldn’t read this recording. Please try again.");
        };
        reader.readAsDataURL(blob);
      };
      recorder.start(250);
      setRecording(true);
      autoStopRef.current = window.setTimeout(stopRecording, 90_000);
    } catch (cause) {
      releaseMicrophone();
      setError(cause instanceof DOMException && cause.name === "NotAllowedError"
        ? "Microphone access was denied. Allow it in your browser, or type your explanation."
        : "The microphone couldn’t start. You can still type your explanation.");
    }
  };

  const verdict = result?.verdict;
  const verdictTitle = verdict === "corrected"
    ? (mode === "retention" ? "Still clear. Nicely done." : "That’s right. This one is cleared up.")
    : verdict === "improving" ? "Getting there" : verdict ? "Not quite yet" : "";
  const stageItems: StageCitation[] = result
    ? result.citations.filter(citation => citation.chunk_id).map(citation => ({
      key: citation.chunk_id as string, citation: citation as SourceCitation, answerText: result.feedback, quote: citation.quote,
    }))
    : [];
  const activeKey = result ? (activeSource ?? stageItems[0]?.key ?? null) : null;
  const tooShort = response.trim().length < 10;
  const primaryButton = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[var(--eb-text)] px-6 font-semibold text-[var(--eb-ink)] disabled:opacity-40";

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="eb-stage grid max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] gap-0 overflow-y-auto border-[#2A3644] p-0 text-[var(--eb-text)] sm:max-w-[1000px] lg:grid-cols-[minmax(0,1fr)_minmax(340px,44%)] lg:overflow-hidden [&>button]:text-[var(--eb-text-soft)]">
        <section className="flex min-w-0 flex-col gap-5 px-6 py-7 sm:px-8 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto">
          <div className="flex flex-col gap-1 pr-8">
            <span className="text-sm text-[var(--eb-text-muted)]">{courseName}</span>
            <DialogTitle className="m-0 text-[24px] font-semibold leading-tight tracking-[-0.015em] text-[var(--eb-text)]">
              {mode === "retention" ? "Is it still clear?" : "Explain it in your own words"}
            </DialogTitle>
            <DialogDescription className="text-[15px] text-[var(--eb-text-soft)]">{misconception.concept}</DialogDescription>
          </div>

          {loading && (
            <div role="status" className="flex flex-col gap-2.5 py-4">
              <span className="text-[15px] text-[var(--eb-text-soft)]">Writing a question from your course material</span>
              <span aria-hidden="true" className="relative block h-[3px] max-w-[320px] overflow-hidden rounded-sm bg-[var(--eb-line-soft)]">
                <span className="eb-seek absolute inset-y-0 w-2/5 bg-[linear-gradient(90deg,transparent,var(--eb-text-muted),transparent)]" />
              </span>
            </div>
          )}

          {!loading && error && !check && (
            <p role="alert" className="m-0 rounded-xl border border-[rgba(232,144,127,0.4)] bg-[rgba(232,144,127,0.08)] px-4 py-3">{error}</p>
          )}

          {check && !result && (
            <>
              <p className="eb-rise m-0 text-[18px] font-medium leading-relaxed">{check.question}</p>
              <div className="flex flex-col gap-2">
                <label htmlFor="check-response" className="text-sm text-[var(--eb-text-muted)]">Your explanation</label>
                <textarea id="check-response" value={response} onChange={event => setResponse(event.target.value)} rows={6}
                  placeholder="Type it as you’d explain it to a classmate, or record it below"
                  disabled={recording || transcribing}
                  className="w-full resize-y rounded-xl border border-[var(--eb-line)] bg-[#18222D] px-4 py-3 text-[16px] leading-relaxed text-[var(--eb-text)] outline-none focus:border-[var(--eb-text-muted)] disabled:opacity-60" />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={recording ? stopRecording : () => void startRecording()} disabled={transcribing || submitting}
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 text-sm disabled:opacity-40"
                  style={recording ? { borderColor: WRONG, color: WRONG } : { borderColor: "var(--eb-line)", color: "var(--eb-text-soft)" }}>
                  {recording ? <><Square size={13} fill="currentColor" aria-hidden="true" />Stop recording, {recordingSeconds}s</>
                    : transcribing ? "Turning your recording into text…"
                    : <><Mic size={15} aria-hidden="true" />Record instead</>}
                </button>
                <span className="text-[13px] text-[var(--eb-text-muted)]">Up to 90 seconds. Only the text is kept, not the audio.</span>
              </div>
              {error && <p role="alert" className="m-0 text-sm" style={{ color: WRONG }}>{error}</p>}
              <div className="flex flex-col items-start gap-1.5">
                <button type="button" onClick={() => void submit()} disabled={tooShort || submitting || recording || transcribing} className={primaryButton}>
                  {submitting ? "Checking against your course…" : "Check my explanation"}
                </button>
                {tooShort && !submitting && <span className="text-[13px] text-[var(--eb-text-muted)]">Write at least a sentence first.</span>}
              </div>
            </>
          )}

          {result && (
            <div role="status" className="eb-rise flex flex-col gap-3">
              <span className="text-[22px] font-semibold" style={{ color: verdict === "corrected" ? "var(--eb-light)" : verdict === "improving" ? "var(--eb-text)" : WRONG }}>
                {verdictTitle}
              </span>
              <p className="m-0 text-[16px] leading-[1.7] text-[var(--eb-text-soft)]">{result.feedback}</p>
              <button type="button" onClick={onClose} className={`${primaryButton} mt-2 self-start`}>Back to my progress</button>
            </div>
          )}
        </section>

        <aside aria-label="Course source" className="min-h-[360px] border-t border-[#26313D] lg:border-l lg:border-t-0">
          <SourceStage
            courseId={courseId}
            items={stageItems}
            activeKey={activeKey}
            onPick={setActiveSource}
            hoverKey={null}
            searching={submitting}
            hasAnswerWithoutSource={false}
            emptyMessage={result
              ? "This check wasn’t linked to a passage you can open."
              : "The passage your explanation is checked against appears here once you submit."}
            stripCaption="Pages this check used"
          />
        </aside>
      </DialogContent>
    </Dialog>
  );
}
