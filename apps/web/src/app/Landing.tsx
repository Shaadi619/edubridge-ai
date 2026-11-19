import { Wordmark } from "./components/Logo";

type Role = "teacher" | "student";

const MOTES = [
  { left: "40%", top: "52%", size: 3, duration: "9s", delay: "0s" },
  { left: "52%", top: "36%", size: 2, duration: "11s", delay: "1.6s" },
  { left: "60%", top: "60%", size: 2, duration: "8s", delay: "3s" },
  { left: "47%", top: "24%", size: 3, duration: "12s", delay: "0.8s" },
  { left: "66%", top: "42%", size: 2, duration: "10s", delay: "4.2s" },
];

const STUDENT_SIDE = [
  { title: "Ask about the course", body: "Answers come only from your teacher’s material, with the exact line lit on the page so you can check it yourself." },
  { title: "Practise with quizzes", body: "Short quizzes written from the same material. After each answer you see the line it was checked against." },
  { title: "Explain it back", body: "Put an idea in your own words and get told what you’ve got right and what’s still missing." },
];

const TEACHER_SIDE = [
  { title: "Know who needs you today", body: "A short list of students who are stuck, on what, and the line in your notes that covers it." },
  { title: "See the common mistakes", body: "Misunderstandings spotted in questions, quizzes and explanations, and whether they’ve been put right." },
  { title: "Check your course is ready", body: "Which topics your material covers, which have quiz questions, and what to add next." },
];

type Photo = { id: string; alt: string; credit: string; profile: string; page: string; position: string; tone: string };

// Free-licence Unsplash photos, loaded from Unsplash's own image server as their licence allows.
const PHOTOS: Record<"student" | "teacher", Photo> = {
  student: {
    id: "photo-1639300505533-9921527d6a50",
    alt: "A student writing at a desk in a dark room, lit by a single desk lamp",
    credit: "Kevin Yudhistira Alloni",
    profile: "https://unsplash.com/@kyalloni",
    page: "https://unsplash.com/photos/WBU233kGI6g",
    position: "50% 66%",
    tone: "brightness(1.08) contrast(1.04)",
  },
  teacher: {
    id: "photo-1758270704296-a59b8f4e7dda",
    alt: "A lecturer, seen from behind, facing a class of students taking notes",
    credit: "Vitaly Gariev",
    profile: "https://unsplash.com/@silverkblack",
    page: "https://unsplash.com/photos/uk8i6pZ_qUM",
    position: "40% 50%",
    tone: "saturate(0.55) brightness(0.72) contrast(1.08) sepia(0.14)",
  },
};

const photoUrl = (id: string, width: number) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&h=${Math.round(width / 1.5)}&q=70`;

function ColumnPhoto({ photo }: { photo: Photo }) {
  return (
    <figure className="m-0 flex flex-col gap-2">
      <div className="eb-photo relative aspect-[3/2] overflow-hidden rounded-2xl">
        <img
          src={photoUrl(photo.id, 960)}
          srcSet={[640, 960, 1440].map(width => `${photoUrl(photo.id, width)} ${width}w`).join(", ")}
          sizes="(min-width: 768px) 540px, 100vw"
          width={960}
          height={640}
          alt={photo.alt}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          style={{ objectPosition: photo.position, filter: photo.tone }}
        />
      </div>
      <figcaption className="text-[13px] text-[var(--eb-text-muted)]">
        Photo by <a href={photo.profile} target="_blank" rel="noreferrer" className="underline decoration-[var(--eb-line)] underline-offset-2 hover:text-[var(--eb-text)]">{photo.credit}</a> on{" "}
        <a href={photo.page} target="_blank" rel="noreferrer" className="underline decoration-[var(--eb-line)] underline-offset-2 hover:text-[var(--eb-text)]">Unsplash</a>
      </figcaption>
    </figure>
  );
}

const SCREENS = [
  {
    who: "For students",
    title: "See which step slips, and why",
    body: "A student uploads their working on attention. Each step is checked against the course; step 6 needs another look, and the slide it relies on opens beside it with the line lit.",
    src: "/landing/show-your-work.webp",
    width: 1393,
    height: 802,
    alt: "Show Your Work feedback. Step 5 holds up; step 6 needs another look because transformers don't read words one at a time. Beside it, page 14 of the Transformers slides is open with the matching line highlighted.",
  },
];

const STEPS: { who: string; steps: string[] }[] = [
  { who: "If you teach", steps: [
    "Create a course and get a join code for your students.",
    "Upload the PDFs and slides you teach from.",
    "Let students in as they ask to join.",
    "Check who needs you, and follow up with practice or a message.",
  ] },
  { who: "If you’re a student", steps: [
    "Enter the join code your teacher gave you.",
    "Ask questions about the course and check the lit lines.",
    "Take quizzes to see what’s sticking.",
    "Explain ideas back until they make sense.",
  ] },
];

const LIMITS = [
  "It doesn’t answer from the internet. If your material doesn’t cover a question, it says so instead of guessing.",
  "It can’t read scanned or handwritten pages yet, only documents with selectable text.",
  "A suspected misunderstanding from uploaded work doesn’t go on a student’s record unless the teacher agrees.",
];

export default function Landing({ onNavigate }: { onNavigate: (view: "auth", role?: Role) => void }) {
  const primary = "inline-flex min-h-12 items-center justify-center rounded-xl bg-[var(--eb-text)] px-6 font-semibold text-[var(--eb-ink)] transition-opacity hover:opacity-90";
  const quiet = "inline-flex min-h-12 items-center justify-center rounded-xl border border-[var(--eb-line)] px-6 text-[var(--eb-text)] transition-colors hover:border-[var(--eb-text-muted)]";

  return (
    <div id="top" className="eb-stage min-h-screen">
      <nav className="sticky top-0 z-40 border-b border-[var(--eb-line-soft)] bg-[rgba(30,42,54,0.92)] backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <a href="#top" aria-label="EduBridge, back to top"><Wordmark width={144} /></a>
          <div className="flex items-center gap-2">
            <a href="#how" className="hidden min-h-10 items-center rounded-lg px-3 text-[15px] text-[var(--eb-text-soft)] hover:text-[var(--eb-text)] sm:inline-flex">How it works</a>
            <button type="button" onClick={() => onNavigate("auth")} className="min-h-10 rounded-lg px-3 text-[15px] text-[var(--eb-text-soft)] hover:text-[var(--eb-text)]">Sign in</button>
          </div>
        </div>
      </nav>

      <header className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-20 pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:pt-20">
        <div className="flex flex-col gap-6">
          <h1 className="m-0 text-[clamp(38px,5.4vw,60px)] font-semibold leading-[1.04] tracking-[-0.03em]">
            Every answer comes with the page it came from.
          </h1>
          <p className="m-0 max-w-[46ch] text-[18px] leading-relaxed text-[var(--eb-text-soft)]">
            EduBridge is a course tutor that only answers from your teacher’s material, and lights up the exact line it used. Teachers see who’s stuck, on what, and why.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button type="button" onClick={() => onNavigate("auth", "teacher")} className={primary}>I teach a course</button>
            <button type="button" onClick={() => onNavigate("auth", "student")} className={quiet}>I’m a student</button>
          </div>
        </div>

        <figure aria-label="An example: a student’s question, the answer, and the course page it came from" className="m-0 flex flex-col gap-3">
          <div className="flex flex-col gap-3">
            <p className="eb-rise m-0 self-end rounded-2xl rounded-br-md border border-[var(--eb-student-line)] bg-[rgba(95,184,174,0.10)] px-4 py-2.5 text-[15px] text-[var(--eb-student-text)]">
              Why do transformers divide the scores by the square root of the key size?
            </p>
            <p className="eb-rise m-0 max-w-[52ch] text-[15px] leading-relaxed text-[var(--eb-text-soft)]" style={{ animationDelay: "350ms" }}>
              Without it, the scores grow with the size of the vectors, which pushes the softmax into extreme values and makes training unstable. Dividing keeps them in a workable range.
            </p>
          </div>
          <div className="eb-source relative flex min-h-[300px] items-end justify-center overflow-hidden rounded-2xl px-6 pb-7 pt-16">
            <span aria-hidden="true" className="eb-beam" />
            {MOTES.map((mote, index) => (
              <span key={index} aria-hidden="true" className="eb-mote"
                style={{ left: mote.left, top: mote.top, width: mote.size, height: mote.size, animationDuration: mote.duration, animationDelay: mote.delay }} />
            ))}
            <div className="eb-paper relative z-[1] flex w-full max-w-[460px] flex-col gap-2 px-7 py-6" style={{ animationDelay: "600ms" }}>
              <span className="text-[13px] text-[var(--eb-ink-faint)]">Lecture 2: Transformers, slide 14</span>
              <p className="eb-serif m-0 text-[16px] leading-[1.75]">
                Attention compares every query with every key using a dot product.{" "}
                <span className="eb-lit" style={{ animationDelay: "1300ms" }}>The scores are divided by the square root of the key dimension so that large values don’t push the softmax into regions with tiny gradients.</span>{" "}
                The result weights each value vector.
              </p>
            </div>
          </div>
          <figcaption className="text-sm text-[var(--eb-text-muted)]">An example. The highlighted line is the one the answer was checked against.</figcaption>
        </figure>
      </header>

      <section aria-labelledby="what" className="border-t border-[var(--eb-line-soft)] bg-[var(--eb-stage-deep)]">
        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-20">
          <h2 id="what" className="m-0 max-w-[24ch] text-[32px] font-semibold leading-tight tracking-[-0.02em]">One course, two sides of the same page.</h2>
          <div className="grid gap-12 md:grid-cols-2">
            {[{ who: "For students", items: STUDENT_SIDE, photo: PHOTOS.student }, { who: "For teachers", items: TEACHER_SIDE, photo: PHOTOS.teacher }].map(column => (
              <div key={column.who} className="flex flex-col gap-6">
                <ColumnPhoto photo={column.photo} />
                <span className="text-[15px] text-[var(--eb-text-muted)]">{column.who}</span>
                <ul className="m-0 flex list-none flex-col gap-6 p-0">
                  {column.items.map(item => (
                    <li key={item.title} className="flex flex-col gap-1.5 border-t border-[var(--eb-line)] pt-4">
                      <span className="text-[18px] font-semibold">{item.title}</span>
                      <span className="max-w-[48ch] text-[16px] leading-relaxed text-[var(--eb-text-soft)]">{item.body}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="screens" className="border-t border-[var(--eb-line-soft)]">
        <div className="mx-auto flex max-w-6xl flex-col gap-14 px-6 py-20">
          <div className="flex max-w-[60ch] flex-col gap-3">
            <h2 id="screens" className="m-0 text-[32px] font-semibold leading-tight tracking-[-0.02em]">Screens from a real course</h2>
            <p className="m-0 text-[17px] leading-relaxed text-[var(--eb-text-soft)]">A university course on transformers, built from the lecturer’s own slides. The feedback and the lit lines are exactly what EduBridge produced.</p>
          </div>
          {SCREENS.map((screen, index) => (
            <figure key={screen.src} className="m-0 grid items-center gap-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-14">
              <div className={`eb-shot ${index % 2 ? "lg:order-2" : ""}`}>
                <img src={screen.src} width={screen.width} height={screen.height} alt={screen.alt} loading="lazy" decoding="async" className="block h-auto w-full" />
              </div>
              <figcaption className={`flex flex-col gap-3 ${index % 2 ? "lg:order-1" : ""}`}>
                <span className="text-[15px] text-[var(--eb-text-muted)]">{screen.who}</span>
                <span className="text-[24px] font-semibold leading-snug tracking-[-0.01em]">{screen.title}</span>
                <span className="max-w-[46ch] text-[16px] leading-relaxed text-[var(--eb-text-soft)]">{screen.body}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section id="how" aria-labelledby="how-title" className="border-t border-[var(--eb-line-soft)]">
        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-20">
          <h2 id="how-title" className="m-0 text-[32px] font-semibold tracking-[-0.02em]">How it works</h2>
          <div className="grid gap-12 md:grid-cols-2">
            {STEPS.map(column => (
              <div key={column.who} className="flex flex-col gap-5">
                <span className="text-[15px] text-[var(--eb-text-muted)]">{column.who}</span>
                <ol className="m-0 flex list-none flex-col gap-4 p-0">
                  {column.steps.map((step, index) => (
                    <li key={step} className="flex gap-4">
                      <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--eb-line)] text-sm font-semibold text-[var(--eb-text-soft)]">{index + 1}</span>
                      <span className="pt-1 text-[16px] leading-relaxed">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="limits" className="border-t border-[var(--eb-line-soft)] bg-[var(--eb-stage-deep)]">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-20 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <h2 id="limits" className="m-0 text-[32px] font-semibold leading-tight tracking-[-0.02em]">What it won’t do</h2>
          <ul className="m-0 flex list-none flex-col gap-4 p-0">
            {LIMITS.map(limit => (
              <li key={limit} className="border-t border-[var(--eb-line)] pt-4 text-[17px] leading-relaxed text-[var(--eb-text-soft)]">{limit}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="border-t border-[var(--eb-line-soft)]">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-6 py-20">
          <h2 className="m-0 max-w-[22ch] text-[32px] font-semibold leading-tight tracking-[-0.02em]">Start with the material you already teach from.</h2>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button type="button" onClick={() => onNavigate("auth", "teacher")} className={primary}>Create a course</button>
            <button type="button" onClick={() => onNavigate("auth", "student")} className={quiet}>Join with a code</button>
          </div>
        </div>
      </section>

      <footer className="border-t border-[var(--eb-line-soft)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-8 text-sm text-[var(--eb-text-muted)]">
          <Wordmark width={140} />
          <span>© {new Date().getFullYear()} EduBridge AI</span>
        </div>
      </footer>
    </div>
  );
}
