import React, { lazy, Suspense, useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { toast, Toaster } from "sonner";
import { BookOpen, Users, Brain, TrendingUp, BarChart2, MessageSquare, LogOut, ArrowRight, Send, Home, Target, Bell, Search, CheckCircle, AlertCircle, Plus, FileText, Settings, Menu, X, Clock, Upload, File, Trash2, CheckSquare, RefreshCw, ChevronRight, Lock, Unlock, ChevronDown, Copy, Pencil, CheckCheck, Sparkles } from "lucide-react";

import { useAuth } from "../auth/AuthContext";
import { supabase } from "../lib/supabase";
import { api, ApiError, type CourseGraphSuggestion, type ExplanationFormat, type TeacherInterventionDraft } from "../lib/api";
import type { Announcement, ChatMessage, HistoryStatus, StudentCourse } from "./student/chatTypes";

import { useScopedQuery, useScopedRequest } from "./useScopedRequest";
import { clearStudentSession, readStudentLocation, writeStudentLocation } from "../lib/studentSession";

const CitationPreview = lazy(() => import("./components/CitationPreview"));
const Landing = lazy(() => import("./Landing"));
const AskWorkspace = lazy(() => import("./student/AskWorkspace"));
const TodayStage = lazy(() => import("./teacher/TodayStage"));
const QuizStage = lazy(() => import("./student/QuizStage"));
const ProgressStage = lazy(() => import("./student/ProgressStage"));
const CheckDialog = lazy(() => import("./student/CheckDialog"));
const WorkStage = lazy(() => import("./student/WorkStage"));
const MaterialsStage = lazy(() => import("./teacher/MaterialsStage"));
const AnalyticsStage = lazy(() => import("./teacher/AnalyticsStage"));
const StudentsStage = lazy(() => import("./teacher/StudentsStage"));
const CourseDesk = lazy(() => import("./teacher/CourseDesk"));
const FollowUpDialog = lazy(() => import("./teacher/FollowUpDialog"));

// ─── Types ────────────────────────────────────────────────────────────────

type View = "landing" | "auth" | "teacher" | "student" | "admin";
type TeacherTab = "overview" | "students" | "analytics" | "materials" | "settings";
type StudentTab = "workspace" | "work" | "quiz" | "progress" | "enroll" | "settings";
const STUDENT_TABS: readonly string[] = ["workspace", "work", "quiz", "progress", "enroll", "settings"];
type InterventionQueueItem = Awaited<ReturnType<typeof api.teacherCourseAnalytics>>["intervention_queue"][number];

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
  createdAt?: string;
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

type TeacherCourse = {
  id: string;
  name: string;
  code: string;
  students: number;
  subject: string;
  description: string | null;
  color: string;
  created_at: string;
  showWork: boolean;
};

type CourseRow = {
  id: string;
  name: string;
  subject: string;
  description: string | null;
  enrollment_code: string;
  created_at: string;
  show_work_enabled?: boolean;
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
  showWork: Boolean(row.show_work_enabled),
});

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
      createdAt: material.created_at,
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
                  {uploading.progress < 75 ? "Uploading…" : "Saving to the course…"}
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

  const setCourseShowWork = async (courseId: string, enabled: boolean) => {
    if (!supabase) return;
    const { error } = await supabase.from("courses").update({ show_work_enabled: enabled }).eq("id", courseId);
    if (error) {
      toast.error(/show_work_enabled/.test(error.message)
        ? "This setting needs the latest database update. Apply the Show Your Work migration in Supabase first."
        : error.message);
      return;
    }
    setCourses(current => current.map(course => course.id === courseId ? { ...course, showWork: enabled } : course));
    toast.success(enabled ? "Show Your Work is on for this course" : "Show Your Work is off for this course");
  };

  const loadCourses = useCallback(async () => {
    if (!supabase || !user) return;
    setCoursesLoading(true);
    const query = (columns: string) => supabase!
      .from("courses")
      .select(columns)
      .eq("teacher_id", user.id)
      .is("archived_at", null)
      .order("created_at", { ascending: false });
    let { data, error } = await query("id, name, subject, description, enrollment_code, created_at, show_work_enabled");
    if (error && /show_work_enabled/.test(error.message)) {
      // The Show Your Work migration hasn't been applied yet; load courses without it.
      ({ data, error } = await query("id, name, subject, description, enrollment_code, created_at"));
    }
    setCoursesLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const loaded = ((data ?? []) as unknown as CourseRow[]).map(courseFromRow);
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
          createdAt: material.created_at,
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
              {tab === "students" && selectedCourse && session && <Suspense fallback={<div role="status" className="eb-stage rounded-2xl px-8 py-8 text-sm text-[#A9B6C2]">Opening students…</div>}><StudentsStage key={selectedCourse.id} searchQuery={searchQuery} courseId={selectedCourse.id} courseName={selectedCourse.name} accessToken={session.access_token} analytics={courseAnalytics} loading={analyticsLoading} focusedStudentId={activeFocus.studentId} focusedAttemptId={activeFocus.attemptId} focusKey={activeFocus.key} /></Suspense>}
              {tab === "analytics" && selectedCourse && session && <Suspense fallback={<div role="status" className="eb-stage rounded-2xl px-8 py-8 text-sm text-[#A9B6C2]">Opening analytics…</div>}><AnalyticsStage key={selectedCourse.id} course={selectedCourse} analytics={courseAnalytics} loading={analyticsLoading} accessToken={session.access_token} focusedMisconceptionId={activeFocus.misconceptionId} focusKey={activeFocus.key} /></Suspense>}
              {tab === "materials" && selectedCourse && (
                <Suspense fallback={<div role="status" className="eb-stage rounded-2xl px-8 py-8 text-sm text-[#A9B6C2]">Opening course material…</div>}>
                  <MaterialsStage docs={docs} onRemoved={id => setDocs(previous => previous.filter(doc => doc.id !== id))}
                    onUploadClick={() => setUploadOpen(true)} courseId={selectedCourse.id} courseName={selectedCourse.name} />
                </Suspense>
              )}
              {tab === "settings" && <TeacherSettings courses={courses} darkMode={darkMode} setDarkMode={setDarkMode} onShowWorkChange={(id, enabled) => void setCourseShowWork(id, enabled)} />}
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

function TeacherOverview({ requests, setRequests, announcements, setAnnouncements, course, courses, onNewCourse, analytics, analyticsLoading, teacherName, accessToken, focusedEnrollmentId, focusKey, onViewStudent }: {
  requests: EnrollRequest[];
  setRequests: React.Dispatch<React.SetStateAction<EnrollRequest[]>>;
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
      toast.success(`Practice sent to ${item.student}`);
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
      toast.success(`Follow-up sent to ${copilotItem.student}`);
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
      toast.success(decision === "approved" ? "Added to the student’s record" : "Marked as not a problem");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not review this submission.");
    } finally {
      setReviewingWorkId(null);
    }
  };

  const postAnnouncement = async (title: string, body: string, pinned: boolean) => {
    try {
      const row = await api.createAnnouncement(course.id, title, body, pinned, accessToken);
      setAnnouncements(prev => [{ id: row.id, title: row.title, body: row.body, course: course.name, createdAt: new Date(row.created_at).toLocaleString(), pinned: row.pinned }, ...prev]);
      toast.success(`Posted to ${course.name}`);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The announcement couldn’t be posted. Try again.");
      return false;
    }
  };

  const resolveRequest = async (id: EnrollRequest["id"], decision: "approved" | "denied") => {
    const request = requests.find(item => item.id === id);
    if (!request) return;
    if (typeof id === "string") {
      try {
        await api.reviewEnrollment(id, decision, accessToken);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "That couldn’t be saved. Try again.");
        return;
      }
    }
    setRequests(previous => previous.map(item => item.id === id ? { ...item, status: decision } : item));
    toast.success(decision === "approved" ? `${request.name} can now use ${request.course}` : `${request.name}’s request was turned down`);
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
      <Suspense fallback={<div role="status" className="eb-stage mb-10 rounded-2xl px-8 py-8 text-sm text-[#A9B6C2]">Loading today’s queue…</div>}>
        <TodayStage
          courseId={course.id}
          analytics={analytics}
          loading={analyticsLoading}
          accessToken={accessToken}
          assigningId={assigningIntervention}
          assignedIds={assignedInterventions}
          onAssign={item => void assignPractice(item)}
          onDraft={item => void draftIntervention(item)}
          onViewStudent={onViewStudent}
        />
      </Suspense>
      <Suspense fallback={<div role="status" className="eb-stage mb-10 rounded-2xl px-8 py-8 text-sm text-[#A9B6C2]">Loading the course…</div>}>
        <CourseDesk
          course={course}
          courses={courses}
          analytics={analytics}
          analyticsLoading={analyticsLoading}
          requests={requests}
          onResolveRequest={resolveRequest}
          workReviews={workReviews}
          reviewingWorkId={reviewingWorkId}
          onReviewWork={(id, decision) => void reviewSubmittedWork(id, decision)}
          announcements={announcements}
          onPostAnnouncement={postAnnouncement}
          onDeleteAnnouncement={deleteAnnouncement}
          onNewCourse={onNewCourse}
          focusedEnrollmentId={focusedEnrollmentId}
          focusKey={focusKey}
        />
      </Suspense>
      {copilotItem && (
        <Suspense fallback={null}>
          <FollowUpDialog
            item={copilotItem}
            draft={copilotDraft}
            loading={copilotLoading}
            dueDays={copilotDueDays}
            assigning={assigningIntervention === copilotItem.id}
            onDueDays={setCopilotDueDays}
            onChange={setCopilotDraft}
            onClose={() => { if (!copilotLoading) { setCopilotItem(null); setCopilotDraft(null); } }}
            onAssign={() => void assignCopilotDraft()}
          />
        </Suspense>
      )}
    </div>
  );
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
    const loaded = rows.map(row => ({ id: row.id, name: row.name, code: row.enrollment_code, teacher: row.teacher, progress: 0, showWork: Boolean(row.show_work_enabled) }));
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

  useEffect(() => {
    if (tab === "work" && selectedCourse && !selectedCourse.showWork) setTab("workspace");
  }, [tab, selectedCourse]);

  const navItems: { id: StudentTab; label: string; icon: React.ElementType }[] = [
    { id: "workspace", label: "Course Q&A", icon: MessageSquare },
    ...(selectedCourse?.showWork ? [{ id: "work" as StudentTab, label: "Show Your Work", icon: Pencil }] : []),
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
        <header className={`sticky top-0 z-20 backdrop-blur-sm border-b h-14 flex items-center px-6 gap-4 ${tab === "workspace" || tab === "quiz" || tab === "progress" || tab === "work" ? "eb-stage-header" : "bg-background/95 border-border"}`}>
          <button className="lg:hidden" aria-label="Open menu" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
          <h1 className="font-semibold text-foreground text-sm">
            {tab === "workspace" && `Course Q&A${selectedCourse ? ` — ${selectedCourse.name}` : ""}`}
            {tab === "work" && "Show Your Work"}
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
            <Suspense fallback={<div role="status" className="eb-stage min-h-[calc(100vh-3.5rem)] p-10 text-sm text-[#A9B6C2]">Opening quiz…</div>}>
              <QuizStage key={courseScope} userId={session.user.id} courseId={selectedCourse.id} courseName={selectedCourse.name}
                accessToken={session.access_token} onViewProgress={() => setTab("progress")} suggestedFocus={practiceConcept}
                onFocusConsumed={() => setPracticeConcept(null)} />
            </Suspense>
          </div>}
          <div hidden={tab === "quiz" && Boolean(selectedCourse && session)}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: "easeOut" }} className="h-full"
            >
              {tab === "workspace" && selectedCourse && <Suspense fallback={<div role="status" className="eb-stage h-[calc(100vh-3.5rem)] p-10 text-sm text-[#A9B6C2]">Opening Q&amp;A…</div>}><AskWorkspace messages={messages} isTyping={isTyping} tutorStatus={tutorStatus} historyStatus={historyStatus} onRetryHistory={() => void restoreHistory()} input={input} setInput={setInput} onSend={() => void handleSend()} onExplain={(index, format) => void handleAlternativeExplanation(index, format)} announcements={courseAnnouncements ?? []} course={selectedCourse} /></Suspense>}
              {tab === "work" && selectedCourse?.showWork && session && <Suspense fallback={<div role="status" className="eb-stage min-h-[calc(100vh-3.5rem)] p-10 text-sm text-[#A9B6C2]">Opening Show Your Work…</div>}><WorkStage key={selectedCourse.id} courseId={selectedCourse.id} courseName={selectedCourse.name} accessToken={session.access_token} /></Suspense>}
              {tab === "work" && !selectedCourse && <div className="p-8 text-sm text-muted-foreground">Join an approved course before submitting work.</div>}
              {tab === "quiz" && !selectedCourse && <div role="status" className="p-8 text-sm text-muted-foreground">{courseStatus ?? "Join an approved course before generating a quiz."}</div>}
              {tab === "progress" && selectedCourse && session && <Suspense fallback={<div role="status" className="eb-stage min-h-[calc(100vh-3.5rem)] p-10 text-sm text-[#A9B6C2]">Opening your progress…</div>}>
                <ProgressStage courseId={selectedCourse.id} courseName={selectedCourse.name} accessToken={session.access_token}
                  onGoQuiz={() => { setPracticeConcept(null); setTab("quiz"); }}
                  onPractice={concept => { setPracticeConcept(concept); setTab("quiz"); }}
                  renderCheck={({ misconception, mode, onClose, onComplete }) => (
                    <Suspense fallback={null}>
                      <CheckDialog courseId={selectedCourse.id} courseName={selectedCourse.name} misconception={misconception}
                        mode={mode} accessToken={session.access_token} onClose={onClose} onComplete={onComplete} />
                    </Suspense>
                  )} />
              </Suspense>}
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

function TeacherSettings({ courses, darkMode, setDarkMode, onShowWorkChange }: { courses: TeacherCourse[]; darkMode: boolean; setDarkMode: (v: boolean) => void; onShowWorkChange: (courseId: string, enabled: boolean) => void }) {
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
      <div className="space-y-3">{courses.map(course => <div key={course.id} className="p-4 bg-muted/40 rounded-xl flex flex-col gap-3">
        <div className="flex justify-between gap-3">
          <div><div className="text-sm font-medium">{course.name}</div><div className="text-xs text-muted-foreground">{course.subject} · <span className="font-mono">{course.code}</span></div></div>
          <span className="text-xs text-emerald-700">Active</span>
        </div>
        <div className="flex items-start justify-between gap-4 border-t border-border pt-3">
          <div>
            <div id={`show-work-${course.id}`} className="text-sm font-medium">Show Your Work</div>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-md">Students can upload a photo or PDF of their working for feedback. Useful for problem-solving courses. Flags only reach a student’s record after you approve them.</p>
          </div>
          <button type="button" role="switch" aria-checked={course.showWork} aria-labelledby={`show-work-${course.id}`}
            onClick={() => onShowWorkChange(course.id, !course.showWork)}
            className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors ${course.showWork ? "bg-primary" : "bg-muted-foreground/30"}`}>
            <span className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${course.showWork ? "translate-x-[22px]" : "translate-x-0.5"}`} />
          </button>
        </div>
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
      {view === "landing" && <Suspense fallback={<div className="eb-stage min-h-screen" />}><Landing onNavigate={go} /></Suspense>}
      {view === "auth" && <Auth role={role} setRole={setRole} onBack={() => setView("landing")} />}
      {view === "admin" && session && profile?.role === "admin" && <AdminDashboard onLogout={() => void logout()} />}
      {view === "teacher" && session && profile?.role === "teacher" && <TeacherDashboard key={session.user.id} onLogout={() => void logout()} darkMode={darkMode} setDarkMode={setDarkMode} />}
      {view === "student" && session && profile?.role === "student" && <StudentDashboard key={session.user.id} onLogout={() => void logout()} darkMode={darkMode} setDarkMode={setDarkMode} />}
    </div>
  );
}
