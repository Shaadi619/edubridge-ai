import React, { lazy, Suspense, useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { toast, Toaster } from "sonner";
import {
  BookOpen, Users, Brain, TrendingUp, BarChart2, MessageSquare,
  Zap, Shield, Eye, LogOut, ArrowRight, Send, Home, Target,
  Award, Bell, Search, CheckCircle, AlertCircle, GraduationCap,
  Plus, FileText, Settings, Menu, X, Clock,
  Upload, File, Trash2, CheckSquare, XSquare, RefreshCw,
  ChevronRight, Lock, Unlock, BookMarked, StickyNote, LineChart,
  MessageCircle, User, ChevronDown, Star, Copy, Pencil,
  CheckCheck, Layers, ToggleLeft, ToggleRight, CalendarDays,
  RotateCcw, Flame, ChevronUp, Sparkles,
  Mic, Square, Volume2,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, AreaChart, Area, RadarChart,
  PolarGrid, PolarAngleAxis, Radar,
} from "recharts";
import { useAuth } from "../auth/AuthContext";
import { supabase } from "../lib/supabase";
import { api, ApiError, type CourseGraphSuggestion, type ExplanationFormat, type SourceCitation, type TeacherInterventionDraft, type WorkSubmission } from "../lib/api";
import type { AiMessage, Announcement, ChatMessage, HistoryStatus, StudentCourse } from "./student/chatTypes";
import { renderText } from "./student/renderText";
import { useScopedQuery, useScopedRequest } from "./useScopedRequest";
import { clearStudentSession, readQuizDraft, readStudentLocation, writeQuizDraft, writeStudentLocation } from "../lib/studentSession";

const CitationPreview = lazy(() => import("./components/CitationPreview"));
const AskWorkspace = lazy(() => import("./student/AskWorkspace"));

// ─── Types ────────────────────────────────────────────────────────────────

type View = "landing" | "auth" | "teacher" | "student" | "admin";
type TeacherTab = "overview" | "students" | "analytics" | "materials" | "settings";
type StudentTab = "workspace" | "work" | "lab" | "quiz" | "progress" | "enroll" | "settings";
const STUDENT_TABS: readonly string[] = ["workspace", "work", "lab", "quiz", "progress", "enroll", "settings"];
type InterventionQueueItem = Awaited<ReturnType<typeof api.teacherCourseAnalytics>>["intervention_queue"][number];


type MisconceptionEntry = {
  id: number;
  student: string;
  initials: string;
  topic: string;
  misconception: string;
  flaggedAt: string;
  status: "open" | "addressed";
};

type QuizAttempt = {
  id: number;
  date: string;
  topic: string;
  score: number;
  total: number;
  duration: string;
};

function initialsFor(name?: string | null): string {
  if (!name) return "?";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? "")
    .join("");
}

type UploadedDoc = {
  id: number | string;
  name: string;
  size: string;
  type: string;
  status: "uploading" | "processing" | "ready" | "error";
  progress: number;
  pages?: number;
  uploadedAt: string;
  storagePath?: string;
};

type EnrollRequest = {
  id: number | string;
  name: string;
  initials: string;
  email: string;
  code: string;
  course: string;
  requestedAt: string;
  status: "pending" | "approved" | "denied";
};

// ─── Data ─────────────────────────────────────────────────────────────────

const TOPIC_DATA = [
  { topic: "Photosynthesis", score: 78 },
  { topic: "Cell Division", score: 65 },
  { topic: "DNA Replication", score: 82 },
  { topic: "Protein Synth.", score: 54 },
  { topic: "Evolution", score: 71 },
  { topic: "Genetics", score: 69 },
];

const WEEKLY_DATA = [
  { week: "Wk 1", avg: 58 },
  { week: "Wk 2", avg: 62 },
  { week: "Wk 3", avg: 65 },
  { week: "Wk 4", avg: 67 },
  { week: "Wk 5", avg: 72 },
  { week: "Wk 6", avg: 70 },
  { week: "Wk 7", avg: 76 },
  { week: "Wk 8", avg: 79 },
];

const RADAR_DATA = [
  { subject: "Genetics", score: 78 },
  { subject: "Cell Bio", score: 52 },
  { subject: "Ecology", score: 88 },
  { subject: "Evolution", score: 65 },
  { subject: "Biochem", score: 43 },
  { subject: "Anatomy", score: 71 },
];

const STUDENTS = [
  { id: 1, name: "Amara Osei", initials: "AO", progress: 82, weak: ["Protein Synthesis", "Meiosis"], quizzes: 14, status: "active" },
  { id: 2, name: "Liam Torres", initials: "LT", progress: 54, weak: ["Cell Division", "DNA Replication"], quizzes: 8, status: "struggling" },
  { id: 3, name: "Priya Nair", initials: "PN", progress: 91, weak: [], quizzes: 19, status: "excelling" },
  { id: 4, name: "Marcus Webb", initials: "MW", progress: 67, weak: ["Genetics", "Evolution"], quizzes: 11, status: "active" },
  { id: 5, name: "Sofia Reyes", initials: "SR", progress: 48, weak: ["Protein Synthesis", "Photosynthesis"], quizzes: 6, status: "struggling" },
  { id: 6, name: "Kai Yamamoto", initials: "KY", progress: 75, weak: ["Cell Division"], quizzes: 13, status: "active" },
  { id: 7, name: "Zoe Chen", initials: "ZC", progress: 88, weak: [], quizzes: 17, status: "excelling" },
];

const INITIAL_DOCS: UploadedDoc[] = [
  { id: 1, name: "Chapter 12 — Cell Division.pdf", size: "2.4 MB", type: "pdf", status: "ready", progress: 100, pages: 18, uploadedAt: "Jun 12" },
  { id: 2, name: "Lecture Notes Week 4.pdf", size: "1.1 MB", type: "pdf", status: "ready", progress: 100, pages: 7, uploadedAt: "Jun 15" },
  { id: 3, name: "Genetics Supplementary.pdf", size: "3.8 MB", type: "pdf", status: "ready", progress: 100, pages: 24, uploadedAt: "Jun 18" },
  { id: 4, name: "Lab Manual — Meiosis.pdf", size: "5.2 MB", type: "pdf", status: "ready", progress: 100, pages: 31, uploadedAt: "Jun 22" },
];

const INITIAL_REQUESTS: EnrollRequest[] = [
  { id: 1, name: "Jordan Kim", initials: "JK", email: "jordan@student.edu", code: "BIO-3F8K", course: "Biology 101", requestedAt: "2h ago", status: "pending" },
  { id: 2, name: "Nadia Patel", initials: "NP", email: "nadia@student.edu", code: "BIO-3F8K", course: "Biology 101", requestedAt: "4h ago", status: "pending" },
  { id: 3, name: "Theo Larsen", initials: "TL", email: "theo@student.edu", code: "GEN-7X2Q", course: "Advanced Genetics", requestedAt: "1d ago", status: "pending" },
];

const INITIAL_CHAT: ChatMessage[] = [
  { role: "user", text: "Can you explain the difference between mitosis and meiosis?" },
  {
    role: "ai",
    text: "Great question! Both are processes of cell division, but they serve different purposes:\n\n**Mitosis** produces two genetically identical diploid daughter cells — used for growth and repair in somatic cells.\n\n**Meiosis** produces four genetically unique haploid cells (gametes) — used for sexual reproduction, and introduces variation through crossing over during Prophase I.",
    citations: ["Chapter 12 — Cell Division", "Lecture Notes: Week 4"],
    misconception: null,
  },
  { role: "user", text: "So meiosis just splits the DNA in half?" },
  {
    role: "ai",
    text: "That's a common misconception worth addressing. Meiosis doesn't simply cut the DNA in half — it's a two-stage process.\n\nIt involves **two sequential divisions** (Meiosis I and II). During Prophase I, homologous chromosomes pair up and exchange segments via **crossing over**, actively creating new genetic combinations — not just splitting existing ones.\n\nThe result: 4 cells with half the chromosome count AND reshuffled genetic content.",
    citations: ["Chapter 12 — Cell Division", "Supplementary: Genetic Variation"],
    misconception: "Misconception flagged: meiosis doesn't simply halve chromosomes — crossing over creates new allele combinations.",
  },
];

const CANNED_RESPONSES: AiMessage[] = [
  {
    role: "ai",
    text: "Based on your Biology 101 materials, this concept is addressed in Chapter 12. The key principle is that cell processes are regulated by enzyme activity and gene expression working in concert.\n\nWould you like me to generate a targeted quiz on this topic to test your understanding?",
    citations: ["Chapter 12 — Cell Division", "Supplementary Notes"],
    misconception: null,
  },
  {
    role: "ai",
    text: "Your course materials address this in the Week 5 lecture notes. The main idea is that biological systems maintain homeostasis through feedback mechanisms — both positive and negative.\n\nThis is a high-priority concept for your upcoming assessment. Want me to walk you through a practice scenario?",
    citations: ["Lecture Notes: Week 5", "Chapter 8 — Homeostasis"],
    misconception: null,
  },
];

const QUIZ = {
  total: 8, current: 3,
  topic: "Cell Division — Meiosis",
  question: "Which phase of meiosis is responsible for genetic recombination through crossing over?",
  options: ["Metaphase I", "Prophase I", "Anaphase II", "Telophase I"],
  correct: 1,
  explanation: "Crossing over occurs during **Prophase I**, when homologous chromosomes pair up (synapsis) and exchange DNA segments. This creates new allele combinations not present in either parent and is the primary source of genetic variation in sexual reproduction.",
};

const FEATURES = [
  { icon: MessageSquare, title: "Course-Grounded Q&A", desc: "Every answer comes directly from uploaded course material, with citations to the exact source document." },
  { icon: Brain, title: "Misconception Detection", desc: "AI reads between the lines of student explanations to catch where understanding breaks down — not just what's wrong." },
  { icon: Zap, title: "Adaptive Quizzes", desc: "Question sets that target each student's weak areas and recalibrate as mastery improves over time." },
  { icon: TrendingUp, title: "Progress Analytics", desc: "Granular topic-by-topic mastery tracking, visible to both students and teachers with trend data." },
  { icon: Eye, title: "Teacher Insight Reports", desc: "Class-wide misconception maps and per-student summaries, so teachers always know who needs help." },
  { icon: Shield, title: "Hallucination Guardrails", desc: "The AI only answers what the course material supports. Unsupported questions are flagged, not fabricated." },
];

const SAMPLE_FILES = [
  "Chapter 13 — Genetic Variation.pdf",
  "Lecture Slides Week 6.pdf",
  "Problem Set 3 — Answers.pdf",
  "Midterm Study Guide.pdf",
];

type Notification = {
  id: string;
  courseId: string | null;
  type: "enroll" | "flag" | "quiz" | "misconception" | "announcement";
  title: string;
  body: string;
  time: string;
  createdAt: string;
  read: boolean;
  metadata: Record<string, unknown>;
};

type NotificationRow = {
  id: string;
  course_id: string | null;
  type: Notification["type"];
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
};

const notificationFromRow = (row: NotificationRow): Notification => ({
  id: row.id,
  courseId: row.course_id,
  type: row.type,
  title: row.title,
  body: row.body,
  time: relativeTime(row.created_at),
  createdAt: row.created_at,
  read: Boolean(row.read_at),
  metadata: row.metadata ?? {},
});

function relativeTime(value: string): string {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString();
}

const STUDENT_QUIZ_TREND = [
  { week: "Wk 1", score: 52 },
  { week: "Wk 2", score: 58 },
  { week: "Wk 3", score: 54 },
  { week: "Wk 4", score: 63 },
  { week: "Wk 5", score: 61 },
  { week: "Wk 6", score: 70 },
  { week: "Wk 7", score: 74 },
  { week: "Wk 8", score: 82 },
];

const STUDENT_CHAT_SAMPLE: ChatMessage[] = [
  { role: "user", text: "Can you explain what crossing over does exactly?" },
  { role: "ai", text: "Crossing over happens during Prophase I of meiosis. Homologous chromosomes pair up and physically exchange segments of DNA, creating new allele combinations on each chromosome.", citations: ["Chapter 12 — Cell Division"], misconception: null },
  { role: "user", text: "So the chromosomes break?" },
  { role: "ai", text: "They do break and rejoin, but it's tightly controlled by enzymes. The key misconception to avoid: the breaks are not random damage — they're deliberate recombination events that produce new genetic variation.", citations: ["Chapter 12 — Cell Division"], misconception: "Misconception flagged: chromosomal breaks in crossing over are enzymatically controlled recombination, not damage." },
];

type TeacherCourse = {
  id: string;
  name: string;
  code: string;
  students: number;
  subject: string;
  description: string | null;
  color: string;
  created_at: string;
};

type CourseRow = {
  id: string;
  name: string;
  subject: string;
  description: string | null;
  enrollment_code: string;
  created_at: string;
};

const courseFromRow = (row: CourseRow): TeacherCourse => ({
  id: row.id,
  name: row.name,
  code: row.enrollment_code,
  students: 0,
  subject: row.subject,
  description: row.description,
  color: "bg-emerald-500",
  created_at: row.created_at,
});


const INITIAL_ANNOUNCEMENTS: Announcement[] = [
  { id: "demo-1", title: "Midterm exam — Chapter 10–14 in scope", body: "The midterm on July 18 will cover all material from Chapters 10 through 14.", course: "Biology 101", createdAt: "2h ago", pinned: true },
];

const MISCONCEPTION_LOG: MisconceptionEntry[] = [
  { id: 1, student: "Liam Torres", initials: "LT", topic: "Protein Synthesis", misconception: "Treats transcription and translation as a single step — conflates mRNA with the final protein.", flaggedAt: "Today, 11:24 AM", status: "open" },
  { id: 2, student: "Sofia Reyes", initials: "SR", topic: "Cell Division", misconception: "Believes meiosis and mitosis produce the same number and type of daughter cells.", flaggedAt: "Today, 9:03 AM", status: "open" },
  { id: 3, student: "Marcus Webb", initials: "MW", topic: "Genetics", misconception: "Conflates dominant allele with 'more common in the population' — frequency vs. dominance confusion.", flaggedAt: "Yesterday, 2:15 PM", status: "open" },
  { id: 4, student: "Amara Osei", initials: "AO", topic: "DNA Replication", misconception: "Thought the new strand replaces the original rather than understanding the semi-conservative model.", flaggedAt: "Jun 28, 10:40 AM", status: "addressed" },
  { id: 5, student: "Kai Yamamoto", initials: "KY", topic: "Cell Division", misconception: "Confused crossing over timing — thought it happens in Metaphase I rather than Prophase I.", flaggedAt: "Jun 27, 3:55 PM", status: "addressed" },
  { id: 6, student: "Priya Nair", initials: "PN", topic: "Evolution", misconception: "Described natural selection as organisms 'wanting' to adapt — teleological framing.", flaggedAt: "Jun 25, 11:00 AM", status: "addressed" },
];

const STUDENT_QUIZ_HISTORY: QuizAttempt[] = [
  { id: 1, date: "Jul 9", topic: "Cell Division — Meiosis", score: 3, total: 4, duration: "4m 12s" },
  { id: 2, date: "Jul 7", topic: "Genetics — Inheritance", score: 2, total: 4, duration: "5m 48s" },
  { id: 3, date: "Jul 5", topic: "Protein Synthesis", score: 3, total: 4, duration: "3m 55s" },
  { id: 4, date: "Jul 2", topic: "DNA Replication", score: 4, total: 4, duration: "4m 01s" },
  { id: 5, date: "Jun 30", topic: "Cell Division — Mitosis", score: 2, total: 4, duration: "6m 20s" },
  { id: 6, date: "Jun 28", topic: "Evolution & Natural Selection", score: 3, total: 4, duration: "4m 44s" },
  { id: 7, date: "Jun 26", topic: "Ecology — Biomes", score: 4, total: 4, duration: "3m 15s" },
  { id: 8, date: "Jun 24", topic: "Cell Biology — Organelles", score: 2, total: 4, duration: "5m 33s" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────

function statusStyle(s: string) {
  if (s === "excelling") return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (s === "struggling") return "text-red-700 bg-red-50 border-red-200";
  return "text-blue-700 bg-blue-50 border-blue-200";
}

function barColor(p: number) {
  if (p >= 80) return "bg-emerald-500";
  if (p >= 60) return "bg-amber-500";
  return "bg-red-500";
}

function CourseCitationList({ courseId, citations, darkMode }: {
  courseId: string;
  citations: Array<SourceCitation | string>;
  darkMode: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <Suspense fallback={<p role="status" className="text-xs text-muted-foreground">Loading sources…</p>}>
        {citations.map((citation, index) => (
          <CitationPreview key={index} courseId={courseId} citation={citation} darkMode={darkMode} />
        ))}
      </Suspense>
    </div>
  );
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className}`} />;
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-1 py-2">
      {[0, 1, 2].map(i => (
        <motion.div key={i} className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50"
          animate={{ opacity: [0.3, 1, 0.3], y: [0, -4, 0] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.18, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border shadow-lg rounded-lg px-4 py-3 min-w-[120px]">
      <div className="font-mono text-xs text-muted-foreground mb-2">{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color || p.fill }} />
          <span className="text-sm font-semibold text-foreground">{p.value}%</span>
        </div>
      ))}
    </div>
  );
}

// ─── Upload Modal ─────────────────────────────────────────────────────────

function UploadModal({ onClose, onUploaded, onProcessed, courseId, courseName, userId }: {
  onClose: () => void;
  onUploaded: (doc: UploadedDoc) => void;
  onProcessed: (id: string, status: "ready" | "error", pages?: number) => void;
  courseId: string;
  courseName: string;
  userId: string;
}) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState<{ name: string; progress: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadFile = useCallback(async (file: File) => {
    if (!supabase) return;
    if (file.size > 50 * 1024 * 1024) {
      toast.error("Files must be 50 MB or smaller.");
      return;
    }
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "bin";
    const storagePath = `${courseId}/${userId}/${crypto.randomUUID()}.${extension}`;
    setUploading({ name: file.name, progress: 20 });
    const { error: uploadError } = await supabase.storage.from("course-materials").upload(storagePath, file, {
      contentType: file.type || undefined,
      upsert: false,
    });
    if (uploadError) {
      setUploading(null);
      toast.error(uploadError.message);
      return;
    }
    setUploading({ name: file.name, progress: 75 });
    const { data, error: rowError } = await supabase.from("materials").insert({
      course_id: courseId,
      uploaded_by: userId,
      title: file.name,
      storage_path: storagePath,
      mime_type: file.type || "application/octet-stream",
      byte_size: file.size,
      status: "uploaded",
    }).select("id, title, storage_path, mime_type, byte_size, page_count, status, created_at").single();
    if (rowError) {
      await supabase.storage.from("course-materials").remove([storagePath]);
      setUploading(null);
      toast.error(rowError.message);
      return;
    }
    const material = data as { id: string; title: string; storage_path: string; mime_type: string; byte_size: number; created_at: string };
    const uploadedDoc: UploadedDoc = {
      id: material.id,
      name: material.title,
      size: material.byte_size > 1024 * 1024 ? `${(material.byte_size / 1024 / 1024).toFixed(1)} MB` : `${Math.round(material.byte_size / 1024)} KB`,
      type: extension,
      status: "processing",
      progress: 100,
      uploadedAt: new Date(material.created_at).toLocaleDateString(),
      storagePath: material.storage_path,
    };
    onUploaded(uploadedDoc);
    setUploading(null);
    onClose();
    toast.success(`"${file.name}" uploaded; extracting content now`);
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      onProcessed(material.id, "error");
      toast.error("Sign in again to process this document.");
      return;
    }
    try {
      const result = await api.processMaterial(material.id, sessionData.session.access_token);
      onProcessed(material.id, "ready", result.pages);
      toast.success(`Document ready: ${result.pages} pages and ${result.chunks} searchable chunks`);
    } catch (error) {
      onProcessed(material.id, "error");
      toast.error(error instanceof Error ? error.message : "Document processing failed.");
    }
  }, [courseId, userId, onClose, onUploaded, onProcessed]);

  const handleFiles = (files: FileList | null) => {
    if (!files?.length) return;
    void uploadFile(files[0]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg p-6"
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="font-semibold text-foreground text-lg">Upload Course Material</h2>
            <p className="text-sm text-muted-foreground font-light mt-0.5">{courseName} · PDF, DOCX, PPTX up to 50 MB</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg transition-colors text-muted-foreground">
            <X size={16} />
          </button>
        </div>

        {uploading ? (
          <div className="py-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <File size={18} className="text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground truncate">{uploading.name}</div>
                <div className="text-xs text-muted-foreground font-light mt-0.5">
                  {uploading.progress < 100 ? "Uploading…" : "Processing with OCR…"}
                </div>
              </div>
              <span className="font-mono text-sm text-muted-foreground tabular-nums shrink-0">
                {Math.round(uploading.progress)}%
              </span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <motion.div className="h-full bg-primary rounded-full"
                animate={{ width: `${uploading.progress}%` }}
                transition={{ duration: 0.15, ease: "linear" }}
              />
            </div>
          </div>
        ) : (
          <>
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
              onClick={() => inputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all mb-5 ${dragging ? "border-primary bg-primary/5 scale-[1.01]" : "border-border hover:border-primary/40 hover:bg-muted/30"}`}
            >
              <input ref={inputRef} type="file" accept=".pdf,.docx,.pptx" className="hidden"
                onChange={e => handleFiles(e.target.files)} />
              <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
                <Upload size={22} className={dragging ? "text-primary" : "text-muted-foreground"} />
              </div>
              <p className="text-sm font-medium text-foreground mb-1">
                {dragging ? "Drop to upload" : "Drag & drop your file here"}
              </p>
              <p className="text-xs text-muted-foreground font-light">or click to browse</p>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}

// ─── Teacher Materials ────────────────────────────────────────────────────

function TeacherMaterials({ docs, setDocs, onUploadClick, onViewDoc, courseName }: {
  docs: UploadedDoc[];
  setDocs: React.Dispatch<React.SetStateAction<UploadedDoc[]>>;
  onViewDoc: (doc: UploadedDoc) => void;
  onUploadClick: () => void;
  courseName: string;
}) {
  const removeDocument = async (doc: UploadedDoc) => {
    if (!supabase || typeof doc.id !== "string") return;
    const { error } = await supabase.from("materials").delete().eq("id", doc.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (doc.storagePath) await supabase.storage.from("course-materials").remove([doc.storagePath]);
    setDocs(previous => previous.filter(item => item.id !== doc.id));
    toast.success("Document removed");
  };

  const docStatusBadge = (s: UploadedDoc["status"]) => {
    if (s === "ready") return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
        <CheckCircle size={10} />Ready
      </span>
    );
    if (s === "processing") return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
        <RefreshCw size={10} className="animate-spin" />Processing
      </span>
    );
    if (s === "uploading") return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
        <Upload size={10} />Uploading
      </span>
    );
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
        <AlertCircle size={10} />Error
      </span>
    );
  };

  const readyDocs = docs.filter(d => d.status === "ready");
  const totalPages = readyDocs.reduce((a, d) => a + (d.pages ?? 0), 0);
  const inProgress = docs.filter(d => d.status !== "ready" && d.status !== "error").length;

  return (
    <div>
      <div className="mb-6 flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-2xl text-primary">Course Materials</h1>
          <p className="text-sm text-muted-foreground mt-1 font-light">{courseName} — documents prepared for AI indexing</p>
        </div>
        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
          onClick={onUploadClick}
          className="flex items-center gap-2 bg-primary text-primary-foreground text-sm font-semibold px-4 py-2.5 rounded-lg shadow-sm"
        >
          <Upload size={15} />Upload Document
        </motion.button>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: "Total Documents", val: String(readyDocs.length), icon: FileText, color: "text-blue-600", bg: "bg-blue-50" },
          { label: "Pages Indexed", val: String(totalPages), icon: BookMarked, color: "text-emerald-600", bg: "bg-emerald-50" },
          { label: "Processing", val: String(inProgress), icon: RefreshCw, color: "text-amber-600", bg: "bg-amber-50" },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-5 shadow-sm">
            <div className="flex items-start justify-between mb-3">
              <span className="text-xs text-muted-foreground font-mono uppercase tracking-wide">{s.label}</span>
              <div className={`w-7 h-7 rounded-lg ${s.bg} flex items-center justify-center`}>
                <s.icon size={14} className={s.color} />
              </div>
            </div>
            <div className="font-display text-3xl text-primary">{s.val}</div>
          </div>
        ))}
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold text-foreground">Uploaded Files</h2>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Search size={13} />
            <input placeholder="Search documents…" className="text-sm bg-transparent focus:outline-none placeholder:text-muted-foreground w-36" />
          </div>
        </div>
        <div>
          <AnimatePresence initial={false}>
            {docs.map(doc => (
              <motion.div key={doc.id} layout
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.22 }}
                className="flex items-center gap-4 px-5 py-4 border-b border-border last:border-0 hover:bg-muted/20 transition-colors group cursor-pointer"
                onClick={() => doc.status === "ready" && onViewDoc(doc)}
              >
                <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
                  <FileText size={16} className="text-red-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">{doc.name}</div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs text-muted-foreground font-light">{doc.size}</span>
                    {doc.status === "ready" && doc.pages && (
                      <span className="text-xs text-muted-foreground font-light">{doc.pages} pages</span>
                    )}
                    <span className="text-xs text-muted-foreground font-light">· {doc.uploadedAt}</span>
                  </div>
                  {(doc.status === "uploading" || doc.status === "processing") && (
                    <div className="mt-2 h-1 bg-muted rounded-full overflow-hidden w-48">
                      <motion.div className="h-full bg-primary rounded-full"
                        animate={{ width: doc.status === "processing" ? "75%" : `${doc.progress}%` }}
                        transition={{ duration: 0.3 }}
                      />
                    </div>
                  )}
                </div>
                <div className="shrink-0">{docStatusBadge(doc.status)}</div>
                <button
                  onClick={event => { event.stopPropagation(); void removeDocument(doc); }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 hover:bg-red-50 rounded-lg text-muted-foreground hover:text-red-500"
                >
                  <Trash2 size={14} />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        <div className="px-5 py-4 bg-muted/30 border-t border-border">
          <p className="text-xs text-muted-foreground font-light leading-relaxed">
            <span className="font-medium text-foreground">How indexing works: </span>
            Uploaded files are OCR-processed and chunked into retrievable segments. Students can only ask questions answerable from these documents.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Enrollment Panel ─────────────────────────────────────────────────────

function EnrollmentPanel({ requests, setRequests, focusedEnrollmentId, focusKey }: {
  requests: EnrollRequest[];
  setRequests: React.Dispatch<React.SetStateAction<EnrollRequest[]>>;
  focusedEnrollmentId?: string;
  focusKey: number;
}) {
  const { session } = useAuth();
  const pending = requests.filter(r => r.status === "pending");
  const resolved = requests.filter(r => r.status !== "pending");

  useEffect(() => {
    if (!focusedEnrollmentId) return;
    window.setTimeout(() => document.getElementById(`enrollment-${focusedEnrollmentId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  }, [focusKey, focusedEnrollmentId]);

  const resolve = async (id: number | string, action: "approved" | "denied") => {
    const r = requests.find(r => r.id === id);
    if (!r) return;
    if (typeof id === "string" && session) {
      try {
        await api.reviewEnrollment(id, action, session.access_token);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not review enrollment.");
        return;
      }
    }
    setRequests(prev => prev.map(r => r.id === id ? { ...r, status: action } : r));
    if (action === "approved") toast.success(`${r.name} approved for ${r.course}`);
    else toast(`${r.name}'s request denied`, { icon: "—" });
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        <h2 className="font-semibold text-foreground">Enrollment Requests</h2>
        {pending.length > 0 && (
          <span className="text-xs font-semibold bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
            {pending.length} pending
          </span>
        )}
      </div>
      <AnimatePresence initial={false}>
        {pending.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground font-light">
            No pending requests right now.
          </div>
        ) : pending.map(r => (
          <motion.div key={r.id} layout
            id={`enrollment-${r.id}`}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22 }}
            className={`flex items-center gap-4 px-5 py-4 border-b border-border last:border-0 hover:bg-muted/20 transition-colors flex-wrap ${String(r.id) === focusedEnrollmentId ? "bg-accent/10 ring-2 ring-inset ring-accent/40" : ""}`}
          >
            <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
              {r.initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-foreground">{r.name}</div>
              <div className="text-xs text-muted-foreground font-light">{r.email}</div>
              <div className="flex items-center gap-2 mt-1">
                <span className="font-mono text-xs bg-muted border border-border px-2 py-0.5 rounded-md">{r.code}</span>
                <span className="text-xs text-muted-foreground">→ {r.course}</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono shrink-0">
              <Clock size={11} />{r.requestedAt}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                onClick={() => void resolve(r.id, "approved")}
                className="flex items-center gap-1.5 text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 px-3 py-1.5 rounded-lg transition-colors"
              >
                <CheckSquare size={13} />Approve
              </motion.button>
              <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                onClick={() => void resolve(r.id, "denied")}
                className="flex items-center gap-1.5 text-xs font-medium bg-muted text-muted-foreground border border-border hover:bg-red-50 hover:text-red-600 hover:border-red-200 px-3 py-1.5 rounded-lg transition-colors"
              >
                <XSquare size={13} />Deny
              </motion.button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
      {resolved.length > 0 && (
        <div className="border-t border-border">
          <div className="px-5 py-2.5 text-xs font-mono text-muted-foreground uppercase tracking-wide bg-muted/30">
            Recently resolved
          </div>
          {resolved.map(r => (
            <div key={r.id} className="flex items-center gap-4 px-5 py-3 border-b border-border last:border-0 opacity-55">
              <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground shrink-0">{r.initials}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground">{r.name}</div>
                <div className="text-xs text-muted-foreground font-light">{r.course}</div>
              </div>
              <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full border ${r.status === "approved" ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-muted-foreground bg-muted border-border"}`}>
                {r.status === "approved" ? "Approved" : "Denied"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Student Enroll Tab ───────────────────────────────────────────────────

type PendingRequest = { id: string; code: string; course: string; teacher: string; createdAt: string };
type CourseLookupResult = { id: string; name: string; teacher: string; subject: string; enrollment_code: string; students: number; documents: number };

function StudentEnroll({ courses }: { courses: StudentCourse[] }) {
  const { session } = useAuth();
  const [code, setCode] = useState("");
  const [lookupState, setLookupState] = useState<"idle" | "looking" | "found" | "notfound" | "error">("idle");
  const [lookupError, setLookupError] = useState("");
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [foundCourse, setFoundCourse] = useState<CourseLookupResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const loadRequests = useCallback(async () => {
    if (!session) return;
    try {
      const rows = await api.myEnrollments(session.access_token);
      setPendingRequests(rows.filter(row => row.status === "pending").map(row => ({
        id: row.id,
        code: row.enrollment_code,
        course: row.course_name,
        teacher: row.teacher,
        createdAt: row.created_at,
      })));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load enrollment requests.");
    }
  }, [session]);

  useEffect(() => { void loadRequests(); }, [loadRequests]);

  const lookup = async () => {
    if (code.trim().length < 3 || !session) return;
    setLookupState("looking");
    setLookupError("");
    setFoundCourse(null);
    try {
      const match = await api.lookupCourse(code, session.access_token);
      setFoundCourse(match);
      setLookupState("found");
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setLookupState("notfound");
      } else {
        setLookupError(error instanceof Error ? error.message : "Course lookup is temporarily unavailable.");
        setLookupState("error");
      }
    }
  };

  const requestAccess = async () => {
    if (!foundCourse || !session) return;
    setSubmitting(true);
    try {
      await api.requestEnrollment(foundCourse.id, session.access_token);
      await loadRequests();
      setSubmitted(true);
      setCode("");
      setLookupState("idle");
      setFoundCourse(null);
      toast.success(`Request sent to ${foundCourse.teacher}`);
      setTimeout(() => setSubmitted(false), 200);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not request enrollment.");
    } finally {
      setSubmitting(false);
    }
  };

  const cancelRequest = async (request: PendingRequest) => {
    if (!session) return;
    try {
      await api.cancelEnrollment(request.id, session.access_token);
      setPendingRequests(prev => prev.filter(r => r.id !== request.id));
      toast(`Request to join ${request.course} cancelled`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not cancel the request.");
    }
  };

  const handleCodeChange = (v: string) => {
    setCode(v.toUpperCase());
    setLookupState("idle");
    setLookupError("");
    setFoundCourse(null);
  };

  return (
    <div className="p-6 lg:p-8 max-w-xl mx-auto">
      <div className="mb-8">
        <h1 className="font-display text-2xl text-primary">Join a Course</h1>
        <p className="text-sm text-muted-foreground mt-1 font-light">Enter the class code your teacher shared with you.</p>
      </div>

      {/* Code entry */}
      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm mb-5">
        <label className="text-sm font-medium text-foreground block mb-2">Class Code</label>
        <div className="flex gap-3 mb-3">
          <input
            value={code}
            onChange={e => handleCodeChange(e.target.value)}
            onKeyDown={e => e.key === "Enter" && lookupState === "idle" && void lookup()}
            placeholder="e.g. BIO-3F8K"
            className="flex-1 border border-border rounded-xl px-4 py-3 text-sm font-mono bg-background focus:outline-none focus:ring-2 focus:ring-ring tracking-widest uppercase"
          />
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
            onClick={() => void lookup()}
            disabled={code.length < 3 || lookupState === "looking" || lookupState === "found"}
            className="bg-primary text-primary-foreground px-5 py-3 rounded-xl text-sm font-semibold disabled:opacity-40 shadow-sm min-w-[100px]"
          >
            {lookupState === "looking" ? <RefreshCw size={15} className="animate-spin mx-auto" /> : "Look Up"}
          </motion.button>
        </div>

        {/* Not found error */}
        {lookupState === "notfound" && (
          <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
            className="text-xs text-red-600 flex items-center gap-1.5 mb-2">
            <AlertCircle size={12} />No course found with that code. Check for typos or ask your teacher.
          </motion.p>
        )}

        {lookupState === "error" && (
          <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
            className="text-xs text-amber-700 flex items-center gap-1.5 mb-2">
            <AlertCircle size={12} />{lookupError}
          </motion.p>
        )}

        {/* Course preview card */}
        <AnimatePresence>
          {lookupState === "found" && foundCourse && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.22 }}
            >
              <div className="mt-3 border border-emerald-200 bg-emerald-50/60 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <BookOpen size={18} className="text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-foreground">{foundCourse.name}</div>
                    <div className="text-xs text-muted-foreground font-light mt-0.5">{foundCourse.teacher} · {foundCourse.subject}</div>
                    <div className="flex gap-4 mt-2 text-xs text-muted-foreground font-light">
                      <span className="flex items-center gap-1"><Users size={11} />{foundCourse.students} students</span>
                      <span className="flex items-center gap-1"><FileText size={11} />{foundCourse.documents} documents</span>
                    </div>
                  </div>
                  <span className="text-xs font-mono text-emerald-700 bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded-md shrink-0">
                    {code.toUpperCase()}
                  </span>
                </div>
              </div>
              <div className="flex gap-3 mt-3">
                <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
                  onClick={() => void requestAccess()}
                  disabled={submitting || pendingRequests.some(r => r.code === code.toUpperCase())}
                  className="flex-1 bg-primary text-primary-foreground py-3 rounded-xl text-sm font-semibold shadow-sm disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {submitting
                    ? <><RefreshCw size={14} className="animate-spin" />Sending…</>
                    : pendingRequests.some(r => r.code === code.toUpperCase())
                    ? <><CheckCircle size={14} />Already requested</>
                    : <>Request Access to {foundCourse.name}</>}
                </motion.button>
                <button onClick={() => { setLookupState("idle"); setCode(""); setFoundCourse(null); }}
                  className="px-4 py-3 border border-border rounded-xl text-sm text-muted-foreground hover:bg-muted transition-colors">
                  Clear
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <p className="text-xs text-muted-foreground mt-3 font-light">
          Your teacher will be notified and can approve or deny your request.
        </p>
      </div>

      {/* Pending requests */}
      <AnimatePresence initial={false}>
        {pendingRequests.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-5"
          >
            <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
              <div className="px-5 py-3.5 border-b border-border flex items-center gap-2">
                <h3 className="font-semibold text-foreground text-sm">Pending Requests</h3>
                <span className="text-xs font-bold bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full">
                  {pendingRequests.length}
                </span>
              </div>
              {pendingRequests.map(r => (
                <motion.div key={r.id} layout
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="flex items-center gap-3 px-5 py-4 border-b border-border last:border-0"
                >
                  <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                    <Lock size={15} className="text-amber-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground">{r.course}</div>
                    <div className="text-xs text-muted-foreground font-light">{r.teacher} · <span className="font-mono">{r.code}</span></div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-muted-foreground font-mono flex items-center gap-1">
                      <Clock size={10} />{relativeTime(r.createdAt)}
                    </span>
                    <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                      Awaiting approval
                    </span>
                    <button onClick={() => void cancelRequest(r)}
                      className="p-1.5 hover:bg-red-50 rounded-lg text-muted-foreground hover:text-red-500 transition-colors">
                      <X size={13} />
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Enrolled courses */}
      <div className="bg-muted/50 border border-border rounded-xl p-5">
        <h3 className="text-xs font-mono uppercase tracking-wide text-muted-foreground mb-4">My Enrolled Courses</h3>
        <div className="space-y-2">
          {courses.map(c => (
            <div key={c.code} className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3.5 shadow-sm">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
                <BookOpen size={16} className="text-emerald-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground">{c.name}</div>
                <div className="text-xs text-muted-foreground font-light">{c.teacher} · <span className="font-mono">{c.code}</span></div>
              </div>
              <div className="text-right shrink-0">
                <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 justify-end">
                  <Unlock size={12} />Active
                </div>
              </div>
            </div>
          ))}
          {courses.length === 0 && <p className="text-sm text-muted-foreground">No approved courses yet. Your approved courses will appear here.</p>}
        </div>
      </div>
    </div>
  );
}

// ─── Notifications Panel ─────────────────────────────────────────────────

type NotifFilter = "all" | "unread" | "enroll" | "flags";

function NotificationsPanel({ open, onClose, notifications, setNotifications, onNavigate, accessToken }: {
  open: boolean;
  onClose: () => void;
  notifications: Notification[];
  setNotifications: React.Dispatch<React.SetStateAction<Notification[]>>;
  onNavigate: (notification: Notification) => void;
  accessToken: string;
}) {
  const [filter, setFilter] = useState<NotifFilter>("all");
  const unread = notifications.filter(n => !n.read).length;

  const markAllRead = () => {
    const previous = notifications;
    setNotifications(items => items.map(n => ({ ...n, read: true })));
    void api.markAllNotificationsRead(accessToken).catch(() => {
      setNotifications(previous);
      toast.error("Could not mark notifications as read.");
    });
  };
  const markRead = (id: string) => {
    const notification = notifications.find(item => item.id === id);
    if (!notification || notification.read) return;
    setNotifications(items => items.map(n => n.id === id ? { ...n, read: true } : n));
    void api.markNotificationRead(id, accessToken).catch(() => {
      setNotifications(items => items.map(n => n.id === id ? { ...n, read: false } : n));
      toast.error("Could not mark the notification as read.");
    });
  };
  const dismiss = (id: string) => {
    const previous = notifications;
    setNotifications(items => items.filter(n => n.id !== id));
    void api.dismissNotification(id, accessToken).catch(() => {
      setNotifications(previous);
      toast.error("Could not dismiss the notification.");
    });
  };

  const iconFor = (type: Notification["type"]) => {
    if (type === "enroll") return <Users size={13} className="text-blue-500" />;
    if (type === "flag") return <AlertCircle size={13} className="text-amber-500" />;
    if (type === "misconception") return <Brain size={13} className="text-purple-500" />;
    if (type === "announcement") return <Bell size={13} className="text-sky-500" />;
    return <Target size={13} className="text-emerald-500" />;
  };
  const bgFor = (type: Notification["type"]) => {
    if (type === "enroll") return "bg-blue-50 border-blue-100";
    if (type === "flag") return "bg-amber-50 border-amber-100";
    if (type === "misconception") return "bg-purple-50 border-purple-100";
    if (type === "announcement") return "bg-sky-50 border-sky-100";
    return "bg-emerald-50 border-emerald-100";
  };

  const FILTERS: { key: NotifFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "unread", label: "Unread" },
    { key: "enroll", label: "Enrollments" },
    { key: "flags", label: "Flags" },
  ];

  const filtered = notifications.filter(n => {
    if (filter === "unread") return !n.read;
    if (filter === "enroll") return n.type === "enroll";
    if (filter === "flags") return n.type === "flag" || n.type === "misconception";
    return true;
  });

  // Date grouping uses the stored timestamp, not the human-readable label.
  const groups: { label: string; items: typeof filtered }[] = [];
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startYesterday = startToday - 86_400_000;
  const todayItems = filtered.filter(n => new Date(n.createdAt).getTime() >= startToday);
  const yesterdayItems = filtered.filter(n => {
    const created = new Date(n.createdAt).getTime();
    return created >= startYesterday && created < startToday;
  });
  const earlierItems = filtered.filter(n => !todayItems.includes(n) && !yesterdayItems.includes(n));
  if (todayItems.length) groups.push({ label: "Today", items: todayItems });
  if (yesterdayItems.length) groups.push({ label: "Yesterday", items: yesterdayItems });
  if (earlierItems.length) groups.push({ label: "Earlier", items: earlierItems });

  return (
    <AnimatePresence>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, x: 16, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 16, scale: 0.97 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="fixed top-16 right-4 z-50 w-[420px] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            style={{ maxHeight: "min(560px, calc(100vh - 80px))" }}
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-foreground">Notifications</h2>
                {unread > 0 && (
                  <span className="text-xs font-bold bg-accent text-accent-foreground rounded-full px-1.5 py-0.5 min-w-[18px] text-center">{unread}</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {unread > 0 && (
                  <button onClick={markAllRead} className="text-xs text-muted-foreground hover:text-foreground transition-colors font-medium">
                    Mark all read
                  </button>
                )}
                <button onClick={onClose} className="p-1 hover:bg-muted rounded-lg transition-colors text-muted-foreground">
                  <X size={15} />
                </button>
              </div>
            </div>

            {/* Filter tabs */}
            <div className="px-5 py-2 border-b border-border flex gap-1 shrink-0">
              {FILTERS.map(f => {
                const count = f.key === "all" ? notifications.length
                  : f.key === "unread" ? notifications.filter(n => !n.read).length
                  : f.key === "enroll" ? notifications.filter(n => n.type === "enroll").length
                  : notifications.filter(n => n.type === "flag" || n.type === "misconception").length;
                return (
                  <button key={f.key}
                    onClick={() => setFilter(f.key)}
                    className={`relative px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      filter === f.key
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {f.label}
                    {count > 0 && f.key !== "all" && (
                      <span className={`ml-1 text-[10px] font-bold px-1 rounded-full ${
                        filter === f.key ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"
                      }`}>{count}</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* List */}
            <div className="overflow-y-auto flex-1">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-14 px-6 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center mb-3">
                    <Bell size={20} className="text-muted-foreground/50" />
                  </div>
                  <p className="text-sm font-medium text-foreground mb-1">
                    {filter === "all" ? "You're all caught up!" : `No ${filter === "unread" ? "unread" : filter === "enroll" ? "enrollment" : "flagged"} notifications`}
                  </p>
                  <p className="text-xs text-muted-foreground font-light">
                    {filter === "all" ? "New alerts will appear here." : "Try switching to a different filter."}
                  </p>
                </div>
              ) : (
                groups.map((group, gi) => (
                  <div key={group.label}>
                    <div className="px-5 pt-3 pb-1.5">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60">{group.label}</span>
                    </div>
                    <AnimatePresence initial={false}>
                      {group.items.map(n => (
                        <motion.div key={n.id} layout
                          exit={{ opacity: 0, height: 0, overflow: "hidden" }}
                          transition={{ duration: 0.18 }}
                          onClick={() => { markRead(n.id); onNavigate(n); onClose(); }}
                          className={`flex gap-3 px-5 py-3.5 border-b border-border last:border-0 cursor-pointer hover:bg-muted/30 transition-colors group ${!n.read ? "bg-accent/5" : ""}`}
                        >
                          <div className={`w-8 h-8 rounded-xl border ${bgFor(n.type)} flex items-center justify-center shrink-0 mt-0.5`}>
                            {iconFor(n.type)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-1 mb-0.5">
                              <span className={`text-sm font-medium leading-snug ${!n.read ? "text-foreground" : "text-muted-foreground"}`}>
                                {n.title}
                              </span>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {!n.read && <div className="w-1.5 h-1.5 rounded-full bg-accent mt-1" />}
                                <button
                                  onClick={e => { e.stopPropagation(); dismiss(n.id); }}
                                  className="p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-muted text-muted-foreground"
                                >
                                  <X size={11} />
                                </button>
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground font-light leading-relaxed">{n.body}</p>
                            <div className="flex items-center mt-1.5">
                              <span className="text-[10px] text-muted-foreground/60 font-mono">{n.time}</span>
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                    {gi < groups.length - 1 && <div className="h-px bg-border mx-5 my-1" />}
                  </div>
                ))
              )}
            </div>

            <div className="px-5 py-3 border-t border-border bg-muted/30 shrink-0">
              <p className="text-xs text-muted-foreground font-light text-center">
                Select a notification to open its related record.
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── Student Insight Drawer ───────────────────────────────────────────────

type StudentRecord = typeof STUDENTS[number];

function StudentInsightDrawer({ student, onClose }: {
  student: StudentRecord | null;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const [savedNote, setSavedNote] = useState("");
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => { setSavedNote(""); setNote(""); setChatOpen(false); }, [student]);

  if (!student) return null;

  const quizHistory = [
    { topic: "Cell Division — Basics", score: 72, date: "Jun 10", questions: 8 },
    { topic: "Meiosis — Phases", score: student.progress < 60 ? 41 : 65, date: "Jun 14", questions: 8 },
    { topic: "Protein Synthesis", score: student.progress < 60 ? 38 : 58, date: "Jun 18", questions: 10 },
    { topic: "Genetics — Mendelian", score: student.progress < 60 ? 44 : 70, date: "Jun 22", questions: 8 },
    { topic: "DNA Replication", score: student.progress < 60 ? 55 : 78, date: "Jun 26", questions: 8 },
  ];

  return (
    <AnimatePresence>
      {student && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 260 }}
            className="fixed inset-y-0 right-0 z-50 w-full max-w-xl bg-background border-l border-border flex flex-col shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center gap-4 px-6 py-5 border-b border-border bg-card">
              <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold shrink-0">
                {student.initials}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="font-display text-xl text-primary">{student.name}</h2>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full border capitalize ${statusStyle(student.status)}`}>{student.status}</span>
                  <span className="text-xs text-muted-foreground font-light">Biology 101 · {student.quizzes} quizzes taken</span>
                </div>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg transition-colors text-muted-foreground shrink-0">
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* Mastery overview */}
              <div className="px-6 pt-6 pb-4">
                <div className="grid grid-cols-3 gap-3 mb-6">
                  {[
                    { label: "Overall Mastery", val: `${student.progress}%`, color: barColor(student.progress) },
                    { label: "Quizzes Taken", val: String(student.quizzes), color: "bg-blue-500" },
                    { label: "Weak Topics", val: String(student.weak.length || "None"), color: student.weak.length ? "bg-red-500" : "bg-emerald-500" },
                  ].map(s => (
                    <div key={s.label} className="bg-muted/50 border border-border rounded-xl p-4 text-center">
                      <div className="font-display text-2xl text-primary">{s.val}</div>
                      <div className="text-xs text-muted-foreground mt-1 font-light">{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* Quiz score trend */}
                <div className="bg-card border border-border rounded-xl p-5 mb-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-4">
                    <LineChart size={14} className="text-muted-foreground" />
                    <h3 className="font-semibold text-foreground text-sm">Quiz Score Trend</h3>
                  </div>
                  <ResponsiveContainer width="100%" height={140}>
                    <AreaChart data={STUDENT_QUIZ_TREND.map(d => ({ ...d, score: d.score + (student.progress - 68) * 0.3 }))}>
                      <defs>
                        <linearGradient id="studentGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#1C2B4A" stopOpacity={0.1} />
                          <stop offset="95%" stopColor="#1C2B4A" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(17,24,39,0.05)" vertical={false} />
                      <XAxis dataKey="week" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} domain={[30, 100]} tickFormatter={(v: number) => `${v}%`} />
                      <Tooltip content={<ChartTooltip />} />
                      <Area type="monotone" dataKey="score" stroke="#1C2B4A" strokeWidth={2} fill="url(#studentGrad)"
                        dot={{ fill: "#1C2B4A", r: 2.5, strokeWidth: 0 }} activeDot={{ r: 4, fill: "#E8A020", strokeWidth: 0 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                {/* Quiz history */}
                <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm mb-4">
                  <div className="px-5 py-3.5 border-b border-border">
                    <h3 className="font-semibold text-foreground text-sm">Recent Quizzes</h3>
                  </div>
                  {quizHistory.map((q, i) => (
                    <div key={i} className="flex items-center gap-4 px-5 py-3 border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">{q.topic}</div>
                        <div className="text-xs text-muted-foreground font-light mt-0.5">{q.date} · {q.questions} questions</div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${barColor(q.score)}`} style={{ width: `${q.score}%` }} />
                        </div>
                        <span className={`font-mono text-sm font-bold tabular-nums ${q.score < 60 ? "text-red-600" : q.score < 75 ? "text-amber-600" : "text-emerald-600"}`}>
                          {q.score}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Weak topics */}
                {student.weak.length > 0 && (
                  <div className="bg-red-50 border border-red-100 rounded-xl p-4 mb-4">
                    <h3 className="font-semibold text-foreground text-sm mb-3 flex items-center gap-2">
                      <AlertCircle size={14} className="text-red-500" />Identified Weak Areas
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {student.weak.map(w => (
                        <span key={w} className="text-xs bg-red-100 text-red-700 border border-red-200 px-2.5 py-1 rounded-full font-medium">{w}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recent Q&A */}
                <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm mb-4">
                  <button
                    onClick={() => setChatOpen(v => !v)}
                    className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-muted/20 transition-colors"
                  >
                    <h3 className="font-semibold text-foreground text-sm flex items-center gap-2">
                      <MessageCircle size={14} className="text-muted-foreground" />Recent Q&A History
                    </h3>
                    {chatOpen ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
                  </button>
                  <AnimatePresence initial={false}>
                    {chatOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.22 }}
                        className="overflow-hidden"
                      >
                        <div className="px-5 pb-4 space-y-3 border-t border-border pt-4">
                          {STUDENT_CHAT_SAMPLE.map((msg, i) => (
                            <div key={i} className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                              <div className={`rounded-xl px-3 py-2 text-xs leading-relaxed max-w-[80%] ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
                                {renderText(msg.text)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Teacher note */}
                <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                  <h3 className="font-semibold text-foreground text-sm mb-3 flex items-center gap-2">
                    <StickyNote size={14} className="text-muted-foreground" />Teacher Note
                  </h3>
                  {savedNote ? (
                    <div>
                      <p className="text-sm text-foreground font-light leading-relaxed bg-amber-50 border border-amber-100 rounded-lg px-4 py-3">{savedNote}</p>
                      <button onClick={() => setSavedNote("")} className="text-xs text-muted-foreground hover:text-foreground mt-2 transition-colors">Edit note</button>
                    </div>
                  ) : (
                    <div>
                      <textarea
                        value={note}
                        onChange={e => setNote(e.target.value)}
                        placeholder={`Add a private note about ${student.name.split(" ")[0]}…`}
                        rows={3}
                        className="w-full border border-border rounded-xl px-4 py-3 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none font-light"
                      />
                      <div className="flex justify-end mt-2">
                        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                          disabled={!note.trim()}
                          onClick={() => { setSavedNote(note); setNote(""); toast.success("Note saved"); }}
                          className="text-xs font-semibold bg-primary text-primary-foreground px-4 py-2 rounded-lg disabled:opacity-40"
                        >
                          Save Note
                        </motion.button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── Landing ──────────────────────────────────────────────────────────────

function Landing({ onNavigate }: { onNavigate: (v: View, role?: "teacher" | "student") => void }) {
  return (
    <div className="min-h-screen bg-background">
      <nav className="fixed top-0 inset-x-0 z-50 bg-background/90 backdrop-blur-md border-b border-border">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <span className="font-display text-xl text-primary tracking-tight">EduBridge AI</span>
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-muted-foreground">
            <a href="#features" className="hover:text-foreground transition-colors">Features</a>
            <a href="#how-it-works" className="hover:text-foreground transition-colors">How It Works</a>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => onNavigate("auth")} className="text-sm font-medium text-foreground px-4 py-2 hover:bg-muted rounded-lg transition-colors">Sign In</button>
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
              onClick={() => onNavigate("auth", "teacher")}
              className="text-sm font-semibold bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:opacity-90 transition-opacity shadow-sm"
            >Get Started</motion.button>
          </div>
        </div>
      </nav>

      <section className="relative bg-primary text-primary-foreground pt-32 pb-28 px-6 overflow-hidden">
        <svg className="absolute inset-0 w-full h-full opacity-[0.07] pointer-events-none">
          <defs><pattern id="dots" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="1.5" fill="currentColor" /></pattern></defs>
          <rect width="100%" height="100%" fill="url(#dots)" />
        </svg>
        <div className="relative max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div>
            <span className="inline-block font-mono text-xs tracking-widest uppercase text-accent mb-6">Misconception-Aware Academic AI</span>
            <h1 className="font-display text-5xl lg:text-6xl leading-tight mb-6">Close the gap between teaching and understanding.</h1>
            <p className="text-primary-foreground/70 text-lg leading-relaxed mb-10 max-w-lg font-light">
              EduBridge AI helps students learn from course material while giving teachers real visibility into who's struggling and why.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                onClick={() => onNavigate("auth", "teacher")}
                className="group flex items-center justify-center gap-2 bg-accent text-accent-foreground font-semibold px-6 py-3.5 rounded-lg shadow-lg shadow-amber-900/20"
              >
                <GraduationCap size={18} />I'm a Teacher
                <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
              </motion.button>
              <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                onClick={() => onNavigate("auth", "student")}
                className="flex items-center justify-center gap-2 border border-primary-foreground/25 text-primary-foreground font-medium px-6 py-3.5 rounded-lg hover:bg-primary-foreground/10 transition-colors"
              >
                <BookOpen size={18} />I'm a Student
              </motion.button>
            </div>
          </div>
          <div className="hidden lg:block">
            <motion.div animate={{ y: [0, -10, 0] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}>
              <div className="bg-primary-foreground/10 backdrop-blur-sm rounded-xl p-5 border border-primary-foreground/15 shadow-2xl shadow-black/30">
                <div className="flex items-center gap-2 mb-5">
                  <div className="w-3 h-3 rounded-full bg-red-400/60" /><div className="w-3 h-3 rounded-full bg-yellow-400/60" /><div className="w-3 h-3 rounded-full bg-green-400/60" />
                  <span className="ml-2 font-mono text-xs text-primary-foreground/35">teacher dashboard</span>
                </div>
                <div className="grid grid-cols-3 gap-2 mb-4">
                  {[{ label: "Students", val: "40" }, { label: "Avg. Mastery", val: "68%" }, { label: "Flags", val: "5" }].map(s => (
                    <div key={s.label} className="bg-primary-foreground/10 rounded-lg p-3">
                      <div className="text-xl font-bold text-primary-foreground">{s.val}</div>
                      <div className="text-xs text-primary-foreground/45 font-mono mt-0.5">{s.label}</div>
                    </div>
                  ))}
                </div>
                <div className="space-y-2 mb-4">
                  {STUDENTS.slice(0, 4).map(s => (
                    <div key={s.id} className="flex items-center gap-3 bg-primary-foreground/5 rounded-lg px-3 py-2">
                      <div className="w-7 h-7 rounded-full bg-accent/25 text-accent flex items-center justify-center text-xs font-bold shrink-0">{s.initials}</div>
                      <span className="text-xs text-primary-foreground/75 flex-1 min-w-0 truncate">{s.name}</span>
                      <div className="w-16 h-1 bg-primary-foreground/10 rounded-full shrink-0">
                        <div className="h-full rounded-full bg-accent" style={{ width: `${s.progress}%` }} />
                      </div>
                      <span className="font-mono text-xs text-primary-foreground/45 shrink-0 tabular-nums">{s.progress}%</span>
                    </div>
                  ))}
                </div>
                <div className="bg-amber-500/15 border border-amber-500/25 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-xs text-amber-300 font-medium">
                    <AlertCircle size={12} className="shrink-0" />2 students struggling with Protein Synthesis
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      <section className="bg-muted border-b border-border">
        <div className="max-w-6xl mx-auto px-6 py-8 grid grid-cols-2 md:grid-cols-4 gap-8">
          {[
            { val: "94%", label: "Answer accuracy vs. source material" },
            { val: "3×", label: "Faster misconception identification" },
            { val: "40+", label: "Trackable learning topics" },
            { val: "100%", label: "Source-grounded responses" },
          ].map(s => (
            <div key={s.label}>
              <div className="font-display text-3xl text-primary mb-1">{s.val}</div>
              <div className="text-sm text-muted-foreground font-light">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="features" className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="mb-14">
            <span className="font-mono text-xs tracking-widest uppercase text-muted-foreground">Capabilities</span>
            <h2 className="font-display text-4xl text-primary mt-2">Built for how learning actually works.</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-border">
            {FEATURES.map((f, i) => (
              <motion.div key={i} whileHover={{ y: -3, boxShadow: "0 8px 24px rgba(0,0,0,0.08)" }}
                className="bg-background p-8 transition-shadow cursor-default"
              >
                <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center mb-5">
                  <f.icon size={18} className="text-accent" />
                </div>
                <h3 className="font-semibold text-foreground mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed font-light">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="bg-muted py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="mb-14">
            <span className="font-mono text-xs tracking-widest uppercase text-muted-foreground">Workflow</span>
            <h2 className="font-display text-4xl text-primary mt-2">Simple setup. Deep insight.</h2>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
            {[
              { label: "For Teachers", color: "text-accent", steps: [
                { n: "01", title: "Create a course", desc: "Name your course and receive a unique class code to share with students." },
                { n: "02", title: "Upload materials", desc: "Upload PDFs, slides, or scanned notes. OCR handles handwritten documents." },
                { n: "03", title: "Approve enrollments", desc: "Review and approve student join requests. Keep full control of your class." },
                { n: "04", title: "Monitor & act", desc: "See who's struggling, what they misunderstand, and get AI-generated suggestions." },
              ]},
              { label: "For Students", color: "text-blue-500", steps: [
                { n: "01", title: "Join your class", desc: "Enter the class code your teacher shared to request enrollment." },
                { n: "02", title: "Ask anything", desc: "Ask course-related questions and get accurate, cited answers from your materials." },
                { n: "03", title: "Take adaptive quizzes", desc: "Targeted quizzes probe your weak areas and track improvement over time." },
                { n: "04", title: "Understand your gaps", desc: "Get plain-language feedback on where your understanding falls short." },
              ]},
            ].map(col => (
              <div key={col.label}>
                <div className={`font-mono text-xs ${col.color} uppercase tracking-widest mb-6`}>{col.label}</div>
                <div className="space-y-7">
                  {col.steps.map(step => (
                    <div key={step.n} className="flex gap-5">
                      <span className="font-mono text-2xl font-bold text-foreground/15 shrink-0 w-8 tabular-nums">{step.n}</span>
                      <div>
                        <div className="font-semibold text-foreground mb-1">{step.title}</div>
                        <div className="text-sm text-muted-foreground font-light leading-relaxed">{step.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative bg-primary text-primary-foreground py-24 px-6 overflow-hidden">
        <svg className="absolute inset-0 w-full h-full opacity-[0.06] pointer-events-none">
          <defs><pattern id="dots2" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="1.5" fill="currentColor" /></pattern></defs>
          <rect width="100%" height="100%" fill="url(#dots2)" />
        </svg>
        <div className="relative max-w-2xl mx-auto text-center">
          <h2 className="font-display text-4xl mb-4">Ready to bridge the gap?</h2>
          <p className="text-primary-foreground/60 mb-10 font-light text-lg">Join teachers and students already using EduBridge AI.</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} onClick={() => onNavigate("auth", "teacher")}
              className="flex items-center justify-center gap-2 bg-accent text-accent-foreground font-semibold px-8 py-4 rounded-lg shadow-lg shadow-amber-900/20"
            >
              <GraduationCap size={18} />Start as Teacher
            </motion.button>
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} onClick={() => onNavigate("auth", "student")}
              className="flex items-center justify-center gap-2 border border-primary-foreground/25 text-primary-foreground font-medium px-8 py-4 rounded-lg hover:bg-primary-foreground/10 transition-colors"
            >
              <BookOpen size={18} />Start as Student
            </motion.button>
          </div>
        </div>
      </section>

      <footer className="border-t border-border py-8 px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between text-sm text-muted-foreground">
          <span className="font-display text-base text-primary">EduBridge AI</span>
          <span className="font-light">© 2025 EduBridge AI. All rights reserved.</span>
        </div>
      </footer>
    </div>
  );
}

// ─── Auth ─────────────────────────────────────────────────────────────────

function Auth({ role, setRole, onBack }: {
  role: "teacher" | "student"; setRole: (r: "teacher" | "student") => void;
  onBack: () => void;
}) {
  const { configured, signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [classCode, setClassCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!configured) {
      toast.error("Add the Supabase URL and publishable key to apps/web/.env first.");
      return;
    }
    if (!email.trim() || !password) {
      toast.error("Enter your email address and password.");
      return;
    }
    if (mode === "signup" && !displayName.trim()) {
      toast.error("Enter your full name.");
      return;
    }
    if (mode === "signup" && password.length < 8) {
      toast.error("Use a password with at least 8 characters.");
      return;
    }

    setSubmitting(true);
    try {
      if (mode === "login") {
        await signIn(email.trim(), password);
        toast.success("Signed in successfully.");
      } else {
        const result = await signUp({
          email: email.trim(),
          password,
          displayName: displayName.trim(),
          role,
        });
        if (classCode.trim()) {
          sessionStorage.setItem("edubridge_pending_class_code", classCode.trim().toUpperCase());
        }
        if (result.requiresEmailVerification) {
          toast.success("Account created. Check your email to verify your address.");
          setMode("login");
        } else {
          toast.success(role === "teacher" ? "Teacher account created and awaiting approval." : "Account created.");
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex">
      <div className="hidden lg:flex flex-col bg-primary text-primary-foreground w-96 p-12 shrink-0">
        <button onClick={onBack} className="text-primary-foreground/50 hover:text-primary-foreground text-sm mb-auto flex items-center gap-2 transition-colors w-fit">← Back to Home</button>
        <div>
          <span className="font-display text-2xl">EduBridge AI</span>
          <p className="text-primary-foreground/50 text-sm mt-3 leading-relaxed font-light">Misconception-aware academic support for students and teachers.</p>
        </div>
        <div className="mt-12 space-y-4">
          {["Course-grounded answers with citations", "Adaptive quizzes targeting weak areas", "Real-time misconception detection", "Class-wide insight reports for teachers"].map(f => (
            <div key={f} className="flex items-start gap-3 text-sm text-primary-foreground/60 font-light">
              <CheckCircle size={15} className="text-accent mt-0.5 shrink-0" />{f}
            </div>
          ))}
        </div>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <button onClick={onBack} className="lg:hidden text-sm text-muted-foreground hover:text-foreground mb-6 flex items-center gap-1 transition-colors">← Back</button>
          <div className="mb-8">
            <h1 className="font-display text-3xl text-primary mb-2">{mode === "signup" ? "Create your account" : "Welcome back"}</h1>
            <p className="text-muted-foreground text-sm font-light">{mode === "signup" ? "Join EduBridge AI to get started." : "Sign in to continue."}</p>
          </div>
          <div className="flex bg-muted rounded-lg p-1 mb-6 gap-1">
            {(["teacher", "student"] as const).map(r => (
              <button key={r} onClick={() => setRole(r)} className={`relative flex-1 py-2 text-sm font-medium rounded-md transition-colors capitalize ${role === r ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                {role === r && <motion.div layoutId="auth-role-indicator" className="absolute inset-0 bg-card shadow-sm rounded-md" transition={{ type: "spring", bounce: 0.2, duration: 0.35 }} />}
                <span className="relative z-10">{r === "teacher" ? "🎓 Teacher" : "📚 Student"}</span>
              </button>
            ))}
          </div>
          <div className="space-y-4 mb-6">
            {mode === "signup" && (
              <div>
                <label className="text-sm font-medium text-foreground block mb-1.5">Full name</label>
                <input value={displayName} onChange={e => setDisplayName(e.target.value)} autoComplete="name" className="w-full border border-border rounded-lg px-3.5 py-2.5 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring" placeholder={role === "teacher" ? "Dr. Sarah Chen" : "Amara Osei"} />
              </div>
            )}
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5">Email address</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" className="w-full border border-border rounded-lg px-3.5 py-2.5 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring" placeholder={role === "teacher" ? "sarah@university.edu" : "amara@student.edu"} />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5">Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} onKeyDown={e => { if (e.key === "Enter") void submit(); }} className="w-full border border-border rounded-lg px-3.5 py-2.5 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring" placeholder="••••••••" />
            </div>
            <AnimatePresence>
              {mode === "signup" && role === "student" && (
                <motion.div initial={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}>
                  <label className="text-sm font-medium text-foreground block mb-1.5">Class code <span className="text-muted-foreground font-normal">(optional)</span></label>
                  <input value={classCode} onChange={e => setClassCode(e.target.value)} className="w-full border border-border rounded-lg px-3.5 py-2.5 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring font-mono" placeholder="BIO-3F8K" />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {!configured && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs text-amber-800">
              Authentication setup is incomplete. Add your Supabase project URL and publishable key to <span className="font-mono">apps/web/.env</span>.
            </div>
          )}
          <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }} onClick={() => void submit()} disabled={submitting}
            className="w-full bg-primary text-primary-foreground font-semibold py-3 rounded-lg shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? "Please wait…" : mode === "signup" ? `Create ${role} account` : "Sign in"}
          </motion.button>
          <p className="text-center text-sm text-muted-foreground mt-5 font-light">
            {mode === "signup" ? "Already have an account?" : "Don't have an account?"}{" "}
            <button onClick={() => setMode(mode === "signup" ? "login" : "signup")} className="text-accent font-medium hover:underline">
              {mode === "signup" ? "Sign in" : "Sign up"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────

function Sidebar<T extends string>({
  title, subtitle, initials, name, role, items, activeTab, setTab, onLogout, open, setOpen, extra,
}: {
  title: string; subtitle: string; initials: string; name: string; role: string;
  items: { id: T; label: string; icon: React.ElementType; badge?: number }[];
  activeTab: T; setTab: (t: T) => void; onLogout: () => void;
  open: boolean; setOpen: (v: boolean) => void; extra?: React.ReactNode;
}) {
  return (
    <>
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 bg-primary text-primary-foreground flex flex-col transition-transform duration-300 lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="p-6 border-b border-primary-foreground/10">
          <span className="font-display text-xl">{title}</span>
          <div className="mt-1 text-xs text-primary-foreground/40 font-mono">{subtitle}</div>
        </div>
        {extra}
        <nav className="flex-1 p-4 space-y-0.5">
          {items.map(item => (
            <button key={item.id} onClick={() => { setTab(item.id); setOpen(false); }}
              className="relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              {activeTab === item.id && (
                <motion.div layoutId={`${title}-nav`} className="absolute inset-0 bg-primary-foreground/15 rounded-lg"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.35 }} />
              )}
              <item.icon size={16} className={`relative z-10 transition-colors ${activeTab === item.id ? "text-primary-foreground" : "text-primary-foreground/50"}`} />
              <span className={`relative z-10 flex-1 text-left transition-colors ${activeTab === item.id ? "text-primary-foreground" : "text-primary-foreground/60"}`}>
                {item.label}
              </span>
              {item.badge != null && item.badge > 0 && (
                <span className="relative z-10 text-xs font-bold bg-accent text-accent-foreground rounded-full w-4 h-4 flex items-center justify-center shrink-0">
                  {item.badge}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-primary-foreground/10">
          <div className="flex items-center gap-3 mb-3 px-1">
            <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-accent-foreground text-xs font-bold shrink-0">{initials}</div>
            <div className="min-w-0">
              <div className="text-sm font-medium text-primary-foreground truncate">{name}</div>
              <div className="text-xs text-primary-foreground/40 capitalize">{role}</div>
            </div>
          </div>
          <button onClick={onLogout} className="w-full flex items-center gap-2 text-xs text-primary-foreground/40 hover:text-primary-foreground/80 transition-colors px-1 py-1">
            <LogOut size={13} />Sign out
          </button>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}
    </>
  );
}

// ─── Teacher Dashboard ────────────────────────────────────────────────────

function TeacherDashboard({ onLogout, darkMode, setDarkMode }: { onLogout: () => void; darkMode: boolean; setDarkMode: (v: boolean) => void }) {
  const { profile, user, session } = useAuth();
  const [tab, setTab] = useState<TeacherTab>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [courseCreateOpen, setCourseCreateOpen] = useState(false);
  const [courseMenuOpen, setCourseMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<TeacherCourse | null>(null);
  const [coursesLoading, setCoursesLoading] = useState(true);
  const [docs, setDocs] = useState<UploadedDoc[]>([]);
  const [requests, setRequests] = useState<EnrollRequest[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [viewingDoc, setViewingDoc] = useState<UploadedDoc | null>(null);
  const [notificationFocus, setNotificationFocus] = useState<{
    key: number;
    courseId?: string;
    enrollmentId?: string;
    studentId?: string;
    misconceptionId?: string;
    attemptId?: string;
  }>({ key: 0 });
  const courseId = selectedCourse?.id;
  const accessToken = session?.access_token ?? "";
  const analyticsScope = courseId && session ? `${session.user.id}:${courseId}` : null;
  const loadAnalytics = useCallback(
    (signal: AbortSignal) => api.teacherCourseAnalytics(courseId!, accessToken, signal),
    [courseId, accessToken],
  );
  const { data: courseAnalytics, loading: analyticsLoading, refresh: refreshAnalytics } =
    useScopedQuery(analyticsScope, loadAnalytics, "Could not load course analytics.");
  const activeFocus: typeof notificationFocus =
    notificationFocus.courseId === courseId ? notificationFocus : { key: 0 };

  const pendingCount = requests.filter(r => r.status === "pending").length;
  const unreadCount = notifications.filter(n => !n.read).length;

  const loadCourses = useCallback(async () => {
    if (!supabase || !user) return;
    setCoursesLoading(true);
    const { data, error } = await supabase
      .from("courses")
      .select("id, name, subject, description, enrollment_code, created_at")
      .eq("teacher_id", user.id)
      .is("archived_at", null)
      .order("created_at", { ascending: false });
    setCoursesLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const loaded = ((data ?? []) as CourseRow[]).map(courseFromRow);
    setCourses(loaded);
    setSelectedCourse(current => loaded.find(course => course.id === current?.id) ?? loaded[0] ?? null);
  }, [user]);

  useEffect(() => {
    void loadCourses();
  }, [loadCourses]);

  const loadEnrollmentRequests = useCallback(async () => {
    if (!session) return;
    const rows = await api.teacherEnrollments(session.access_token);
    setRequests(rows.map(row => ({
        id: row.id,
        name: row.student_name,
        initials: initialsFor(row.student_name),
        email: "",
        code: row.enrollment_code,
        course: row.course_name,
        requestedAt: new Date(row.created_at).toLocaleDateString(),
        status: row.status,
      })));
  }, [session]);

  useEffect(() => {
    void loadEnrollmentRequests().catch(error => toast.error(error instanceof Error ? error.message : "Could not load enrollment requests."));
  }, [loadEnrollmentRequests]);

  useEffect(() => {
    if (!session) return;
    void api.notifications(session.access_token).then(rows => {
      setNotifications(rows.map(notificationFromRow));
    }).catch(error => toast.error(error instanceof Error ? error.message : "Could not load notifications."));
  }, [session]);

  useEffect(() => {
    if (!supabase || !user || !session) return;
    const realtimeClient = supabase;
    const channel = realtimeClient
      .channel(`teacher-notifications-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `recipient_id=eq.${user.id}`,
        },
        payload => {
          const incoming = notificationFromRow(payload.new as NotificationRow);
          setNotifications(current => current.some(item => item.id === incoming.id) ? current : [incoming, ...current]);
          toast(incoming.title, { description: incoming.body });
          if (incoming.type === "enroll") {
            void loadEnrollmentRequests().catch(() => toast.error("Could not refresh enrollment requests."));
          }
          if (courseId && incoming.courseId === courseId && ["quiz", "flag", "misconception"].includes(incoming.type)) {
            void refreshAnalytics(true);
          }
        },
      )
      .subscribe(status => {
        if (status === "CHANNEL_ERROR") toast.error("Live notifications disconnected. Refresh to reconnect.");
      });

    return () => {
      void realtimeClient.removeChannel(channel);
    };
  }, [loadEnrollmentRequests, courseId, refreshAnalytics, session, user]);

  useEffect(() => {
    if (!supabase || !selectedCourse) {
      setDocs([]);
      return;
    }
    void supabase.from("materials")
      .select("id, title, storage_path, mime_type, byte_size, page_count, status, created_at")
      .eq("course_id", selectedCourse.id)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          toast.error(error.message);
          return;
        }
        setDocs((data ?? []).map(material => ({
          id: material.id,
          name: material.title,
          size: material.byte_size > 1024 * 1024 ? `${(material.byte_size / 1024 / 1024).toFixed(1)} MB` : `${Math.round(material.byte_size / 1024)} KB`,
          type: material.mime_type,
          status: material.status === "ready" ? "ready" : material.status === "failed" ? "error" : "processing",
          progress: material.status === "ready" ? 100 : 75,
          pages: material.page_count ?? undefined,
          uploadedAt: new Date(material.created_at).toLocaleDateString(),
          storagePath: material.storage_path,
        })));
      });
  }, [selectedCourse]);

  useEffect(() => {
    if (!session || !selectedCourse) { setAnnouncements([]); return; }
    void api.announcements(selectedCourse.id, session.access_token).then(rows => {
      setAnnouncements(rows.map(row => ({ id: row.id, title: row.title, body: row.body, pinned: row.pinned, course: selectedCourse.name, createdAt: new Date(row.created_at).toLocaleString() })));
    }).catch(error => toast.error(error instanceof Error ? error.message : "Could not load announcements."));
  }, [session, selectedCourse]);

  const createCourse = async (input: {
    name: string;
    subject: string;
    description: string;
    code: string;
    topics: { name: string; weight: "high" | "medium" | "low" }[];
  }) => {
    if (!supabase || !user) throw new Error("You must be signed in to create a course.");
    const { data, error } = await supabase
      .from("courses")
      .insert({
        teacher_id: user.id,
        name: input.name.trim(),
        subject: input.subject,
        description: input.description.trim() || null,
        enrollment_code: input.code,
      })
      .select("id, name, subject, description, enrollment_code, created_at")
      .single();
    if (error) throw error;
    const course = courseFromRow(data as CourseRow);
    if (input.topics.length > 0) {
      const { error: topicsError } = await supabase.from("course_topics").insert(
        input.topics.map(topic => ({
          course_id: course.id,
          name: topic.name.trim(),
          weight: topic.weight,
        })),
      );
      if (topicsError) {
        await supabase.from("courses").delete().eq("id", course.id);
        throw topicsError;
      }
    }
    setCourses(current => [course, ...current]);
    setSelectedCourse(course);
  };

  const navItems: { id: TeacherTab; label: string; icon: React.ElementType; badge?: number }[] = [
    { id: "overview", label: "Overview", icon: Home },
    { id: "students", label: "Students", icon: Users },
    { id: "analytics", label: "Analytics", icon: BarChart2 },
    { id: "materials", label: "Materials", icon: FileText },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  const navigateFromNotification = (notification: Notification) => {
    const relatedCourse = courses.find(course => course.id === notification.courseId);
    if (relatedCourse) setSelectedCourse(relatedCourse);
    const studentId = typeof notification.metadata.student_id === "string" ? notification.metadata.student_id : undefined;
    const enrollmentId = typeof notification.metadata.enrollment_id === "string" ? notification.metadata.enrollment_id : undefined;
    const misconceptionId = typeof notification.metadata.misconception_id === "string" ? notification.metadata.misconception_id : undefined;
    const attemptId = typeof notification.metadata.attempt_id === "string" ? notification.metadata.attempt_id : undefined;
    const focus = { key: Date.now(), courseId: notification.courseId ?? courseId };

    if (notification.type === "enroll") {
      setNotificationFocus({ ...focus, enrollmentId });
      setTab("overview");
    } else if (notification.type === "misconception") {
      setNotificationFocus({ ...focus, studentId, misconceptionId });
      setTab("analytics");
    } else if (notification.type === "flag" || notification.type === "quiz") {
      setNotificationFocus({ ...focus, studentId, attemptId });
      setTab("students");
    } else {
      setNotificationFocus(focus);
      setTab("overview");
    }
  };

  return (
    <div className="min-h-screen flex bg-background">
      <Sidebar title="EduBridge AI" subtitle="Teacher Portal" initials={initialsFor(profile?.display_name)} name={profile?.display_name ?? "Teacher"} role="teacher"
        items={navItems} activeTab={tab} setTab={setTab} onLogout={onLogout} open={sidebarOpen} setOpen={setSidebarOpen} />
      <div className="flex-1 min-w-0 lg:ml-64 flex flex-col min-h-screen">
        <header className="sticky top-0 z-20 w-full min-w-0 bg-background/95 backdrop-blur-sm border-b border-border h-14 flex items-center px-4 lg:px-6 gap-3">
          <button className="lg:hidden" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
          {/* Course switcher */}
          <div className="relative hidden md:block">
            <button
              onClick={() => { setCourseMenuOpen(open => !open); setNotifOpen(false); }}
              aria-expanded={courseMenuOpen}
              className={`min-w-44 flex items-center justify-between gap-3 bg-muted border text-sm font-medium text-foreground rounded-xl pl-3 pr-2.5 py-1.5 transition-colors ${courseMenuOpen ? "border-accent ring-2 ring-accent/20" : "border-border hover:bg-muted/80"}`}
            >
              <span className="truncate">{selectedCourse?.name ?? "No courses yet"}</span>
              <ChevronDown size={13} className={`text-muted-foreground transition-transform ${courseMenuOpen ? "rotate-180" : ""}`} />
            </button>
            <AnimatePresence>
              {courseMenuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ duration: 0.16, ease: "easeOut" }}
                  className="absolute top-full left-0 mt-2 z-50 w-80 bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
                >
                  <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                    <div>
                      <h2 className="font-semibold text-foreground">Switch course</h2>
                      <p className="text-xs text-muted-foreground mt-0.5">{courses.length} {courses.length === 1 ? "course" : "courses"}</p>
                    </div>
                    <button onClick={() => setCourseMenuOpen(false)} className="p-1 hover:bg-muted rounded-lg text-muted-foreground"><X size={15} /></button>
                  </div>
                  <div className="max-h-72 overflow-y-auto py-1.5">
                    {courses.map(course => {
                      const active = selectedCourse?.id === course.id;
                      return (
                        <button
                          key={course.id}
                          onClick={() => { setSelectedCourse(course); setCourseMenuOpen(false); }}
                          className={`w-full flex items-center gap-3 px-5 py-3 text-left transition-colors ${active ? "bg-accent/8" : "hover:bg-muted/40"}`}
                        >
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                            <BookOpen size={15} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className={`text-sm font-medium truncate ${active ? "text-primary" : "text-foreground"}`}>{course.name}</div>
                            <div className="text-xs text-muted-foreground truncate">{course.subject} · <span className="font-mono">{course.code}</span></div>
                          </div>
                          {active && <CheckCircle size={16} className="text-accent shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                  <div className="px-4 py-3 border-t border-border bg-muted/30">
                    <button
                      onClick={() => { setCourseMenuOpen(false); setCourseCreateOpen(true); }}
                      className="w-full flex items-center justify-center gap-2 text-xs font-semibold text-accent hover:text-accent/80"
                    >
                      <Plus size={13} />Create a new course
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {/* Functional search */}
          <div className="flex-1 flex items-center gap-2 bg-muted/60 border border-border rounded-xl px-3 py-1.5 max-w-xs">
            <Search size={14} className="text-muted-foreground shrink-0" />
            <input
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); if (e.target.value) setTab("students"); }}
              className="text-sm bg-transparent focus:outline-none text-foreground placeholder:text-muted-foreground w-full"
              placeholder="Search students..."
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="text-muted-foreground hover:text-foreground">
                <X size={13} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
              onClick={() => setCourseCreateOpen(true)}
              className="hidden sm:flex items-center gap-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-full px-3 py-1.5 shadow-sm"
            >
              <Plus size={11} />New Course
            </motion.button>
            <button onClick={() => { setNotifOpen(v => !v); setCourseMenuOpen(false); }} className="relative p-2 hover:bg-muted rounded-lg transition-colors">
              <Bell size={16} />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 w-4 h-4 bg-accent rounded-full text-accent-foreground text-[9px] font-bold flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </button>
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold">SC</div>
          </div>
        </header>
        <main className="flex-1 min-w-0 max-w-full overflow-x-hidden p-4 sm:p-6 lg:p-8">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="min-w-0 max-w-full"
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              {coursesLoading ? (
                <div className="py-20 text-center text-sm text-muted-foreground"><RefreshCw size={20} className="mx-auto mb-3 animate-spin" />Loading courses…</div>
              ) : !selectedCourse && tab !== "settings" ? (
                <div className="max-w-lg mx-auto py-20 text-center">
                  <div className="h-14 w-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto mb-4"><BookOpen size={26} /></div>
                  <h1 className="font-display text-2xl text-foreground mb-2">Create your first course</h1>
                  <p className="text-sm text-muted-foreground mb-6">Add a course to receive an enrollment code you can share with students.</p>
                  <button onClick={() => setCourseCreateOpen(true)} className="bg-primary text-primary-foreground rounded-xl px-5 py-2.5 text-sm font-semibold inline-flex items-center gap-2"><Plus size={15} />New Course</button>
                </div>
              ) : tab === "overview" && selectedCourse ? (
                <TeacherOverview
                  requests={requests} setRequests={setRequests}
                  announcements={announcements} setAnnouncements={setAnnouncements}
                  onGoMaterials={() => setTab("materials")}
                  course={selectedCourse}
                  courses={courses}
                  onNewCourse={() => setCourseCreateOpen(true)}
                  analytics={courseAnalytics}
                  analyticsLoading={analyticsLoading}
                  teacherName={profile?.display_name ?? "Teacher"}
                  accessToken={session?.access_token ?? ""}
                  focusedEnrollmentId={activeFocus.enrollmentId}
                  focusKey={activeFocus.key}
                  onViewStudent={studentId => {
                    setNotificationFocus({ key: Date.now(), courseId, studentId });
                    setTab("students");
                  }}
                />
              ) : null}
              {tab === "students" && selectedCourse && session && <TeacherStudents key={selectedCourse.id} searchQuery={searchQuery} courseId={selectedCourse.id} courseName={selectedCourse.name} accessToken={session.access_token} analytics={courseAnalytics} loading={analyticsLoading} focusedStudentId={activeFocus.studentId} focusedAttemptId={activeFocus.attemptId} focusKey={activeFocus.key} />}
              {tab === "analytics" && selectedCourse && session && <TeacherAnalytics course={selectedCourse} analytics={courseAnalytics} loading={analyticsLoading} accessToken={session.access_token} focusedMisconceptionId={activeFocus.misconceptionId} focusKey={activeFocus.key} />}
              {tab === "materials" && selectedCourse && (
                <TeacherMaterials docs={docs} setDocs={setDocs} onUploadClick={() => setUploadOpen(true)} onViewDoc={setViewingDoc} courseName={selectedCourse.name} />
              )}
              {tab === "settings" && <TeacherSettings courses={courses} darkMode={darkMode} setDarkMode={setDarkMode} />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <AnimatePresence>
        {uploadOpen && selectedCourse && user && (
          <UploadModal
            onClose={() => setUploadOpen(false)}
            onUploaded={doc => setDocs(prev => [doc, ...prev])}
            onProcessed={(id, status, pages) => setDocs(previous => previous.map(doc => doc.id === id ? { ...doc, status, pages } : doc))}
            courseId={selectedCourse.id}
            courseName={selectedCourse.name}
            userId={user.id}
          />
        )}
        {courseCreateOpen && (
          <CourseCreateModal
            onClose={() => setCourseCreateOpen(false)}
            onCreate={createCourse}
          />
        )}
        {viewingDoc && <DocViewerModal doc={viewingDoc} onClose={() => setViewingDoc(null)} />}
      </AnimatePresence>
      <NotificationsPanel
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
        notifications={notifications}
        setNotifications={setNotifications}
        onNavigate={navigateFromNotification}
        accessToken={session?.access_token ?? ""}
      />
    </div>
  );
}

function TeacherOverview({ requests, setRequests, onGoMaterials, announcements, setAnnouncements, course, courses, onNewCourse, analytics, analyticsLoading, teacherName, accessToken, focusedEnrollmentId, focusKey, onViewStudent }: {
  requests: EnrollRequest[];
  setRequests: React.Dispatch<React.SetStateAction<EnrollRequest[]>>;
  onGoMaterials: () => void;
  announcements: Announcement[];
  setAnnouncements: React.Dispatch<React.SetStateAction<Announcement[]>>;
  course: TeacherCourse;
  courses: TeacherCourse[];
  onNewCourse: () => void;
  analytics: Awaited<ReturnType<typeof api.teacherCourseAnalytics>> | null;
  analyticsLoading: boolean;
  teacherName: string;
  accessToken: string;
  focusedEnrollmentId?: string;
  focusKey: number;
  onViewStudent: (studentId: string) => void;
}) {
  const [composing, setComposing] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [pinNew, setPinNew] = useState(false);
  const [assigningIntervention, setAssigningIntervention] = useState<string | null>(null);
  const [assignedInterventions, setAssignedInterventions] = useState<string[]>([]);
  const [workReviews, setWorkReviews] = useState<Awaited<ReturnType<typeof api.teacherWorkSubmissions>>>([]);
  const [reviewingWorkId, setReviewingWorkId] = useState<string | null>(null);
  const [copilotItem, setCopilotItem] = useState<InterventionQueueItem | null>(null);
  const [copilotDraft, setCopilotDraft] = useState<TeacherInterventionDraft | null>(null);
  const [copilotLoading, setCopilotLoading] = useState(false);
  const [copilotDueDays, setCopilotDueDays] = useState(3);

  useEffect(() => {
    if (!course.id || !accessToken) return;
    void api.teacherWorkSubmissions(course.id, accessToken)
      .then(setWorkReviews)
      .catch(() => setWorkReviews([]));
  }, [accessToken, course.id]);

  const assignPractice = async (item: NonNullable<typeof analytics>["intervention_queue"][number]) => {
    setAssigningIntervention(item.id);
    try {
      await api.assignTargetedPractice(course.id, item.student_id, item.concept, accessToken);
      setAssignedInterventions(current => current.includes(item.id) ? current : [...current, item.id]);
      toast.success(`Targeted practice assigned to ${item.student}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not assign targeted practice.");
    } finally {
      setAssigningIntervention(null);
    }
  };

  const draftIntervention = async (item: InterventionQueueItem) => {
    setCopilotItem(item);
    setCopilotDraft(null);
    setCopilotDueDays(3);
    setCopilotLoading(true);
    try {
      const draft = await api.draftTeacherIntervention(course.id, item.student_id, {
        concept: item.concept,
        reason: item.reason,
        source: item.source,
        downstream_concept: item.downstream_concept,
      }, accessToken);
      setCopilotDraft(draft);
    } catch (error) {
      setCopilotItem(null);
      toast.error(error instanceof Error ? error.message : "Could not draft an intervention.");
    } finally {
      setCopilotLoading(false);
    }
  };

  const assignCopilotDraft = async () => {
    if (!copilotItem || !copilotDraft) return;
    setAssigningIntervention(copilotItem.id);
    try {
      await api.assignTargetedPractice(
        course.id,
        copilotItem.student_id,
        copilotItem.concept,
        accessToken,
        {
          action: copilotDraft.recommended_action,
          student_message: copilotDraft.student_message,
          due_days: copilotDueDays,
        },
      );
      setAssignedInterventions(current => current.includes(copilotItem.id) ? current : [...current, copilotItem.id]);
      toast.success(`Reviewed intervention assigned to ${copilotItem.student}`);
      setCopilotItem(null);
      setCopilotDraft(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not assign this intervention.");
    } finally {
      setAssigningIntervention(null);
    }
  };

  const reviewSubmittedWork = async (id: string, decision: "approved" | "dismissed") => {
    setReviewingWorkId(id);
    try {
      await api.reviewWorkSubmission(course.id, id, decision, accessToken);
      setWorkReviews(current => current.filter(item => item.id !== id));
      toast.success(decision === "approved" ? "Misconception confirmed and added to the learner record" : "AI suggestion dismissed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not review this submission.");
    } finally {
      setReviewingWorkId(null);
    }
  };

  const postAnnouncement = async () => {
    if (!newTitle.trim() || !newBody.trim()) return;
    try {
      const row = await api.createAnnouncement(course.id, newTitle.trim(), newBody.trim(), pinNew, accessToken);
      setAnnouncements(prev => [{ id: row.id, title: row.title, body: row.body, course: course.name, createdAt: new Date(row.created_at).toLocaleString(), pinned: row.pinned }, ...prev]);
      setNewTitle(""); setNewBody(""); setPinNew(false); setComposing(false);
      toast.success("Announcement posted to " + course.name);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not post announcement.");
    }
  };

  const deleteAnnouncement = async (id: string) => {
    try {
      await api.deleteAnnouncement(course.id, id, accessToken);
      setAnnouncements(previous => previous.filter(item => item.id !== id));
      toast.success("Announcement deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete announcement.");
    }
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-display text-2xl text-primary">Welcome, {teacherName}</h1>
        <p className="text-sm text-muted-foreground mt-1 font-light">Here’s what’s happening in {course.name}.</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        {[
          { label: "Active Students", val: analyticsLoading ? "…" : String(analytics?.active_students ?? 0), sub: `in ${course.name}`, icon: Users, color: "text-blue-500", bg: "bg-blue-50" },
          { label: "Avg. Quiz Score", val: analyticsLoading ? "…" : `${analytics?.average_score ?? 0}%`, sub: "completed attempts", icon: TrendingUp, color: "text-emerald-600", bg: "bg-emerald-50" },
          { label: "Open Flags", val: analyticsLoading ? "…" : String(analytics?.open_flags ?? 0), sub: `${analytics?.overdue_study_tasks ?? 0} overdue study tasks`, icon: AlertCircle, color: "text-amber-600", bg: "bg-amber-50" },
          { label: "Quizzes Today", val: analyticsLoading ? "…" : String(analytics?.quizzes_today ?? 0), sub: "completed today", icon: Target, color: "text-purple-600", bg: "bg-purple-50" },
        ].map(s => (
          <motion.div key={s.label} whileHover={{ y: -2, boxShadow: "0 4px 16px rgba(0,0,0,0.08)" }}
            className="bg-card border border-border rounded-xl p-5 shadow-sm cursor-default transition-shadow"
          >
            <div className="flex items-start justify-between mb-4">
              <span className="text-xs text-muted-foreground font-mono uppercase tracking-wide">{s.label}</span>
              <div className={`w-7 h-7 rounded-lg ${s.bg} flex items-center justify-center`}>
                <s.icon size={14} className={s.color} />
              </div>
            </div>
            <div className="font-display text-3xl text-primary">{s.val}</div>
            <div className="text-xs text-muted-foreground mt-1.5 font-light">{s.sub}</div>
          </motion.div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-foreground">My Courses</h2>
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
              onClick={onNewCourse}
              className="flex items-center gap-1.5 text-xs font-medium text-accent bg-accent/10 hover:bg-accent/20 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Plus size={12} />New Course
            </motion.button>
          </div>
          <div className="space-y-4">
            {courses.map(c => (
              <motion.div key={c.name} whileHover={{ y: -2, boxShadow: "0 4px 16px rgba(0,0,0,0.07)" }}
                className="bg-card border border-border rounded-xl p-5 shadow-sm cursor-pointer transition-shadow"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-foreground">{c.name}</h3>
                    <span className="font-mono text-xs text-muted-foreground">{c.code}</span>
                  </div>
                  {requests.filter(request => request.course === c.name && request.status === "pending").length > 0 && (
                    <button onClick={onGoMaterials}
                      className="text-xs font-medium bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full hover:bg-amber-200 transition-colors"
                    >
                      {requests.filter(request => request.course === c.name && request.status === "pending").length} pending
                    </button>
                  )}
                </div>
                <div className="flex gap-4 text-xs text-muted-foreground mb-5 font-light">
                  <span className="flex items-center gap-1.5"><Users size={12} />{c.id === course.id ? analytics?.active_students ?? 0 : c.students} students</span>
                  <span className="flex items-center gap-1.5"><FileText size={12} />{c.id === course.id ? analytics?.document_count ?? 0 : 0} documents</span>
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-2">
                    <span className="text-muted-foreground font-light">Class avg. mastery</span>
                    <span className="font-mono font-semibold tabular-nums">{c.id === course.id ? `${analytics?.average_score ?? 0}%` : "—"}</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <motion.div className="h-full rounded-full bg-accent"
                      initial={{ width: 0 }} animate={{ width: c.id === course.id ? `${analytics?.average_score ?? 0}%` : "0%" }}
                      transition={{ duration: 0.8, ease: "easeOut" }}
                    />
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-4">
            <h2 className="font-semibold text-foreground">Enrollment Requests</h2>
          </div>
          <EnrollmentPanel requests={requests} setRequests={setRequests} focusedEnrollmentId={focusedEnrollmentId} focusKey={focusKey} />
        </div>
      </div>
      <div className="mb-10">
        <div className="flex items-end justify-between gap-4 mb-4">
          <div>
            <h2 className="font-semibold text-foreground">Teacher Intervention Queue</h2>
            <p className="text-xs text-muted-foreground mt-1">Prioritized from learning evidence without using additional AI tokens.</p>
          </div>
          <span className="text-xs font-mono text-muted-foreground">{analytics?.intervention_queue.length ?? 0} items need review</span>
        </div>
        <div className="space-y-3">
          {(analytics?.intervention_queue ?? []).map(item => (
            <div key={item.id} className="bg-card border border-border rounded-xl px-5 py-4 shadow-sm hover:border-amber-300/60 transition-colors">
              <div className="flex items-start gap-4">
                <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${item.priority === "high" ? "bg-red-500" : item.priority === "medium" ? "bg-amber-500" : "bg-blue-500"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-semibold text-sm text-foreground">{item.student}</span>
                    <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">{item.concept}</span>
                    <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${item.priority === "high" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{item.priority}</span>
                    <span className={`text-[10px] font-mono uppercase rounded-full px-2 py-0.5 ${item.source === "prerequisite_gap" ? "bg-violet-50 text-violet-700" : "text-muted-foreground"}`}>{item.source === "prerequisite_gap" ? "possible prerequisite gap" : item.source.replace("_", " ")}</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{item.reason}</p>
                  <p className="text-xs text-foreground mt-2"><span className="font-semibold">Recommended:</span> {item.recommended_action}</p>
                  {item.citations.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-3">
                      {item.citations.map((citation, index) => (
                        <span key={`${citation.document_title}-${citation.page_number}-${index}`} className="inline-flex items-center gap-1.5 text-[11px] text-primary bg-primary/8 border border-primary/15 rounded-lg px-2.5 py-1">
                          <BookMarked size={11} />
                          Read {citation.document_title}{citation.page_number ? ` · ${citation.source_kind === "slide" ? "Slide" : "Page"} ${citation.page_number}` : ""}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="shrink-0 flex flex-col items-end gap-2">
                  {item.due_at && <span className="text-[10px] font-mono text-muted-foreground flex items-center gap-1"><Clock size={10} />{new Date(item.due_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>}
                  <div className="flex gap-2">
                    <button onClick={() => onViewStudent(item.student_id)} className="text-xs font-semibold text-primary border border-border rounded-lg px-3 py-1.5 hover:bg-muted transition-colors">View student</button>
                    <button
                      onClick={() => void draftIntervention(item)}
                      disabled={item.practice_assigned || assignedInterventions.includes(item.id)}
                      className="text-xs font-semibold text-violet-700 border border-violet-200 bg-violet-50 rounded-lg px-3 py-1.5 disabled:opacity-50 flex items-center gap-1.5"
                    >
                      <Sparkles size={11} />Draft with AI
                    </button>
                    <button
                      onClick={() => void assignPractice(item)}
                      disabled={assigningIntervention === item.id || item.practice_assigned || assignedInterventions.includes(item.id)}
                      className="text-xs font-semibold bg-primary text-primary-foreground rounded-lg px-3 py-1.5 disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {assigningIntervention === item.id ? <RefreshCw size={11} className="animate-spin" /> : item.practice_assigned || assignedInterventions.includes(item.id) ? <CheckCircle size={11} /> : <Target size={11} />}
                      {item.practice_assigned || assignedInterventions.includes(item.id) ? "Assigned" : "Assign practice"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
          {!analyticsLoading && (analytics?.intervention_queue.length ?? 0) === 0 && <div className="text-sm text-muted-foreground bg-card border border-border rounded-xl p-5">No students currently require intervention.</div>}
        </div>
      </div>

      {workReviews.length > 0 && <div className="mb-10">
        <div className="flex items-end justify-between gap-4 mb-4"><div><h2 className="font-semibold text-foreground">Submitted Work Review</h2><p className="text-xs text-muted-foreground mt-1">Confirm or dismiss AI-detected misconceptions before they affect mastery.</p></div><span className="text-xs font-mono text-muted-foreground">{workReviews.length} pending</span></div>
        <div className="space-y-3">{workReviews.map(submission => {
          const analysis = submission.analysis;
          const misconception = analysis?.misconception;
          return <div key={submission.id} className="rounded-xl border border-violet-200 bg-card p-5 shadow-sm">
            <div className="flex items-start gap-4"><div className="w-9 h-9 rounded-xl bg-violet-50 text-violet-700 flex items-center justify-center shrink-0"><Pencil size={16} /></div><div className="flex-1 min-w-0"><div className="flex items-center gap-2 flex-wrap"><span className="text-sm font-semibold text-foreground">{submission.student}</span><span className="text-xs text-muted-foreground">{submission.filename}</span>{misconception?.confidence != null && <span className="text-[10px] rounded-full bg-violet-50 text-violet-700 px-2 py-0.5">{Math.round(misconception.confidence * 100)}% confidence</span>}</div><p className="text-xs text-muted-foreground mt-1">{submission.context}</p>{misconception && <div className="mt-3"><div className="text-xs font-semibold text-violet-800">Possible misconception: {misconception.concept || misconception.label}</div><p className="text-xs text-foreground mt-1">{misconception.explanation}</p>{misconception.evidence_from_student && <div className="mt-2 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground"><span className="font-semibold text-foreground">Observed evidence:</span> “{misconception.evidence_from_student}”</div>}</div>}{analysis?.citations.length ? <div className="flex flex-wrap gap-2 mt-3">{analysis.citations.map((citation, index) => <span key={`${citation.document_title}-${citation.page_number}-${index}`} className="inline-flex items-center gap-1 text-[10px] text-primary border border-primary/15 rounded-lg px-2 py-1"><BookMarked size={10} />{citation.document_title}{citation.page_number ? ` · ${citation.source_kind === "slide" ? "Slide" : "Page"} ${citation.page_number}` : ""}</span>)}</div> : null}</div><div className="shrink-0 flex gap-2"><button onClick={() => void reviewSubmittedWork(submission.id, "dismissed")} disabled={reviewingWorkId === submission.id} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground disabled:opacity-40">Dismiss</button><button onClick={() => void reviewSubmittedWork(submission.id, "approved")} disabled={reviewingWorkId === submission.id} className="rounded-lg bg-primary text-primary-foreground px-3 py-2 text-xs font-semibold disabled:opacity-40">{reviewingWorkId === submission.id ? "Saving…" : "Confirm"}</button></div></div>
          </div>;
        })}</div>
      </div>}

      {/* Announcements */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-foreground">Announcements</h2>
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
            onClick={() => setComposing(v => !v)}
            className="flex items-center gap-1.5 text-xs font-medium bg-primary text-primary-foreground px-3 py-1.5 rounded-lg shadow-sm"
          >
            <Plus size={12} />{composing ? "Cancel" : "Post Announcement"}
          </motion.button>
        </div>

        <AnimatePresence initial={false}>
          {composing && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
              className="overflow-hidden mb-4"
            >
              <div className="bg-card border border-primary/20 rounded-xl p-5 shadow-sm space-y-3">
                <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
                  placeholder="Announcement title..."
                  className="w-full border border-border rounded-xl px-4 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring font-medium" />
                <textarea value={newBody} onChange={e => setNewBody(e.target.value)}
                  rows={3} placeholder="Write your message to students in this course..."
                  className="w-full border border-border rounded-xl px-4 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none font-light" />
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                    <input type="checkbox" checked={pinNew} onChange={e => setPinNew(e.target.checked)} className="rounded" />
                    Pin to top of student feed
                  </label>
                  <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.97 }}
                    onClick={postAnnouncement} disabled={!newTitle.trim() || !newBody.trim()}
                    className="bg-primary text-primary-foreground px-4 py-2 rounded-xl text-sm font-semibold shadow-sm disabled:opacity-40 flex items-center gap-2">
                    <Send size={13} />Post to {course.name}
                  </motion.button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {announcements.length === 0 ? (
          <div className="text-center py-10 text-sm text-muted-foreground font-light border border-dashed border-border rounded-xl">
            No announcements yet. Post one to notify your students.
          </div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence initial={false}>
              {announcements.map(a => (
                <motion.div key={a.id} layout exit={{ opacity: 0, height: 0 }}
                  className={`bg-card border rounded-xl p-5 shadow-sm ${a.pinned ? "border-accent/40 bg-accent/5" : "border-border"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {a.pinned && <span className="text-[10px] font-bold text-accent uppercase tracking-widest font-mono">Pinned</span>}
                        <h3 className="font-semibold text-foreground text-sm">{a.title}</h3>
                      </div>
                      <p className="text-xs text-muted-foreground font-light leading-relaxed">{a.body}</p>
                      <div className="flex gap-3 mt-2 text-[10px] font-mono text-muted-foreground/60">
                        <span>{a.course}</span><span>·</span><span>{a.createdAt}</span>
                      </div>
                    </div>
                    <button onClick={() => void deleteAnnouncement(a.id)}
                      className="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-muted transition-colors shrink-0">
                      <X size={13} />
                    </button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      <AnimatePresence>
        {copilotItem && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[80] bg-slate-950/55 backdrop-blur-sm flex items-center justify-center p-4"
            onMouseDown={event => { if (event.target === event.currentTarget && !copilotLoading) setCopilotItem(null); }}
          >
            <motion.div initial={{ y: 18, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 18, scale: 0.98 }} className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-card border border-border shadow-2xl">
              <div className="sticky top-0 z-10 flex items-start gap-4 border-b border-border bg-card/95 backdrop-blur px-6 py-5">
                <div className="w-10 h-10 rounded-xl bg-violet-100 text-violet-700 flex items-center justify-center shrink-0"><Sparkles size={18} /></div>
                <div className="flex-1"><h2 className="font-semibold text-foreground">Teacher Intervention Copilot</h2><p className="text-xs text-muted-foreground mt-1">{copilotItem.student} · {copilotItem.concept}</p></div>
                <button onClick={() => { if (!copilotLoading) setCopilotItem(null); }} className="p-2 rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-40" disabled={copilotLoading}><X size={16} /></button>
              </div>

              {copilotLoading ? (
                <div className="py-20 text-center"><RefreshCw size={24} className="mx-auto text-violet-600 animate-spin" /><h3 className="mt-4 text-sm font-semibold text-foreground">Drafting from course evidence…</h3><p className="mt-2 text-xs text-muted-foreground">This explicit generation uses AI tokens once.</p></div>
              ) : copilotDraft ? (
                <div className="p-6 space-y-5">
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><div className="text-xs font-semibold text-amber-900">Why this was suggested</div><p className="text-xs text-amber-800 mt-1 leading-relaxed">{copilotDraft.rationale}</p></div>

                  <label className="block"><span className="text-xs font-semibold text-foreground">Editable teacher action</span><textarea rows={3} value={copilotDraft.recommended_action} onChange={event => setCopilotDraft({ ...copilotDraft, recommended_action: event.target.value })} className="mt-2 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-violet-300 resize-y" /></label>
                  <label className="block"><span className="text-xs font-semibold text-foreground">Message the student will receive</span><textarea rows={3} value={copilotDraft.student_message} onChange={event => setCopilotDraft({ ...copilotDraft, student_message: event.target.value })} className="mt-2 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-violet-300 resize-y" /></label>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="rounded-xl border border-border p-4"><h3 className="text-xs font-semibold text-foreground">Suggested talking points</h3><ul className="mt-2 space-y-2">{copilotDraft.talking_points.map((point, index) => <li key={index} className="flex gap-2 text-xs text-muted-foreground leading-relaxed"><span className="text-violet-600 font-semibold">{index + 1}.</span>{point}</li>)}</ul></div>
                    <div className="rounded-xl border border-border p-4"><h3 className="text-xs font-semibold text-foreground">Observable success check</h3><p className="mt-2 text-xs text-muted-foreground leading-relaxed">{copilotDraft.success_check}</p></div>
                  </div>

                  <div><div className="text-xs font-semibold text-foreground mb-2">Grounded in course material</div><div className="flex flex-wrap gap-2">{copilotDraft.citations.map((citation, index) => <span key={`${citation.document_title}-${citation.page_number}-${index}`} className="inline-flex items-center gap-1.5 text-[11px] text-primary border border-primary/15 rounded-lg px-2.5 py-1"><BookMarked size={11} />{citation.document_title}{citation.page_number ? ` · ${citation.source_kind === "slide" ? "Slide" : "Page"} ${citation.page_number}` : ""}</span>)}</div></div>

                  <div className="flex flex-wrap items-end justify-between gap-4 border-t border-border pt-5">
                    <label><span className="block text-xs font-semibold text-foreground mb-2">Due in</span><select value={copilotDueDays} onChange={event => setCopilotDueDays(Number(event.target.value))} className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"><option value={1}>1 day</option><option value={3}>3 days</option><option value={7}>7 days</option><option value={14}>14 days</option></select></label>
                    <div className="flex gap-2"><button onClick={() => setCopilotItem(null)} className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-foreground">Cancel</button><button onClick={() => void assignCopilotDraft()} disabled={!copilotDraft.recommended_action.trim() || !copilotDraft.student_message.trim() || assigningIntervention === copilotItem.id} className="rounded-xl bg-primary text-primary-foreground px-4 py-2.5 text-sm font-semibold flex items-center gap-2 disabled:opacity-40">{assigningIntervention === copilotItem.id ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle size={14} />}Review complete — assign</button></div>
                  </div>
                  <p className="text-[10px] text-center text-muted-foreground">AI recommends; the teacher edits and decides. Nothing is sent until you assign it.</p>
                </div>
              ) : null}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TeacherStudents({ searchQuery = "", courseId, courseName, accessToken, analytics, loading, focusedStudentId, focusedAttemptId, focusKey }: {
  searchQuery?: string;
  courseId: string;
  courseName: string;
  accessToken: string;
  analytics: Awaited<ReturnType<typeof api.teacherCourseAnalytics>> | null;
  loading: boolean;
  focusedStudentId?: string;
  focusedAttemptId?: string;
  focusKey: number;
}) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const students = (analytics?.students ?? []).map(student => ({ ...student, initials: initialsFor(student.name) }));

  useEffect(() => {
    if (focusedStudentId) setSelectedStudentId(focusedStudentId);
  }, [focusKey, focusedStudentId]);

  const filtered = students.filter(s => {
    const matchesSearch = !searchQuery || s.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || s.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-2xl text-primary">Students</h1>
          <p className="text-sm text-muted-foreground mt-1 font-light">
            {courseName} — {filtered.length} {searchQuery ? `matching "${searchQuery}"` : "enrolled"}
          </p>
        </div>
        <div className="relative">
          <button onClick={() => setStatusMenuOpen(open => !open)} aria-expanded={statusMenuOpen}
            className={`min-w-40 flex items-center justify-between gap-3 text-sm border rounded-xl px-3 py-2 bg-card text-foreground shadow-sm transition-colors ${statusMenuOpen ? "border-accent ring-2 ring-accent/20" : "border-border hover:bg-muted/40"}`}>
            <span>{statusFilter === "all" ? "All statuses" : statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)}</span>
            <ChevronDown size={13} className={`text-muted-foreground transition-transform ${statusMenuOpen ? "rotate-180" : ""}`} />
          </button>
          <AnimatePresence>
            {statusMenuOpen && (
              <motion.div initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }}
                transition={{ duration: 0.15 }} className="absolute right-0 top-full mt-2 z-30 w-56 bg-card border border-border rounded-xl shadow-xl overflow-hidden p-1.5">
                {[
                  { value: "all", label: "All statuses", count: students.length },
                  { value: "excelling", label: "Excelling", count: students.filter(student => student.status === "excelling").length },
                  { value: "active", label: "Active", count: students.filter(student => student.status === "active").length },
                  { value: "struggling", label: "Struggling", count: students.filter(student => student.status === "struggling").length },
                ].map(option => {
                  const selected = statusFilter === option.value;
                  return <button key={option.value} onClick={() => { setStatusFilter(option.value); setStatusMenuOpen(false); }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm transition-colors ${selected ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"}`}>
                    <span className="flex-1">{option.label}</span>
                    <span className={`font-mono text-xs ${selected ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{option.count}</span>
                    {selected && <CheckCircle size={14} />}
                  </button>;
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {["Student", "Average Score", "Weak Topics", "Quizzes", "Status", ""].map(h => (
                  <th key={h} className="text-left text-xs font-medium text-muted-foreground font-mono uppercase tracking-wide px-5 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="px-5 py-4"><div className="flex items-center gap-3"><Skeleton className="w-8 h-8 rounded-full" /><Skeleton className="w-28 h-3" /></div></td>
                  <td className="px-5 py-4"><Skeleton className="w-28 h-2 rounded-full" /></td>
                  <td className="px-5 py-4"><Skeleton className="w-36 h-5 rounded-full" /></td>
                  <td className="px-5 py-4"><Skeleton className="w-6 h-3" /></td>
                  <td className="px-5 py-4"><Skeleton className="w-16 h-5 rounded-full" /></td>
                </tr>
              )) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-14 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Users size={32} className="text-muted-foreground/30" />
                    <p className="text-sm font-medium text-foreground">{searchQuery ? `No students matching "${searchQuery}"` : "No students yet"}</p>
                    <p className="text-xs text-muted-foreground font-light">{searchQuery ? "Try a different search term." : "Share your class code with students to get started."}</p>
                  </div>
                </td></tr>
              ) : filtered.map(s => (
                <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">{s.initials}</div>
                      <div><span className="text-sm font-medium text-foreground">{s.name}</span>{s.overdue_tasks > 0 && <div className="text-[10px] text-amber-700 mt-0.5">{s.overdue_tasks} overdue study {s.overdue_tasks === 1 ? "task" : "tasks"}</div>}</div>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                        <motion.div className={`h-full rounded-full ${barColor(s.progress)}`}
                          initial={{ width: 0 }} animate={{ width: `${s.progress}%` }}
                          transition={{ duration: 0.7, ease: "easeOut" }} />
                      </div>
                      <span className="font-mono text-xs text-muted-foreground tabular-nums">{s.progress}%</span>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex flex-wrap gap-1">
                      {s.weak.length === 0
                        ? <span className="text-xs text-muted-foreground font-light">None identified</span>
                        : s.weak.map(w => <span key={w} className="text-xs bg-red-50 text-red-700 border border-red-100 px-2 py-0.5 rounded-full">{w}</span>)
                      }
                    </div>
                  </td>
                  <td className="px-5 py-4 font-mono text-sm text-muted-foreground tabular-nums">{s.quizzes}</td>
                  <td className="px-5 py-4">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border capitalize ${statusStyle(s.status)}`}>{s.status}</span>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <button onClick={() => setSelectedStudentId(s.id)} className="text-xs font-medium text-primary border border-border rounded-lg px-3 py-1.5 hover:bg-muted transition-colors">View</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <LiveStudentDrawer courseId={courseId} courseName={courseName} studentId={selectedStudentId} accessToken={accessToken} focusedAttemptId={focusedAttemptId} focusKey={focusKey} onClose={() => setSelectedStudentId(null)} />
    </div>
  );
}

function LiveStudentDrawer({ courseId, courseName, studentId, accessToken, focusedAttemptId, focusKey, onClose }: {
  courseId: string; courseName: string; studentId: string | null; accessToken: string; focusedAttemptId?: string; focusKey: number; onClose: () => void;
}) {
  const loadDetail = useCallback(
    (signal: AbortSignal) => api.teacherStudentProgress(courseId, studentId!, accessToken, signal),
    [courseId, studentId, accessToken],
  );
  const { data: detail, loading } = useScopedQuery(
    studentId ? `${courseId}:${studentId}` : null, loadDetail, "Could not load student progress.",
  );

  useEffect(() => {
    if (!detail || !focusedAttemptId) return;
    const timer = window.setTimeout(() => document.getElementById(`attempt-${focusedAttemptId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
    return () => window.clearTimeout(timer);
  }, [detail, focusKey, focusedAttemptId]);

  if (!studentId) return null;
  return <AnimatePresence><>
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
    <motion.aside initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", damping: 28, stiffness: 260 }}
      className="fixed inset-y-0 right-0 z-50 w-full max-w-xl bg-background border-l border-border shadow-2xl flex flex-col">
      <div className="px-6 py-5 border-b border-border bg-card flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold">{initialsFor(detail?.name)}</div>
        <div className="flex-1"><h2 className="font-display text-xl text-primary">{detail?.name ?? "Student progress"}</h2><p className="text-xs text-muted-foreground">{courseName}</p></div>
        <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg text-muted-foreground"><X size={16} /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {loading || !detail ? <div className="flex items-center gap-3 text-sm text-muted-foreground"><TypingIndicator />Loading progress…</div> : <>
          <div className="grid grid-cols-3 gap-3 mb-6">
            {[{ label: "Average", value: `${detail.average_score}%` }, { label: "Quizzes", value: String(detail.quiz_count) }, { label: "Weak topics", value: String(detail.weak_topics.length) }].map(item => <div key={item.label} className="bg-card border border-border rounded-xl p-4 text-center"><div className="font-display text-2xl text-primary">{item.value}</div><div className="text-xs text-muted-foreground mt-1">{item.label}</div></div>)}
          </div>
          <div className="bg-card border border-border rounded-xl p-5 mb-5">
            <h3 className="font-semibold text-foreground mb-4">Topic performance</h3>
            {detail.topic_scores.length ? <div className="space-y-3">{detail.topic_scores.map(topic => <div key={topic.topic}><div className="flex justify-between text-xs mb-1.5"><span className="font-medium">{topic.topic}</span><span className="font-mono text-muted-foreground">{topic.score}%</span></div><div className="h-1.5 bg-muted rounded-full overflow-hidden"><div className={`h-full ${barColor(topic.score)}`} style={{ width: `${topic.score}%` }} /></div></div>)}</div> : <p className="text-sm text-muted-foreground">No answered quiz questions yet.</p>}
          </div>
          <div className="bg-card border border-border rounded-xl overflow-hidden mb-5">
            <h3 className="font-semibold text-foreground px-5 py-4 border-b border-border">Quiz attempts</h3>
            {detail.attempts.map(attempt => <div id={`attempt-${attempt.id}`} key={attempt.id} className={`flex items-center gap-3 px-5 py-3.5 border-b border-border last:border-0 ${attempt.id === focusedAttemptId ? "bg-amber-50 ring-2 ring-inset ring-amber-300" : ""}`}><div className={`w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold ${attempt.score >= 70 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{attempt.score}%</div><div className="flex-1 min-w-0"><div className="text-sm font-medium truncate">{attempt.title}</div><div className="text-xs text-muted-foreground">{attempt.correct}/{attempt.total} correct</div></div><span className="text-xs font-mono text-muted-foreground">{new Date(attempt.completed_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span></div>)}
            {!detail.attempts.length && <p className="p-5 text-sm text-muted-foreground">No completed attempts.</p>}
          </div>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <h3 className="font-semibold text-foreground px-5 py-4 border-b border-border">Misconceptions</h3>
            {detail.misconceptions.map(item => <div key={item.id} className="px-5 py-4 border-b border-border last:border-0"><div className="flex items-center gap-2 mb-1"><span className="text-xs font-semibold text-primary">{item.concept}</span><span className={`text-[10px] px-2 py-0.5 rounded-full ${item.status === "open" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{item.status}</span></div><p className="text-xs text-muted-foreground leading-relaxed">{item.explanation}</p></div>)}
            {!detail.misconceptions.length && <p className="p-5 text-sm text-muted-foreground">No misconceptions recorded.</p>}
          </div>
        </>}
      </div>
    </motion.aside>
  </></AnimatePresence>;
}

function TeacherAnalytics({ course, analytics, loading, accessToken, focusedMisconceptionId, focusKey }: {
  course: TeacherCourse;
  analytics: Awaited<ReturnType<typeof api.teacherCourseAnalytics>> | null;
  loading: boolean;
  accessToken: string;
  focusedMisconceptionId?: string;
  focusKey: number;
}) {
  const [subtab, setSubtab] = useState<"overview" | "misconceptions" | "network" | "mastery" | "twin">("overview");
  const [addressedIds, setAddressedIds] = useState<string[]>([]);
  const loadMastery = useCallback(
    (signal: AbortSignal) => api.teacherMasteryJourneys(course.id, accessToken, signal),
    [course.id, accessToken],
  );
  const loadDigitalTwin = useCallback(
    (signal: AbortSignal) => api.teacherCourseDigitalTwin(course.id, accessToken, signal),
    [course.id, accessToken],
  );
  const { data: masteryJourneys, loading: masteryLoading } =
    useScopedQuery(subtab === "mastery" ? course.id : null, loadMastery, "Could not load mastery journeys.");
  const { data: digitalTwin, loading: digitalTwinLoading } =
    useScopedQuery(subtab === "twin" ? course.id : null, loadDigitalTwin, "Could not load the course digital twin.");
  const log = (analytics?.misconceptions ?? []).map(item => ({ ...item, status: addressedIds.includes(item.id) ? "addressed" as const : item.status }));

  useEffect(() => {
    if (!focusedMisconceptionId || loading) return;
    setSubtab("misconceptions");
    const timer = window.setTimeout(() => document.getElementById(`misconception-${focusedMisconceptionId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
    return () => window.clearTimeout(timer);
  }, [focusKey, focusedMisconceptionId, loading]);

  const markAddressed = async (id: string) => {
    try {
      await api.addressMisconception(course.id, id, accessToken);
      setAddressedIds(previous => [...previous, id]);
      toast.success("Marked as addressed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update misconception.");
    }
  };

  if (loading) return <div className="py-20 text-center text-sm text-muted-foreground"><RefreshCw size={20} className="mx-auto mb-3 animate-spin" />Loading analytics…</div>;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-2xl text-foreground">Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1 font-light">{course.name} — Class-wide performance overview</p>
        </div>
        <div className="flex max-w-full gap-1 overflow-x-auto bg-muted p-1 rounded-xl">
          {(["overview", "misconceptions", "network", "mastery", "twin"] as const).map(t => (
            <button key={t} onClick={() => setSubtab(t)}
              className={`shrink-0 whitespace-nowrap px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${subtab === t ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {t === "misconceptions" ? "Misconception Log" : t === "network" ? "Concept Network" : t === "mastery" ? "Mastery Journeys" : t === "twin" ? "Course Twin" : "Overview"}
            </button>
          ))}
        </div>
      </div>

      {subtab === "mastery" && (
        <MasteryJourneysPanel data={masteryJourneys} loading={masteryLoading} />
      )}

      {subtab === "twin" && (
        <CourseDigitalTwinPanel data={digitalTwin} loading={digitalTwinLoading} />
      )}

      {subtab === "network" && (
        <MisconceptionNetworkPanel data={analytics?.misconception_network ?? { nodes: [], edges: [], hub_concept: null }} />
      )}

      {subtab === "misconceptions" && (
        <div>
          <div className="flex gap-3 mb-5">
            {[
              { label: "Open", count: log.filter(m => m.status === "open").length, color: "text-amber-600 bg-amber-50 border-amber-200" },
              { label: "Addressed", count: log.filter(m => m.status === "addressed").length, color: "text-emerald-600 bg-emerald-50 border-emerald-200" },
              { label: "Total flagged", count: log.length, color: "text-foreground bg-card border-border" },
            ].map(s => (
              <div key={s.label} className={`flex-1 border rounded-xl px-4 py-3 ${s.color} shadow-sm`}>
                <div className="font-display text-2xl">{s.count}</div>
                <div className="text-xs font-light mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
          <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
            {log.map((m, i) => (
              <div id={`misconception-${m.id}`} key={m.id} className={`flex items-start gap-4 px-5 py-4 ${i < log.length - 1 ? "border-b border-border" : ""} ${m.status === "addressed" ? "opacity-50" : ""} ${m.id === focusedMisconceptionId ? "bg-purple-50 ring-2 ring-inset ring-purple-300" : ""}`}>
                <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">{initialsFor(m.student)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className="text-sm font-semibold text-foreground">{m.student}</span>
                    <span className="text-xs font-mono text-muted-foreground">·</span>
                    <span className="text-xs font-medium text-primary bg-primary/8 px-2 py-0.5 rounded-full">{m.concept}</span>
                  </div>
                  <p className="text-xs text-muted-foreground font-light leading-relaxed">{m.explanation}</p>
                  <span className="text-[10px] font-mono text-muted-foreground/60 mt-1 block">{new Date(m.created_at).toLocaleDateString()}</span>
                </div>
                <div className="shrink-0">
                  {m.status === "open" ? (
                    <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                      onClick={() => markAddressed(m.id)}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 transition-colors flex items-center gap-1.5">
                      <CheckCircle size={12} />Mark addressed
                    </motion.button>
                  ) : (
                    <span className="text-xs font-medium text-emerald-600 flex items-center gap-1">
                      <CheckCheck size={13} />Addressed
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {subtab === "overview" && (<div><div className="mb-8">
        <p className="text-sm text-muted-foreground mt-1 font-light">{course.name} — Class-wide performance overview</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <h2 className="font-semibold text-foreground mb-0.5">Topic Mastery</h2>
          <p className="text-xs text-muted-foreground font-mono mb-6">Class average by topic</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={analytics?.topic_scores ?? []} barSize={20} barCategoryGap="30%">
              <defs>
                <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#E8A020" stopOpacity={1} />
                  <stop offset="100%" stopColor="#E8A020" stopOpacity={0.55} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(17,24,39,0.06)" vertical={false} />
              <XAxis dataKey="topic" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--muted)", radius: 4 }} />
              <Bar dataKey="score" fill="url(#barGrad)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <h2 className="font-semibold text-foreground mb-0.5">Student Performance</h2>
          <p className="text-xs text-muted-foreground font-mono mb-6">Current quiz average per student</p>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={(analytics?.students ?? []).map(student => ({ week: student.name, avg: student.progress }))}>
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#1C2B4A" stopOpacity={0.12} />
                  <stop offset="95%" stopColor="#1C2B4A" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(17,24,39,0.06)" vertical={false} />
              <XAxis dataKey="week" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="avg" stroke="#1C2B4A" strokeWidth={2} fill="url(#areaGrad)"
                dot={{ fill: "#1C2B4A", r: 3, strokeWidth: 0 }} activeDot={{ r: 5, fill: "#E8A020", strokeWidth: 0 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold text-foreground">Top Misconceptions</h2>
          <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.97 }}
            onClick={() => {
              const rows = log.map(m => `${m.student},${m.concept},"${m.explanation.replaceAll('"', '""')}",${m.created_at},${m.status}`).join("\n");
              const blob = new Blob([`Student,Topic,Misconception,Flagged At,Status\n${rows}`], { type: "text/csv" });
              const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "misconceptions.csv"; a.click();
              toast.success("Report exported as CSV");
            }}
            className="text-xs font-medium text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 flex items-center gap-1.5 transition-colors">
            <FileText size={12} />Export CSV
          </motion.button>
        </div>
        <p className="text-xs text-muted-foreground font-mono mb-5">Detected from student answers and quiz responses</p>
        <div>
          {log.filter(item => item.status === "open").map((m, i) => (
            <div key={m.id} className="flex items-center gap-4 py-4 border-b border-border last:border-0 hover:bg-muted/20 transition-colors rounded -mx-2 px-2">
              <span className="font-mono text-sm font-bold text-muted-foreground/40 w-5 shrink-0 tabular-nums">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-foreground">{m.concept}</div>
                <div className="text-xs text-muted-foreground mt-0.5 font-light">{m.explanation}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-medium text-foreground">{m.student}</div>
                <div className="text-xs text-muted-foreground font-light">{new Date(m.created_at).toLocaleDateString()}</div>
              </div>
            </div>
          ))}
          {log.filter(item => item.status === "open").length === 0 && <p className="text-sm text-muted-foreground py-4">No open misconceptions.</p>}
        </div>
      </div>
      </div>
      )}
    </div>
  );
}

function CourseDigitalTwinPanel({ data, loading }: {
  data: Awaited<ReturnType<typeof api.teacherCourseDigitalTwin>> | null;
  loading: boolean;
}) {
  const [selectedSimulationId, setSelectedSimulationId] = useState("starting-fresh");
  if (loading) return <div className="py-20 text-center text-sm text-muted-foreground"><RefreshCw size={20} className="mx-auto mb-3 animate-spin" />Building the live course map…</div>;
  if (!data) return <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">The course map could not be loaded.</div>;
  const simulations = data.simulated_learners ?? [];
  const selectedSimulation = simulations.find(profile => profile.id === selectedSimulationId) ?? simulations[0];
  const readinessColor = data.summary.readiness >= 75
    ? "text-emerald-700 dark:text-emerald-300"
    : data.summary.readiness >= 50
      ? "text-amber-700 dark:text-amber-300"
      : "text-red-700 dark:text-red-300";
  const severityStyle = (severity: "high" | "medium" | "low") => severity === "high"
    ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/35 dark:text-red-300"
    : severity === "medium"
      ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300"
      : "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300";
  return <div className="space-y-6">
    <div className="rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/[0.06] to-violet-500/[0.06] p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><div className="flex items-center gap-2"><Layers size={18} className="text-violet-600 dark:text-violet-300" /><h2 className="font-semibold text-foreground">Live curriculum alignment map</h2></div><p className="text-xs text-muted-foreground mt-2 max-w-2xl leading-relaxed">Connects the approved concept graph to indexed materials, assessment questions, and learner evidence. It recalculates from existing records and uses no AI tokens.</p></div>
        <div className="text-right"><div className={`font-display text-4xl ${readinessColor}`}>{data.summary.readiness}%</div><div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">alignment readiness</div></div>
      </div>
    </div>

    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {[
        { label: "Material coverage", value: `${data.summary.material_coverage}%`, detail: `${data.summary.materials} documents`, icon: BookMarked },
        { label: "Assessment coverage", value: `${data.summary.assessment_coverage}%`, detail: `${data.summary.assessment_questions} questions`, icon: Target },
        { label: "Prerequisite coverage", value: `${data.summary.prerequisite_coverage}%`, detail: `${data.summary.topics} concepts`, icon: Layers },
        { label: "Learner evidence", value: String(data.summary.completed_attempts), detail: "completed attempts", icon: TrendingUp },
      ].map(item => <div key={item.label} className="rounded-xl border border-border bg-card p-5 shadow-sm"><div className="flex items-start justify-between"><span className="text-[10px] uppercase tracking-wide font-mono text-muted-foreground">{item.label}</span><item.icon size={14} className="text-primary dark:text-amber-300" /></div><div className="font-display text-3xl text-foreground mt-3">{item.value}</div><div className="text-xs text-muted-foreground mt-1">{item.detail}</div></div>)}
    </div>

    <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4 border-b border-border">
        <div><div className="flex items-center gap-2"><Eye size={16} className="text-violet-600 dark:text-violet-300" /><h2 className="font-semibold text-foreground">Simulated learner preview</h2></div><p className="text-xs text-muted-foreground mt-1 max-w-2xl leading-relaxed">Test how the course structure responds to different starting assumptions before real students encounter it.</p></div>
        <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[9px] uppercase tracking-wide font-mono text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-300">Simulation · no student data</span>
      </div>
      {simulations.length ? <>
        <div className="grid gap-2 border-b border-border bg-muted/20 p-3 sm:grid-cols-3">
          {simulations.map(profile => {
            const active = profile.id === selectedSimulation?.id;
            return <button key={profile.id} onClick={() => setSelectedSimulationId(profile.id)} aria-pressed={active} className={`rounded-xl border p-3 text-left transition-colors ${active ? "border-accent bg-card shadow-sm ring-1 ring-accent/20" : "border-transparent hover:border-border hover:bg-card/60"}`}><div className="flex items-center gap-2"><span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${active ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"}`}><User size={12} /></span><span className="text-xs font-semibold text-foreground">{profile.label}</span></div><p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">{profile.summary}</p></button>;
          })}
        </div>
        {selectedSimulation && <div className="grid lg:grid-cols-[1.2fr_0.8fr]">
          <div className="px-5 py-5 lg:border-r lg:border-border">
            <div className="mb-4 flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-foreground">Likely learning route</h3><p className="mt-0.5 text-[10px] text-muted-foreground">Calculated from prerequisites, mapped materials, and aligned questions.</p></div><span className="shrink-0 text-[10px] font-mono text-muted-foreground">{selectedSimulation.next_steps.length} steps</span></div>
            {selectedSimulation.next_steps.length ? <div className="space-y-3">{selectedSimulation.next_steps.map((step, index) => <div key={step.topic} className="flex items-start gap-3"><div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted/40 text-[10px] font-mono text-foreground">{index + 1}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold text-foreground">{step.topic}</span><span className={`rounded-full px-2 py-0.5 text-[9px] ${step.has_material ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" : "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300"}`}>{step.has_material ? "Material ready" : "Material gap"}</span><span className={`rounded-full px-2 py-0.5 text-[9px] ${step.assessment_questions ? "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300" : "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"}`}>{step.assessment_questions ? `${step.assessment_questions} questions` : "No aligned quiz"}</span></div><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.experience}</p></div>{index < selectedSimulation.next_steps.length - 1 && <ArrowRight size={12} className="mt-2 shrink-0 text-muted-foreground/50" />}</div>)}</div> : <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 text-xs text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/25 dark:text-emerald-200">No prerequisite step remains under this scenario. Use a transfer task or spaced review to test retention.</div>}
          </div>
          <div className="space-y-5 bg-muted/15 px-5 py-5">
            <div><h3 className="text-xs font-semibold text-foreground">Teacher verification checks</h3><div className="mt-3 space-y-2">{selectedSimulation.teacher_checks.map(check => <div key={check} className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><CheckCircle size={13} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-300" /><span>{check}</span></div>)}</div></div>
            <div><h3 className="text-xs font-semibold text-foreground">Assumed mastered</h3><div className="mt-2 flex flex-wrap gap-1.5">{selectedSimulation.assumed_mastered.length ? selectedSimulation.assumed_mastered.map(topic => <span key={topic} className="rounded-full border border-border bg-card px-2 py-1 text-[10px] text-muted-foreground">{topic}</span>) : <span className="text-xs text-muted-foreground">None</span>}</div></div>
            {selectedSimulation.at_risk_topics.length > 0 && <div><h3 className="text-xs font-semibold text-foreground">Downstream concepts at risk</h3><div className="mt-2 flex flex-wrap gap-1.5">{selectedSimulation.at_risk_topics.map(topic => <span key={topic} className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">{topic}</span>)}</div></div>}
            {selectedSimulation.blocked.length > 0 && <details><summary className="cursor-pointer text-xs font-semibold text-foreground">Blocked under this assumption ({selectedSimulation.blocked.length})</summary><div className="mt-2 space-y-2">{selectedSimulation.blocked.slice(0, 5).map(item => <div key={item.topic} className="rounded-lg border border-border bg-card px-3 py-2 text-[10px]"><div className="font-semibold text-foreground">{item.topic}</div><div className="mt-0.5 text-muted-foreground">Needs {item.missing_prerequisites.join(", ")}</div></div>)}</div></details>}
          </div>
        </div>}
      </> : <div className="px-5 py-10 text-center"><Layers size={22} className="mx-auto text-muted-foreground/40" /><div className="mt-3 text-sm font-semibold text-foreground">Add course topics to enable simulation</div><p className="mt-1 text-xs text-muted-foreground">The preview needs an approved concept and prerequisite map.</p></div>}
      <div className="border-t border-border bg-muted/25 px-5 py-3 text-[10px] leading-relaxed text-muted-foreground"><span className="font-semibold text-foreground">Important:</span> This is a structural scenario, not a prediction about any learner. It never reads or changes student progress.</div>
    </div>

    {data.gaps.length > 0 && <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm"><div className="px-5 py-4 border-b border-border"><h2 className="font-semibold text-foreground">Alignment gaps</h2><p className="text-xs text-muted-foreground mt-1">Concrete curriculum checks generated from missing links—not AI guesses.</p></div><div className="divide-y divide-border">{data.gaps.slice(0, 8).map((gap, index) => <div key={`${gap.kind}-${gap.topic}-${index}`} className="px-5 py-4 flex items-start gap-3"><AlertCircle size={15} className={`mt-0.5 shrink-0 ${gap.severity === "high" ? "text-red-600 dark:text-red-300" : gap.severity === "medium" ? "text-amber-600 dark:text-amber-300" : "text-blue-600 dark:text-blue-300"}`} /><div className="flex-1"><div className="flex items-center gap-2 flex-wrap"><span className="text-sm font-semibold text-foreground">{gap.topic ?? "Course structure"}</span><span className={`rounded-full border px-2 py-0.5 text-[9px] uppercase font-mono ${severityStyle(gap.severity)}`}>{gap.severity}</span><span className="text-[10px] uppercase font-mono text-muted-foreground">{gap.kind}</span></div><p className="text-xs text-muted-foreground mt-1">{gap.message}</p><p className="text-xs text-foreground mt-1.5"><span className="font-semibold">Next action:</span> {gap.recommendation}</p></div></div>)}</div></div>}

    <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4 border-b border-border"><div><h2 className="font-semibold text-foreground">Assessment quality audit</h2><p className="text-xs text-muted-foreground mt-1">Checks question structure, course-map alignment, material support, and common ambiguity risks.</p></div><div className="flex gap-2"><span className="rounded-full border border-border bg-muted px-2.5 py-1 text-[10px] font-mono text-muted-foreground">{data.assessment_audit.total_questions} reviewed</span><span className={`rounded-full border px-2.5 py-1 text-[10px] font-mono ${data.assessment_audit.flagged_questions ? severityStyle(data.assessment_audit.high_priority ? "high" : "medium") : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300"}`}>{data.assessment_audit.flagged_questions} need review</span></div></div>
      {data.assessment_audit.questions.length ? <div className="divide-y divide-border">{data.assessment_audit.questions.map(question => <details key={question.question_id} className="group px-5 py-4"><summary className="flex cursor-pointer list-none items-start gap-3"><div className={`mt-0.5 rounded-lg border px-2 py-1 text-[9px] uppercase font-mono ${severityStyle(question.highest_severity)}`}>{question.highest_severity}</div><div className="min-w-0 flex-1"><div className="text-xs text-muted-foreground">{question.quiz_title} · {question.concept} · Difficulty {question.difficulty}</div><div className="mt-1 text-sm font-medium text-foreground">{question.prompt}</div><div className="mt-2 flex flex-wrap gap-1.5">{question.issues.map(issue => <span key={issue.code} className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{issue.label}</span>)}</div></div><ChevronDown size={15} className="mt-1 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" /></summary><div className="ml-0 sm:ml-[68px] mt-4 space-y-3">{question.issues.map(issue => <div key={issue.code} className="rounded-xl border border-border bg-muted/35 p-4"><div className="text-xs font-semibold text-foreground">{issue.label}</div><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{issue.detail}</p><p className="mt-2 text-xs text-foreground"><span className="font-semibold">Recommended fix:</span> {issue.recommendation}</p></div>)}</div></details>)}</div> : <div className="px-5 py-10 text-center"><CheckCircle size={22} className="mx-auto text-emerald-600 dark:text-emerald-300" /><div className="mt-3 text-sm font-semibold text-foreground">{data.assessment_audit.total_questions ? "No structural risks detected" : "No assessment questions yet"}</div><p className="mt-1 text-xs text-muted-foreground">{data.assessment_audit.total_questions ? "Questions still require normal teacher review for subject accuracy." : "Generate or create a quiz to begin measuring assessment alignment."}</p></div>}
      <div className="border-t border-border bg-muted/25 px-5 py-3 text-[10px] leading-relaxed text-muted-foreground">This audit identifies review signals, not proof that a question is invalid. The teacher remains the final reviewer.</div>
    </div>

    <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
      <div className="px-5 py-4 border-b border-border"><h2 className="font-semibold text-foreground">Concept alignment matrix</h2><p className="text-xs text-muted-foreground mt-1">Each concept should be taught, assessed, and connected to the learning sequence.</p></div>
      {data.topics.length ? <div className="overflow-x-auto"><table className="w-full"><thead><tr className="bg-muted/40 border-b border-border">{["Concept", "Material", "Assessment", "Sequence", "Learner evidence", "Readiness"].map(label => <th key={label} className="px-4 py-3 text-left text-[10px] font-mono uppercase tracking-wide text-muted-foreground">{label}</th>)}</tr></thead><tbody>{data.topics.map(topic => <tr key={topic.id} className="border-b border-border last:border-0 align-top"><td className="px-4 py-4 min-w-48"><div className="text-sm font-semibold text-foreground">{topic.name}</div><span className="text-[10px] text-muted-foreground uppercase">{topic.weight} weight</span></td><td className="px-4 py-4 min-w-52">{topic.material_sources.length ? <div><span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">{topic.material_mentions} matching sections</span><div className="mt-1 space-y-1">{topic.material_sources.slice(0, 2).map((source, index) => <div key={index} className="text-[10px] text-muted-foreground">{source.document_title}{source.page_number ? ` · ${source.source_kind === "slide" ? "Slide" : "Page"} ${source.page_number}` : ""}</div>)}</div></div> : <span className="text-xs font-semibold text-red-700 dark:text-red-300">Not found</span>}</td><td className="px-4 py-4"><span className={`text-xs font-semibold ${topic.assessment_questions ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>{topic.assessment_questions} questions</span></td><td className="px-4 py-4 min-w-52">{topic.prerequisites.length || topic.unlocks.length ? <div className="space-y-1 text-[10px] text-muted-foreground">{topic.prerequisites.length > 0 && <div>Requires: {topic.prerequisites.join(", ")}</div>}{topic.unlocks.length > 0 && <div className="flex items-center gap-1">Unlocks <ArrowRight size={9} /> {topic.unlocks.join(", ")}</div>}</div> : <span className="text-xs text-amber-700 dark:text-amber-300">Isolated</span>}</td><td className="px-4 py-4"><div className="text-xs font-semibold text-foreground">{topic.students_with_evidence} students</div><div className="text-[10px] text-muted-foreground mt-1">{topic.average_mastery == null ? "No mastery yet" : `${topic.average_mastery}% avg. mastery`}</div></td><td className="px-4 py-4"><div className="w-24"><div className="flex justify-between text-[10px] mb-1"><span className={topic.readiness >= 75 ? "text-emerald-700 dark:text-emerald-300" : topic.readiness >= 50 ? "text-amber-700 dark:text-amber-300" : "text-red-700 dark:text-red-300"}>{topic.readiness}%</span></div><div className="h-1.5 bg-muted rounded-full overflow-hidden"><div className={`h-full ${topic.readiness >= 75 ? "bg-emerald-500" : topic.readiness >= 50 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${topic.readiness}%` }} /></div></div></td></tr>)}</tbody></table></div> : <div className="py-14 text-center"><Layers size={24} className="mx-auto text-muted-foreground/40 mb-3" /><p className="text-sm text-foreground font-semibold">No course concepts defined</p><p className="text-xs text-muted-foreground mt-1">Open Settings to add topics or review AI-assisted graph suggestions.</p></div>}
    </div>

    <div className="rounded-xl border border-border bg-card p-5"><h2 className="font-semibold text-foreground mb-3">Material contribution</h2><div className="grid md:grid-cols-2 gap-3">{data.materials.map(material => <div key={material.id} className="rounded-xl bg-muted/40 px-4 py-3"><div className="flex gap-2 items-center"><FileText size={13} className="text-primary" /><span className="text-sm font-medium text-foreground truncate">{material.title}</span></div><div className="text-xs text-muted-foreground mt-1">{material.page_count ? `${material.page_count} pages · ` : ""}{material.matched_topics.length} mapped concepts</div>{material.matched_topics.length > 0 && <div className="flex flex-wrap gap-1 mt-2">{material.matched_topics.slice(0, 5).map(topic => <span key={topic} className="text-[10px] rounded-full bg-card border border-border px-2 py-0.5 text-muted-foreground">{topic}</span>)}</div>}</div>)}</div>{!data.materials.length && <p className="text-sm text-muted-foreground">No course materials uploaded.</p>}</div>
  </div>;
}

function MisconceptionNetworkPanel({ data }: {
  data: Awaited<ReturnType<typeof api.teacherCourseAnalytics>>["misconception_network"];
}) {
  if (data.nodes.length === 0) return (
    <div className="bg-card border border-border rounded-xl py-16 text-center">
      <Brain size={28} className="mx-auto mb-3 text-muted-foreground/40" />
      <h2 className="font-semibold text-foreground">No open misconception network yet</h2>
      <p className="text-sm text-muted-foreground mt-1">Connections will appear when students show misunderstandings across multiple concepts.</p>
    </div>
  );

  const visibleNodes = data.nodes.slice(0, 10);
  const hubIndex = Math.max(0, visibleNodes.findIndex(node => node.id === data.hub_concept));
  const orderedNodes = [visibleNodes[hubIndex], ...visibleNodes.filter((_, index) => index !== hubIndex)];
  const positions = new Map<string, { x: number; y: number }>();
  positions.set(orderedNodes[0].id, { x: 450, y: 210 });
  orderedNodes.slice(1).forEach((node, index, surrounding) => {
    const angle = (index / Math.max(1, surrounding.length)) * Math.PI * 2 - Math.PI / 2;
    positions.set(node.id, { x: 450 + Math.cos(angle) * 330, y: 210 + Math.sin(angle) * 145 });
  });
  const visibleIds = new Set(visibleNodes.map(node => node.id));
  const visibleEdges = data.edges.filter(edge => visibleIds.has(edge.source) && visibleIds.has(edge.target));
  const hub = data.hub_concept ? visibleNodes.find(node => node.id === data.hub_concept) : null;

  return <div className="space-y-5">
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5 shadow-sm overflow-hidden">
        <div className="mb-3">
          <h2 className="font-semibold text-foreground">Class misconception co-occurrence map</h2>
          <p className="text-xs text-muted-foreground mt-1">A line means the same student showed both misconceptions. Thicker lines indicate more shared students.</p>
        </div>
        <svg viewBox="0 0 900 420" className="w-full h-auto min-h-[320px]" role="img" aria-label="Class misconception concept network">
          {visibleEdges.map(edge => {
            const source = positions.get(edge.source); const target = positions.get(edge.target);
            if (!source || !target) return null;
            return <line key={`${edge.source}-${edge.target}`} x1={source.x} y1={source.y} x2={target.x} y2={target.y}
              stroke="#94a3b8" strokeOpacity={0.45} strokeWidth={1 + Math.min(7, edge.shared_students * 2)} />;
          })}
          {orderedNodes.map((node, index) => {
            const point = positions.get(node.id)!;
            const isHub = node.id === data.hub_concept;
            const radius = 30 + Math.min(14, node.affected_students * 3);
            const label = node.concept.length > 20 ? `${node.concept.slice(0, 18)}…` : node.concept;
            return <g key={node.id}>
              <circle cx={point.x} cy={point.y} r={radius} fill={isHub ? "#1C2B4A" : index % 2 ? "#E8A020" : "#6D5BD0"} opacity={0.95}>
                <title>{node.concept}: {node.affected_students} affected students, {node.occurrences} detections</title>
              </circle>
              <text x={point.x} y={point.y - 2} textAnchor="middle" fill="white" fontSize="12" fontWeight="600">{label}</text>
              <text x={point.x} y={point.y + 15} textAnchor="middle" fill="white" fillOpacity={0.8} fontSize="10">{node.affected_students} students</text>
            </g>;
          })}
        </svg>
      </div>
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
        <h2 className="font-semibold text-foreground mb-1">Potential intervention hub</h2>
        <p className="text-xs text-muted-foreground leading-relaxed mb-5">This is the most connected concept, not proof that it causes the others. Review it first as a possible upstream issue.</p>
        {hub ? <>
          <div className="rounded-xl bg-primary text-primary-foreground p-4 mb-4">
            <div className="text-[10px] uppercase tracking-widest opacity-60 font-mono">Most connected</div>
            <div className="font-display text-xl mt-1">{hub.concept}</div>
          </div>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Affected students</span><span className="font-mono font-semibold">{hub.affected_students}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Total detections</span><span className="font-mono font-semibold">{hub.occurrences}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Connection strength</span><span className="font-mono font-semibold">{hub.connection_strength}</span></div>
          </div>
        </> : <p className="text-sm text-muted-foreground">More than one connected concept is needed to identify a hub.</p>}
      </div>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {visibleNodes.map(node => <div key={node.id} className="bg-card border border-border rounded-xl p-4">
        <div className="font-semibold text-sm text-foreground">{node.concept}</div>
        <div className="text-xs text-muted-foreground mt-1">{node.affected_students} affected · {node.occurrences} detections · {node.connection_strength} connection strength</div>
      </div>)}
    </div>
  </div>;
}

function MasteryJourneysPanel({ data, loading }: {
  data: Awaited<ReturnType<typeof api.teacherMasteryJourneys>> | null;
  loading: boolean;
}) {
  if (loading) return <div className="py-20 text-center text-sm text-muted-foreground"><RefreshCw size={20} className="mx-auto mb-3 animate-spin" />Loading mastery journeys…</div>;
  const journeys = data?.journeys ?? [];
  const summary = data?.summary ?? { detected: 0, improving: 0, verified: 0, retained: 0, verification_rate: 0 };
  const statusStyle = {
    open: { label: "Detected", badge: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-400" },
    improving: { label: "Improving", badge: "bg-blue-50 text-blue-700 border-blue-200", dot: "bg-blue-500" },
    verified: { label: "Verified", badge: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  } as const;

  return <div>
    <div className="grid grid-cols-2 xl:grid-cols-5 gap-3 mb-6">
      {[
        { label: "Detected", value: summary.detected, tone: "text-amber-700 bg-amber-50 border-amber-200" },
        { label: "Improving", value: summary.improving, tone: "text-blue-700 bg-blue-50 border-blue-200" },
        { label: "Verified", value: summary.verified, tone: "text-emerald-700 bg-emerald-50 border-emerald-200" },
        { label: "Retained", value: summary.retained, tone: "text-purple-700 bg-purple-50 border-purple-200" },
        { label: "Verification rate", value: `${summary.verification_rate}%`, tone: "text-primary bg-primary/5 border-primary/15" },
      ].map(card => <div key={card.label} className={`rounded-xl border px-4 py-4 shadow-sm ${card.tone}`}>
        <div className="font-display text-2xl">{card.value}</div>
        <div className="text-xs mt-1">{card.label}</div>
      </div>)}
    </div>

    <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="font-semibold text-foreground">Misconception-to-Mastery</h2>
        <p className="text-xs text-muted-foreground mt-1">Follow detected misunderstandings through teach-back practice to verified correction.</p>
      </div>
      {journeys.map((journey, index) => {
        const style = statusStyle[journey.learning_status];
        const retained = journey.retention_status === "retained";
        return <div key={journey.id} className={`px-5 py-5 ${index < journeys.length - 1 ? "border-b border-border" : ""}`}>
          <div className="flex items-start gap-4">
            <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">{initialsFor(journey.student)}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold">{journey.student}</span>
                <span className="text-xs text-muted-foreground">·</span>
                <span className="text-xs font-medium text-primary">{journey.concept}</span>
                <span className={`text-[10px] border rounded-full px-2 py-0.5 ${retained ? "bg-purple-50 text-purple-700 border-purple-200" : style.badge}`}>{retained ? "Retained" : style.label}</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed mt-1.5">{journey.explanation}</p>

              <div className="flex items-center gap-1.5 mt-4 max-w-2xl">
                <div className="flex items-center gap-1.5 text-[10px] font-medium"><span className="w-2 h-2 rounded-full bg-amber-400" />Detected</div>
                <div className={`h-px flex-1 ${journey.teach_back_attempts > 0 ? "bg-blue-400" : "bg-border"}`} />
                <div className={`flex items-center gap-1.5 text-[10px] font-medium ${journey.teach_back_attempts > 0 ? "text-blue-700" : "text-muted-foreground"}`}><span className={`w-2 h-2 rounded-full ${journey.teach_back_attempts > 0 ? "bg-blue-500" : "bg-border"}`} />Teach-back</div>
                <div className={`h-px flex-1 ${journey.learning_status === "verified" ? "bg-emerald-500" : "bg-border"}`} />
                <div className={`flex items-center gap-1.5 text-[10px] font-medium ${journey.learning_status === "verified" ? "text-emerald-700" : "text-muted-foreground"}`}><span className={`w-2 h-2 rounded-full ${journey.learning_status === "verified" ? "bg-emerald-500" : "bg-border"}`} />Verified</div>
                <div className={`h-px flex-1 ${retained ? "bg-purple-500" : "bg-border"}`} />
                <div className={`flex items-center gap-1.5 text-[10px] font-medium ${retained ? "text-purple-700" : "text-muted-foreground"}`}><span className={`w-2 h-2 rounded-full ${retained ? "bg-purple-500" : "bg-border"}`} />Retained</div>
              </div>

              {journey.latest_feedback && <p className="mt-3 text-xs bg-muted/50 border border-border rounded-lg px-3 py-2"><span className="font-semibold">Latest feedback:</span> {journey.latest_feedback}</p>}
            </div>
            <div className="text-right shrink-0">
              <div className="text-lg font-display text-primary">{journey.mastery_score === null ? "—" : `${Math.round(journey.mastery_score)}%`}</div>
              <div className="text-[10px] text-muted-foreground">{journey.mastery_score === null ? "insufficient evidence" : "concept mastery"}</div>
              <div className="text-[10px] text-muted-foreground mt-1">{Math.round(journey.confidence * 100)}% evidence confidence</div>
              <div className="text-[10px] text-muted-foreground mt-2">{journey.teach_back_attempts} teach-back {journey.teach_back_attempts === 1 ? "attempt" : "attempts"}</div>
              <div className="text-[10px] text-muted-foreground mt-1">{journey.retention_checks} retention {journey.retention_checks === 1 ? "check" : "checks"}</div>
              {journey.related_records > 1 && <div className="text-[10px] text-blue-600 mt-1">{journey.related_records} related detections grouped</div>}
            </div>
          </div>
        </div>;
      })}
      {!journeys.length && <div className="py-14 text-center"><Brain size={24} className="mx-auto mb-3 text-muted-foreground/50" /><p className="text-sm text-muted-foreground">No misconception journeys recorded for this course yet.</p></div>}
    </div>
  </div>;
}

// ─── Student Dashboard ────────────────────────────────────────────────────

function StudentDashboard({ onLogout, darkMode, setDarkMode }: { onLogout: () => void; darkMode: boolean; setDarkMode: (v: boolean) => void }) {
  const { profile, session, user } = useAuth();
  const [initialLocation] = useState(() => readStudentLocation(user?.id ?? ""));
  const [tab, setTab] = useState<StudentTab>(() => STUDENT_TABS.includes(initialLocation.tab) ? initialLocation.tab as StudentTab : "workspace");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [tutorStatus, setTutorStatus] = useState("Searching course materials…");
  const [practiceConcept, setPracticeConcept] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [studentCourses, setStudentCourses] = useState<StudentCourse[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<StudentCourse | null>(null);
  const [courseLoadState, setCourseLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const courseId = selectedCourse?.id;
  const courseName = selectedCourse?.name ?? "";
  const accessToken = session?.access_token ?? "";
  const courseScope = courseId && session ? `${session.user.id}:${courseId}` : null;
  const startTutorRequest = useScopedRequest(courseScope);
  const startHistoryRequest = useScopedRequest(courseScope);
  const [history, setHistory] = useState<{ scope: string; status: HistoryStatus } | null>(null);
  const historyStatus = history?.scope === courseScope ? history.status : "loading";
  const latestToken = useRef(accessToken);
  useLayoutEffect(() => { latestToken.current = accessToken; }, [accessToken]);
  const loadCourseAnnouncements = useCallback(async (signal: AbortSignal) => {
    const rows = await api.announcements(courseId!, accessToken, signal);
    return rows.map(row => ({
      id: row.id, title: row.title, body: row.body, pinned: row.pinned,
      course: courseName, createdAt: new Date(row.created_at).toLocaleString(),
    }));
  }, [courseId, courseName, accessToken]);
  const { data: courseAnnouncements, refresh: refreshCourseAnnouncements } =
    useScopedQuery(courseScope, loadCourseAnnouncements, "Could not load announcements.");

  useLayoutEffect(() => {
    setMessages([]);
    setInput("");
    setConversationId(undefined);
    setIsTyping(false);
    setTutorStatus("Searching course materials…");
  }, [courseScope]);

  const restoreHistory = useCallback(async () => {
    if (!courseScope || !courseId) return;
    const request = startHistoryRequest();
    if (!request) return;
    setHistory({ scope: courseScope, status: "loading" });
    try {
      const saved = await api.tutorHistory(courseId, latestToken.current, request.signal);
      if (!request.isCurrent()) return;
      let question: string | undefined;
      const restored = saved.messages.map((message): ChatMessage => {
        if (message.author_role === "student") {
          question = message.content;
          return { role: "user", text: message.content };
        }
        return {
          role: "ai", text: message.content, citations: message.citations, misconception: null,
          question: message.grounded ? question : undefined,
        };
      });
      setConversationId(saved.conversation_id ?? undefined);
      setMessages(restored);
      setHistory({ scope: courseScope, status: "ready" });
    } catch {
      if (request.isCurrent()) setHistory({ scope: courseScope, status: "error" });
    } finally {
      request.finish();
    }
  }, [courseId, courseScope, startHistoryRequest]);

  useEffect(() => { void restoreHistory(); }, [restoreHistory]);
  useEffect(() => {
    if (user && courseId) writeStudentLocation(user.id, courseId, tab);
  }, [user?.id, courseId, tab]);

  const loadStudentCourses = useCallback(async () => {
    if (!session) return [];
    const rows = await api.myCourses(session.access_token);
    const loaded = rows.map(row => ({ id: row.id, name: row.name, code: row.enrollment_code, teacher: row.teacher, progress: 0 }));
    setStudentCourses(loaded);
    setCourseLoadState("ready");
    setSelectedCourse(current => loaded.find(course => course.id === (current?.id ?? initialLocation.courseId)) ?? loaded[0] ?? null);
    if (!loaded.length) setTab("enroll");
    return loaded;
  }, [session, initialLocation.courseId]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    let retryTimer: number | undefined;
    const loadCourses = async (retry = true) => {
      try {
        await loadStudentCourses();
      } catch (error) {
        if (retry && !cancelled) {
          retryTimer = window.setTimeout(() => void loadCourses(false), 1500);
          return;
        }
        if (!cancelled) {
          setCourseLoadState(current => current === "loading" ? "error" : current);
          toast.error(error instanceof Error ? error.message : "Could not load courses.");
        }
      }
    };
    const reloadOnFocus = () => { void loadCourses(false); };
    void loadCourses();
    window.addEventListener("focus", reloadOnFocus);
    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      window.removeEventListener("focus", reloadOnFocus);
    };
  }, [loadStudentCourses, session]);

  useEffect(() => {
    if (!session) return;
    void api.notifications(session.access_token)
      .then(rows => setNotifications(rows.map(notificationFromRow)))
      .catch(error => toast.error(error instanceof Error ? error.message : "Could not load notifications."));
  }, [session]);

  useEffect(() => {
    if (!supabase || !user || !session) return;
    const realtimeClient = supabase;
    const channel = realtimeClient
      .channel(`student-notifications-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${user.id}` },
        payload => {
          const incoming = notificationFromRow(payload.new as NotificationRow);
          setNotifications(current => current.some(item => item.id === incoming.id) ? current : [incoming, ...current]);
          toast(incoming.title, { description: incoming.body });
          if (incoming.type === "enroll" && incoming.metadata.decision === "approved") {
            void loadStudentCourses().catch(() => toast.error("Could not refresh your courses."));
          }
          if (incoming.type === "announcement" && courseId && incoming.courseId === courseId) {
            void refreshCourseAnnouncements(true);
          }
        },
      )
      .subscribe(status => {
        if (status === "CHANNEL_ERROR") toast.error("Live notifications disconnected. Refresh to reconnect.");
      });
    return () => { void realtimeClient.removeChannel(channel); };
  }, [loadStudentCourses, courseId, refreshCourseAnnouncements, session, user]);

  const navItems: { id: StudentTab; label: string; icon: React.ElementType }[] = [
    { id: "workspace", label: "Course Q&A", icon: MessageSquare },
    { id: "work", label: "Show Your Work", icon: Pencil },
    { id: "lab", label: "Concept Lab", icon: Layers },
    { id: "quiz", label: "Quiz", icon: Target },
    { id: "progress", label: "My Progress", icon: TrendingUp },
    { id: "enroll", label: "Join Course", icon: Plus },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  const handleSend = async () => {
    if (!input.trim() || !selectedCourse || !session || historyStatus !== "ready") return;
    const request = startTutorRequest(false);
    if (!request) return;
    const question = input.trim();
    setMessages(prev => [...prev, { role: "user", text: question }]);
    setInput("");
    setIsTyping(true);
    setTutorStatus("Searching course materials…");
    const statusTimer = window.setTimeout(() => {
      if (request.isCurrent()) setTutorStatus("Preparing a grounded explanation…");
    }, 1400);
    try {
      const result = await api.tutor(selectedCourse.id, question, session.access_token, conversationId, request.signal);
      if (!request.isCurrent()) return;
      setConversationId(result.conversation_id);
      const misconception = result.answer.misconception.detected ? result.answer.misconception.explanation : null;
      setMessages(prev => [...prev, {
        role: "ai",
        text: result.answer.answer,
        citations: result.answer.citations,
        misconception,
        question: result.answer.grounded ? question : undefined,
      }]);
    } catch (error) {
      if (request.isCurrent()) {
        toast.error(error instanceof Error ? error.message : "The tutor could not answer this question.");
      }
    } finally {
      window.clearTimeout(statusTimer);
      if (request.isCurrent()) setIsTyping(false);
      request.finish();
    }
  };

  const handleAlternativeExplanation = async (messageIndex: number, format: ExplanationFormat) => {
    if (!selectedCourse || !session || isTyping) return;
    const message = messages[messageIndex];
    if (message?.role !== "ai" || !message.question) return;
    const request = startTutorRequest(false);
    if (!request) return;
    const labels: Record<ExplanationFormat, string> = {
      simpler: "Simpler explanation",
      analogy: "Analogy",
      worked_example: "Worked example",
      visual_outline: "Visual outline",
    };
    setIsTyping(true);
    setTutorStatus(`Creating a ${labels[format].toLowerCase()}…`);
    try {
      const result = await api.explainInFormat(selectedCourse.id, message.question, format, session.access_token, request.signal);
      if (!request.isCurrent()) return;
      setMessages(previous => [...previous, {
        role: "ai",
        text: result.answer,
        citations: result.citations,
        misconception: null,
        question: result.grounded ? message.question : undefined,
        formatLabel: labels[format],
      }]);
    } catch (error) {
      if (request.isCurrent()) {
        toast.error(error instanceof Error ? error.message : "Could not create another explanation.");
      }
    } finally {
      if (request.isCurrent()) setIsTyping(false);
      request.finish();
    }
  };

  const navigateStudentNotification = (notification: Notification) => {
    void (async () => {
      let availableCourses = studentCourses;
      if (notification.type === "enroll" && notification.metadata.decision === "approved") {
        try {
          availableCourses = await loadStudentCourses();
        } catch {
          toast.error("Could not refresh your approved courses.");
        }
      }
      const relatedCourse = availableCourses.find(course => course.id === notification.courseId);
      if (relatedCourse) setSelectedCourse(relatedCourse);

      if (notification.type === "announcement") setTab("workspace");
      else if (notification.type === "misconception") setTab("progress");
      else if (notification.type === "enroll") setTab(relatedCourse ? "workspace" : "enroll");
      else if (notification.type === "quiz") {
        const focusConcept = typeof notification.metadata.focus_concept === "string" ? notification.metadata.focus_concept : null;
        setPracticeConcept(focusConcept);
        setTab("quiz");
      }
      else setTab("progress");
    })();
  };

  const courseStatus = courseLoadState === "loading" ? "Loading your courses…" :
    courseLoadState === "error" ? "Could not load your courses." : null;
  const courseExtra = (
    <div className="p-4 border-b border-primary-foreground/10">
      <div className="text-xs text-primary-foreground/35 font-mono uppercase tracking-wide mb-2">Current Course</div>
      {studentCourses.length > 1 && selectedCourse ? (
        <div className="relative">
          <select value={selectedCourse.id} onChange={e => setSelectedCourse(studentCourses.find(c => c.id === e.target.value) ?? null)}
            className="w-full appearance-none bg-primary-foreground/10 text-primary-foreground text-sm font-semibold rounded-lg px-3 py-2 pr-7 focus:outline-none cursor-pointer">
            {studentCourses.map(c => <option key={c.id} value={c.id} style={{ color: "black" }}>{c.name}</option>)}
          </select>
          <ChevronDown size={11} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-primary-foreground/50 pointer-events-none" />
        </div>
      ) : selectedCourse ? (
        <div className="bg-primary-foreground/10 rounded-lg px-3 py-2.5">
          <div className="text-sm font-semibold text-primary-foreground">{selectedCourse.name}</div>
          <div className="text-xs text-primary-foreground/45 font-mono">{selectedCourse.teacher} · {selectedCourse.code}</div>
        </div>
      ) : <div role="status" className="text-xs text-primary-foreground/60">{courseStatus ?? "No approved courses yet"}</div>}
    </div>
  );

  return (
    <div className="min-h-screen flex bg-background">
      <Sidebar title="EduBridge AI" subtitle="Student Portal" initials={initialsFor(profile?.display_name)} name={profile?.display_name ?? "Student"} role="student"
        items={navItems} activeTab={tab} setTab={setTab} onLogout={onLogout} open={sidebarOpen} setOpen={setSidebarOpen}
        extra={courseExtra} />
      <div className="flex-1 min-w-0 lg:ml-64 flex flex-col min-h-screen">
        <header className={`sticky top-0 z-20 backdrop-blur-sm border-b h-14 flex items-center px-6 gap-4 ${tab === "workspace" ? "eb-stage-header" : "bg-background/95 border-border"}`}>
          <button className="lg:hidden" aria-label="Open menu" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
          <h1 className="font-semibold text-foreground text-sm">
            {tab === "workspace" && `Course Q&A${selectedCourse ? ` — ${selectedCourse.name}` : ""}`}
            {tab === "work" && "Show Your Work"}
            {tab === "lab" && "Concept Lab"}
            {tab === "quiz" && "Adaptive Quiz"}
            {tab === "progress" && "My Progress"}
            {tab === "enroll" && "Join a Course"}
            {tab === "settings" && "Settings"}
          </h1>
          <div className="ml-auto relative">
            <button
              onClick={() => setNotifOpen(open => !open)}
              className={`relative w-9 h-9 rounded-xl border flex items-center justify-center transition-colors ${notifOpen ? "border-accent bg-accent/10" : "border-border bg-card hover:bg-muted"}`}
              aria-label="Open notifications"
            >
              <Bell size={16} />
              {notifications.some(item => !item.read) && (
                <span className="absolute -top-1 -right-1 min-w-[17px] h-[17px] px-1 rounded-full bg-accent text-accent-foreground text-[10px] font-bold flex items-center justify-center">
                  {Math.min(99, notifications.filter(item => !item.read).length)}
                </span>
              )}
            </button>
          </div>
        </header>
        <main className="flex-1">
          {selectedCourse && session && <div hidden={tab !== "quiz"}>
            <StudentQuiz key={courseScope} userId={session.user.id} courseId={selectedCourse.id}
              accessToken={session.access_token} onViewProgress={() => setTab("progress")} suggestedFocus={practiceConcept}
              onFocusConsumed={() => setPracticeConcept(null)} darkMode={darkMode} />
          </div>}
          <div hidden={tab === "quiz" && Boolean(selectedCourse && session)}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: "easeOut" }} className="h-full"
            >
              {tab === "workspace" && selectedCourse && <Suspense fallback={<div role="status" className="eb-stage h-[calc(100vh-3.5rem)] p-10 text-sm text-[#A9B6C2]">Opening Q&amp;A…</div>}><AskWorkspace messages={messages} isTyping={isTyping} tutorStatus={tutorStatus} historyStatus={historyStatus} onRetryHistory={() => void restoreHistory()} input={input} setInput={setInput} onSend={() => void handleSend()} onExplain={(index, format) => void handleAlternativeExplanation(index, format)} announcements={courseAnnouncements ?? []} course={selectedCourse} /></Suspense>}
              {tab === "work" && selectedCourse && session && <StudentShowWork courseId={selectedCourse.id} courseName={selectedCourse.name} accessToken={session.access_token} />}
              {tab === "work" && !selectedCourse && <div className="p-8 text-sm text-muted-foreground">Join an approved course before submitting work.</div>}
              {tab === "lab" && selectedCourse && session && <StudentConceptLab courseId={selectedCourse.id} courseName={selectedCourse.name} accessToken={session.access_token} />}
              {tab === "lab" && !selectedCourse && <div className="p-8 text-sm text-muted-foreground">Join an approved course before opening the Concept Lab.</div>}
              {tab === "quiz" && !selectedCourse && <div role="status" className="p-8 text-sm text-muted-foreground">{courseStatus ?? "Join an approved course before generating a quiz."}</div>}
              {tab === "progress" && selectedCourse && session && <StudentProgress courseId={selectedCourse.id} courseName={selectedCourse.name} accessToken={session.access_token} onGoQuiz={() => { setPracticeConcept(null); setTab("quiz"); }} onPractice={concept => { setPracticeConcept(concept); setTab("quiz"); }} />}
              {tab === "enroll" && <StudentEnroll courses={studentCourses} />}
              {tab === "settings" && <StudentSettings courses={studentCourses} darkMode={darkMode} setDarkMode={setDarkMode} />}
            </motion.div>
          </AnimatePresence>
          </div>
        </main>
      </div>
      <NotificationsPanel
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
        notifications={notifications}
        setNotifications={setNotifications}
        onNavigate={navigateStudentNotification}
        accessToken={session?.access_token ?? ""}
      />
    </div>
  );
}

function StudentShowWork({ courseId, courseName, accessToken }: { courseId: string; courseName: string; accessToken: string }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileMimeType, setFileMimeType] = useState("");
  const [context, setContext] = useState("");
  const [submissions, setSubmissions] = useState<WorkSubmission[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    setLoadingHistory(true);
    setFile(null); setFileMimeType(""); setContext("");
    void api.workSubmissions(courseId, accessToken)
      .then(setSubmissions)
      .catch(error => toast.error(error instanceof Error ? error.message : "Could not load submitted work."))
      .finally(() => setLoadingHistory(false));
  }, [accessToken, courseId]);

  const chooseFile = (selected?: File) => {
    if (!selected) return;
    const extension = selected.name.toLowerCase().split(".").pop();
    const inferredType = selected.type || ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" } as Record<string, string>)[extension ?? ""];
    if (!inferredType || !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(inferredType)) { toast.error("Choose a JPG, PNG, WebP, or PDF file."); return; }
    if (selected.size > 8 * 1024 * 1024) { toast.error("The file must be 8 MB or smaller."); return; }
    setFile(selected);
    setFileMimeType(inferredType);
  };

  const submitWork = async () => {
    if (!file || context.trim().length < 3 || analyzing) return;
    setAnalyzing(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("The selected file could not be read."));
        reader.readAsDataURL(file);
      });
      const result = await api.analyzeWork(courseId, {
        filename: file.name, mime_type: fileMimeType, data_base64: dataUrl.split(",")[1] ?? "", context: context.trim(),
      }, accessToken);
      setSubmissions(current => [result, ...current.filter(item => item.id !== result.id)]);
      setFile(null); setFileMimeType(""); setContext("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      toast.success("Your work has been analyzed against the course material");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The submitted work could not be analyzed.");
    } finally {
      setAnalyzing(false);
    }
  };

  const citationLabel = (citation: { document_title: string; page_number: number | null; source_kind: string }) =>
    `${citation.document_title}${citation.page_number ? ` · ${citation.source_kind === "slide" ? "Slide" : "Page"} ${citation.page_number}` : ""}`;

  return <div className="p-6 lg:p-8 max-w-3xl mx-auto">
    <div className="mb-6"><h1 className="font-display text-2xl text-foreground">Show Your Work</h1><p className="text-sm text-muted-foreground mt-1">Upload your reasoning for {courseName}. EduBridge will identify where your steps are strong and where they need revision.</p></div>
    <div className="bg-card border border-border rounded-2xl p-6 shadow-sm mb-6">
      <div className="grid md:grid-cols-[220px_1fr] gap-5">
        <button onClick={() => fileInputRef.current?.click()} className={`min-h-40 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 p-4 text-center transition-colors ${file ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}>
          {file ? <><FileText size={24} className="text-primary" /><span className="text-sm font-semibold text-foreground break-all">{file.name}</span><span className="text-[10px] text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB · Click to replace</span></> : <><Upload size={24} className="text-primary" /><span className="text-sm font-semibold text-foreground">Choose your work</span><span className="text-[10px] text-muted-foreground">JPG, PNG, WebP, or text PDF · 8 MB maximum</span></>}
        </button>
        <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={event => chooseFile(event.target.files?.[0])} />
        <div>
          <label className="text-xs font-semibold text-foreground">What problem or concept are you working on?</label>
          <textarea value={context} onChange={event => setContext(event.target.value)} maxLength={2000} rows={5} placeholder="For example: I am explaining how self-attention uses queries, keys, and values. Please check the reasoning in my diagram." className="w-full mt-2 rounded-xl border border-border bg-background text-foreground px-3 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" />
          <p className="text-[10px] text-muted-foreground mt-1">This context helps retrieve the correct pages from your course. It does not need to contain the answer.</p>
          <button onClick={() => void submitWork()} disabled={!file || context.trim().length < 3 || analyzing} className="w-full mt-3 rounded-xl bg-primary text-primary-foreground py-3 text-sm font-semibold disabled:opacity-40 inline-flex items-center justify-center gap-2">{analyzing ? <><RefreshCw size={14} className="animate-spin" />Reading your reasoning and course evidence…</> : <><Sparkles size={14} />Analyze my work</>}</button>
          <p className="text-[10px] text-muted-foreground text-center mt-2">This action uses AI tokens. Suspected misconceptions require teacher review before affecting mastery.</p>
        </div>
      </div>
    </div>
    <div className="flex items-center justify-between mb-3"><h2 className="font-semibold text-foreground">Recent submissions</h2><span className="text-xs text-muted-foreground">{submissions.length} shown</span></div>
    {loadingHistory ? <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground flex items-center gap-2"><RefreshCw size={14} className="animate-spin" />Loading your work…</div> : <div className="space-y-4">
      {submissions.map(submission => <div key={submission.id} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4"><div><div className="text-sm font-semibold text-foreground">{submission.filename}</div><div className="text-xs text-muted-foreground mt-0.5">{submission.context}</div></div><span className={`text-[10px] font-semibold rounded-full px-2 py-1 ${submission.status === "analyzed" ? "bg-emerald-50 text-emerald-700" : submission.status === "failed" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{submission.status}</span></div>
        {submission.processing_error && <div className="mt-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-800">{submission.processing_error}</div>}
        {submission.analysis && <div className="mt-4">
          <div className="rounded-xl bg-muted/40 p-4"><div className="text-xs font-semibold text-foreground mb-1">Overall feedback</div><p className="text-sm text-muted-foreground leading-relaxed">{submission.analysis.summary}</p>{submission.analysis.strengths.length > 0 && <div className="mt-2 text-xs text-emerald-700"><span className="font-semibold">Strengths:</span> {submission.analysis.strengths.join(" · ")}</div>}</div>
          <div className="space-y-2 mt-3">{submission.analysis.steps.map(step => <div key={step.step_number} className={`rounded-xl border p-3 ${step.status === "correct" ? "border-emerald-200 bg-emerald-50" : step.status === "needs_revision" ? "border-amber-200 bg-amber-50" : "border-border bg-muted/30"}`}><div className="flex items-center gap-2"><span className="text-xs font-semibold text-foreground">Step {step.step_number}</span><span className="text-[10px] uppercase text-muted-foreground">{step.status.replace("_", " ")}</span></div><p className="text-xs text-foreground mt-1">{step.observed_reasoning}</p><p className="text-xs text-muted-foreground mt-1">{step.feedback}</p>{step.citations.length > 0 && <div className="text-[10px] text-primary mt-2">Review: {step.citations.map(citationLabel).join(" · ")}</div>}</div>)}</div>
          {submission.analysis.misconception.detected && <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs text-violet-900"><div className="font-semibold">Possible misconception: {submission.analysis.misconception.concept || submission.analysis.misconception.label}</div><p className="mt-1">{submission.analysis.misconception.explanation}</p><p className="mt-1 text-violet-700">{submission.review_status === "pending" ? "Waiting for teacher review before this affects your mastery record." : submission.review_status === "approved" ? "Your teacher confirmed this learning gap." : submission.review_status === "dismissed" ? "Your teacher dismissed this suggestion." : "This is guidance only."}</p></div>}
          <div className="mt-3 text-xs text-foreground"><span className="font-semibold">Next step:</span> {submission.analysis.next_step}</div>
        </div>}
      </div>)}
      {submissions.length === 0 && <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">No submitted work yet.</div>}
    </div>}
  </div>;
}

function StudentConceptLab({ courseId, courseName, accessToken }: { courseId: string; courseName: string; accessToken: string }) {
  type Walkthrough = Awaited<ReturnType<typeof api.generateWalkthrough>>;
  const [focus, setFocus] = useState("");
  const [walkthrough, setWalkthrough] = useState<Walkthrough | null>(null);
  const [generating, setGenerating] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    setFocus("");
    setWalkthrough(null);
    setStepIndex(0);
    setSelectedOption(null);
    setChecked(false);
    setCompleted(false);
  }, [courseId]);

  const generate = async () => {
    if (focus.trim().length < 2 || generating) return;
    setGenerating(true);
    try {
      const result = await api.generateWalkthrough(courseId, focus.trim(), accessToken);
      setWalkthrough(result);
      setStepIndex(0);
      setSelectedOption(null);
      setChecked(false);
      setCompleted(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the walkthrough.");
    } finally {
      setGenerating(false);
    }
  };

  const resetStep = (nextIndex: number) => {
    setStepIndex(nextIndex);
    setSelectedOption(null);
    setChecked(false);
  };

  if (!walkthrough) return <div className="p-6 lg:p-8 max-w-3xl mx-auto">
    <div className="bg-card border border-border rounded-2xl p-8 shadow-sm">
      <div className="w-12 h-12 rounded-xl bg-violet-100 text-violet-700 flex items-center justify-center mb-5"><Layers size={22} /></div>
      <h1 className="font-display text-2xl text-foreground">Course-Grounded Concept Lab</h1>
      <p className="text-sm text-muted-foreground mt-2 leading-relaxed max-w-xl">Choose a concept from {courseName}. EduBridge will create a short cited walkthrough with scenarios and reasoning checkpoints.</p>
      <div className="mt-6 flex flex-col sm:flex-row gap-3">
        <input value={focus} onChange={event => setFocus(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void generate(); }} maxLength={240} placeholder="e.g. self-attention compared with recurrence" className="flex-1 rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
        <button onClick={() => void generate()} disabled={focus.trim().length < 2 || generating} className="rounded-xl bg-primary text-primary-foreground px-5 py-3 text-sm font-semibold disabled:opacity-40 inline-flex items-center justify-center gap-2">{generating ? <><RefreshCw size={14} className="animate-spin" />Building lab…</> : <><Sparkles size={14} />Generate walkthrough</>}</button>
      </div>
      <div className="mt-4 rounded-xl border border-border bg-muted/40 p-4 grid sm:grid-cols-3 gap-3 text-xs text-muted-foreground">
        <div><span className="font-semibold text-foreground">Grounded</span><br />Every step links to a page or slide.</div>
        <div><span className="font-semibold text-foreground">Interactive</span><br />Reason through one checkpoint at a time.</div>
        <div><span className="font-semibold text-foreground">Cost-aware</span><br />Only generation uses tokens; replay is free.</div>
      </div>
    </div>
  </div>;

  if (completed) return <div className="p-6 lg:p-8 max-w-3xl mx-auto">
    <div className="bg-card border border-border rounded-2xl p-8 shadow-sm text-center">
      <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto mb-4"><CheckCheck size={26} /></div>
      <div className="text-xs font-mono uppercase tracking-wide text-muted-foreground mb-2">Walkthrough complete</div>
      <h1 className="font-display text-2xl text-foreground mb-2">{walkthrough.title}</h1>
      <div className="text-left rounded-xl border border-violet-200 bg-violet-50 p-5 mt-6"><div className="text-xs font-semibold uppercase tracking-wide text-violet-700 mb-2">Transfer challenge</div><p className="text-sm text-violet-950 leading-relaxed">{walkthrough.closing_challenge}</p></div>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button onClick={() => { setCompleted(false); resetStep(0); }} className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-muted inline-flex items-center gap-2"><RotateCcw size={14} />Replay without tokens</button>
        <button onClick={() => setWalkthrough(null)} className="rounded-xl bg-primary text-primary-foreground px-4 py-2.5 text-sm font-semibold">Explore another concept</button>
      </div>
    </div>
  </div>;

  const step = walkthrough.steps[stepIndex];
  const correct = selectedOption === step.checkpoint.correct_option;
  return <div className="p-6 lg:p-8 max-w-3xl mx-auto">
    <div className="flex items-start justify-between gap-4 mb-5">
      <div><div className="text-xs font-mono uppercase tracking-wide text-muted-foreground">{walkthrough.title}</div><h1 className="font-display text-2xl text-foreground mt-1">{step.title}</h1><p className="text-xs text-muted-foreground mt-1">Goal: {walkthrough.learning_goal}</p></div>
      <button onClick={() => setWalkthrough(null)} className="text-xs font-semibold text-primary hover:underline shrink-0">New lab</button>
    </div>
    <div className="flex gap-2 mb-5">{walkthrough.steps.map((item, index) => <div key={`${item.title}-${index}`} className={`h-1.5 rounded-full flex-1 ${index <= stepIndex ? "bg-primary" : "bg-muted"}`} />)}</div>
    <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Step {stepIndex + 1} of {walkthrough.steps.length}</div>
      <div className="text-sm text-foreground leading-relaxed">{renderText(step.explanation)}</div>
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 mt-5"><div className="text-[10px] font-semibold uppercase tracking-wide text-blue-700 mb-1.5">Try this scenario</div><p className="text-sm text-blue-950 leading-relaxed">{step.scenario}</p></div>
      <div className="mt-6"><div className="text-sm font-semibold text-foreground mb-3">{step.checkpoint.question}</div><div className="space-y-2">{step.checkpoint.options.map((option, index) => {
        const optionCorrect = index === step.checkpoint.correct_option;
        const selected = selectedOption === index;
        const stateClass = checked && optionCorrect ? "border-emerald-400 bg-emerald-50" : checked && selected && !optionCorrect ? "border-amber-400 bg-amber-50" : selected ? "border-primary bg-primary/5" : "border-border bg-background hover:bg-muted";
        return <button key={`${option}-${index}`} onClick={() => { if (!checked) setSelectedOption(index); }} disabled={checked} className={`w-full text-left rounded-xl border px-4 py-3 text-sm transition-colors ${stateClass}`}><span className="font-mono text-xs text-muted-foreground mr-2">{String.fromCharCode(65 + index)}.</span>{option}</button>;
      })}</div></div>
      {checked && <div className={`mt-4 rounded-xl border p-4 text-sm ${correct ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}><div className="font-semibold mb-1">{correct ? "Good reasoning" : "Revisit the distinction"}</div>{correct ? step.checkpoint.correct_feedback : step.checkpoint.revision_feedback}</div>}
      <div className="mt-5 flex items-center justify-between gap-3">
        <button onClick={() => resetStep(Math.max(0, stepIndex - 1))} disabled={stepIndex === 0} className="text-sm font-semibold text-muted-foreground disabled:opacity-30">← Previous</button>
        {!checked ? <button onClick={() => setChecked(true)} disabled={selectedOption === null} className="rounded-xl bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold disabled:opacity-40">Check reasoning</button> : <button onClick={() => { if (stepIndex === walkthrough.steps.length - 1) setCompleted(true); else resetStep(stepIndex + 1); }} className="rounded-xl bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold">{stepIndex === walkthrough.steps.length - 1 ? "Finish lab" : "Next step →"}</button>}
      </div>
      {step.citations.length > 0 && <div className="mt-5 pt-4 border-t border-border"><div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Course evidence</div><div className="flex flex-wrap gap-2">{step.citations.map((citation, index) => <span key={`${citation.document_title}-${citation.page_number}-${index}`} className="rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-[10px] text-muted-foreground"><span className="font-medium text-foreground">{citation.document_title}</span>{citation.page_number ? ` · ${citation.source_kind === "slide" ? "Slide" : "Page"} ${citation.page_number}` : ""}</span>)}</div></div>}
    </div>
    <p className="text-[10px] text-muted-foreground text-center mt-3">Checking answers and moving between steps uses no additional AI tokens.</p>
  </div>;
}

const QUIZ_QUESTIONS = [
  {
    topic: "Cell Division — Meiosis",
    question: "Which phase of meiosis is responsible for genetic recombination through crossing over?",
    options: ["Metaphase I", "Prophase I", "Anaphase II", "Telophase I"],
    correct: 1,
    explanation: "Crossing over occurs during **Prophase I**, when homologous chromosomes pair up (synapsis) and exchange DNA segments. This creates new allele combinations and is the primary source of genetic variation in sexual reproduction.",
  },
  {
    topic: "Genetics",
    question: "In a monohybrid cross between two heterozygous parents (Aa × Aa), what is the expected phenotypic ratio?",
    options: ["1:1", "3:1", "1:2:1", "2:1"],
    correct: 1,
    explanation: "The phenotypic ratio is **3:1** (dominant:recessive). The genotypic ratio is 1 AA : 2 Aa : 1 aa. Since both AA and Aa express the dominant phenotype, 3 out of 4 offspring show the dominant trait.",
  },
  {
    topic: "Cell Biology",
    question: "Which organelle is known as the powerhouse of the cell and produces ATP via oxidative phosphorylation?",
    options: ["Ribosome", "Golgi apparatus", "Mitochondria", "Endoplasmic reticulum"],
    correct: 2,
    explanation: "The **mitochondria** produce ATP through oxidative phosphorylation in the inner membrane. The cristae (folds) increase surface area for the electron transport chain, which drives ATP synthase.",
  },
  {
    topic: "DNA Replication",
    question: "DNA replication is described as semi-conservative because:",
    options: [
      "It conserves half the original sequence",
      "Each daughter DNA has one original and one new strand",
      "Only half of the genome is copied",
      "It requires two separate polymerases",
    ],
    correct: 1,
    explanation: "**Semi-conservative** means each new double helix retains one original (parental) strand and one newly synthesized strand. This was confirmed by the Meselson-Stahl experiment using nitrogen isotope labeling.",
  },
];

function StudentQuiz({ userId, courseId, accessToken, onViewProgress, suggestedFocus, onFocusConsumed, darkMode }: {
  userId: string; courseId: string; accessToken: string;
  onViewProgress: () => void;
  suggestedFocus: string | null;
  onFocusConsumed: () => void;
  darkMode: boolean;
}) {
  type GeneratedQuiz = Awaited<ReturnType<typeof api.generateQuiz>>;
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

  if (loading) return <div className="p-8 max-w-2xl mx-auto"><div role="status" className="bg-card border border-border rounded-xl p-6 flex items-center gap-3"><TypingIndicator /><span className="text-sm text-muted-foreground">Generating a quiz from your course materials…</span></div></div>;
  if (!quiz) return (
    <div className="p-6 lg:p-8 max-w-2xl mx-auto">
      <div className="bg-card border border-border rounded-2xl p-8 text-center shadow-sm">
        <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center mx-auto mb-4"><Target size={22} /></div>
        <h2 className="font-display text-2xl text-foreground mb-2">Course-grounded quiz</h2>
        <p className="text-sm text-muted-foreground font-light leading-relaxed max-w-md mx-auto mb-6">
          {suggestedFocus ? <>Generate up to four questions focused on <span className="font-semibold text-foreground">{suggestedFocus}</span> from this course’s uploaded materials.</> : "Generate up to four questions from this course’s uploaded materials. Your quiz stays open when you switch sections."}
        </p>
        {loadError && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-800 mb-4">{loadError}</div>}
        <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }} onClick={() => void loadQuiz(suggestedFocus ?? undefined)}
          className="bg-primary text-primary-foreground px-6 py-3 rounded-xl font-medium shadow-sm inline-flex items-center gap-2">
          <Sparkles size={15} />{loadError ? "Try Again" : suggestedFocus ? "Generate Targeted Practice" : "Generate Quiz"}
        </motion.button>
        <p className="text-[11px] text-muted-foreground mt-3">This action uses AI tokens.</p>
      </div>
    </div>
  );

  const quizQuestions = quiz.questions.map(question => ({
    id: question.id,
    topic: question.concept,
    question: question.prompt,
    options: question.options,
    correct: question.correct_option,
    explanation: question.explanation,
    citations: question.citations,
  }));

  const q = quizQuestions[questionIndex];
  const isLastQuestion = questionIndex === quizQuestions.length - 1;
  const isCorrect = selectedAnswer === q.correct;
  const correctCount = answers.filter((a, i) => a === quizQuestions[i].correct).length;
  const pct = Math.round((correctCount / quizQuestions.length) * 100);

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
      setQuestionIndex(i => i + 1);
      setSelectedAnswer(null);
      setSelectedConfidence(null);
      setShowExplanation(false);
    }
  };

  const retake = () => { void loadQuiz(); };

  if (showResults) {
    const wrongTopics = quizQuestions.filter((_, i) => answers[i] !== quizQuestions[i].correct).map(q => q.topic);
    return (
      <div className="p-6 lg:p-8 max-w-2xl mx-auto">
        {loadError && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{loadError}</p>}
        {/* Score hero */}
        <div className={`rounded-2xl p-6 text-center mb-6 border ${pct >= 75 ? "bg-emerald-50 border-emerald-200" : pct >= 50 ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-200"}`}>
          <div className={`font-display text-6xl mb-1 ${pct >= 75 ? "text-emerald-600" : pct >= 50 ? "text-amber-600" : "text-red-600"}`}>{pct}%</div>
          <div className="font-semibold text-foreground mb-1">
            {pct >= 75 ? "Great work!" : pct >= 50 ? "Good effort" : "Keep practicing"}
          </div>
          <div className="text-sm text-muted-foreground font-light">
            {correctCount} correct out of {quizQuestions.length} questions
          </div>
          {/* Progress dots */}
          <div className="flex gap-2 justify-center mt-4">
            {quizQuestions.map((_, i) => (
              <div key={i} className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                answers[i] === quizQuestions[i].correct ? "bg-emerald-500 text-white" : "bg-red-400 text-white"
              }`}>
                {answers[i] === quizQuestions[i].correct ? "✓" : "✗"}
              </div>
            ))}
          </div>
        </div>

        {/* Question breakdown */}
        <div className="bg-card border border-border rounded-2xl p-5 shadow-sm mb-5">
          <h3 className="font-semibold text-foreground mb-4">Question Breakdown</h3>
          <div className="space-y-3">
            {quizQuestions.map((qq, i) => {
              const correct = answers[i] === qq.correct;
              return (
                <div key={i} className={`flex items-start gap-3 p-3 rounded-xl ${correct ? "bg-emerald-50" : "bg-red-50"}`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${correct ? "bg-emerald-500" : "bg-red-400"} text-white`}>
                    {correct ? <CheckCircle size={13} /> : <X size={13} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-mono text-muted-foreground mb-0.5">{qq.topic}</div>
                    <div className="text-sm text-foreground font-medium leading-snug">{qq.question}</div>
                    {!correct && (
                      <div className="text-xs text-muted-foreground mt-1 font-light">
                        Correct: <span className="font-semibold text-foreground">{qq.options[qq.correct]}</span>
                      </div>
                    )}
                    {!correct && confidences[i] === 3 && (
                      <div className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-800 bg-amber-100 rounded-full px-2 py-0.5 mt-2">
                        <AlertCircle size={10} />Confidence gap — review your reasoning
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Weak areas */}
        {wrongTopics.length > 0 && (
          <div className="bg-card border border-border rounded-2xl p-5 shadow-sm mb-5">
            <h3 className="font-semibold text-foreground mb-1">Areas to Review</h3>
            <p className="text-xs text-muted-foreground font-light mb-4">Focus your next study session on these topics.</p>
            <div className="space-y-2">
              {[...new Set(wrongTopics)].map(topic => (
                <div key={topic} className="flex items-center justify-between p-3 bg-amber-50 border border-amber-200 rounded-xl">
                  <div className="flex items-center gap-2.5">
                    <AlertCircle size={14} className="text-amber-500 shrink-0" />
                    <span className="text-sm font-medium text-foreground">{topic}</span>
                  </div>
                  <button onClick={() => setPracticeTopic(topic)} className="text-xs font-semibold text-primary hover:underline flex items-center gap-1">
                    Practice <ChevronRight size={11} />
                  </button>
                </div>
              ))}
            </div>
            {practiceTopic && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="text-sm font-semibold text-amber-900">Generate targeted practice for {practiceTopic}?</div>
              <p className="text-xs text-amber-800 mt-1">This creates four new AI questions and uses AI tokens.</p>
              <div className="flex gap-2 mt-3">
                <button onClick={() => setPracticeTopic(null)} className="px-3 py-2 rounded-lg border border-amber-300 text-xs font-medium text-amber-900">Cancel</button>
                <button onClick={() => void loadQuiz(practiceTopic)} className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold flex items-center gap-1.5"><Sparkles size={12} />Generate practice</button>
              </div>
            </div>}
          </div>
        )}

        <div className="flex gap-3">
          <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
            onClick={retake}
            className="flex-1 border border-border text-foreground py-3 rounded-xl font-medium hover:bg-muted transition-colors text-sm flex items-center justify-center gap-2">
            <RotateCcw size={14} />Start new quiz
          </motion.button>
          <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }} onClick={onViewProgress}
            className="flex-1 bg-primary text-primary-foreground py-3 rounded-xl font-medium shadow-sm text-sm flex items-center justify-center gap-2">
            <TrendingUp size={14} />View Progress
          </motion.button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-2xl mx-auto">
      <div className="mb-4 flex justify-end">
        <button type="button" disabled={savingAttempt} onClick={() => setReplaceQuiz(open => !open)}
          aria-expanded={replaceQuiz} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50">
          {suggestedFocus ? "Start targeted quiz" : "Start new quiz"}
        </button>
      </div>
      {replaceQuiz && <div className="mb-4 rounded-xl border border-border bg-card p-4 text-sm">
        <p>Starting a new quiz will replace your unfinished quiz once the new questions are ready.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => setReplaceQuiz(false)} className="rounded-lg border border-border px-3 py-1.5 font-medium hover:bg-muted">Keep current quiz</button>
          <button type="button" onClick={() => void loadQuiz(suggestedFocus ?? undefined)} className="rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground hover:opacity-90">Generate new quiz</button>
        </div>
      </div>}
      {loadError && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{loadError}</p>}
      {quiz.prerequisite_concepts.length > 0 && quiz.focus_concept && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 mb-5">
        <div className="text-xs font-semibold text-emerald-900 mb-1">Prerequisite-aware practice</div>
        <div className="text-xs text-emerald-800 flex flex-wrap items-center gap-1.5">
          {[...quiz.prerequisite_concepts, quiz.focus_concept].map((concept, index, path) => <span key={`${concept}-${index}`} className="inline-flex items-center gap-1.5"><span className="font-medium">{concept}</span>{index < path.length - 1 && <ArrowRight size={11} />}</span>)}
        </div>
        <p className="text-[11px] text-emerald-800/80 mt-1.5">The quiz checks the earliest required concept before moving to the target concept.</p>
      </div>}
      <div className="flex items-center justify-between mb-7">
        <div className="text-sm text-muted-foreground font-light">
          Question <span className="font-semibold text-foreground font-mono">{questionIndex + 1}</span> of <span className="font-mono">{quizQuestions.length}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-wide rounded-full border border-border bg-muted px-2 py-1 text-muted-foreground">{quiz.difficulty_mode}</span>
          <div className="flex gap-1">
          {quizQuestions.map((_, i) => (
            <div key={i} className={`h-1.5 w-7 rounded-full transition-colors ${i < questionIndex ? "bg-emerald-500" : i === questionIndex ? "bg-primary" : "bg-muted"}`} />
          ))}
          </div>
        </div>
      </div>
      <div className="bg-card border border-border rounded-xl p-6 mb-5 shadow-sm">
        <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono uppercase tracking-wide mb-4">
          <Target size={12} className="shrink-0" />{q.topic}
        </div>
        <p className="text-foreground font-medium leading-relaxed">{q.question}</p>
      </div>
      <div className="space-y-3 mb-6">
        {q.options.map((option, i) => {
          const isSelected = selectedAnswer === i;
          const isRight = showExplanation && i === q.correct;
          const isWrong = showExplanation && isSelected && !isCorrect;
          return (
            <motion.button key={i} whileTap={!showExplanation ? { scale: 0.98 } : {}}
              onClick={() => { if (!showExplanation) setSelectedAnswer(i); }}
              aria-pressed={isSelected}
              className={`w-full text-left px-4 py-3.5 rounded-xl border text-sm font-medium transition-all shadow-sm ${
                isRight ? "border-emerald-400 bg-emerald-50 text-emerald-800" :
                isWrong ? "border-red-300 bg-red-50 text-red-800" :
                isSelected ? "border-primary bg-primary/5 text-primary" :
                "border-border bg-card text-foreground hover:border-primary/40 hover:bg-muted/40"
              }`}
            >
              <span className="flex items-center gap-3">
                <span className="font-mono text-xs shrink-0 tabular-nums">{String.fromCharCode(65 + i)}.</span>
                <span className="flex-1">{option}</span>
                <AnimatePresence>
                  {isRight && <motion.span key="check" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", bounce: 0.4 }}><CheckCircle size={15} className="text-emerald-600 shrink-0" /></motion.span>}
                  {isWrong && <motion.span key="x" initial={{ scale: 0 }} animate={{ scale: 1 }}><X size={15} className="text-red-500 shrink-0" /></motion.span>}
                </AnimatePresence>
              </span>
            </motion.button>
          );
        })}
      </div>
      {selectedAnswer !== null && !showExplanation && (
        <div className="bg-card border border-border rounded-xl p-4 mb-4 shadow-sm">
          <div className="text-sm font-semibold text-foreground mb-1">How confident are you?</div>
          <p className="text-xs text-muted-foreground mb-3">Choose before seeing the answer. This helps distinguish a guess from a stable misunderstanding.</p>
          <div className="grid grid-cols-3 gap-2">
            {[{ value: 1, label: "Not sure" }, { value: 2, label: "Somewhat sure" }, { value: 3, label: "Very sure" }].map(option => (
              <button key={option.value} onClick={() => setSelectedConfidence(option.value)} aria-pressed={selectedConfidence === option.value}
                className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${selectedConfidence === option.value ? "bg-primary text-primary-foreground border-primary" : "bg-background text-foreground border-border hover:bg-muted"}`}>
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <AnimatePresence mode="wait">
        {selectedAnswer !== null && !showExplanation && (
          <motion.button key="check" initial={{ opacity: 1 }} exit={{ opacity: 0 }}
            whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
            disabled={selectedConfidence === null}
            onClick={() => setShowExplanation(true)}
            className="w-full bg-primary text-primary-foreground py-3 rounded-xl font-medium shadow-sm disabled:opacity-40"
          >Check Answer</motion.button>
        )}
        {showExplanation && (
          <motion.div key="result" initial={{ opacity: 1 }}>
            <div className={`rounded-xl p-5 mb-4 border text-sm leading-relaxed shadow-sm ${isCorrect ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-800"}`}>
              <div className="font-semibold mb-2 flex items-center gap-2">
                {isCorrect ? <><CheckCircle size={16} className="text-emerald-600" />Correct!</> : <><X size={16} className="text-red-500" />Not quite.</>}
              </div>
              <div>{renderText(q.explanation)}</div>
              {q.citations.length > 0 && (
                <div className="mt-3 grid gap-1.5 border-t border-current/15 pt-3">
                  <span className="text-xs font-semibold">Review the course source</span>
                  <CourseCitationList courseId={courseId} citations={q.citations} darkMode={darkMode} />
                </div>
              )}
            </div>
            <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
              onClick={() => void handleNext()}
              disabled={savingAttempt}
              className="w-full border border-border text-foreground py-3 rounded-xl font-medium hover:bg-muted transition-colors text-sm shadow-sm disabled:opacity-50 flex items-center justify-center gap-2"
            >{savingAttempt && <RefreshCw size={14} className="animate-spin" />}{savingAttempt ? "Saving attempt…" : isLastQuestion ? "See Results →" : "Next Question →"}</motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StudentProgress({ courseId, courseName, accessToken, onGoQuiz, onPractice }: { courseId: string; courseName: string; accessToken: string; onGoQuiz: () => void; onPractice: (concept: string) => void }) {
  type ProgressData = Awaited<ReturnType<typeof api.courseProgress>>;
  type MasteryData = Awaited<ReturnType<typeof api.conceptMastery>>;
  type MisconceptionData = Awaited<ReturnType<typeof api.myMisconceptions>>;
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [mastery, setMastery] = useState<MasteryData>([]);
  const [misconceptions, setMisconceptions] = useState<MisconceptionData>([]);
  const [activeMisconception, setActiveMisconception] = useState<MisconceptionData[number] | null>(null);
  const [checkMode, setCheckMode] = useState<"teach-back" | "retention">("teach-back");
  const [loading, setLoading] = useState(true);
  type StudyPlan = Awaited<ReturnType<typeof api.studyPlan>>;
  const [planItems, setPlanItems] = useState<StudyPlan>([]);
  const doneCount = planItems.filter(item => item.status === "completed").length;

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
    }).catch(error => toast.error(error instanceof Error ? error.message : "Could not load progress.")).finally(() => setLoading(false));
  }, [courseId, accessToken]);

  const toggleDone = async (id: string) => {
    const item = planItems.find(plan => plan.id === id);
    if (!item) return;
    const completed = item.status !== "completed";
    setPlanItems(previous => previous.map(plan => plan.id === id ? { ...plan, status: completed ? "completed" : "pending", completed_at: completed ? new Date().toISOString() : null } : plan));
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

  const priorityStyle = (priority: "high" | "medium" | "low") =>
    priority === "high" ? "bg-red-100 text-red-700 border-red-200" : priority === "medium" ? "bg-amber-100 text-amber-700 border-amber-200" : "bg-blue-100 text-blue-700 border-blue-200";
  if (loading) return <div className="p-8 max-w-4xl mx-auto"><div className="bg-card border border-border rounded-xl p-6 flex items-center gap-3"><TypingIndicator /><span className="text-sm text-muted-foreground">Loading your progress…</span></div></div>;
  if (!progress) return <div className="p-8 text-sm text-muted-foreground">Progress is currently unavailable.</div>;
  const topicData = progress.topic_scores.map(row => ({ subject: row.topic, score: row.score }));
  const masteryStyle = (status: MasteryData[number]["status"]) => {
    if (status === "strong") return { label: "Strong", color: "text-emerald-700 bg-emerald-50 border-emerald-200", bar: "bg-emerald-500" };
    if (status === "developing") return { label: "Developing", color: "text-blue-700 bg-blue-50 border-blue-200", bar: "bg-blue-500" };
    if (status === "verified_once") return { label: "Verified Once", color: "text-emerald-700 bg-emerald-50 border-emerald-200", bar: "bg-emerald-400" };
    if (status === "needs_review") return { label: "Needs Review", color: "text-amber-700 bg-amber-50 border-amber-200", bar: "bg-amber-500" };
    return { label: "Not Started", color: "text-muted-foreground bg-muted border-border", bar: "bg-muted-foreground/30" };
  };

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="font-display text-2xl text-primary">My Progress</h1>
        <p className="text-sm text-muted-foreground mt-1 font-light">{courseName} — results from your completed quizzes</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-7">
        {[
          { label: "Average Score", val: `${progress.average_score}%`, icon: Award, color: "text-emerald-600", bg: "bg-emerald-50" },
          { label: "Quizzes Taken", val: String(progress.quiz_count), icon: Target, color: "text-blue-600", bg: "bg-blue-50" },
          { label: "Best Score", val: `${progress.best_score}%`, icon: TrendingUp, color: "text-purple-600", bg: "bg-purple-50" },
          { label: "Weak Topics", val: String(progress.weak_topics.length), icon: AlertCircle, color: "text-amber-600", bg: "bg-amber-50" },
        ].map(s => (
          <motion.div key={s.label} whileHover={{ y: -2, boxShadow: "0 4px 16px rgba(0,0,0,0.07)" }}
            className="bg-card border border-border rounded-xl p-4 text-center shadow-sm cursor-default"
          >
            <div className={`w-9 h-9 ${s.bg} rounded-xl flex items-center justify-center mx-auto mb-2.5`}>
              <s.icon size={18} className={s.color} />
            </div>
            <div className="font-display text-2xl text-primary">{s.val}</div>
            <div className="text-xs text-muted-foreground mt-0.5 font-light">{s.label}</div>
          </motion.div>
        ))}
      </div>

      {/* Persistent concept profile */}
      <div className="bg-card border border-border rounded-xl p-6 shadow-sm mb-6">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="font-semibold text-foreground">My Concept Profile</h2>
            <p className="text-xs text-muted-foreground mt-1 font-light">Built from quiz answers and misconception evidence. No additional AI tokens are used.</p>
          </div>
          <span className="text-xs font-mono text-muted-foreground shrink-0">{mastery.length} concepts</span>
        </div>
        {mastery.length ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {mastery.map(item => {
              const style = masteryStyle(item.status);
              return (
                <div key={item.concept} className={`border rounded-xl p-4 ${item.review_due ? "ring-2 ring-amber-200" : "border-border"}`}>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="text-sm font-semibold text-foreground leading-snug">{item.concept}</div>
                    <span className={`text-[10px] font-semibold border rounded-full px-2 py-0.5 shrink-0 ${style.color}`}>{style.label}</span>
                  </div>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden flex-1">
                      <div className={`h-full rounded-full ${style.bar}`} style={{ width: `${item.mastery_score ?? 0}%` }} />
                    </div>
                    <span className="text-xs font-mono text-muted-foreground min-w-9 text-right">{item.mastery_score === null ? "—" : `${Math.round(item.mastery_score)}%`}</span>
                  </div>
                  {!item.evidence_sufficient && <div className="text-[10px] text-muted-foreground mb-2">Not enough evidence for a reliable percentage yet.</div>}
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground font-mono">
                    <span>{item.correct_answers}/{item.total_answers} quiz answers</span>
                    <span>{item.completed_teach_backs} teach-back {item.completed_teach_backs === 1 ? "check" : "checks"}</span>
                    <span>{Math.round(item.confidence * 100)}% evidence confidence</span>
                    {item.open_misconceptions > 0 && <span className="text-amber-700">{item.open_misconceptions} open misconception{item.open_misconceptions === 1 ? "" : "s"}</span>}
                    {item.review_due && <span className="text-amber-700 font-semibold">Review due</span>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="border border-dashed border-border rounded-xl p-6 text-center text-sm text-muted-foreground">
            Complete a quiz or use Course Q&amp;A to begin building your concept profile.
          </div>
        )}
      </div>

      {/* Teach-back verification */}
      {misconceptions.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm mb-6">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div>
              <h2 className="font-semibold text-foreground">Check My Understanding</h2>
              <p className="text-xs text-muted-foreground mt-1 font-light">Explain a flagged concept in your own words to verify that the distinction is now clear.</p>
            </div>
            <Brain size={18} className="text-purple-500 shrink-0" />
          </div>
          <div className="space-y-3">
            {misconceptions.map(item => {
              const retentionDue = item.retention_status === "due" || Boolean(item.retention_due_at && new Date(item.retention_due_at) <= new Date());
              const retained = item.retention_status === "retained";
              return (
              <div key={item.id} className="flex items-center gap-4 border border-border rounded-xl p-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-foreground">{item.concept}</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${retained ? "bg-purple-50 text-purple-700" : item.learning_status === "verified" ? "bg-emerald-50 text-emerald-700" : item.learning_status === "improving" ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"}`}>
                      {retained ? "Retained" : item.learning_status === "verified" ? retentionDue ? "Retention check due" : "Verified" : item.learning_status === "improving" ? "Improving" : "Ready to check"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{item.explanation}</p>
                </div>
                {item.learning_status !== "verified" ? (
                  <button onClick={() => { setCheckMode("teach-back"); setActiveMisconception(item); }} className="bg-primary text-primary-foreground rounded-lg px-3 py-2 text-xs font-semibold shrink-0">
                    Check understanding
                  </button>
                ) : retained ? <CheckCheck size={18} className="text-purple-500 shrink-0" /> : retentionDue ? (
                  <button onClick={() => { setCheckMode("retention"); setActiveMisconception(item); }} className="bg-purple-600 text-white rounded-lg px-3 py-2 text-xs font-semibold shrink-0">
                    Check retention
                  </button>
                ) : <div className="text-right shrink-0"><CheckCheck size={18} className="text-emerald-500 ml-auto" />{item.retention_due_at && <div className="text-[10px] text-muted-foreground mt-1">Due {new Date(item.retention_due_at).toLocaleDateString()}</div>}</div>}
              </div>
            );})}
          </div>
          <p className="text-[10px] text-muted-foreground mt-3">Generating and evaluating a teach-back check uses AI tokens only when you choose to start it.</p>
        </div>
      )}

      {/* Charts row */}
      {topicData.length > 0 ? <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <h2 className="font-semibold text-foreground mb-0.5">Topic Mastery Radar</h2>
          <p className="text-xs text-muted-foreground font-mono mb-4 font-light">Across all covered topics</p>
          <ResponsiveContainer width="100%" height={240}>
            <RadarChart data={topicData} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
              <PolarGrid stroke="rgba(17,24,39,0.08)" />
              <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <Radar name="Mastery" dataKey="score" stroke="#E8A020" fill="#E8A020" fillOpacity={0.18} strokeWidth={2} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <h2 className="font-semibold text-foreground mb-0.5">Topic Breakdown</h2>
          <p className="text-xs text-muted-foreground font-mono mb-5 font-light">Score per topic area</p>
          <div className="space-y-4">
            {topicData.map((d, i) => (
              <div key={d.subject}>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-foreground font-medium">{d.subject}</span>
                  <span className="font-mono text-muted-foreground tabular-nums">{d.score}%</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <motion.div
                    className={`h-full rounded-full ${d.score >= 80 ? "bg-emerald-500" : d.score >= 60 ? "bg-amber-500" : "bg-red-500"}`}
                    initial={{ width: 0 }} animate={{ width: `${d.score}%` }}
                    transition={{ duration: 0.8, ease: "easeOut", delay: i * 0.08 }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div> : <div className="bg-card border border-border rounded-xl p-8 text-center mb-6"><Target size={24} className="text-muted-foreground/40 mx-auto mb-3" /><h2 className="font-semibold text-foreground mb-1">No completed quizzes yet</h2><p className="text-sm text-muted-foreground mb-4">Complete a course-grounded quiz to start building your progress report.</p><button onClick={onGoQuiz} className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm">Take your first quiz</button></div>}

      {/* AI Study Plan — interactive checklist */}
      {planItems.length > 0 && <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold text-foreground">AI Study Plan</h2>
          <span className="text-xs font-mono text-muted-foreground">{doneCount}/{planItems.length} done</span>
        </div>
        <p className="text-xs text-muted-foreground font-light mb-2">Personalized recommendations based on your weak areas.</p>
        {/* Progress bar */}
        <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-5">
          <motion.div className="h-full bg-emerald-500 rounded-full"
            animate={{ width: `${(doneCount / planItems.length) * 100}%` }}
            transition={{ duration: 0.4 }} />
        </div>
        <div className="space-y-3">
          {planItems.map(plan => (
            <motion.div key={plan.id} layout
              className={`flex gap-4 p-4 rounded-xl border transition-colors ${plan.status === "completed" ? "bg-muted/30 border-border" : "bg-muted/40 border-transparent hover:bg-muted/70"}`}>
              <button onClick={() => void toggleDone(plan.id)} className="shrink-0 mt-0.5">
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${plan.status === "completed" ? "bg-emerald-500 border-emerald-500" : "border-muted-foreground/30"}`}>
                  {plan.status === "completed" && <CheckCheck size={11} className="text-white" />}
                </div>
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border capitalize ${priorityStyle(plan.priority)} ${plan.status === "completed" ? "opacity-50" : ""}`}>
                    {plan.priority}
                  </span>
                  <span className={`text-sm font-semibold text-foreground ${plan.status === "completed" ? "line-through opacity-40" : ""}`}>{plan.concept}</span>
                  {plan.action.startsWith("Prerequisite first:") && <span className="text-[10px] font-semibold rounded-full bg-violet-50 text-violet-700 px-2 py-0.5">Learn this first</span>}
                  <span className="text-xs font-mono text-muted-foreground/60 ml-auto">Due {new Date(plan.due_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                </div>
                <div className={`text-xs text-muted-foreground font-light leading-relaxed ${plan.status === "completed" ? "opacity-40" : ""}`}>{plan.action}</div>
              </div>
              {plan.status !== "completed" && (
                <button onClick={() => onPractice(plan.concept)} className="text-xs font-semibold text-primary hover:underline shrink-0 mt-0.5 flex items-center gap-0.5">
                  Practice now <ChevronRight size={11} />
                </button>
              )}
            </motion.div>
          ))}
        </div>
      </div>}

      {/* Quiz History */}
      <div className="bg-card border border-border rounded-xl p-6 shadow-sm mt-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold text-foreground">Quiz History</h2>
          <button onClick={onGoQuiz}
            className="text-xs font-medium text-primary hover:underline flex items-center gap-1">
            Take a quiz <ChevronRight size={11} />
          </button>
        </div>
        <p className="text-xs text-muted-foreground font-light mb-5">All past attempts — most recent first.</p>
        <div className="space-y-0">
          {progress.attempts.map((attempt, i) => {
            const pct = attempt.score;
            return (
              <div key={attempt.id} className={`flex items-center gap-4 py-3.5 ${i < progress.attempts.length - 1 ? "border-b border-border" : ""}`}>
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-xs font-bold ${pct === 100 ? "bg-emerald-50 text-emerald-600" : pct >= 75 ? "bg-blue-50 text-blue-600" : pct >= 50 ? "bg-amber-50 text-amber-600" : "bg-red-50 text-red-600"}`}>
                  {pct}%
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">{attempt.title}</div>
                  <div className="text-xs text-muted-foreground font-light">{attempt.correct}/{attempt.total} correct</div>
                </div>
                <div className="text-xs font-mono text-muted-foreground/60 shrink-0">{new Date(attempt.completed_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div>
              </div>
            );
          })}
          {progress.attempts.length === 0 && <div className="text-sm text-muted-foreground py-4">No completed quiz attempts yet.</div>}
        </div>
      </div>
      {activeMisconception && (
        <TeachBackModal
          courseId={courseId}
          courseName={courseName}
          misconception={activeMisconception}
          mode={checkMode}
          accessToken={accessToken}
          onClose={() => setActiveMisconception(null)}
          onComplete={refreshLearningEvidence}
        />
      )}
    </div>
  );
}

function TeachBackModal({ courseId, courseName, misconception, mode, accessToken, onClose, onComplete }: {
  courseId: string;
  courseName: string;
  misconception: Awaited<ReturnType<typeof api.myMisconceptions>>[number];
  mode: "teach-back" | "retention";
  accessToken: string;
  onClose: () => void;
  onComplete: () => Promise<void>;
}) {
  type Start = Awaited<ReturnType<typeof api.startTeachBack>>;
  type Result = Awaited<ReturnType<typeof api.submitTeachBack>>;
  const [check, setCheck] = useState<Start | null>(null);
  const [response, setResponse] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
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
      .catch(cause => setError(cause instanceof Error ? cause.message : "Could not create the understanding check."))
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
      setError(cause instanceof Error ? cause.message : "Could not evaluate your explanation.");
    } finally {
      setSubmitting(false);
    }
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Voice recording is not supported in this browser. You can still type your explanation.");
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
          setError("The browser could not read this recording. Please try again.");
        };
        reader.readAsDataURL(blob);
      };
      recorder.start(250);
      setRecording(true);
      autoStopRef.current = window.setTimeout(stopRecording, 90_000);
    } catch (cause) {
      releaseMicrophone();
      setError(cause instanceof DOMException && cause.name === "NotAllowedError"
        ? "Microphone permission was denied. Allow microphone access or type your explanation."
        : "The microphone could not be started. You can still type your explanation.");
    }
  };

  const citations = result?.citations ?? check?.citations ?? [];
  return <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden">
      <div className="px-6 py-5 border-b border-border flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0"><Brain size={16} /></div>
        <div className="flex-1"><h2 className="font-semibold text-foreground">{mode === "retention" ? "Retention check" : "Teach-back check"}</h2><p className="text-xs text-muted-foreground mt-0.5">{courseName} · {misconception.concept}</p></div>
        <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground"><X size={15} /></button>
      </div>
      <div className="p-6">
        {loading ? <div className="flex items-center gap-3 text-sm text-muted-foreground py-8 justify-center"><TypingIndicator />Creating one grounded question…</div> : error && !check ? <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-4">{error}</div> : check && !result ? <>
          <div className="bg-muted/50 border border-border rounded-xl p-4 mb-4"><div className="text-[10px] font-mono uppercase text-muted-foreground mb-2">Explain in your own words</div><p className="text-sm font-medium text-foreground leading-relaxed">{check.question}</p></div>
          <textarea value={response} onChange={event => setResponse(event.target.value)} rows={6} placeholder="Type your explanation, or record it below…" disabled={recording || transcribing} className="w-full border border-border rounded-xl px-4 py-3 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none disabled:opacity-60" />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={recording ? stopRecording : () => void startRecording()}
              disabled={transcribing || submitting}
              className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-semibold transition-colors disabled:opacity-40 ${recording ? "border-red-300 bg-red-50 text-red-700" : "border-border bg-card text-foreground hover:bg-muted"}`}
            >
              {recording ? <><Square size={13} fill="currentColor" />Stop recording · {recordingSeconds}s</> : transcribing ? <><TypingIndicator />Transcribing…</> : <><Mic size={14} />Record explanation</>}
            </button>
            <span className="text-[10px] text-muted-foreground">Maximum 90 seconds. Audio is transcribed, not stored.</span>
          </div>
          {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
          <button onClick={() => void submit()} disabled={response.trim().length < 10 || submitting || recording || transcribing} className="w-full mt-4 bg-primary text-primary-foreground rounded-xl py-3 text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-2">
            {submitting ? <><TypingIndicator />Checking your explanation…</> : <><CheckCircle size={14} />{mode === "retention" ? "Submit retention check" : "Submit teach-back"}</>}
          </button>
        </> : result ? <>
          <div className={`border rounded-xl p-5 ${result.verdict === "corrected" ? "bg-emerald-50 border-emerald-200" : result.verdict === "improving" ? "bg-blue-50 border-blue-200" : "bg-amber-50 border-amber-200"}`}>
            <div className="font-semibold text-foreground mb-2">{result.verdict === "corrected" ? mode === "retention" ? "Retention verified" : "Understanding verified" : result.verdict === "improving" ? "You’re making progress" : "This needs another review"}</div>
            <p className="text-sm text-muted-foreground leading-relaxed">{result.feedback}</p>
          </div>
          <button onClick={onClose} className="w-full mt-4 bg-primary text-primary-foreground rounded-xl py-3 text-sm font-semibold">Return to My Progress</button>
        </> : null}
        {citations.length > 0 && <div className="mt-5"><div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Course evidence</div><div className="space-y-1.5">{citations.map((citation, index) => <div key={`${citation.document_title}-${citation.page_number}-${index}`} className="text-xs border border-border bg-muted/40 rounded-lg px-3 py-2 flex gap-2"><FileText size={12} className="text-primary shrink-0" /><span className="truncate">{citation.document_title}</span>{citation.page_number && <span className="ml-auto shrink-0">{citation.source_kind === "slide" ? "Slide" : "Page"} {citation.page_number}</span>}</div>)}</div></div>}
      </div>
    </motion.div>
  </div>;
}

// ─── Document Viewer Modal ────────────────────────────────────────────────

const DOC_MOCK_CONTENT: Record<string, string[]> = {
  "Chapter 12 — Cell Division.pdf": [
    "Chapter 12: Cell Division",
    "12.1 Introduction to Cell Division",
    "Cell division is the process by which a parent cell divides into two or more daughter cells. Cell division is part of the life cycle of virtually all organisms.\n\nIn multicellular organisms, cell division serves two main purposes: (1) growth and repair of tissues, and (2) asexual reproduction in single-celled organisms.",
    "12.2 Mitosis",
    "Mitosis is a form of eukaryotic cell division that produces two daughter cells with the same number and kind of chromosomes as the parent nucleus, typical of ordinary tissue growth.\n\nPhases: Prophase → Metaphase → Anaphase → Telophase → Cytokinesis",
    "12.3 Meiosis",
    "Meiosis is a specialized form of cell division that reduces the chromosome number by half, from diploid (2n) to haploid (n), creating four genetically unique gametes.\n\nKey event: Crossing over during Prophase I creates new allele combinations — the primary source of genetic variation in sexual reproduction.",
  ],
  "Lecture Notes Week 4.pdf": [
    "Week 4 Lecture Notes",
    "Topic: DNA Structure and Replication",
    "DNA is a double helix composed of two antiparallel strands connected by hydrogen bonds between complementary base pairs:\n• Adenine (A) pairs with Thymine (T)\n• Guanine (G) pairs with Cytosine (C)",
    "Semi-Conservative Replication",
    "Each strand of the original DNA serves as a template for a new complementary strand. The result: two daughter molecules, each containing one original and one newly synthesized strand.\n\nKey enzymes: DNA helicase (unwinds), DNA polymerase (builds new strand), DNA ligase (seals fragments).",
  ],
};

const GENERIC_PAGES = [
  "This document contains course-specific content for Biology 101.",
  "All materials are grounded in peer-reviewed sources and align with the course curriculum.",
  "Page content indexed and available for AI-powered Q&A through the Course Workspace.",
];

function DocViewerModal({ doc, onClose }: { doc: UploadedDoc; onClose: () => void }) {
  const [page, setPage] = useState(0);
  const content = DOC_MOCK_CONTENT[doc.name] ?? GENERIC_PAGES;
  const totalPages = doc.pages ?? content.length;
  const currentContent = content[page % content.length];
  const isHeading = !currentContent.includes("\n") && currentContent.length < 50;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: "min(700px, 90vh)" }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border shrink-0">
          <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
            <FileText size={16} className="text-red-500" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-foreground text-sm truncate">{doc.name}</div>
            <div className="text-xs text-muted-foreground font-light">{doc.size} · {totalPages} pages · Uploaded {doc.uploadedAt}</div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-lg transition-colors text-muted-foreground">
            <X size={16} />
          </button>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto p-8">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={page}
              initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.15 }}
              className="max-w-prose mx-auto"
            >
              {isHeading ? (
                <h2 className="font-display text-xl text-primary mb-4">{currentContent}</h2>
              ) : (
                <p className="text-sm text-foreground leading-relaxed font-light whitespace-pre-line">{currentContent}</p>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer nav */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-muted/30 shrink-0">
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
            onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors">
            ← Previous
          </motion.button>
          <span className="text-xs font-mono text-muted-foreground">Page {page + 1} of {content.length}</span>
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
            onClick={() => setPage(p => Math.min(content.length - 1, p + 1))} disabled={page === content.length - 1}
            className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors">
            Next →
          </motion.button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Course Create Modal ──────────────────────────────────────────────────

const SUBJECT_OPTIONS = ["Biology", "Chemistry", "Physics", "Mathematics", "Computer Science", "History", "English", "Other"];
const DEFAULT_TOPICS = ["Cell Biology", "Genetics", "Evolution", "Ecology", "Biochemistry", "Anatomy"];

function CourseCreateModal({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (input: {
    name: string;
    subject: string;
    description: string;
    code: string;
    topics: { name: string; weight: "high" | "medium" | "low" }[];
  }) => Promise<void>;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("Biology");
  const [description, setDescription] = useState("");
  const [topics, setTopics] = useState(DEFAULT_TOPICS.map(t => ({ name: t, weight: "medium" as "high" | "medium" | "low", enabled: true })));
  const [generatedCode, setGeneratedCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);

  const generateCode = () => {
    const prefix = subject.slice(0, 3).toUpperCase();
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `${prefix}-${suffix}`;
  };

  const goStep2 = () => { if (!name.trim()) return; setStep(2); };
  const goStep3 = async () => {
    const code = generateCode();
    setCreating(true);
    try {
      await onCreate({
        name,
        subject,
        description,
        code,
        topics: topics
          .filter(topic => topic.enabled && topic.name.trim())
          .map(topic => ({ name: topic.name.trim(), weight: topic.weight })),
      });
      setGeneratedCode(code);
      setStep(3);
      toast.success(`Course "${name}" created!`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the course.");
    } finally {
      setCreating(false);
    }
  };
  const finish = () => onClose();

  const copyCode = () => {
    navigator.clipboard.writeText(generatedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const weightColor = (w: string) => w === "high" ? "text-red-600 bg-red-50 border-red-200" : w === "medium" ? "text-amber-600 bg-amber-50 border-amber-200" : "text-blue-600 bg-blue-50 border-blue-200";
  const weightNext = (w: "high" | "medium" | "low") => w === "high" ? "medium" : w === "medium" ? "low" : "high";

  const STEPS = ["Course Basics", "Topic Weights", "Generate Code"];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-xl text-primary">Create New Course</h2>
            <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-lg transition-colors text-muted-foreground">
              <X size={16} />
            </button>
          </div>
          {/* Step indicator */}
          <div className="flex items-center gap-0">
            {STEPS.map((s, i) => (
              <React.Fragment key={s}>
                <div className="flex items-center gap-2">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                    step > i + 1 ? "bg-emerald-500 text-white" : step === i + 1 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                  }`}>
                    {step > i + 1 ? <CheckCheck size={12} /> : i + 1}
                  </div>
                  <span className={`text-xs font-medium hidden sm:block ${step === i + 1 ? "text-foreground" : "text-muted-foreground"}`}>{s}</span>
                </div>
                {i < STEPS.length - 1 && <div className={`flex-1 h-px mx-3 transition-colors ${step > i + 1 ? "bg-emerald-300" : "bg-border"}`} />}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Step content */}
        <AnimatePresence mode="wait" initial={false}>
          {step === 1 && (
            <motion.div key="step1" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.18 }}
              className="px-6 py-5 space-y-4"
            >
              <div>
                <label className="text-sm font-medium text-foreground block mb-1.5">Course Name <span className="text-red-500">*</span></label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Advanced Biology"
                  className="w-full border border-border rounded-xl px-4 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground block mb-1.5">Subject</label>
                <div className="relative">
                  <select value={subject} onChange={e => setSubject(e.target.value)}
                    className="w-full border border-border rounded-xl px-4 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring appearance-none">
                    {SUBJECT_OPTIONS.map(s => <option key={s}>{s}</option>)}
                  </select>
                  <ChevronDown size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground block mb-1.5">Description <span className="text-muted-foreground font-normal">(optional)</span></label>
                <textarea value={description} onChange={e => setDescription(e.target.value)}
                  rows={3} placeholder="Brief description of what this course covers..."
                  className="w-full border border-border rounded-xl px-4 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none" />
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div key="step2" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.18 }}
              className="px-6 py-5"
            >
              <p className="text-xs text-muted-foreground font-light mb-4 leading-relaxed">
                Set the weight for each topic. The AI quiz engine will generate more questions for high-weight topics.
              </p>
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {topics.map((t, i) => (
                  <div key={t.name} className="flex items-center gap-3 py-2 border-b border-border last:border-0">
                    <button onClick={() => setTopics(prev => prev.map((tt, j) => j === i ? { ...tt, enabled: !tt.enabled } : tt))}
                      className={`shrink-0 ${t.enabled ? "text-primary" : "text-muted-foreground/40"}`}>
                      {t.enabled ? <CheckSquare size={16} /> : <CheckSquare size={16} />}
                    </button>
                    <input
                      value={t.name}
                      onChange={event => setTopics(previous => previous.map((topic, index) => index === i ? { ...topic, name: event.target.value } : topic))}
                      disabled={!t.enabled}
                      aria-label={`Topic ${i + 1} name`}
                      className={`flex-1 min-w-0 text-sm font-medium bg-transparent border-b border-transparent focus:border-border focus:outline-none ${t.enabled ? "text-foreground" : "text-muted-foreground/50 line-through"}`}
                    />
                    {t.enabled && (
                      <button onClick={() => setTopics(prev => prev.map((tt, j) => j === i ? { ...tt, weight: weightNext(tt.weight) } : tt))}
                        className={`text-xs font-semibold px-2.5 py-1 rounded-full border cursor-pointer transition-colors ${weightColor(t.weight)}`}>
                        {t.weight}
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button onClick={() => setTopics(prev => [...prev, { name: "New Topic", weight: "medium", enabled: true }])}
                className="mt-3 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors">
                <Plus size={12} />Add custom topic
              </button>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div key="step3" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.18 }}
              className="px-6 py-5"
            >
              <div className="text-center mb-6">
                <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto mb-3">
                  <CheckCircle size={26} className="text-emerald-500" />
                </div>
                <h3 className="font-semibold text-foreground mb-1">Course created!</h3>
                <p className="text-xs text-muted-foreground font-light">Share this class code with your students so they can request enrollment.</p>
              </div>
              <div className="bg-muted/50 border border-border rounded-xl p-4 text-center mb-5">
                <p className="text-xs text-muted-foreground font-mono uppercase tracking-wide mb-2">Class Code</p>
                <p className="font-display text-4xl tracking-widest text-primary mb-3">{generatedCode}</p>
                <button onClick={copyCode}
                  className={`inline-flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-xl border transition-colors ${copied ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-card border-border text-foreground hover:bg-muted"}`}>
                  {copied ? <><CheckCheck size={13} />Copied!</> : <><Copy size={13} />Copy Code</>}
                </button>
              </div>
              <div className="bg-card border border-border rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground font-light">Course name</span>
                  <span className="font-medium text-foreground">{name}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground font-light">Subject</span>
                  <span className="font-medium text-foreground">{subject}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground font-light">Topics enabled</span>
                  <span className="font-medium text-foreground">{topics.filter(t => t.enabled).length}</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer */}
        <div className="px-6 pb-6 flex items-center justify-between">
          {step > 1 && step < 3 ? (
            <button onClick={() => setStep(s => (s - 1) as 1 | 2 | 3)} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              ← Back
            </button>
          ) : <div />}
          {step === 1 && (
            <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
              onClick={goStep2} disabled={!name.trim()}
              className="bg-primary text-primary-foreground px-5 py-2.5 rounded-xl text-sm font-semibold shadow-sm disabled:opacity-40">
              Next: Topic Weights →
            </motion.button>
          )}
          {step === 2 && (
            <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
              onClick={goStep3}
              disabled={creating}
              className="bg-primary text-primary-foreground px-5 py-2.5 rounded-xl text-sm font-semibold shadow-sm disabled:opacity-50 flex items-center gap-2">
              {creating && <RefreshCw size={14} className="animate-spin" />}{creating ? "Creating course…" : "Generate Class Code →"}
            </motion.button>
          )}
          {step === 3 && (
            <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
              onClick={finish}
              className="bg-primary text-primary-foreground px-5 py-2.5 rounded-xl text-sm font-semibold shadow-sm">
              Done
            </motion.button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ─── Teacher Settings ─────────────────────────────────────────────────────

type StoredPreferences = {
  darkMode?: boolean;
  difficulty?: "easy" | "adaptive" | "hard";
  enrollments?: boolean;
  flags?: boolean;
  misconceptions?: boolean;
  quizActivity?: boolean;
  weeklyDigest?: boolean;
  emailDigest?: boolean;
  quizReminders?: boolean;
  misconceptionAlerts?: boolean;
};

function SettingsToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return <button type="button" aria-pressed={on} onClick={onToggle}
    className={`relative rounded-full transition-colors shrink-0 ${on ? "bg-primary" : "bg-muted border border-border"}`}
    style={{ width: "40px", height: "22px" }}>
    <motion.div animate={{ x: on ? 20 : 2 }} transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className="absolute top-[3px] w-4 h-4 rounded-full bg-white shadow-sm" />
  </button>;
}

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function sendPasswordReset(email?: string) {
  if (!supabase || !email) return;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
  if (error) throw error;
}

function TeacherSettings({ courses, darkMode, setDarkMode }: { courses: TeacherCourse[]; darkMode: boolean; setDarkMode: (v: boolean) => void }) {
  const { profile: account, user, session, refreshProfile } = useAuth();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [details, setDetails] = useState({ name: account?.display_name ?? "", headline: account?.headline ?? "", organization: account?.organization ?? "" });
  const [prefs, setPrefs] = useState<StoredPreferences>({ enrollments: true, flags: true, misconceptions: true, darkMode });
  const [graphCourseId, setGraphCourseId] = useState(courses[0]?.id ?? "");
  const [graphTopics, setGraphTopics] = useState<Array<{ id: string; name: string }>>([]);
  const [graphLinks, setGraphLinks] = useState<Array<{ id: string; topic_id: string; prerequisite_topic_id: string }>>([]);
  const [prerequisiteId, setPrerequisiteId] = useState("");
  const [dependentId, setDependentId] = useState("");
  const [graphLoading, setGraphLoading] = useState(false);
  const [newTopicName, setNewTopicName] = useState("");
  const [addingTopic, setAddingTopic] = useState(false);
  const [graphSuggestion, setGraphSuggestion] = useState<CourseGraphSuggestion | null>(null);
  const [selectedSuggestedTopics, setSelectedSuggestedTopics] = useState<Set<string>>(new Set());
  const [selectedSuggestedLinks, setSelectedSuggestedLinks] = useState<Set<string>>(new Set());
  const [suggestingGraph, setSuggestingGraph] = useState(false);
  const [applyingGraph, setApplyingGraph] = useState(false);

  const suggestionKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const relationshipKey = (prerequisite: string, topic: string) => `${suggestionKey(prerequisite)}->${suggestionKey(topic)}`;

  useEffect(() => {
    if (!graphCourseId && courses[0]) setGraphCourseId(courses[0].id);
  }, [courses, graphCourseId]);

  useEffect(() => {
    setGraphSuggestion(null);
    setSelectedSuggestedTopics(new Set());
    setSelectedSuggestedLinks(new Set());
  }, [graphCourseId]);

  const loadPrerequisiteGraph = useCallback(async () => {
    if (!supabase || !graphCourseId) { setGraphTopics([]); setGraphLinks([]); return; }
    setGraphLoading(true);
    const [topicsResult, linksResult] = await Promise.all([
      supabase.from("course_topics").select("id,name").eq("course_id", graphCourseId).order("name"),
      supabase.from("course_topic_prerequisites").select("id,topic_id,prerequisite_topic_id").eq("course_id", graphCourseId),
    ]);
    setGraphLoading(false);
    if (topicsResult.error) { toast.error("Could not load course topics."); return; }
    if (linksResult.error) { setGraphLinks([]); return; }
    setGraphTopics((topicsResult.data ?? []) as Array<{ id: string; name: string }>);
    setGraphLinks((linksResult.data ?? []) as Array<{ id: string; topic_id: string; prerequisite_topic_id: string }>);
    setPrerequisiteId(""); setDependentId("");
  }, [graphCourseId]);

  useEffect(() => { void loadPrerequisiteGraph(); }, [loadPrerequisiteGraph]);

  const addPrerequisite = async () => {
    if (!supabase || !graphCourseId || !prerequisiteId || !dependentId || prerequisiteId === dependentId) return;
    const { error } = await supabase.from("course_topic_prerequisites").insert({
      course_id: graphCourseId, topic_id: dependentId, prerequisite_topic_id: prerequisiteId,
    });
    if (error) { toast.error(error.message.includes("cycle") ? "That relationship would create a circular prerequisite." : error.message); return; }
    await loadPrerequisiteGraph();
    toast.success("Prerequisite relationship added");
  };

  const addGraphTopic = async () => {
    const name = newTopicName.trim();
    if (!supabase || !graphCourseId || !name) return;
    setAddingTopic(true);
    const { error } = await supabase.from("course_topics").insert({ course_id: graphCourseId, name, weight: "medium" });
    setAddingTopic(false);
    if (error) {
      toast.error(error.code === "23505" ? "That topic already exists in this course." : error.message);
      return;
    }
    setNewTopicName("");
    await loadPrerequisiteGraph();
    toast.success("Course topic added");
  };

  const suggestGraph = async () => {
    if (!graphCourseId || !session?.access_token || suggestingGraph) return;
    setSuggestingGraph(true);
    try {
      const suggestion = await api.suggestCourseGraph(graphCourseId, session.access_token);
      setGraphSuggestion(suggestion);
      setSelectedSuggestedTopics(new Set(suggestion.topics.filter(topic => topic.confidence >= 0.65).map(topic => suggestionKey(topic.name))));
      setSelectedSuggestedLinks(new Set(suggestion.relationships.filter(link => link.confidence >= 0.75).map(link => relationshipKey(link.prerequisite, link.topic))));
      toast.success("Grounded graph suggestions are ready for review");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not analyze the course documents.");
    } finally {
      setSuggestingGraph(false);
    }
  };

  const toggleSuggestedTopic = (name: string) => {
    const key = suggestionKey(name);
    setSelectedSuggestedTopics(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    setSelectedSuggestedLinks(current => {
      const next = new Set(current);
      if (selectedSuggestedTopics.has(key)) {
        graphSuggestion?.relationships.forEach(link => {
          if (suggestionKey(link.prerequisite) === key || suggestionKey(link.topic) === key) next.delete(relationshipKey(link.prerequisite, link.topic));
        });
      }
      return next;
    });
  };

  const toggleSuggestedLink = (prerequisite: string, topic: string) => {
    const key = relationshipKey(prerequisite, topic);
    setSelectedSuggestedLinks(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    setSelectedSuggestedTopics(current => {
      const next = new Set(current);
      next.add(suggestionKey(prerequisite)); next.add(suggestionKey(topic));
      return next;
    });
  };

  const applySuggestedGraph = async () => {
    if (!graphSuggestion || !graphCourseId || !session?.access_token || applyingGraph) return;
    const topics = graphSuggestion.topics.filter(topic => selectedSuggestedTopics.has(suggestionKey(topic.name))).map(topic => topic.name);
    const relationships = graphSuggestion.relationships
      .filter(link => selectedSuggestedLinks.has(relationshipKey(link.prerequisite, link.topic)))
      .map(link => ({ prerequisite: link.prerequisite, topic: link.topic, reason: link.reason, confidence: link.confidence, citations: link.citations }));
    if (!topics.length && !relationships.length) { toast.error("Select at least one suggestion to apply."); return; }
    setApplyingGraph(true);
    try {
      const result = await api.applyCourseGraph(graphCourseId, topics, relationships, session.access_token);
      await loadPrerequisiteGraph();
      setGraphSuggestion(null);
      toast.success(`Applied ${result.topics_added} new topic${result.topics_added === 1 ? "" : "s"} and ${result.relationships_added} relationship${result.relationships_added === 1 ? "" : "s"}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not apply the selected suggestions.");
    } finally {
      setApplyingGraph(false);
    }
  };

  const removePrerequisite = async (id: string) => {
    if (!supabase) return;
    const { error } = await supabase.from("course_topic_prerequisites").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setGraphLinks(current => current.filter(link => link.id !== id));
  };

  useEffect(() => {
    setDetails({ name: account?.display_name ?? "", headline: account?.headline ?? "", organization: account?.organization ?? "" });
  }, [account]);

  useEffect(() => {
    if (!supabase || !user) return;
    void supabase.from("user_preferences").select("preferences").eq("user_id", user.id).maybeSingle().then(({ data, error }) => {
      if (error) { toast.error("Could not load settings."); return; }
      const loaded = (data?.preferences ?? {}) as StoredPreferences;
      setPrefs(current => ({ ...current, ...loaded }));
      if (typeof loaded.darkMode === "boolean") setDarkMode(loaded.darkMode);
    });
  }, [setDarkMode, user]);

  const persistPrefs = async (next: StoredPreferences) => {
    if (!supabase || !user) return;
    setPrefs(next);
    if (typeof next.darkMode === "boolean") setDarkMode(next.darkMode);
    const { error } = await supabase.from("user_preferences").upsert({ user_id: user.id, preferences: next });
    if (error) toast.error("Could not save this preference.");
  };

  const saveProfile = async () => {
    if (!supabase || !user || !details.name.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("profiles").update({
      display_name: details.name.trim(),
      headline: details.headline.trim() || null,
      organization: details.organization.trim() || null,
    }).eq("id", user.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    await refreshProfile();
    setEditing(false);
    toast.success("Profile updated");
  };

  const preferenceRows: Array<{ key: keyof StoredPreferences; label: string; desc: string }> = [
    { key: "enrollments", label: "Enrollment requests", desc: "When a student requests to join your course" },
    { key: "flags", label: "Struggling student alerts", desc: "When a student needs additional support" },
    { key: "misconceptions", label: "Misconception alerts", desc: "When a misunderstanding is detected" },
  ];

  return <div className="p-6 lg:p-8 max-w-2xl mx-auto text-foreground">
    <div className="mb-8"><h1 className="font-display text-2xl text-foreground">Settings</h1><p className="text-sm text-muted-foreground mt-1">Manage your real profile and preferences.</p></div>

    <section className="bg-card border border-border rounded-2xl p-6 shadow-sm mb-5">
      <div className="flex justify-between mb-5"><h2 className="font-semibold">Profile</h2><button onClick={() => setEditing(value => !value)} className="text-xs flex gap-1.5 items-center text-muted-foreground"><Pencil size={12} />{editing ? "Cancel" : "Edit"}</button></div>
      <div className="flex gap-4">
        <div className="w-16 h-16 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center font-display text-xl shrink-0">{initialsFor(account?.display_name)}</div>
        <div className="flex-1 space-y-3">
          {editing ? <>
            <input value={details.name} onChange={event => setDetails(value => ({ ...value, name: event.target.value }))} placeholder="Full name" className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-background text-foreground" />
            <input value={details.headline} onChange={event => setDetails(value => ({ ...value, headline: event.target.value }))} placeholder="Title, e.g. Lecturer" className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-background text-foreground" />
            <input value={details.organization} onChange={event => setDetails(value => ({ ...value, organization: event.target.value }))} placeholder="Department or institution" className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-background text-foreground" />
            <button disabled={saving || !details.name.trim()} onClick={() => void saveProfile()} className="w-full bg-primary text-primary-foreground py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50">{saving ? "Saving…" : "Save profile"}</button>
          </> : <>
            <div className="font-semibold">{account?.display_name}</div>
            <div className="text-sm text-muted-foreground">{account?.headline || "Teacher"}{account?.organization ? ` · ${account.organization}` : ""}</div>
            <div className="text-xs text-muted-foreground font-mono">{user?.email}</div>
            <div className="text-[11px] text-muted-foreground">Email changes require a separate verification flow.</div>
          </>}
        </div>
      </div>
    </section>

    <section className="bg-card border border-border rounded-2xl p-6 shadow-sm mb-5">
      <h2 className="font-semibold mb-4">My Courses</h2>
      <div className="space-y-3">{courses.map(course => <div key={course.id} className="p-4 bg-muted/40 rounded-xl flex justify-between gap-3">
        <div><div className="text-sm font-medium">{course.name}</div><div className="text-xs text-muted-foreground">{course.subject} · <span className="font-mono">{course.code}</span></div></div>
        <span className="text-xs text-emerald-700">Active</span>
      </div>)}{courses.length === 0 && <p className="text-sm text-muted-foreground">You have not created a course yet.</p>}</div>
    </section>

    <section className="bg-card border border-border rounded-2xl p-6 shadow-sm mb-5">
      <h2 className="font-semibold mb-1">Course Prerequisite Graph</h2>
      <p className="text-xs text-muted-foreground mb-5">Define what students should understand first. EduBridge will use these relationships to distinguish root weaknesses from downstream difficulties.</p>
      {courses.length > 1 && <div className="flex flex-wrap gap-2 mb-5">{courses.map(course => <button key={course.id} onClick={() => setGraphCourseId(course.id)} className={`text-xs px-3 py-2 rounded-lg border ${graphCourseId === course.id ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}>{course.name}</button>)}</div>}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 mb-5">
        <div className="flex items-start justify-between gap-4">
          <div><div className="text-sm font-semibold text-foreground flex items-center gap-2"><Sparkles size={14} className="text-primary" />AI-assisted graph</div><p className="text-xs text-muted-foreground mt-1 leading-relaxed">Analyze indexed course documents and recommend cited concepts and prerequisites. You review every suggestion before anything is saved.</p></div>
          <button onClick={() => void suggestGraph()} disabled={suggestingGraph || !graphCourseId || !session?.access_token} className="shrink-0 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-xs font-semibold disabled:opacity-40 inline-flex items-center gap-2">{suggestingGraph ? <><RefreshCw size={12} className="animate-spin" />Analyzing…</> : <><Sparkles size={12} />Generate suggestions</>}</button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">Runs only when clicked and uses AI tokens. Existing indexed text is reused; documents are not uploaded again.</p>
      </div>
      {graphSuggestion && <div className="rounded-xl border border-border bg-background p-4 mb-5 space-y-5">
        <div><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-foreground">Review AI suggestions</h3><span className="text-[10px] text-muted-foreground">{graphSuggestion.documents_analyzed} document{graphSuggestion.documents_analyzed === 1 ? "" : "s"} · {graphSuggestion.excerpts_analyzed} excerpts</span></div><p className="text-xs text-muted-foreground mt-1 leading-relaxed">{graphSuggestion.summary}</p></div>
        <div>
          <div className="text-xs font-semibold text-foreground mb-2">Suggested topics</div>
          <div className="space-y-2">{graphSuggestion.topics.map(topic => {
            const selected = selectedSuggestedTopics.has(suggestionKey(topic.name));
            return <button key={suggestionKey(topic.name)} onClick={() => toggleSuggestedTopic(topic.name)} className={`w-full text-left rounded-xl border p-3 transition-colors ${selected ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
              <div className="flex items-start gap-3"><span className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 ${selected ? "bg-primary border-primary text-primary-foreground" : "border-border"}`}>{selected && <CheckCheck size={10} />}</span><div className="flex-1 min-w-0"><div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-foreground">{topic.name}</span><span className="text-[10px] text-muted-foreground">{Math.round(topic.confidence * 100)}% confidence</span></div><p className="text-xs text-muted-foreground mt-1">{topic.description}</p><div className="text-[10px] text-primary mt-1.5">{topic.citations.map(citation => `${citation.document_title}${citation.page_number ? ` — ${citation.source_kind} ${citation.page_number}` : ""}`).join(" · ")}</div></div></div>
            </button>;
          })}</div>
        </div>
        <div>
          <div className="text-xs font-semibold text-foreground mb-2">Suggested prerequisite relationships</div>
          <div className="space-y-2">{graphSuggestion.relationships.map(link => {
            const key = relationshipKey(link.prerequisite, link.topic);
            const selected = selectedSuggestedLinks.has(key);
            return <button key={key} onClick={() => toggleSuggestedLink(link.prerequisite, link.topic)} className={`w-full text-left rounded-xl border p-3 transition-colors ${selected ? "border-emerald-300 bg-emerald-50" : "border-border bg-card"}`}>
              <div className="flex items-start gap-3"><span className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 ${selected ? "bg-emerald-600 border-emerald-600 text-white" : "border-border"}`}>{selected && <CheckCheck size={10} />}</span><div className="flex-1 min-w-0"><div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground"><span>{link.prerequisite}</span><ArrowRight size={12} className="text-muted-foreground" /><span className="text-primary">{link.topic}</span><span className="text-[10px] font-normal text-muted-foreground ml-auto">{Math.round(link.confidence * 100)}% confidence</span></div><p className="text-xs text-muted-foreground mt-1">{link.reason}</p><div className="text-[10px] text-primary mt-1.5">{link.citations.map(citation => `${citation.document_title}${citation.page_number ? ` — ${citation.source_kind} ${citation.page_number}` : ""}`).join(" · ")}</div></div></div>
            </button>;
          })}{graphSuggestion.relationships.length === 0 && <p className="text-xs text-muted-foreground">The documents support concepts, but not a reliable prerequisite order. You can still approve topics and connect them manually.</p>}</div>
        </div>
        <div className="flex gap-2"><button onClick={() => setGraphSuggestion(null)} className="flex-1 rounded-lg border border-border px-4 py-2.5 text-xs font-semibold text-foreground">Discard suggestions</button><button onClick={() => void applySuggestedGraph()} disabled={applyingGraph || (selectedSuggestedTopics.size === 0 && selectedSuggestedLinks.size === 0)} className="flex-1 rounded-lg bg-primary text-primary-foreground px-4 py-2.5 text-xs font-semibold disabled:opacity-40">{applyingGraph ? "Applying…" : "Apply selected suggestions"}</button></div>
      </div>}
      <div className="rounded-xl border border-border bg-muted/30 p-4 mb-5">
        <div className="text-xs font-semibold text-foreground mb-2">Course topics</div>
        <div className="flex gap-2">
          <input value={newTopicName} onChange={event => setNewTopicName(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void addGraphTopic(); }} placeholder="Add a topic, e.g. Self-attention" aria-label="New course topic" className="flex-1 min-w-0 rounded-lg border border-border bg-background text-foreground px-3 py-2 text-sm" />
          <button onClick={() => void addGraphTopic()} disabled={!newTopicName.trim() || addingTopic || !graphCourseId} className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-xs font-semibold disabled:opacity-40">{addingTopic ? "Adding…" : "Add topic"}</button>
        </div>
        {graphTopics.length > 0 && <div className="flex flex-wrap gap-2 mt-3">{graphTopics.map(topic => <span key={topic.id} className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-foreground">{topic.name}</span>)}</div>}
      </div>
      {graphLoading ? <div className="text-sm text-muted-foreground flex items-center gap-2"><RefreshCw size={14} className="animate-spin" />Loading topic graph…</div> : graphTopics.length < 2 ? <p className="text-sm text-muted-foreground">Add at least two topics above, then connect them in the order students should learn them.</p> : <>
        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <div><div className="text-xs font-semibold text-foreground mb-2">1. Must understand first</div><div className="flex flex-wrap gap-2">{graphTopics.map(topic => <button key={topic.id} onClick={() => setPrerequisiteId(topic.id)} disabled={topic.id === dependentId} className={`text-xs px-3 py-2 rounded-lg border disabled:opacity-30 ${prerequisiteId === topic.id ? "bg-amber-100 text-amber-900 border-amber-300" : "border-border hover:bg-muted"}`}>{topic.name}</button>)}</div></div>
          <div><div className="text-xs font-semibold text-foreground mb-2">2. Unlocks this concept</div><div className="flex flex-wrap gap-2">{graphTopics.map(topic => <button key={topic.id} onClick={() => setDependentId(topic.id)} disabled={topic.id === prerequisiteId} className={`text-xs px-3 py-2 rounded-lg border disabled:opacity-30 ${dependentId === topic.id ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}>{topic.name}</button>)}</div></div>
        </div>
        <button onClick={() => void addPrerequisite()} disabled={!prerequisiteId || !dependentId} className="w-full bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-semibold disabled:opacity-40 mb-5">Add prerequisite relationship</button>
        <div className="space-y-2">{graphLinks.map(link => {
          const prerequisite = graphTopics.find(topic => topic.id === link.prerequisite_topic_id)?.name ?? "Topic";
          const dependent = graphTopics.find(topic => topic.id === link.topic_id)?.name ?? "Topic";
          return <div key={link.id} className="flex items-center gap-3 bg-muted/40 rounded-xl px-4 py-3"><span className="text-sm font-medium text-foreground">{prerequisite}</span><ArrowRight size={13} className="text-muted-foreground" /><span className="text-sm font-medium text-primary flex-1">{dependent}</span><button onClick={() => void removePrerequisite(link.id)} className="p-1.5 text-muted-foreground hover:text-red-600"><Trash2 size={13} /></button></div>;
        })}{graphLinks.length === 0 && <p className="text-xs text-muted-foreground">No prerequisite relationships defined yet.</p>}</div>
        {graphLinks.length > 0 && <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900">Active: targeted quizzes will check the earliest required topic first and show the learning path to the student.</div>}
      </>}
    </section>

    <section className="bg-card border border-border rounded-2xl p-6 shadow-sm mb-5">
      <h2 className="font-semibold mb-1">Notification Preferences</h2><p className="text-xs text-muted-foreground mb-5">Saved to your account.</p>
      <div className="space-y-4">{preferenceRows.map(item => <div key={item.key} className="flex justify-between gap-4"><div><div className="text-sm font-medium">{item.label}</div><div className="text-xs text-muted-foreground">{item.desc}</div></div><SettingsToggle on={Boolean(prefs[item.key])} onToggle={() => void persistPrefs({ ...prefs, [item.key]: !prefs[item.key] })} /></div>)}</div>
      <div className="mt-5 rounded-xl border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
        Quiz summaries and weekly email delivery will be available after scheduled email delivery is configured.
      </div>
    </section>

    <section className="bg-card border border-border rounded-2xl p-6 shadow-sm mb-5 flex justify-between items-center">
      <div><h2 className="font-semibold">Dark mode</h2><p className="text-xs text-muted-foreground">Saved across sessions.</p></div>
      <SettingsToggle on={darkMode} onToggle={() => void persistPrefs({ ...prefs, darkMode: !darkMode })} />
    </section>

    <section className="bg-card border border-border rounded-2xl p-6 shadow-sm">
      <h2 className="font-semibold mb-4">Account</h2>
      <button onClick={() => void sendPasswordReset(user?.email).then(() => toast.success("Password reset email sent.")).catch(error => toast.error(error.message))} className="w-full text-left px-4 py-3 rounded-xl text-sm font-medium hover:bg-muted flex justify-between">Send password reset email <ChevronRight size={15} /></button>
      <button onClick={() => { downloadJson("edubridge-teacher-data.json", { profile: account, email: user?.email, courses, preferences: prefs }); toast.success("Your data was downloaded."); }} className="w-full text-left px-4 py-3 rounded-xl text-sm font-medium hover:bg-muted flex justify-between">Download my data <ChevronRight size={15} /></button>
    </section>
  </div>;
}

// ─── Student Settings ─────────────────────────────────────────────────────

function StudentSettings({ courses, darkMode, setDarkMode }: { courses: StudentCourse[]; darkMode: boolean; setDarkMode: (v: boolean) => void }) {
  const { profile: account, user, session, refreshProfile } = useAuth();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [quizCount, setQuizCount] = useState(0);
  const [details, setDetails] = useState({ name: account?.display_name ?? "", headline: account?.headline ?? "", organization: account?.organization ?? "" });
  const [prefs, setPrefs] = useState<StoredPreferences>({ difficulty: "adaptive", misconceptionAlerts: true, darkMode });

  useEffect(() => setDetails({ name: account?.display_name ?? "", headline: account?.headline ?? "", organization: account?.organization ?? "" }), [account]);

  useEffect(() => {
    if (!supabase || !user) return;
    void supabase.from("user_preferences").select("preferences").eq("user_id", user.id).maybeSingle().then(({ data, error }) => {
      if (error) { toast.error("Could not load settings."); return; }
      const loaded = (data?.preferences ?? {}) as StoredPreferences;
      setPrefs(current => ({ ...current, ...loaded }));
      if (typeof loaded.darkMode === "boolean") setDarkMode(loaded.darkMode);
    });
  }, [setDarkMode, user]);

  useEffect(() => {
    if (!session) return;
    void Promise.all(courses.map(course => api.courseProgress(course.id, session.access_token)))
      .then(results => setQuizCount(results.reduce((sum, result) => sum + result.quiz_count, 0)))
      .catch(() => setQuizCount(0));
  }, [courses, session]);

  const persistPrefs = async (next: StoredPreferences) => {
    if (!supabase || !user) return;
    setPrefs(next);
    if (typeof next.darkMode === "boolean") setDarkMode(next.darkMode);
    const { error } = await supabase.from("user_preferences").upsert({ user_id: user.id, preferences: next });
    if (error) toast.error("Could not save this preference.");
  };

  const saveProfile = async () => {
    if (!supabase || !user || !details.name.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("profiles").update({
      display_name: details.name.trim(),
      headline: details.headline.trim() || null,
      organization: details.organization.trim() || null,
    }).eq("id", user.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    await refreshProfile();
    setEditing(false);
    toast.success("Profile updated");
  };

  return <div className="p-6 lg:p-8 max-w-2xl mx-auto text-foreground">
    <div className="mb-8"><h1 className="font-display text-2xl text-foreground">Settings</h1><p className="text-sm text-muted-foreground mt-1">Update your profile and study preferences.</p></div>

    <section className="bg-card border border-border rounded-2xl p-6 shadow-sm mb-5">
      <div className="flex justify-between mb-5"><h2 className="font-semibold">Profile</h2><button onClick={() => setEditing(value => !value)} className="text-xs flex gap-1.5 items-center text-muted-foreground"><Pencil size={12} />{editing ? "Cancel" : "Edit"}</button></div>
      <div className="flex gap-4"><div className="w-16 h-16 rounded-2xl bg-accent text-accent-foreground flex items-center justify-center font-display text-xl shrink-0">{initialsFor(account?.display_name)}</div>
        <div className="flex-1 space-y-3">{editing ? <>
          <input value={details.name} onChange={event => setDetails(value => ({ ...value, name: event.target.value }))} placeholder="Full name" className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-background text-foreground" />
          <input value={details.headline} onChange={event => setDetails(value => ({ ...value, headline: event.target.value }))} placeholder="Program or major" className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-background text-foreground" />
          <input value={details.organization} onChange={event => setDetails(value => ({ ...value, organization: event.target.value }))} placeholder="Study level or institution" className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-background text-foreground" />
          <button disabled={saving || !details.name.trim()} onClick={() => void saveProfile()} className="w-full bg-primary text-primary-foreground py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50">{saving ? "Saving…" : "Save profile"}</button>
        </> : <>
          <div className="font-semibold">{account?.display_name}</div><div className="text-sm text-muted-foreground">{account?.headline || "Student"}{account?.organization ? ` · ${account.organization}` : ""}</div><div className="text-xs text-muted-foreground font-mono">{user?.email}</div><div className="text-[11px] text-muted-foreground">Email changes require a separate verification flow.</div>
        </>}</div>
      </div>
    </section>

    <section className="bg-card border border-border rounded-2xl p-6 shadow-sm mb-5">
      <h2 className="font-semibold mb-1">Quiz Preferences</h2><p className="text-xs text-muted-foreground mb-5">Saved to your account.</p>
      <div className="grid grid-cols-3 gap-2 mb-5">{(["easy", "adaptive", "hard"] as const).map(difficulty => <button key={difficulty} onClick={() => void persistPrefs({ ...prefs, difficulty })} className={`py-2.5 rounded-xl text-sm capitalize border ${prefs.difficulty === difficulty ? "bg-primary text-primary-foreground border-primary" : "border-border"}`}>{difficulty}</button>)}</div>
      <div className="flex justify-between"><div><div className="text-sm font-medium">Misconception alerts</div><div className="text-xs text-muted-foreground">When your teacher reviews a detected misunderstanding</div></div><SettingsToggle on={Boolean(prefs.misconceptionAlerts)} onToggle={() => void persistPrefs({ ...prefs, misconceptionAlerts: !prefs.misconceptionAlerts })} /></div>
      <div className="mt-5 rounded-xl border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
        Daily reminders and weekly progress emails will be available after scheduled email delivery is configured.
      </div>
    </section>

    <section className="bg-card border border-border rounded-2xl p-6 shadow-sm mb-5">
      <h2 className="font-semibold mb-4">Your Stats</h2>
      <div className="grid grid-cols-3 gap-3">{[
        ["Member since", account?.created_at ? new Date(account.created_at).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "—"],
        ["Total quizzes", String(quizCount)],
        ["Courses enrolled", String(courses.length)],
      ].map(([label, value]) => <div key={label} className="bg-muted/50 rounded-xl p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="font-semibold text-sm">{value}</div></div>)}</div>
    </section>

    <section className="bg-card border border-border rounded-2xl p-6 shadow-sm mb-5 flex justify-between items-center"><div><h2 className="font-semibold">Dark mode</h2><p className="text-xs text-muted-foreground">Saved across sessions.</p></div><SettingsToggle on={darkMode} onToggle={() => void persistPrefs({ ...prefs, darkMode: !darkMode })} /></section>

    <section className="bg-card border border-border rounded-2xl p-6 shadow-sm">
      <h2 className="font-semibold mb-4">Account</h2>
      <button onClick={() => void sendPasswordReset(user?.email).then(() => toast.success("Password reset email sent.")).catch(error => toast.error(error.message))} className="w-full text-left px-4 py-3 rounded-xl text-sm font-medium hover:bg-muted flex justify-between">Send password reset email <ChevronRight size={15} /></button>
      <button onClick={() => { downloadJson("edubridge-student-data.json", { profile: account, email: user?.email, courses, preferences: prefs, totalQuizzes: quizCount }); toast.success("Your data was downloaded."); }} className="w-full text-left px-4 py-3 rounded-xl text-sm font-medium hover:bg-muted flex justify-between">Download my data <ChevronRight size={15} /></button>
    </section>
  </div>;
}
// ─── App ──────────────────────────────────────────────────────────────────

function AuthLoading() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        <RefreshCw size={24} className="mx-auto mb-3 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Restoring your session…</p>
      </div>
    </div>
  );
}

function TeacherApprovalPending({ onLogout }: { onLogout: () => void }) {
  const { profile } = useAuth();
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-sm text-center">
        <div className="mx-auto mb-5 h-12 w-12 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center">
          <Clock size={22} />
        </div>
        <h1 className="font-display text-2xl text-primary mb-2">Teacher approval pending</h1>
        <p className="text-sm text-muted-foreground leading-relaxed mb-6">
          Thanks, {profile?.display_name ?? "Teacher"}. An administrator must approve your teacher account before you can create courses or access student information.
        </p>
        <button onClick={onLogout} className="w-full rounded-lg border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted transition-colors">
          Sign out
        </button>
      </div>
    </div>
  );
}

type PendingTeacher = {
  id: string;
  display_name: string;
  created_at: string;
};

function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const { profile } = useAuth();
  const [teachers, setTeachers] = useState<PendingTeacher[]>([]);
  const [loadingTeachers, setLoadingTeachers] = useState(true);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const loadPendingTeachers = useCallback(async () => {
    if (!supabase) return;
    setLoadingTeachers(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, created_at")
      .eq("role", "teacher")
      .is("teacher_approved_at", null)
      .order("created_at", { ascending: true });
    setLoadingTeachers(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setTeachers((data ?? []) as PendingTeacher[]);
  }, []);

  useEffect(() => {
    void loadPendingTeachers();
  }, [loadPendingTeachers]);

  const approveTeacher = async (teacher: PendingTeacher) => {
    if (!supabase) return;
    setApprovingId(teacher.id);
    const { error } = await supabase
      .from("profiles")
      .update({ teacher_approved_at: new Date().toISOString() })
      .eq("id", teacher.id)
      .eq("role", "teacher")
      .is("teacher_approved_at", null);
    setApprovingId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    setTeachers(current => current.filter(item => item.id !== teacher.id));
    toast.success(`${teacher.display_name} is now an approved teacher.`);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <div className="font-display text-xl text-primary">EduBridge AI</div>
            <div className="text-xs text-muted-foreground">Administrator portal</div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:block text-right">
              <div className="text-sm font-medium text-foreground">{profile?.display_name ?? "Administrator"}</div>
              <div className="text-xs text-muted-foreground">Administrator</div>
            </div>
            <button onClick={onLogout} className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted transition-colors flex items-center gap-2">
              <LogOut size={15} /> Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-7">
          <h1 className="font-display text-3xl text-foreground mb-2">Teacher approvals</h1>
          <p className="text-sm text-muted-foreground">Review teacher applications before granting access to course creation and student information.</p>
        </div>

        <section className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="border-b border-border px-5 py-4 flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-foreground">Pending applications</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{teachers.length} awaiting review</p>
            </div>
            <button onClick={() => void loadPendingTeachers()} disabled={loadingTeachers} className="rounded-lg border border-border p-2 hover:bg-muted disabled:opacity-50" aria-label="Refresh pending teachers">
              <RefreshCw size={16} className={loadingTeachers ? "animate-spin" : ""} />
            </button>
          </div>

          {loadingTeachers ? (
            <div className="py-14 text-center text-sm text-muted-foreground"><RefreshCw size={20} className="mx-auto mb-3 animate-spin" />Loading applications…</div>
          ) : teachers.length === 0 ? (
            <div className="py-14 text-center px-6">
              <CheckCircle size={28} className="mx-auto mb-3 text-emerald-600" />
              <h3 className="font-semibold text-foreground mb-1">All caught up</h3>
              <p className="text-sm text-muted-foreground">There are no teacher applications waiting for approval.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {teachers.map(teacher => (
                <div key={teacher.id} className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold">{initialsFor(teacher.display_name)}</div>
                    <div>
                      <div className="font-medium text-foreground">{teacher.display_name || "Unnamed teacher"}</div>
                      <div className="text-xs text-muted-foreground">Applied {new Date(teacher.created_at).toLocaleDateString()}</div>
                    </div>
                  </div>
                  <button onClick={() => void approveTeacher(teacher)} disabled={approvingId === teacher.id} className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
                    {approvingId === teacher.id ? <RefreshCw size={15} className="animate-spin" /> : <CheckCircle size={15} />} Approve teacher
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default function App() {
  const { loading, session, profile, signOut } = useAuth();
  const [view, setView] = useState<View>("landing");
  const [role, setRole] = useState<"teacher" | "student">("teacher");
  const [darkMode, setDarkMode] = useState(false);
  const go = (v: View, r?: "teacher" | "student") => { if (r) setRole(r); setView(v); };

  useEffect(() => {
    if (!supabase || !session) return;
    void supabase.from("user_preferences").select("preferences").eq("user_id", session.user.id).maybeSingle()
      .then(({ data }) => {
        const preferences = data?.preferences as StoredPreferences | undefined;
        if (typeof preferences?.darkMode === "boolean") setDarkMode(preferences.darkMode);
      });
  }, [session]);

  useEffect(() => {
    if (!session || !profile) return;
    if (profile.role === "admin") {
      setView("admin");
    } else if (profile.role === "student") {
      setRole("student");
      setView("student");
    } else {
      setRole("teacher");
      setView("teacher");
    }
  }, [session, profile]);

  const logout = async () => {
    try {
      await signOut();
      if (session) clearStudentSession(session.user.id);
      setView("landing");
      toast.success("Signed out.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not sign out.");
    }
  };

  if (loading) return <AuthLoading />;

  if (session && profile?.role === "teacher" && !profile.teacher_approved_at) {
    return (
      <div className={darkMode ? "dark" : ""}>
        <Toaster position="bottom-right" />
        <TeacherApprovalPending onLogout={() => void logout()} />
      </div>
    );
  }

  return (
    <div className={darkMode ? "dark" : ""}>
      <Toaster position="bottom-right" toastOptions={{ style: { fontFamily: "Outfit, sans-serif", fontSize: "14px" } }} />
      {view === "landing" && <Landing onNavigate={go} />}
      {view === "auth" && <Auth role={role} setRole={setRole} onBack={() => setView("landing")} />}
      {view === "admin" && session && profile?.role === "admin" && <AdminDashboard onLogout={() => void logout()} />}
      {view === "teacher" && session && profile?.role === "teacher" && <TeacherDashboard key={session.user.id} onLogout={() => void logout()} darkMode={darkMode} setDarkMode={setDarkMode} />}
      {view === "student" && session && profile?.role === "student" && <StudentDashboard key={session.user.id} onLogout={() => void logout()} darkMode={darkMode} setDarkMode={setDarkMode} />}
    </div>
  );
}
