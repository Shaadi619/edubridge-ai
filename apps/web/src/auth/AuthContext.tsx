import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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

  const loadProfile = useCallback(async (userId: string) => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("profiles")
      .select("id, role, display_name, avatar_url, teacher_approved_at, headline, organization, created_at")
      .eq("id", userId)
      .single();

    if (error) throw error;
    setProfile(data as Profile);
  }, []);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let active = true;
    supabase.auth.getSession().then(async ({ data, error }) => {
      if (!active) return;
      if (error) {
        setLoading(false);
        return;
      }
      setSession(data.session);
      if (data.session) {
        try {
          await loadProfile(data.session.user.id);
        } finally {
          if (active) setLoading(false);
        }
      } else {
        setLoading(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setProfile(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      queueMicrotask(() => {
        loadProfile(nextSession.user.id)
          .catch(() => setProfile(null))
          .finally(() => setLoading(false));
      });
    });

    return () => {
      active = false;
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
      if (session) await loadProfile(session.user.id);
    },
  }), [loading, session, profile, loadProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
