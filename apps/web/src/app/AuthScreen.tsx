import { useState } from "react";
import { toast } from "sonner";

import { useAuth } from "../auth/AuthContext";
import { Wordmark } from "./components/Logo";

type Role = "teacher" | "student";

const field = "w-full min-h-12 rounded-xl border border-[var(--eb-line)] bg-[var(--eb-raised-2)] px-4 text-[16px] text-[var(--eb-text)] focus:border-[var(--eb-text-muted)] focus:outline-none";

export default function AuthScreen({ role, setRole, onBack }: {
  role: Role; setRole: (role: Role) => void; onBack: () => void;
}) {
  const { configured, signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [classCode, setClassCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const signup = mode === "signup";

  const submit = async () => {
    if (!configured) { toast.error("Sign-in isn’t set up yet. Add the Supabase URL and publishable key to apps/web/.env."); return; }
    if (signup && !displayName.trim()) { toast.error("Enter your full name."); return; }
    if (!email.trim() || !password) { toast.error("Enter your email address and password."); return; }
    if (signup && password.length < 8) { toast.error("Use a password with at least 8 characters."); return; }
    setSubmitting(true);
    try {
      if (!signup) {
        await signIn(email.trim(), password);
      } else {
        const result = await signUp({ email: email.trim(), password, displayName: displayName.trim(), role });
        if (classCode.trim()) sessionStorage.setItem("edubridge_pending_class_code", classCode.trim().toUpperCase());
        if (result.requiresEmailVerification) {
          toast.success("Account created. Check your email to confirm your address, then sign in.");
          setMode("login");
        } else {
          toast.success(role === "teacher" ? "Account created. It needs approving before you can create courses." : "Account created.");
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That didn’t work. Check your details and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="eb-stage grid min-h-screen lg:grid-cols-[minmax(340px,40%)_1fr]">
      <aside className="eb-source relative hidden flex-col justify-between overflow-hidden px-12 py-10 lg:flex">
        <span aria-hidden="true" className="eb-beam is-quiet" style={{ opacity: 0.45, animation: "none" }} />
        <button type="button" onClick={onBack} className="relative z-[1] w-fit text-[15px] text-[var(--eb-text-soft)] hover:text-[var(--eb-text)]">Back to the home page</button>
        <div className="relative z-[1] flex flex-col gap-6">
          <Wordmark width={220} />
          <p className="m-0 max-w-[30ch] text-[19px] leading-relaxed text-[var(--eb-text-soft)]">
            A course tutor that shows the page every answer came from.
          </p>
        </div>
        <p className="relative z-[1] m-0 max-w-[40ch] text-sm leading-relaxed text-[var(--eb-text-muted)]">
          Students only get answers from their teacher’s material. Teachers see who’s stuck and why.
        </p>
      </aside>

      <main className="flex flex-col items-center justify-center px-6 py-10">
        <div className="flex w-full max-w-[400px] flex-col gap-7">
          <div className="flex items-center justify-between lg:hidden">
            <Wordmark width={140} />
            <button type="button" onClick={onBack} className="text-[15px] text-[var(--eb-text-soft)] hover:text-[var(--eb-text)]">Back</button>
          </div>

          <div className="flex flex-col gap-2">
            <h1 className="m-0 text-[30px] font-semibold tracking-[-0.02em]">{signup ? "Create your account" : "Welcome back"}</h1>
            <p className="m-0 text-[16px] text-[var(--eb-text-soft)]">
              {signup ? "It takes a minute. You’ll need your school email." : "Sign in to carry on where you left off."}
            </p>
          </div>

          {signup && (
            <div role="radiogroup" aria-label="I am" className="grid grid-cols-2 gap-2">
              {([["teacher", "I teach"], ["student", "I’m a student"]] as const).map(([value, label]) => (
                <button key={value} type="button" role="radio" aria-checked={role === value} onClick={() => setRole(value)}
                  className={`min-h-12 rounded-xl text-[15px] transition-colors ${role === value ? "bg-[var(--eb-text)] font-semibold text-[var(--eb-ink)]" : "border border-[var(--eb-line)] text-[var(--eb-text-soft)] hover:text-[var(--eb-text)]"}`}>
                  {label}
                </button>
              ))}
            </div>
          )}

          <form className="flex flex-col gap-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
            {signup && (
              <label className="flex flex-col gap-2">
                <span className="text-[15px] font-medium">Full name</span>
                <input value={displayName} onChange={event => setDisplayName(event.target.value)} autoComplete="name" className={field} />
              </label>
            )}
            <label className="flex flex-col gap-2">
              <span className="text-[15px] font-medium">Email address</span>
              <input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" inputMode="email" className={field} />
            </label>
            <label className="flex flex-col gap-2">
              <span className="flex items-baseline justify-between text-[15px] font-medium">
                Password
                {signup && <span id="password-hint" className="text-sm font-normal text-[var(--eb-text-muted)]">At least 8 characters</span>}
              </span>
              <span className="relative block">
                <input type={showPassword ? "text" : "password"} value={password} onChange={event => setPassword(event.target.value)} aria-label="Password" aria-describedby={signup ? "password-hint" : undefined}
                  autoComplete={signup ? "new-password" : "current-password"} className={`${field} pr-20`} />
                <button type="button" onClick={() => setShowPassword(value => !value)} aria-pressed={showPassword}
                  className="absolute inset-y-1 right-1 rounded-lg px-3 text-sm text-[var(--eb-text-soft)] hover:text-[var(--eb-text)]">
                  {showPassword ? "Hide" : "Show"}
                </button>
              </span>
            </label>
            {signup && role === "student" && (
              <label className="eb-rise flex flex-col gap-2">
                <span className="flex items-baseline justify-between text-[15px] font-medium">
                  Join code
                  <span id="code-hint" className="text-sm font-normal text-[var(--eb-text-muted)]">Optional, from your teacher</span>
                </span>
                <input value={classCode} onChange={event => setClassCode(event.target.value)} autoCapitalize="characters" aria-label="Join code" aria-describedby="code-hint" className={`${field} tracking-wide`} />
              </label>
            )}
            {signup && role === "teacher" && (
              <p className="m-0 text-sm leading-relaxed text-[var(--eb-text-muted)]">Teacher accounts are approved before you can create courses.</p>
            )}

            {!configured && (
              <p role="alert" className="m-0 rounded-xl border border-[rgba(232,144,127,0.4)] bg-[rgba(232,144,127,0.08)] px-4 py-3 text-sm">
                Sign-in isn’t set up yet. Add your Supabase project URL and publishable key to apps/web/.env.
              </p>
            )}

            <button type="submit" disabled={submitting}
              className="mt-1 min-h-12 rounded-xl bg-[var(--eb-text)] font-semibold text-[var(--eb-ink)] transition-opacity disabled:opacity-50">
              {submitting ? "One moment…" : signup ? (role === "teacher" ? "Create teacher account" : "Create student account") : "Sign in"}
            </button>
          </form>

          <p className="m-0 text-center text-[15px] text-[var(--eb-text-soft)]">
            {signup ? "Already have an account? " : "New to EduBridge? "}
            <button type="button" onClick={() => setMode(signup ? "login" : "signup")} className="font-semibold text-[var(--eb-text)] underline-offset-4 hover:underline">
              {signup ? "Sign in" : "Create an account"}
            </button>
          </p>
        </div>
      </main>
    </div>
  );
}
