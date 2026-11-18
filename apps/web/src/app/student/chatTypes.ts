import type { SourceCitation } from "../../lib/api";

export type HistoryStatus = "loading" | "ready" | "error";

export type Announcement = {
  id: string;
  title: string;
  body: string;
  course: string;
  createdAt: string;
  pinned: boolean;
};

export type StudentCourse = {
  id: string;
  name: string;
  code: string;
  teacher: string;
  progress: number;
};

export type UserMessage = { role: "user"; text: string };
export type AiMessage = {
  role: "ai";
  text: string;
  citations: Array<string | SourceCitation>;
  misconception: string | null;
  question?: string;
  formatLabel?: string;
};
export type ChatMessage = UserMessage | AiMessage;
