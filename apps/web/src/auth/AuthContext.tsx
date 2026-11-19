import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";

import { isSupabaseConfigured, supabase } from "../lib/supabase";

export type UserRole = "admin" | "teacher" | "student";

export type Profile = {
  id: string;
  role: UserRole;
  display_name: string;
  avatar_url: string | null;
  teacher_approved_at: string | null;
  headline: string | null;
  organization: string | null;
  created_at: string;
};

type SignUpInput = {
  email: string;
  password: string;
  displayName: string;
  role: "teacher" | "student";
};

type AuthContextValue = {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: SignUpInput) => Promise<{ requiresEmailVerification: boolean }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const activeUser = useRef<string | null>(null);

  const loadProfile = useCallback(async (userId: string) => {
    if (!supabase) return null;
    const { data, error } = await supabase
      .from("profiles")
      .select("id, role, display_name, avatar_url, teacher_approved_at, headline, organization, created_at")
      .eq("id", userId)
      .single();

    if (error) throw error;
    return data as Profile;
  }, []);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let active = true;
    let identity: string | null | undefined;
    let revision = 0;
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      // Supabase repeats events (for example when the tab regains focus) with the same login.
      // Keep the existing session then, so screens don't reload for nothing.
      setSession(current => (
        current && nextSession
        && current.access_token === nextSession.access_token
        && current.user.id === nextSession.user.id
      ) ? current : nextSession);
      const userId = nextSession?.user.id ?? null;
      // Token renewal and repeated sign-in events for the same user are not navigation.
      if (identity === userId && userId !== null) return;
      identity = userId;
      activeUser.current = userId;
      const requestRevision = ++revision;
      const isCurrent = () => active && requestRevision === revision;
      setProfile(null);
      if (!userId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      queueMicrotask(() => {
        if (!isCurrent()) return;
        loadProfile(userId)
          .then(nextProfile => { if (isCurrent()) setProfile(nextProfile); })
          .catch(() => { if (isCurrent()) setProfile(null); })
          .finally(() => { if (isCurrent()) setLoading(false); });
      });
    });

    return () => {
      active = false;
      activeUser.current = null;
      listener.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const value = useMemo<AuthContextValue>(() => ({
    configured: isSupabaseConfigured,
    loading,
    session,
    user: session?.user ?? null,
    profile,
    async signIn(email, password) {
      if (!supabase) throw new Error("Supabase authentication is not configured yet.");
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    async signUp({ email, password, displayName, role }) {
      if (!supabase) throw new Error("Supabase authentication is not configured yet.");
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            display_name: displayName,
            requested_role: role,
          },
        },
      });
      if (error) throw error;
      // With email confirmation enabled, Supabase may return an obfuscated user
      // with no identities for an already-registered email. Treat it as a
      // duplicate instead of showing a false account-created message or
      // implying that the existing account's role changed.
      if (data.user && data.user.identities?.length === 0) {
        throw new Error("An account with this email already exists. Sign in instead.");
      }
      return { requiresEmailVerification: data.session === null };
    },
    async signOut() {
      if (!supabase) return;
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
    async refreshProfile() {
      if (!session) return;
      const userId = session.user.id;
      const nextProfile = await loadProfile(userId);
      if (activeUser.current === userId) setProfile(nextProfile);
    },
  }), [loading, session, profile, loadProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
