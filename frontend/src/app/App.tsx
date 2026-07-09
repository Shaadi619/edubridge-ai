import React, { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { toast, Toaster } from "sonner";
import {
  BookOpen, Users, Brain, TrendingUp, BarChart2, MessageSquare,
  Zap, Shield, Eye, LogOut, ArrowRight, Send, Home, Target,
  Award, Bell, Search, CheckCircle, AlertCircle, GraduationCap,
  Plus, FileText, Settings, Menu, X, Clock, ArrowLeftRight,
  Upload, File, Trash2, CheckSquare, XSquare, RefreshCw,
  ChevronRight, Lock, Unlock, BookMarked, StickyNote, LineChart,
  MessageCircle, User, ChevronDown, Star, Copy, Pencil,
  CheckCheck, Layers, ToggleLeft, ToggleRight, CalendarDays,
  RotateCcw, Flame,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, AreaChart, Area, RadarChart,
  PolarGrid, PolarAngleAxis, Radar,
} from "recharts";
import { api, type ApiCourse, type ApiEnrollmentRequest, type ApiStudent, type ApiTeacher } from "./api";

// ─── Types ────────────────────────────────────────────────────────────────

type View = "landing" | "auth" | "teacher" | "student";
type TeacherTab = "overview" | "students" | "analytics" | "materials" | "settings";
type StudentTab = "workspace" | "quiz" | "progress" | "enroll" | "settings";

type DemoSession = {
  teacher: ApiTeacher | null;
  student: ApiStudent | null;
};

type Announcement = {
  id: number;
  title: string;
  body: string;
  course: string;
  createdAt: string;
  pinned: boolean;
};

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
type UserMessage = { role: "user"; text: string };
type AiMessage = { role: "ai"; text: string; citations: string[]; misconception: string | null };
type ChatMessage = UserMessage | AiMessage;

type UploadedDoc = {
  id: number;
  name: string;
  size: string;
  type: string;
  status: "uploading" | "processing" | "ready" | "error";
  progress: number;
  pages?: number;
  uploadedAt: string;
};

type EnrollRequest = {
  id: number;
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
  id: number;
  type: "enroll" | "flag" | "quiz" | "misconception";
  title: string;
  body: string;
  time: string;
  read: boolean;
};

const INITIAL_NOTIFICATIONS: Notification[] = [
  { id: 1, type: "enroll", title: "New enrollment request", body: "Jordan Kim wants to join Biology 101.", time: "2h ago", read: false },
  { id: 2, type: "enroll", title: "New enrollment request", body: "Nadia Patel wants to join Biology 101.", time: "4h ago", read: false },
  { id: 3, type: "flag", title: "Student struggling", body: "Liam Torres scored below 40% on Protein Synthesis — 3rd attempt.", time: "5h ago", read: false },
  { id: 4, type: "misconception", title: "Misconception spike", body: "6 students confused mitosis with meiosis in today's quiz.", time: "1d ago", read: true },
  { id: 5, type: "quiz", title: "Quiz activity", body: "47 quizzes completed across your courses today.", time: "1d ago", read: true },
  { id: 6, type: "enroll", title: "New enrollment request", body: "Theo Larsen wants to join Advanced Genetics.", time: "1d ago", read: true },
];

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

const TEACHER_COURSES = [
  { id: "bio101", name: "Biology 101", code: "BIO-3F8K", students: 24, subject: "Biology", color: "bg-emerald-500" },
  { id: "gen7x2", name: "Advanced Genetics", code: "GEN-7X2Q", students: 16, subject: "Genetics", color: "bg-purple-500" },
];

const STUDENT_COURSES = [
  { id: "bio101", name: "Biology 101", code: "BIO-3F8K", teacher: "Dr. Sarah Chen", progress: 82 },
];

const INITIAL_ANNOUNCEMENTS: Announcement[] = [
  { id: 1, title: "Midterm exam — Chapter 10–14 in scope", body: "The midterm on July 18 will cover all material from Chapters 10 through 14. Focus especially on Meiosis I vs II and protein synthesis. Office hours are extended this week: Mon/Wed 3–5 PM.", course: "Biology 101", createdAt: "2h ago", pinned: true },
  { id: 2, title: "Lab session rescheduled to Friday", body: "This week's lab has moved from Thursday to Friday at the same time (2 PM, Room 204). Please bring your lab manual.", course: "Biology 101", createdAt: "1d ago", pinned: false },
  { id: 3, title: "New lecture notes uploaded", body: "Week 7 slides are now available in Materials. They cover genetic inheritance patterns and Punnett squares.", course: "Biology 101", createdAt: "2d ago", pinned: false },
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

function renderText(text: string) {
  return text.split("\n").map((line, i) => {
    const html = line.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    return line
      ? <p key={i} className="mb-1 last:mb-0" dangerouslySetInnerHTML={{ __html: html }} />
      : <br key={i} />;
  });
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

function initialsFromName(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join("") || "EB";
}

function formatRelativeDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Just now";
  const diffMs = Date.now() - date.getTime();
  const mins = Math.max(0, Math.round(diffMs / 60000));
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function courseColor(index: number) {
  return ["bg-emerald-500", "bg-blue-500", "bg-purple-500", "bg-amber-500", "bg-rose-500"][index % 5];
}

function toTeacherCourse(course: ApiCourse, index: number) {
  return {
    id: String(course.id),
    name: course.title,
    code: course.class_code,
    students: course.student_ids.length,
    subject: course.subject,
    color: courseColor(index),
    backendId: course.id,
    description: course.description,
  };
}

function toStudentCourse(course: ApiCourse) {
  return {
    id: String(course.id),
    name: course.title,
    code: course.class_code,
    teacher: `Teacher #${course.teacher_id}`,
    progress: 0,
    backendId: course.id,
  };
}

function toEnrollRequest(request: ApiEnrollmentRequest): EnrollRequest {
  return {
    id: request.id,
    name: request.student_name,
    initials: initialsFromName(request.student_name),
    email: request.student_email,
    code: `Course #${request.course_id}`,
    course: request.course_title,
    requestedAt: formatRelativeDate(request.requested_at),
    status: request.status === "rejected" ? "denied" : request.status,
  };
}

// ─── Upload Modal ─────────────────────────────────────────────────────────

function UploadModal({ onClose, onUploaded }: {
  onClose: () => void;
  onUploaded: (doc: UploadedDoc) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState<{ name: string; progress: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const simulateUpload = useCallback((name: string, size: string) => {
    const newDoc: UploadedDoc = {
      id: Date.now(), name, size, type: "pdf",
      status: "uploading", progress: 0, uploadedAt: "Just now",
    };
    onUploaded(newDoc);
    setUploading({ name, progress: 0 });
    let p = 0;
    const interval = setInterval(() => {
      p += Math.random() * 18 + 8;
      if (p >= 100) {
        clearInterval(interval);
        setUploading(null);
        onClose();
        toast.success(`"${name}" uploaded and queued for processing`);
        return;
      }
      setUploading({ name, progress: Math.min(p, 100) });
    }, 180);
  }, [onClose, onUploaded]);

  const handleFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const f = files[0];
    const size = f.size > 1024 * 1024
      ? `${(f.size / 1024 / 1024).toFixed(1)} MB`
      : `${Math.round(f.size / 1024)} KB`;
    simulateUpload(f.name, size);
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
            <p className="text-sm text-muted-foreground font-light mt-0.5">Biology 101 · PDF, DOCX, PPTX up to 50 MB</p>
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

            <div>
              <p className="text-xs font-mono text-muted-foreground uppercase tracking-wide mb-3">Or add a sample file</p>
              <div className="space-y-1">
                {SAMPLE_FILES.map(name => (
                  <button key={name}
                    onClick={() => simulateUpload(name, `${(Math.random() * 4 + 0.8).toFixed(1)} MB`)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted transition-colors text-left group"
                  >
                    <div className="w-7 h-7 rounded-lg bg-red-50 flex items-center justify-center shrink-0">
                      <FileText size={13} className="text-red-500" />
                    </div>
                    <span className="text-sm text-foreground flex-1 min-w-0 truncate">{name}</span>
                    <ChevronRight size={14} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}

// ─── Teacher Materials ────────────────────────────────────────────────────

function TeacherMaterials({ docs, setDocs, onUploadClick, onViewDoc }: {
  docs: UploadedDoc[];
  setDocs: React.Dispatch<React.SetStateAction<UploadedDoc[]>>;
  onViewDoc: (doc: UploadedDoc) => void;
  onUploadClick: () => void;
}) {
  useEffect(() => {
    const uploading = docs.filter(d => d.status === "uploading" || d.status === "processing");
    if (!uploading.length) return;
    const t = setTimeout(() => {
      setDocs(prev => prev.map(d =>
        d.status === "uploading" ? { ...d, status: "processing" as const, progress: 100 }
          : d.status === "processing" ? { ...d, status: "ready" as const, pages: Math.floor(Math.random() * 25 + 5) }
          : d
      ));
    }, 2400);
    return () => clearTimeout(t);
  }, [docs, setDocs]);

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
          <p className="text-sm text-muted-foreground mt-1 font-light">Biology 101 — documents indexed for AI Q&A</p>
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
                  onClick={() => { setDocs(prev => prev.filter(d => d.id !== doc.id)); toast.success("Document removed"); }}
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

function EnrollmentPanel({ requests, setRequests, onResolve }: {
  requests: EnrollRequest[];
  setRequests: React.Dispatch<React.SetStateAction<EnrollRequest[]>>;
  onResolve?: (id: number, action: "approved" | "denied") => Promise<void>;
}) {
  const pending = requests.filter(r => r.status === "pending");
  const resolved = requests.filter(r => r.status !== "pending");

  const resolve = async (id: number, action: "approved" | "denied") => {
    const r = requests.find(r => r.id === id);
    if (!r) return;
    try {
      if (onResolve) await onResolve(id, action);
      else setRequests(prev => prev.map(r => r.id === id ? { ...r, status: action } : r));
      if (action === "approved") toast.success(`${r.name} approved for ${r.course}`);
      else toast(`${r.name}'s request denied`, { icon: "—" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update enrollment request");
    }
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
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22 }}
            className="flex items-center gap-4 px-5 py-4 border-b border-border last:border-0 hover:bg-muted/20 transition-colors flex-wrap"
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
                onClick={() => resolve(r.id, "approved")}
                className="flex items-center gap-1.5 text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 px-3 py-1.5 rounded-lg transition-colors"
              >
                <CheckSquare size={13} />Approve
              </motion.button>
              <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                onClick={() => resolve(r.id, "denied")}
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

const COURSE_LOOKUP: Record<string, { name: string; teacher: string; subject: string; students: number; docs: number }> = {
  "BIO-3F8K": { name: "Biology 101", teacher: "Dr. Sarah Chen", subject: "Biology", students: 24, docs: 4 },
  "GEN-7X2Q": { name: "Advanced Genetics", teacher: "Dr. Sarah Chen", subject: "Genetics", students: 16, docs: 4 },
};

type PendingRequest = { code: string; course: string; teacher: string; sentAt: string };

function StudentEnroll({ studentId, enrolledCourses, onJoinRequested }: {
  studentId: number | null;
  enrolledCourses: ReturnType<typeof toStudentCourse>[];
  onJoinRequested: () => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [lookupState, setLookupState] = useState<"idle" | "looking" | "found" | "notfound">("idle");
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [foundCourse, setFoundCourse] = useState<(typeof COURSE_LOOKUP[string] & { backendCode?: string }) | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const lookup = async () => {
    if (code.trim().length < 3) return;
    setLookupState("looking");
    setFoundCourse(null);
    try {
      const course = await api.getCourseByCode(code.toUpperCase());
      setFoundCourse({
        name: course.title,
        teacher: `Teacher #${course.teacher_id}`,
        subject: course.subject,
        students: course.student_ids.length,
        docs: 0,
        backendCode: course.class_code,
      });
      setLookupState("found");
    } catch {
      const match = COURSE_LOOKUP[code.toUpperCase()];
      if (match) { setFoundCourse(match); setLookupState("found"); }
      else setLookupState("notfound");
    }
  };

  const requestAccess = async () => {
    if (!foundCourse) return;
    if (!studentId) {
      toast.error("Sign in as a student first");
      return;
    }
    setSubmitting(true);
    try {
      const enrollment = await api.joinCourse({ student_id: studentId, class_code: code.toUpperCase() });
      setPendingRequests(prev => [...prev, { code: code.toUpperCase(), course: enrollment.course_title, teacher: foundCourse.teacher, sentAt: "Just now" }]);
      setSubmitting(false);
      setSubmitted(true);
      setCode("");
      setLookupState("idle");
      setFoundCourse(null);
      toast.success(`Request sent to ${foundCourse.teacher}`);
      await onJoinRequested();
      setTimeout(() => setSubmitted(false), 200);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send join request");
      setSubmitting(false);
    }
  };

  const cancelRequest = (code: string) => {
    setPendingRequests(prev => prev.filter(r => r.code !== code));
    toast(`Request to join ${COURSE_LOOKUP[code]?.name ?? code} cancelled`);
  };

  const handleCodeChange = (v: string) => {
    setCode(v.toUpperCase());
    setLookupState("idle");
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
            onKeyDown={e => e.key === "Enter" && lookupState === "idle" && lookup()}
            placeholder="e.g. BIO-3F8K"
            className="flex-1 border border-border rounded-xl px-4 py-3 text-sm font-mono bg-background focus:outline-none focus:ring-2 focus:ring-ring tracking-widest uppercase"
          />
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
            onClick={lookup}
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
                      <span className="flex items-center gap-1"><FileText size={11} />{foundCourse.docs} documents</span>
                    </div>
                  </div>
                  <span className="text-xs font-mono text-emerald-700 bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded-md shrink-0">
                    {code.toUpperCase()}
                  </span>
                </div>
              </div>
              <div className="flex gap-3 mt-3">
                <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
                  onClick={requestAccess}
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
                <motion.div key={r.code} layout
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
                      <Clock size={10} />{r.sentAt}
                    </span>
                    <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                      Awaiting approval
                    </span>
                    <button onClick={() => cancelRequest(r.code)}
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
          {(enrolledCourses.length ? enrolledCourses : STUDENT_COURSES).map(c => (
            <div key={c.code} className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3.5 shadow-sm">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
                <BookOpen size={16} className="text-emerald-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground">{c.name}</div>
                <div className="text-xs text-muted-foreground font-light">{c.teacher} · <span className="font-mono">{c.code}</span></div>
              </div>
              <div className="text-right shrink-0">
                <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 justify-end mb-1">
                  <Unlock size={12} />Active
                </div>
                <div className="w-16 h-1 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${c.progress}%` }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Notifications Panel ─────────────────────────────────────────────────

type NotifFilter = "all" | "unread" | "enroll" | "flags";

function NotificationsPanel({ open, onClose, notifications, setNotifications, onGoEnroll }: {
  open: boolean;
  onClose: () => void;
  notifications: Notification[];
  setNotifications: React.Dispatch<React.SetStateAction<Notification[]>>;
  onGoEnroll: () => void;
}) {
  const [filter, setFilter] = useState<NotifFilter>("all");
  const unread = notifications.filter(n => !n.read).length;

  const markAllRead = () => setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  const markRead = (id: number) => setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  const dismiss = (id: number) => setNotifications(prev => prev.filter(n => n.id !== id));
  const approveEnroll = (id: number, title: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
    toast.success(`Approved: ${title}`);
  };
  const denyEnroll = (id: number, title: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
    toast(`Denied: ${title}`);
  };

  const iconFor = (type: Notification["type"]) => {
    if (type === "enroll") return <Users size={13} className="text-blue-500" />;
    if (type === "flag") return <AlertCircle size={13} className="text-amber-500" />;
    if (type === "misconception") return <Brain size={13} className="text-purple-500" />;
    return <Target size={13} className="text-emerald-500" />;
  };
  const bgFor = (type: Notification["type"]) => {
    if (type === "enroll") return "bg-blue-50 border-blue-100";
    if (type === "flag") return "bg-amber-50 border-amber-100";
    if (type === "misconception") return "bg-purple-50 border-purple-100";
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

  // Date grouping
  const groups: { label: string; items: typeof filtered }[] = [];
  const todayItems = filtered.filter(n => n.time.includes("min") || n.time.includes("hr") || n.time.includes("h ago") || n.time === "Just now");
  const yesterdayItems = filtered.filter(n => n.time.includes("Yesterday") || n.time === "1d ago");
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
                          onClick={() => { markRead(n.id); if (n.type === "enroll") { onGoEnroll(); onClose(); } }}
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
                            <div className="flex items-center justify-between mt-1.5">
                              <span className="text-[10px] text-muted-foreground/60 font-mono">{n.time}</span>
                              {/* Inline enroll actions */}
                              {n.type === "enroll" && (
                                <div className="flex gap-1.5" onClick={e => e.stopPropagation()}>
                                  <button
                                    onClick={() => approveEnroll(n.id, n.title)}
                                    className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 transition-colors flex items-center gap-1"
                                  >
                                    <CheckCircle size={9} />Approve
                                  </button>
                                  <button
                                    onClick={() => denyEnroll(n.id, n.title)}
                                    className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 transition-colors flex items-center gap-1"
                                  >
                                    <X size={9} />Deny
                                  </button>
                                </div>
                              )}
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
                Manage enrollment requests in{" "}
                <button onClick={() => { onGoEnroll(); onClose(); }} className="text-accent font-medium hover:underline">Overview</button>
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

function Auth({ role, setRole, onBack, onEnter }: {
  role: "teacher" | "student"; setRole: (r: "teacher" | "student") => void;
  onBack: () => void; onEnter: (r: "teacher" | "student", account: ApiTeacher | ApiStudent) => void;
}) {
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [specialization, setSpecialization] = useState("English");
  const [classCode, setClassCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async () => {
    if (!email.trim()) {
      toast.error("Email is required");
      return;
    }
    if (mode === "signup" && !fullName.trim()) {
      toast.error("Full name is required");
      return;
    }

    setIsSubmitting(true);
    try {
      if (role === "teacher") {
        const teacher = mode === "signup"
          ? await api.createTeacher({
              full_name: fullName.trim(),
              email: email.trim(),
              course_specializations: [specialization.trim() || "English"],
            })
          : (await api.listTeachers()).find(item => item.email.toLowerCase() === email.trim().toLowerCase());

        if (!teacher) {
          toast.error("No teacher account found with that email");
          return;
        }
        toast.success(mode === "signup" ? "Teacher account created" : "Signed in");
        onEnter("teacher", teacher);
        return;
      }

      const student = mode === "signup"
        ? await api.createStudent({ full_name: fullName.trim(), email: email.trim() })
        : (await api.listStudents()).find(item => item.email.toLowerCase() === email.trim().toLowerCase());

      if (!student) {
        toast.error("No student account found with that email");
        return;
      }
      if (mode === "signup" && classCode.trim()) {
        try {
          await api.joinCourse({ student_id: student.id, class_code: classCode.trim().toUpperCase() });
          toast.success("Account created and join request sent");
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Account created, but class join failed");
        }
      } else {
        toast.success(mode === "signup" ? "Student account created" : "Signed in");
      }
      onEnter("student", student);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setIsSubmitting(false);
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
                <input value={fullName} onChange={e => setFullName(e.target.value)} className="w-full border border-border rounded-lg px-3.5 py-2.5 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring" placeholder={role === "teacher" ? "Dr. Sarah Chen" : "Amara Osei"} />
              </div>
            )}
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5">Email address</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full border border-border rounded-lg px-3.5 py-2.5 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring" placeholder={role === "teacher" ? "teacher@edubridge.ai" : "student@edubridge.ai"} />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5">Password</label>
              <input type="password" className="w-full border border-border rounded-lg px-3.5 py-2.5 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring" placeholder="••••••••" />
            </div>
            <AnimatePresence>
              {mode === "signup" && role === "teacher" && (
                <motion.div initial={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}>
                  <label className="text-sm font-medium text-foreground block mb-1.5">Course specialization</label>
                  <input value={specialization} onChange={e => setSpecialization(e.target.value)} className="w-full border border-border rounded-lg px-3.5 py-2.5 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring" placeholder="English" />
                </motion.div>
              )}
            </AnimatePresence>
            <AnimatePresence>
              {mode === "signup" && role === "student" && (
                <motion.div initial={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}>
                  <label className="text-sm font-medium text-foreground block mb-1.5">Class code <span className="text-muted-foreground font-normal">(optional)</span></label>
                  <input value={classCode} onChange={e => setClassCode(e.target.value.toUpperCase())} className="w-full border border-border rounded-lg px-3.5 py-2.5 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring font-mono" placeholder="ENG-SS1U" />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }} onClick={submit}
            disabled={isSubmitting}
            className="w-full bg-primary text-primary-foreground font-semibold py-3 rounded-lg shadow-sm disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {isSubmitting && <RefreshCw size={15} className="animate-spin" />}
            {mode === "signup" ? `Create ${role} account` : "Sign in"}
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
          <div className="pt-3 mt-3 border-t border-primary-foreground/10 space-y-0.5">
            <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-primary-foreground/40 hover:text-primary-foreground hover:bg-primary-foreground/10 transition-colors">
              <Settings size={16} />Settings
            </button>
          </div>
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

function TeacherDashboard({ teacher, onLogout, onSwitch, darkMode, setDarkMode }: { teacher: ApiTeacher | null; onLogout: () => void; onSwitch: () => void; darkMode: boolean; setDarkMode: (v: boolean) => void }) {
  const [tab, setTab] = useState<TeacherTab>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [courseCreateOpen, setCourseCreateOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [teacherCourses, setTeacherCourses] = useState(TEACHER_COURSES.map((course, index) => ({ ...course, backendId: index + 1, description: "" })));
  const [selectedCourse, setSelectedCourse] = useState(teacherCourses[0]);
  const [docs, setDocs] = useState<UploadedDoc[]>(INITIAL_DOCS);
  const [requests, setRequests] = useState<EnrollRequest[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>(INITIAL_NOTIFICATIONS);
  const [announcements, setAnnouncements] = useState<Announcement[]>(INITIAL_ANNOUNCEMENTS);
  const [viewingDoc, setViewingDoc] = useState<UploadedDoc | null>(null);
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(false);

  const loadWorkspace = useCallback(async () => {
    if (!teacher) {
      setRequests(INITIAL_REQUESTS);
      return;
    }
    setIsWorkspaceLoading(true);
    try {
      const workspace = await api.getTeacherWorkspace(teacher.id);
      const nextCourses = workspace.courses.map(toTeacherCourse);
      setTeacherCourses(nextCourses.length ? nextCourses : []);
      setSelectedCourse(current => nextCourses.find(course => course.id === current?.id) ?? nextCourses[0] ?? current);
      setRequests(workspace.pending_requests.map(toEnrollRequest));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load teacher workspace");
    } finally {
      setIsWorkspaceLoading(false);
    }
  }, [teacher]);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  const resolveEnrollment = async (id: number, action: "approved" | "denied") => {
    const updated = await api.decideEnrollment(id, action === "approved" ? "approved" : "rejected");
    setRequests(prev => prev.map(r => r.id === id ? toEnrollRequest(updated) : r));
    await loadWorkspace();
  };

  const createCourse = async (title: string, subject: string, description: string) => {
    if (!teacher) throw new Error("Sign in as a teacher first");
    const course = await api.createCourse({ teacher_id: teacher.id, title, subject, description });
    const mapped = toTeacherCourse(course, teacherCourses.length);
    setTeacherCourses(prev => [mapped, ...prev]);
    setSelectedCourse(mapped);
    return course.class_code;
  };

  const pendingCount = requests.filter(r => r.status === "pending").length;
  const unreadCount = notifications.filter(n => !n.read).length;

  const navItems: { id: TeacherTab; label: string; icon: React.ElementType; badge?: number }[] = [
    { id: "overview", label: "Overview", icon: Home },
    { id: "students", label: "Students", icon: Users },
    { id: "analytics", label: "Analytics", icon: BarChart2 },
    { id: "materials", label: "Materials", icon: FileText },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="min-h-screen flex bg-background">
      <Sidebar title="EduBridge AI" subtitle="Teacher Portal" initials={initialsFromName(teacher?.full_name ?? "Dr. Sarah Chen")} name={teacher?.full_name ?? "Dr. Sarah Chen"} role="teacher"
        items={navItems} activeTab={tab} setTab={setTab} onLogout={onLogout} open={sidebarOpen} setOpen={setSidebarOpen} />
      <div className="flex-1 lg:ml-64 flex flex-col min-h-screen">
        <header className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border h-14 flex items-center px-4 lg:px-6 gap-3">
          <button className="lg:hidden" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
          {/* Course switcher */}
          <div className="relative hidden md:block">
            <select
              value={selectedCourse.id}
              onChange={e => setSelectedCourse(teacherCourses.find(c => c.id === e.target.value)!)}
              className="appearance-none bg-muted border border-border text-sm font-medium text-foreground rounded-xl pl-3 pr-8 py-1.5 focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer"
            >
              {teacherCourses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
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
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} onClick={onSwitch}
              className="hidden lg:flex items-center gap-1.5 text-xs font-medium border border-border rounded-full px-3 py-1.5 hover:bg-muted transition-colors text-muted-foreground"
            >
              <ArrowLeftRight size={11} />Student view
            </motion.button>
            <button onClick={() => setNotifOpen(v => !v)} className="relative p-2 hover:bg-muted rounded-lg transition-colors">
              <Bell size={16} />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 w-4 h-4 bg-accent rounded-full text-accent-foreground text-[9px] font-bold flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </button>
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold">{initialsFromName(teacher?.full_name ?? "SC")}</div>
          </div>
        </header>
        <main className="flex-1 p-6 lg:p-8">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              {tab === "overview" && (
                <TeacherOverview
                  requests={requests} setRequests={setRequests}
                  onResolveEnrollment={resolveEnrollment}
                  announcements={announcements} setAnnouncements={setAnnouncements}
                  onGoMaterials={() => setTab("materials")}
                  course={selectedCourse}
                  isWorkspaceLoading={isWorkspaceLoading}
                  teacherName={teacher?.full_name ?? "Dr. Sarah Chen"}
                />
              )}
              {tab === "students" && <TeacherStudents searchQuery={searchQuery} />}
              {tab === "analytics" && <TeacherAnalytics course={selectedCourse} />}
              {tab === "materials" && (
                <TeacherMaterials docs={docs} setDocs={setDocs} onUploadClick={() => setUploadOpen(true)} onViewDoc={setViewingDoc} />
              )}
              {tab === "settings" && <TeacherSettings darkMode={darkMode} setDarkMode={setDarkMode} />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <AnimatePresence>
        {uploadOpen && (
          <UploadModal
            onClose={() => setUploadOpen(false)}
            onUploaded={doc => setDocs(prev => [doc, ...prev])}
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
        onGoEnroll={() => { setTab("overview"); setNotifOpen(false); }}
      />
    </div>
  );
}

function TeacherOverview({ requests, setRequests, onResolveEnrollment, onGoMaterials, announcements, setAnnouncements, course, isWorkspaceLoading, teacherName }: {
  requests: EnrollRequest[];
  setRequests: React.Dispatch<React.SetStateAction<EnrollRequest[]>>;
  onResolveEnrollment?: (id: number, action: "approved" | "denied") => Promise<void>;
  onGoMaterials: () => void;
  announcements: Announcement[];
  setAnnouncements: React.Dispatch<React.SetStateAction<Announcement[]>>;
  course: typeof TEACHER_COURSES[number];
  isWorkspaceLoading?: boolean;
  teacherName: string;
}) {
  const [composing, setComposing] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [pinNew, setPinNew] = useState(false);

  const postAnnouncement = () => {
    if (!newTitle.trim() || !newBody.trim()) return;
    setAnnouncements(prev => [{
      id: Date.now(), title: newTitle, body: newBody, course: course.name, createdAt: "Just now", pinned: pinNew,
    }, ...prev]);
    setNewTitle(""); setNewBody(""); setPinNew(false); setComposing(false);
    toast.success("Announcement posted to " + course.name);
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-display text-2xl text-primary">Good morning, {teacherName}</h1>
        <p className="text-sm text-muted-foreground mt-1 font-light">{isWorkspaceLoading ? "Syncing your backend workspace..." : "Here's what's happening across your courses today."}</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        {[
          { label: "Active Students", val: "40", sub: "across 2 courses", icon: Users, color: "text-blue-500", bg: "bg-blue-50" },
          { label: "Avg. Mastery", val: "68%", sub: "+4% this week", icon: TrendingUp, color: "text-emerald-600", bg: "bg-emerald-50" },
          { label: "Open Flags", val: "5", sub: "need attention", icon: AlertCircle, color: "text-amber-600", bg: "bg-amber-50" },
          { label: "Quizzes Today", val: "47", sub: "across all students", icon: Target, color: "text-purple-600", bg: "bg-purple-50" },
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
              className="flex items-center gap-1.5 text-xs font-medium text-accent bg-accent/10 hover:bg-accent/20 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Plus size={12} />New Course
            </motion.button>
          </div>
          <div className="space-y-4">
            {[
              { name: "Biology 101", code: "BIO-3F8K", students: 24, docs: 4, avg: 68, pending: 2 },
              { name: "Advanced Genetics", code: "GEN-7X2Q", students: 16, docs: 4, avg: 74, pending: 1 },
            ].map(c => (
              <motion.div key={c.name} whileHover={{ y: -2, boxShadow: "0 4px 16px rgba(0,0,0,0.07)" }}
                className="bg-card border border-border rounded-xl p-5 shadow-sm cursor-pointer transition-shadow"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-foreground">{c.name}</h3>
                    <span className="font-mono text-xs text-muted-foreground">{c.code}</span>
                  </div>
                  {c.pending > 0 && (
                    <button onClick={onGoMaterials}
                      className="text-xs font-medium bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full hover:bg-amber-200 transition-colors"
                    >
                      {c.pending} pending
                    </button>
                  )}
                </div>
                <div className="flex gap-4 text-xs text-muted-foreground mb-5 font-light">
                  <span className="flex items-center gap-1.5"><Users size={12} />{c.students} students</span>
                  <span className="flex items-center gap-1.5"><FileText size={12} />{c.docs} documents</span>
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-2">
                    <span className="text-muted-foreground font-light">Class avg. mastery</span>
                    <span className="font-mono font-semibold tabular-nums">{c.avg}%</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <motion.div className="h-full rounded-full bg-accent"
                      initial={{ width: 0 }} animate={{ width: `${c.avg}%` }}
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
          <EnrollmentPanel requests={requests} setRequests={setRequests} onResolve={onResolveEnrollment} />
        </div>
      </div>
      <div className="mb-10">
        <h2 className="font-semibold text-foreground mb-4">Attention Needed</h2>
        <div className="space-y-2">
          {[
            { student: "Liam Torres", issue: "Scored below 40% on Protein Synthesis quiz — 3rd consecutive attempt", time: "2h ago" },
            { student: "Sofia Reyes", issue: "Has not engaged with the course workspace in 5 days", time: "5d ago" },
            { student: "Marcus Webb", issue: "Frequently confuses dominant and recessive alleles in open-ended answers", time: "1d ago" },
          ].map((a, i) => (
            <div key={i} className="flex items-center gap-4 bg-card border border-border rounded-xl px-4 py-3.5 shadow-sm hover:border-amber-300/60 transition-colors">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
              <p className="text-sm flex-1 min-w-0">
                <span className="font-semibold text-foreground">{a.student}</span>
                <span className="text-muted-foreground font-light"> — {a.issue}</span>
              </p>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono shrink-0">
                <Clock size={11} />{a.time}
              </div>
            </div>
          ))}
        </div>
      </div>

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
                    <button onClick={() => setAnnouncements(prev => prev.filter(x => x.id !== a.id))}
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
    </div>
  );
}

function TeacherStudents({ searchQuery = "" }: { searchQuery?: string }) {
  const [isLoading, setIsLoading] = useState(true);
  const [selectedStudent, setSelectedStudent] = useState<typeof STUDENTS[number] | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  useEffect(() => { const t = setTimeout(() => setIsLoading(false), 1100); return () => clearTimeout(t); }, []);

  const filtered = STUDENTS.filter(s => {
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
            Biology 101 — {filtered.length} {searchQuery ? `matching "${searchQuery}"` : "enrolled"}
          </p>
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="text-sm border border-border rounded-lg px-3 py-2 bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-ring shadow-sm">
          <option value="all">All statuses</option>
          <option value="excelling">Excelling</option>
          <option value="active">Active</option>
          <option value="struggling">Struggling</option>
        </select>
      </div>
      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {["Student", "Progress", "Weak Topics", "Quizzes", "Status", ""].map(h => (
                  <th key={h} className="text-left text-xs font-medium text-muted-foreground font-mono uppercase tracking-wide px-5 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="px-5 py-4"><div className="flex items-center gap-3"><Skeleton className="w-8 h-8 rounded-full" /><Skeleton className="w-28 h-3" /></div></td>
                  <td className="px-5 py-4"><Skeleton className="w-28 h-2 rounded-full" /></td>
                  <td className="px-5 py-4"><Skeleton className="w-36 h-5 rounded-full" /></td>
                  <td className="px-5 py-4"><Skeleton className="w-6 h-3" /></td>
                  <td className="px-5 py-4"><Skeleton className="w-16 h-5 rounded-full" /></td>
                  <td className="px-5 py-4" />
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
                <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors group">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">{s.initials}</div>
                      <span className="text-sm font-medium text-foreground">{s.name}</span>
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
                  <td className="px-5 py-4">
                    <button className="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-muted-foreground hover:text-foreground font-medium border border-border rounded-lg px-2.5 py-1"
                      onClick={() => setSelectedStudent(s)}>
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <StudentInsightDrawer student={selectedStudent} onClose={() => setSelectedStudent(null)} />
    </div>
  );
}

function TeacherAnalytics({ course }: { course: typeof TEACHER_COURSES[number] }) {
  const [subtab, setSubtab] = useState<"overview" | "misconceptions">("overview");
  const [log, setLog] = useState<MisconceptionEntry[]>(MISCONCEPTION_LOG);

  const markAddressed = (id: number) => {
    setLog(prev => prev.map(m => m.id === id ? { ...m, status: "addressed" } : m));
    toast.success("Marked as addressed");
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-2xl text-primary">Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1 font-light">{course.name} — Class-wide performance overview</p>
        </div>
        <div className="flex gap-1 bg-muted p-1 rounded-xl">
          {(["overview", "misconceptions"] as const).map(t => (
            <button key={t} onClick={() => setSubtab(t)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${subtab === t ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {t === "misconceptions" ? "Misconception Log" : "Overview"}
            </button>
          ))}
        </div>
      </div>

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
              <div key={m.id} className={`flex items-start gap-4 px-5 py-4 ${i < log.length - 1 ? "border-b border-border" : ""} ${m.status === "addressed" ? "opacity-50" : ""}`}>
                <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">{m.initials}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className="text-sm font-semibold text-foreground">{m.student}</span>
                    <span className="text-xs font-mono text-muted-foreground">·</span>
                    <span className="text-xs font-medium text-primary bg-primary/8 px-2 py-0.5 rounded-full">{m.topic}</span>
                  </div>
                  <p className="text-xs text-muted-foreground font-light leading-relaxed">{m.misconception}</p>
                  <span className="text-[10px] font-mono text-muted-foreground/60 mt-1 block">{m.flaggedAt}</span>
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
            <BarChart data={TOPIC_DATA} barSize={20} barCategoryGap="30%">
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
          <h2 className="font-semibold text-foreground mb-0.5">Class Progress</h2>
          <p className="text-xs text-muted-foreground font-mono mb-6">8-week average mastery trend</p>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={WEEKLY_DATA}>
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#1C2B4A" stopOpacity={0.12} />
                  <stop offset="95%" stopColor="#1C2B4A" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(17,24,39,0.06)" vertical={false} />
              <XAxis dataKey="week" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} domain={[50, 90]} tickFormatter={(v: number) => `${v}%`} />
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
              const rows = MISCONCEPTION_LOG.map(m => `${m.student},${m.topic},"${m.misconception}",${m.flaggedAt},${m.status}`).join("\n");
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
          {[
            { topic: "Protein Synthesis", issue: "Confuses transcription and translation — treats them as one step", freq: 12, students: 8 },
            { topic: "Cell Division", issue: "Believes meiosis and mitosis produce the same number of cells", freq: 9, students: 6 },
            { topic: "Genetics", issue: "Conflates dominant with \"more common in population\"", freq: 8, students: 7 },
            { topic: "DNA Replication", issue: "Thinks new strand replaces the original — misses semi-conservative model", freq: 5, students: 4 },
          ].map((m, i) => (
            <div key={i} className="flex items-center gap-4 py-4 border-b border-border last:border-0 hover:bg-muted/20 transition-colors rounded -mx-2 px-2">
              <span className="font-mono text-sm font-bold text-muted-foreground/40 w-5 shrink-0 tabular-nums">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-foreground">{m.topic}</div>
                <div className="text-xs text-muted-foreground mt-0.5 font-light">{m.issue}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-mono text-sm font-bold text-foreground tabular-nums">{m.freq}×</div>
                <div className="text-xs text-muted-foreground font-light">{m.students} students</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      </div>
      )}
    </div>
  );
}

// ─── Student Dashboard ────────────────────────────────────────────────────

function StudentDashboard({ student, onLogout, onSwitch, darkMode, setDarkMode }: { student: ApiStudent | null; onLogout: () => void; onSwitch: () => void; darkMode: boolean; setDarkMode: (v: boolean) => void }) {
  const [tab, setTab] = useState<StudentTab>("workspace");
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_CHAT);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [studentCourses, setStudentCourses] = useState(STUDENT_COURSES.map((course, index) => ({ ...course, backendId: index + 1 })));
  const [selectedCourse, setSelectedCourse] = useState(studentCourses[0]);

  const loadWorkspace = useCallback(async () => {
    if (!student) return;
    try {
      const workspace = await api.getStudentWorkspace(student.id);
      const nextCourses = workspace.courses.map(toStudentCourse);
      if (nextCourses.length) {
        setStudentCourses(nextCourses);
        setSelectedCourse(current => nextCourses.find(course => course.id === current?.id) ?? nextCourses[0]);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load student workspace");
    }
  }, [student]);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  const navItems: { id: StudentTab; label: string; icon: React.ElementType }[] = [
    { id: "workspace", label: "Course Q&A", icon: MessageSquare },
    { id: "quiz", label: "Quiz", icon: Target },
    { id: "progress", label: "My Progress", icon: TrendingUp },
    { id: "enroll", label: "Join Course", icon: Plus },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  const handleSend = async () => {
    if (!input.trim()) return;
    const question = input;
    setMessages(prev => [...prev, { role: "user", text: question }]);
    setInput("");
    setIsTyping(true);
    try {
      if (!student || !selectedCourse?.backendId) throw new Error("Choose an approved course first");
      const answer = await api.askTutor({
        student_id: student.id,
        course_id: selectedCourse.backendId,
        question,
      });
      setMessages(prev => [...prev, {
        role: "ai",
        text: answer.answer,
        citations: answer.citations,
        misconception: answer.unsupported ? "Unsupported by indexed course material for now. This will become RAG-grounded in the AI phase." : null,
      }]);
    } catch (error) {
      const fallback = CANNED_RESPONSES[Math.floor(Math.random() * CANNED_RESPONSES.length)];
      setMessages(prev => [...prev, {
        ...fallback,
        text: error instanceof Error ? `${fallback.text}\n\nBackend note: ${error.message}` : fallback.text,
      }]);
    } finally {
      setIsTyping(false);
    }
  };

  const courseExtra = (
    <div className="p-4 border-b border-primary-foreground/10">
      <div className="text-xs text-primary-foreground/35 font-mono uppercase tracking-wide mb-2">Current Course</div>
      {studentCourses.length > 1 ? (
        <div className="relative">
          <select value={selectedCourse.id} onChange={e => setSelectedCourse(studentCourses.find(c => c.id === e.target.value)!)}
            className="w-full appearance-none bg-primary-foreground/10 text-primary-foreground text-sm font-semibold rounded-lg px-3 py-2 pr-7 focus:outline-none cursor-pointer">
            {studentCourses.map(c => <option key={c.id} value={c.id} style={{ color: "black" }}>{c.name}</option>)}
          </select>
          <ChevronDown size={11} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-primary-foreground/50 pointer-events-none" />
        </div>
      ) : (
        <div className="bg-primary-foreground/10 rounded-lg px-3 py-2.5">
          <div className="text-sm font-semibold text-primary-foreground">{selectedCourse.name}</div>
          <div className="text-xs text-primary-foreground/45 font-mono">{selectedCourse.teacher} · {selectedCourse.code}</div>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen flex bg-background">
      <Sidebar title="EduBridge AI" subtitle="Student Portal" initials={initialsFromName(student?.full_name ?? "Amara Osei")} name={student?.full_name ?? "Amara Osei"} role="student"
        items={navItems} activeTab={tab} setTab={setTab} onLogout={onLogout} open={sidebarOpen} setOpen={setSidebarOpen}
        extra={courseExtra} />
      <div className="flex-1 lg:ml-64 flex flex-col min-h-screen">
        <header className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border h-14 flex items-center px-6 gap-4">
          <button className="lg:hidden" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
          <h1 className="font-semibold text-foreground text-sm">
            {tab === "workspace" && `Course Q&A — ${selectedCourse.name}`}
            {tab === "quiz" && "Adaptive Quiz"}
            {tab === "progress" && "My Progress"}
            {tab === "enroll" && "Join a Course"}
            {tab === "settings" && "Settings"}
          </h1>
          <div className="ml-auto">
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} onClick={onSwitch}
              className="hidden sm:flex items-center gap-1.5 text-xs font-medium border border-border rounded-full px-3 py-1.5 hover:bg-muted transition-colors text-muted-foreground"
            >
              <ArrowLeftRight size={11} />Teacher view
            </motion.button>
          </div>
        </header>
        <main className="flex-1">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: "easeOut" }} className="h-full"
            >
              {tab === "workspace" && <StudentWorkspace messages={messages} isTyping={isTyping} input={input} setInput={setInput} onSend={handleSend} announcements={INITIAL_ANNOUNCEMENTS} course={selectedCourse} />}
              {tab === "quiz" && <StudentQuiz selectedAnswer={selectedAnswer} setSelectedAnswer={setSelectedAnswer} showExplanation={showExplanation} setShowExplanation={setShowExplanation} />}
              {tab === "progress" && <StudentProgress onGoQuiz={() => setTab("quiz")} />}
              {tab === "enroll" && <StudentEnroll studentId={student?.id ?? null} enrolledCourses={studentCourses} onJoinRequested={loadWorkspace} />}
              {tab === "settings" && <StudentSettings darkMode={darkMode} setDarkMode={setDarkMode} />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

function StudentWorkspace({ messages, isTyping, input, setInput, onSend, announcements, course }: {
  messages: ChatMessage[]; isTyping: boolean; input: string;
  setInput: (v: string) => void; onSend: () => void;
  announcements: Announcement[]; course: typeof STUDENT_COURSES[number];
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [dismissedIds, setDismissedIds] = useState<number[]>([]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, isTyping]);

  const pinned = announcements.filter(a => a.pinned && !dismissedIds.includes(a.id));

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col">
      {/* Pinned announcements */}
      <AnimatePresence initial={false}>
        {pinned.map(a => (
          <motion.div key={a.id} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="flex items-start gap-3 px-5 py-3 bg-accent/10 border-b border-accent/20">
              <div className="w-5 h-5 rounded-full bg-accent/20 flex items-center justify-center shrink-0 mt-0.5">
                <Star size={10} className="text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-xs font-semibold text-foreground">{a.title}</span>
                <span className="text-xs text-muted-foreground font-light ml-2">{a.body.slice(0, 80)}{a.body.length > 80 ? "…" : ""}</span>
              </div>
              <button onClick={() => setDismissedIds(p => [...p, a.id])} className="text-muted-foreground hover:text-foreground p-0.5 shrink-0">
                <X size={12} />
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
            {msg.role === "ai" && (
              <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center shrink-0 mt-1 shadow-sm">
                <Brain size={13} className="text-primary-foreground" />
              </div>
            )}
            <div className={`max-w-[520px] ${msg.role === "user" ? "items-end flex flex-col" : ""}`}>
              {msg.role === "ai" && (msg as AiMessage).misconception && (
                <div className="flex items-center gap-2 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 mb-2">
                  <AlertCircle size={12} className="shrink-0" />{(msg as AiMessage).misconception}
                </div>
              )}
              <div className={`rounded-xl px-4 py-3 text-sm leading-relaxed shadow-sm ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-card border border-border text-foreground"}`}>
                {renderText(msg.text)}
              </div>
              {msg.role === "ai" && (msg as AiMessage).citations.length > 0 && (
                <div className="flex gap-2 mt-2 flex-wrap">
                  {(msg as AiMessage).citations.map((c, j) => (
                    <span key={j} className="font-mono text-xs bg-muted text-muted-foreground border border-border px-2 py-0.5 rounded-lg flex items-center gap-1">
                      <FileText size={10} className="shrink-0" />{c}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {isTyping && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center shrink-0 mt-1">
              <Brain size={13} className="text-primary-foreground" />
            </div>
            <div className="bg-card border border-border rounded-xl px-4 shadow-sm"><TypingIndicator /></div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="border-t border-border p-4 bg-background/95 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto flex gap-3">
          <input value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && onSend()}
            placeholder="Ask a question about your Biology 101 material..."
            className="flex-1 border border-border rounded-xl px-4 py-2.5 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring shadow-sm"
          />
          <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.93 }}
            onClick={onSend} disabled={!input.trim() || isTyping}
            className="bg-primary text-primary-foreground px-4 py-2.5 rounded-xl disabled:opacity-35 shadow-sm"
          >
            <Send size={15} />
          </motion.button>
        </div>
        <p className="text-center text-xs text-muted-foreground mt-2 font-mono">Answers grounded in your course material only</p>
      </div>
    </div>
  );
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

function StudentQuiz({ selectedAnswer, setSelectedAnswer, showExplanation, setShowExplanation }: {
  selectedAnswer: number | null; setSelectedAnswer: (n: number) => void;
  showExplanation: boolean; setShowExplanation: (v: boolean) => void;
}) {
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<(number | null)[]>(Array(QUIZ_QUESTIONS.length).fill(null));
  const [showResults, setShowResults] = useState(false);

  const q = QUIZ_QUESTIONS[questionIndex];
  const isLastQuestion = questionIndex === QUIZ_QUESTIONS.length - 1;
  const isCorrect = selectedAnswer === q.correct;
  const correctCount = answers.filter((a, i) => a === QUIZ_QUESTIONS[i].correct).length;
  const pct = Math.round((correctCount / QUIZ_QUESTIONS.length) * 100);

  const handleNext = () => {
    const newAnswers = [...answers];
    newAnswers[questionIndex] = selectedAnswer;
    setAnswers(newAnswers);
    if (isLastQuestion) {
      setShowResults(true);
    } else {
      setQuestionIndex(i => i + 1);
      setSelectedAnswer(null);
      setShowExplanation(false);
    }
  };

  const retake = () => {
    setQuestionIndex(0);
    setAnswers(Array(QUIZ_QUESTIONS.length).fill(null));
    setSelectedAnswer(null);
    setShowExplanation(false);
    setShowResults(false);
  };

  if (showResults) {
    const wrongTopics = QUIZ_QUESTIONS.filter((_, i) => answers[i] !== QUIZ_QUESTIONS[i].correct).map(q => q.topic);
    return (
      <div className="p-6 lg:p-8 max-w-2xl mx-auto">
        {/* Score hero */}
        <div className={`rounded-2xl p-6 text-center mb-6 border ${pct >= 75 ? "bg-emerald-50 border-emerald-200" : pct >= 50 ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-200"}`}>
          <div className={`font-display text-6xl mb-1 ${pct >= 75 ? "text-emerald-600" : pct >= 50 ? "text-amber-600" : "text-red-600"}`}>{pct}%</div>
          <div className="font-semibold text-foreground mb-1">
            {pct >= 75 ? "Great work!" : pct >= 50 ? "Good effort" : "Keep practicing"}
          </div>
          <div className="text-sm text-muted-foreground font-light">
            {correctCount} correct out of {QUIZ_QUESTIONS.length} questions
          </div>
          {/* Progress dots */}
          <div className="flex gap-2 justify-center mt-4">
            {QUIZ_QUESTIONS.map((_, i) => (
              <div key={i} className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                answers[i] === QUIZ_QUESTIONS[i].correct ? "bg-emerald-500 text-white" : "bg-red-400 text-white"
              }`}>
                {answers[i] === QUIZ_QUESTIONS[i].correct ? "✓" : "✗"}
              </div>
            ))}
          </div>
        </div>

        {/* Question breakdown */}
        <div className="bg-card border border-border rounded-2xl p-5 shadow-sm mb-5">
          <h3 className="font-semibold text-foreground mb-4">Question Breakdown</h3>
          <div className="space-y-3">
            {QUIZ_QUESTIONS.map((qq, i) => {
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
                  <button className="text-xs font-semibold text-primary hover:underline flex items-center gap-1">
                    Practice <ChevronRight size={11} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
            onClick={retake}
            className="flex-1 border border-border text-foreground py-3 rounded-xl font-medium hover:bg-muted transition-colors text-sm flex items-center justify-center gap-2">
            <RotateCcw size={14} />Retake Quiz
          </motion.button>
          <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
            className="flex-1 bg-primary text-primary-foreground py-3 rounded-xl font-medium shadow-sm text-sm flex items-center justify-center gap-2">
            <TrendingUp size={14} />View Progress
          </motion.button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-7">
        <div className="text-sm text-muted-foreground font-light">
          Question <span className="font-semibold text-foreground font-mono">{questionIndex + 1}</span> of <span className="font-mono">{QUIZ_QUESTIONS.length}</span>
        </div>
        <div className="flex gap-1">
          {QUIZ_QUESTIONS.map((_, i) => (
            <div key={i} className={`h-1.5 w-7 rounded-full transition-colors ${i < questionIndex ? "bg-emerald-500" : i === questionIndex ? "bg-primary" : "bg-muted"}`} />
          ))}
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
      <AnimatePresence mode="wait">
        {selectedAnswer !== null && !showExplanation && (
          <motion.button key="check" initial={{ opacity: 1 }} exit={{ opacity: 0 }}
            whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
            onClick={() => setShowExplanation(true)}
            className="w-full bg-primary text-primary-foreground py-3 rounded-xl font-medium shadow-sm"
          >Check Answer</motion.button>
        )}
        {showExplanation && (
          <motion.div key="result" initial={{ opacity: 1 }}>
            <div className={`rounded-xl p-5 mb-4 border text-sm leading-relaxed shadow-sm ${isCorrect ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-800"}`}>
              <div className="font-semibold mb-2 flex items-center gap-2">
                {isCorrect ? <><CheckCircle size={16} className="text-emerald-600" />Correct!</> : <><X size={16} className="text-red-500" />Not quite.</>}
              </div>
              <div dangerouslySetInnerHTML={{ __html: q.explanation.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>") }} />
            </div>
            <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
              onClick={handleNext}
              className="w-full border border-border text-foreground py-3 rounded-xl font-medium hover:bg-muted transition-colors text-sm shadow-sm"
            >{isLastQuestion ? "See Results →" : "Next Question →"}</motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const STUDY_PLAN_ITEMS = [
  { id: 1, priority: "High" as const, topic: "Biochemistry — Protein Synthesis", action: "Review Chapter 14, then attempt 5 targeted quiz questions on the ribosome pathway.", done: false, time: "~20 min" },
  { id: 2, priority: "High" as const, topic: "Cell Biology — Mitosis vs. Meiosis", action: "Re-read your misconception report, then use Q&A to ask specifically about Meiosis II.", done: false, time: "~15 min" },
  { id: 3, priority: "Medium" as const, topic: "Evolution — Natural Selection", action: "Your last quiz showed confusion about fitness. Try 3 application-style scenario questions.", done: false, time: "~10 min" },
  { id: 4, priority: "Low" as const, topic: "Ecology — Biomes", action: "Strong performance here. One quick reinforcement quiz to maintain mastery.", done: false, time: "~8 min" },
];

const WEEK_SCHEDULE = [
  { day: "Mon", sessions: [{ topic: "Protein Synthesis", duration: 20, priority: "high" }] },
  { day: "Tue", sessions: [{ topic: "Cell Division", duration: 15, priority: "high" }] },
  { day: "Wed", sessions: [] },
  { day: "Thu", sessions: [{ topic: "Natural Selection", duration: 10, priority: "medium" }, { topic: "Genetics Quiz", duration: 12, priority: "high" }] },
  { day: "Fri", sessions: [{ topic: "Ecology Review", duration: 8, priority: "low" }] },
  { day: "Sat", sessions: [] },
  { day: "Sun", sessions: [{ topic: "Full Topic Quiz", duration: 25, priority: "high" }] },
];

function StudentProgress({ onGoQuiz }: { onGoQuiz: () => void }) {
  const [planItems, setPlanItems] = useState(STUDY_PLAN_ITEMS);
  const doneCount = planItems.filter(p => p.done).length;

  const toggleDone = (id: number) => setPlanItems(prev => prev.map(p => p.id === id ? { ...p, done: !p.done } : p));

  const priorityStyle = (p: "High" | "Medium" | "Low") =>
    p === "High" ? "bg-red-100 text-red-700 border-red-200" : p === "Medium" ? "bg-amber-100 text-amber-700 border-amber-200" : "bg-blue-100 text-blue-700 border-blue-200";
  const sessionColor = (p: string) =>
    p === "high" ? "bg-primary/15 border-primary/30 text-primary" : p === "medium" ? "bg-amber-100 border-amber-200 text-amber-800" : "bg-blue-50 border-blue-200 text-blue-700";

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="font-display text-2xl text-primary">My Progress</h1>
        <p className="text-sm text-muted-foreground mt-1 font-light">Biology 101 — Topic mastery overview</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-7">
        {[
          { label: "Overall Mastery", val: "82%", icon: Award, color: "text-emerald-600", bg: "bg-emerald-50" },
          { label: "Quizzes Taken", val: "14", icon: Target, color: "text-blue-600", bg: "bg-blue-50" },
          { label: "Study Streak", val: "12d", icon: Flame, color: "text-orange-600", bg: "bg-orange-50" },
          { label: "Weak Topics", val: "2", icon: AlertCircle, color: "text-amber-600", bg: "bg-amber-50" },
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

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <h2 className="font-semibold text-foreground mb-0.5">Topic Mastery Radar</h2>
          <p className="text-xs text-muted-foreground font-mono mb-4 font-light">Across all covered topics</p>
          <ResponsiveContainer width="100%" height={240}>
            <RadarChart data={RADAR_DATA} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
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
            {RADAR_DATA.map((d, i) => (
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
      </div>

      {/* Weekly study schedule */}
      <div className="bg-card border border-border rounded-xl p-6 shadow-sm mb-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold text-foreground">This Week's Study Schedule</h2>
          <span className="text-xs font-mono text-muted-foreground">Jul 7 – Jul 13</span>
        </div>
        <p className="text-xs text-muted-foreground font-light mb-5">AI-generated based on your weak topics and quiz history.</p>
        <div className="grid grid-cols-7 gap-2">
          {WEEK_SCHEDULE.map((day, i) => (
            <div key={day.day} className="min-h-[80px]">
              <div className={`text-xs font-mono font-semibold mb-1.5 ${i === 2 ? "text-muted-foreground/40" : "text-muted-foreground"}`}>
                {day.day}
              </div>
              <div className="space-y-1">
                {day.sessions.length === 0 ? (
                  <div className="h-10 border border-dashed border-border rounded-lg flex items-center justify-center">
                    <span className="text-[9px] text-muted-foreground/40">Rest</span>
                  </div>
                ) : (
                  day.sessions.map((s, j) => (
                    <div key={j} className={`text-[9px] font-medium px-1.5 py-1.5 rounded-lg border leading-tight ${sessionColor(s.priority)}`}>
                      <div className="truncate">{s.topic}</div>
                      <div className="font-mono opacity-60 mt-0.5">{s.duration}m</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* AI Study Plan — interactive checklist */}
      <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
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
              className={`flex gap-4 p-4 rounded-xl border transition-colors ${plan.done ? "bg-muted/30 border-border" : "bg-muted/40 border-transparent hover:bg-muted/70"}`}>
              <button onClick={() => toggleDone(plan.id)} className="shrink-0 mt-0.5">
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${plan.done ? "bg-emerald-500 border-emerald-500" : "border-muted-foreground/30"}`}>
                  {plan.done && <CheckCheck size={11} className="text-white" />}
                </div>
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${priorityStyle(plan.priority)} ${plan.done ? "opacity-50" : ""}`}>
                    {plan.priority}
                  </span>
                  <span className={`text-sm font-semibold text-foreground ${plan.done ? "line-through opacity-40" : ""}`}>{plan.topic}</span>
                  <span className="text-xs font-mono text-muted-foreground/60 ml-auto">{plan.time}</span>
                </div>
                <div className={`text-xs text-muted-foreground font-light leading-relaxed ${plan.done ? "opacity-40" : ""}`}>{plan.action}</div>
              </div>
              {!plan.done && (
                <button onClick={onGoQuiz} className="text-xs font-semibold text-primary hover:underline shrink-0 mt-0.5 flex items-center gap-0.5">
                  Start <ChevronRight size={11} />
                </button>
              )}
            </motion.div>
          ))}
        </div>
      </div>

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
          {STUDENT_QUIZ_HISTORY.map((attempt, i) => {
            const pct = Math.round((attempt.score / attempt.total) * 100);
            return (
              <div key={attempt.id} className={`flex items-center gap-4 py-3.5 ${i < STUDENT_QUIZ_HISTORY.length - 1 ? "border-b border-border" : ""}`}>
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-xs font-bold ${pct === 100 ? "bg-emerald-50 text-emerald-600" : pct >= 75 ? "bg-blue-50 text-blue-600" : pct >= 50 ? "bg-amber-50 text-amber-600" : "bg-red-50 text-red-600"}`}>
                  {pct}%
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">{attempt.topic}</div>
                  <div className="text-xs text-muted-foreground font-light">{attempt.score}/{attempt.total} correct · {attempt.duration}</div>
                </div>
                <div className="text-xs font-mono text-muted-foreground/60 shrink-0">{attempt.date}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
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

function CourseCreateModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, subject: string, description: string) => Promise<string> }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("Biology");
  const [description, setDescription] = useState("");
  const [topics, setTopics] = useState(DEFAULT_TOPICS.map(t => ({ name: t, weight: "medium" as "high" | "medium" | "low", enabled: true })));
  const [generatedCode, setGeneratedCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const goStep2 = () => { if (!name.trim()) return; setStep(2); };
  const goStep3 = async () => {
    setIsCreating(true);
    try {
      const code = await onCreate(name, subject, description);
      setGeneratedCode(code);
      setStep(3);
      toast.success(`Course "${name}" created!`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create course");
    } finally {
      setIsCreating(false);
    }
  };
  const finish = () => { onClose(); toast.success(`"${name}" is live — code ${generatedCode}`); };

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
                    <span className={`flex-1 text-sm font-medium ${t.enabled ? "text-foreground" : "text-muted-foreground/50 line-through"}`}>{t.name}</span>
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
              disabled={isCreating}
              className="bg-primary text-primary-foreground px-5 py-2.5 rounded-xl text-sm font-semibold shadow-sm disabled:opacity-60 flex items-center gap-2">
              {isCreating && <RefreshCw size={14} className="animate-spin" />}
              Generate Class Code →
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

function TeacherSettings({ darkMode, setDarkMode }: { darkMode: boolean; setDarkMode: (v: boolean) => void }) {
  const [profile, setProfile] = useState({ name: "Dr. Sarah Chen", email: "s.chen@university.edu", title: "Associate Professor", department: "Life Sciences" });
  const [notifPrefs, setNotifPrefs] = useState({ enrollments: true, flags: true, misconceptions: true, quizActivity: false, weeklyDigest: true });
  const [saved, setSaved] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);

  const save = () => { setSaved(true); setEditingProfile(false); toast.success("Settings saved"); setTimeout(() => setSaved(false), 2000); };

  const toggle = (key: keyof typeof notifPrefs) => setNotifPrefs(p => ({ ...p, [key]: !p[key] }));

  const Toggle = ({ on, onToggle }: { on: boolean; onToggle: () => void }) => (
    <button onClick={onToggle} className={`relative w-10 h-5.5 rounded-full transition-colors shrink-0 ${on ? "bg-primary" : "bg-muted border border-border"}`}
      style={{ height: "22px" }}>
      <motion.div animate={{ x: on ? 20 : 2 }} transition={{ type: "spring", stiffness: 500, damping: 30 }}
        className="absolute top-[3px] w-4 h-4 rounded-full bg-white shadow-sm" />
    </button>
  );

  return (
    <div className="p-6 lg:p-8 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="font-display text-2xl text-primary">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1 font-light">Manage your profile, courses, and notification preferences.</p>
      </div>

      {/* Profile */}
      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm mb-5">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-foreground">Profile</h2>
          <button onClick={() => setEditingProfile(v => !v)}
            className="text-xs font-medium text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors">
            <Pencil size={12} />{editingProfile ? "Cancel" : "Edit"}
          </button>
        </div>
        <div className="flex items-start gap-4 mb-5">
          <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center text-primary-foreground font-display text-xl shrink-0">
            SC
          </div>
          <div className="flex-1 min-w-0">
            {editingProfile ? (
              <div className="space-y-3">
                <input value={profile.name} onChange={e => setProfile(p => ({ ...p, name: e.target.value }))}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
                <input value={profile.title} onChange={e => setProfile(p => ({ ...p, title: e.target.value }))}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
                <input value={profile.email} onChange={e => setProfile(p => ({ ...p, email: e.target.value }))}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
                <input value={profile.department} onChange={e => setProfile(p => ({ ...p, department: e.target.value }))}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
            ) : (
              <>
                <div className="font-semibold text-foreground">{profile.name}</div>
                <div className="text-sm text-muted-foreground font-light">{profile.title} · {profile.department}</div>
                <div className="text-xs text-muted-foreground font-mono mt-1">{profile.email}</div>
              </>
            )}
          </div>
        </div>
        {editingProfile && (
          <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
            onClick={save}
            className="w-full bg-primary text-primary-foreground py-2.5 rounded-xl text-sm font-semibold shadow-sm">
            Save Changes
          </motion.button>
        )}
      </div>

      {/* My Courses */}
      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm mb-5">
        <h2 className="font-semibold text-foreground mb-5">My Courses</h2>
        <div className="space-y-3">
          {[
            { name: "Biology 101", code: "BIO-3F8K", students: 24, docs: 4, color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
            { name: "Advanced Genetics", code: "GEN-7X2Q", students: 16, docs: 4, color: "bg-purple-50 text-purple-700 border-purple-200" },
          ].map(c => (
            <div key={c.code} className="flex items-center gap-3 p-4 bg-muted/40 rounded-xl">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-foreground text-sm">{c.name}</div>
                <div className="text-xs text-muted-foreground font-light mt-0.5">
                  <span className="font-mono">{c.code}</span> · {c.students} students · {c.docs} docs
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${c.color}`}>Active</span>
                <button className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground hover:text-foreground transition-colors">
                  <Pencil size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Notification Preferences */}
      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm mb-5">
        <h2 className="font-semibold text-foreground mb-1">Notification Preferences</h2>
        <p className="text-xs text-muted-foreground font-light mb-5">Choose which events trigger in-app notifications.</p>
        <div className="space-y-4">
          {[
            { key: "enrollments" as const, label: "Enrollment requests", desc: "When a student requests to join your course" },
            { key: "flags" as const, label: "Struggling student alerts", desc: "When a student scores below 40% on 3+ attempts" },
            { key: "misconceptions" as const, label: "Misconception spikes", desc: "When 5+ students show the same misunderstanding" },
            { key: "quizActivity" as const, label: "Quiz activity summaries", desc: "Daily count of quizzes completed across courses" },
            { key: "weeklyDigest" as const, label: "Weekly digest email", desc: "Summary of class performance every Monday" },
          ].map(item => (
            <div key={item.key} className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-foreground">{item.label}</div>
                <div className="text-xs text-muted-foreground font-light mt-0.5">{item.desc}</div>
              </div>
              <Toggle on={notifPrefs[item.key]} onToggle={() => toggle(item.key)} />
            </div>
          ))}
        </div>
      </div>

      {/* Appearance */}
      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm mb-5">
        <h2 className="font-semibold text-foreground mb-5">Appearance</h2>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-foreground">Dark mode</div>
            <div className="text-xs text-muted-foreground font-light mt-0.5">Switch between light and dark interface</div>
          </div>
          <Toggle on={darkMode} onToggle={() => setDarkMode(!darkMode)} />
        </div>
      </div>

      {/* Account */}
      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
        <h2 className="font-semibold text-foreground mb-5">Account</h2>
        <div className="space-y-2">
          <button className="w-full text-left px-4 py-3 rounded-xl text-sm font-medium text-foreground hover:bg-muted transition-colors flex items-center justify-between">
            Change password <ChevronRight size={15} className="text-muted-foreground" />
          </button>
          <button onClick={() => {
            const rows = STUDENTS.map(s => `${s.name},${s.progress}%,${s.quizzes},${s.status},"${s.weak.join("; ")}"`).join("\n");
            const blob = new Blob([`Name,Progress,Quizzes,Status,Weak Topics\n${rows}`], { type: "text/csv" });
            const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "student_data.csv"; a.click();
            toast.success("Student data exported");
          }} className="w-full text-left px-4 py-3 rounded-xl text-sm font-medium text-foreground hover:bg-muted transition-colors flex items-center justify-between">
            Export student data <ChevronRight size={15} className="text-muted-foreground" />
          </button>
          <button className="w-full text-left px-4 py-3 rounded-xl text-sm font-medium text-red-600 hover:bg-red-50 transition-colors flex items-center justify-between">
            Delete account <ChevronRight size={15} className="text-red-400" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Student Settings ─────────────────────────────────────────────────────

function StudentSettings({ darkMode, setDarkMode }: { darkMode: boolean; setDarkMode: (v: boolean) => void }) {
  const [profile, setProfile] = useState({ name: "Amara Osei", email: "amara@student.edu", year: "3rd Year", major: "Molecular Biology" });
  const [editingProfile, setEditingProfile] = useState(false);
  const [prefs, setPrefs] = useState({ difficulty: "adaptive" as "easy" | "adaptive" | "hard", emailDigest: true, quizReminders: true, misconceptionAlerts: true });

  const save = () => { setEditingProfile(false); toast.success("Profile updated"); };
  const togglePref = (key: keyof typeof prefs) => setPrefs(p => ({ ...p, [key]: !p[key] }));

  const Toggle = ({ on, onToggle }: { on: boolean; onToggle: () => void }) => (
    <button onClick={onToggle} className={`relative rounded-full transition-colors shrink-0 ${on ? "bg-primary" : "bg-muted border border-border"}`}
      style={{ width: "40px", height: "22px" }}>
      <motion.div animate={{ x: on ? 20 : 2 }} transition={{ type: "spring", stiffness: 500, damping: 30 }}
        className="absolute top-[3px] w-4 h-4 rounded-full bg-white shadow-sm" />
    </button>
  );

  return (
    <div className="p-6 lg:p-8 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="font-display text-2xl text-primary">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1 font-light">Update your profile and study preferences.</p>
      </div>

      {/* Profile */}
      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm mb-5">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-foreground">Profile</h2>
          <button onClick={() => setEditingProfile(v => !v)}
            className="text-xs font-medium text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors">
            <Pencil size={12} />{editingProfile ? "Cancel" : "Edit"}
          </button>
        </div>
        <div className="flex items-start gap-4 mb-5">
          <div className="w-16 h-16 rounded-2xl bg-accent flex items-center justify-center text-accent-foreground font-display text-xl shrink-0">
            AO
          </div>
          <div className="flex-1 min-w-0">
            {editingProfile ? (
              <div className="space-y-3">
                <input value={profile.name} onChange={e => setProfile(p => ({ ...p, name: e.target.value }))}
                  placeholder="Full name"
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
                <input value={profile.major} onChange={e => setProfile(p => ({ ...p, major: e.target.value }))}
                  placeholder="Major"
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
                <input value={profile.email} onChange={e => setProfile(p => ({ ...p, email: e.target.value }))}
                  placeholder="Email"
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
                <button onClick={save}
                  className="w-full bg-primary text-primary-foreground py-2.5 rounded-xl text-sm font-semibold shadow-sm">
                  Save Profile
                </button>
              </div>
            ) : (
              <>
                <div className="font-semibold text-foreground">{profile.name}</div>
                <div className="text-sm text-muted-foreground font-light">{profile.major} · {profile.year}</div>
                <div className="text-xs text-muted-foreground font-mono mt-1">{profile.email}</div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Quiz Preferences */}
      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm mb-5">
        <h2 className="font-semibold text-foreground mb-1">Quiz Preferences</h2>
        <p className="text-xs text-muted-foreground font-light mb-5">Control how the adaptive quiz engine challenges you.</p>
        <div className="mb-5">
          <label className="text-sm font-medium text-foreground block mb-3">Difficulty Mode</label>
          <div className="grid grid-cols-3 gap-2">
            {(["easy", "adaptive", "hard"] as const).map(d => (
              <button key={d} onClick={() => setPrefs(p => ({ ...p, difficulty: d }))}
                className={`py-2.5 rounded-xl text-sm font-medium border capitalize transition-colors ${
                  prefs.difficulty === d ? "bg-primary text-primary-foreground border-primary shadow-sm" : "bg-card border-border text-foreground hover:bg-muted"
                }`}>
                {d === "adaptive" ? "Adaptive ✦" : d === "easy" ? "Easy" : "Hard"}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground font-light mt-2">
            {prefs.difficulty === "adaptive" ? "Questions adjust based on your recent performance — recommended." : prefs.difficulty === "easy" ? "Foundational recall questions. Good for review." : "Application and synthesis-level questions. Most challenging."}
          </p>
        </div>
        <div className="space-y-4">
          {[
            { key: "quizReminders" as const, label: "Daily quiz reminders", desc: "Get reminded to complete your daily quiz target" },
            { key: "misconceptionAlerts" as const, label: "Misconception alerts", desc: "Be notified when your teacher flags a misunderstanding" },
            { key: "emailDigest" as const, label: "Weekly progress email", desc: "Receive your progress summary every Sunday" },
          ].map(item => (
            <div key={item.key} className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-foreground">{item.label}</div>
                <div className="text-xs text-muted-foreground font-light mt-0.5">{item.desc}</div>
              </div>
              <Toggle on={prefs[item.key] as boolean} onToggle={() => togglePref(item.key)} />
            </div>
          ))}
        </div>
      </div>

      {/* Stats card */}
      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm mb-5">
        <h2 className="font-semibold text-foreground mb-4">Your Stats</h2>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Member since", val: "Sep 2024" },
            { label: "Total quizzes", val: "47" },
            { label: "Courses enrolled", val: "1" },
            { label: "Study streak", val: "12 days" },
          ].map(s => (
            <div key={s.label} className="bg-muted/50 rounded-xl p-3">
              <div className="text-xs text-muted-foreground font-light mb-0.5">{s.label}</div>
              <div className="font-semibold text-foreground text-sm">{s.val}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Appearance */}
      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm mb-5">
        <h2 className="font-semibold text-foreground mb-5">Appearance</h2>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-foreground">Dark mode</div>
            <div className="text-xs text-muted-foreground font-light mt-0.5">Switch between light and dark interface</div>
          </div>
          <Toggle on={darkMode} onToggle={() => setDarkMode(!darkMode)} />
        </div>
      </div>

      {/* Account */}
      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
        <h2 className="font-semibold text-foreground mb-5">Account</h2>
        <div className="space-y-2">
          <button className="w-full text-left px-4 py-3 rounded-xl text-sm font-medium text-foreground hover:bg-muted transition-colors flex items-center justify-between">
            Change password <ChevronRight size={15} className="text-muted-foreground" />
          </button>
          <button className="w-full text-left px-4 py-3 rounded-xl text-sm font-medium text-foreground hover:bg-muted transition-colors flex items-center justify-between">
            Download my data <ChevronRight size={15} className="text-muted-foreground" />
          </button>
          <button className="w-full text-left px-4 py-3 rounded-xl text-sm font-medium text-red-600 hover:bg-red-50 transition-colors flex items-center justify-between">
            Delete account <ChevronRight size={15} className="text-red-400" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [view, setView] = useState<View>("landing");
  const [role, setRole] = useState<"teacher" | "student">("teacher");
  const [darkMode, setDarkMode] = useState(false);
  const [session, setSession] = useState<DemoSession>({ teacher: null, student: null });
  const go = (v: View, r?: "teacher" | "student") => { if (r) setRole(r); setView(v); };
  const enterAuthenticated = (nextRole: "teacher" | "student", account: ApiTeacher | ApiStudent) => {
    setRole(nextRole);
    setSession(prev => nextRole === "teacher"
      ? { ...prev, teacher: account as ApiTeacher }
      : { ...prev, student: account as ApiStudent });
    setView(nextRole);
  };
  const logout = () => {
    setView("landing");
  };
  return (
    <div className={darkMode ? "dark" : ""}>
      <Toaster position="bottom-right" toastOptions={{ style: { fontFamily: "Outfit, sans-serif", fontSize: "14px" } }} />
      {view === "landing" && <Landing onNavigate={go} />}
      {view === "auth" && <Auth role={role} setRole={setRole} onBack={() => setView("landing")} onEnter={enterAuthenticated} />}
      {view === "teacher" && <TeacherDashboard teacher={session.teacher} onLogout={logout} onSwitch={() => setView("student")} darkMode={darkMode} setDarkMode={setDarkMode} />}
      {view === "student" && <StudentDashboard student={session.student} onLogout={logout} onSwitch={() => setView("teacher")} darkMode={darkMode} setDarkMode={setDarkMode} />}
    </div>
  );
}
