import { useState } from "react";
import { ArrowDown, ArrowRight, ArrowUpRight, BookOpen, Maximize2, Plus } from "lucide-react";
import { Wordmark } from "./components/Logo";
import "./landing.css";

type Role = "teacher" | "student";
type Navigate = (view: "auth", role?: Role) => void;
const photograph = "https://unsplash.com/photos/teacher-writing-mathematical-formulas-on-a-blackboard-NpHSRakEYPM";

const views = {
  student: {
    title: "Find the step that needs another look.",
    text: "The student’s calculation holds up at step five. At step six, they assume a transformer reads one word at a time. EduBridge brings the relevant slide alongside their working so they can check the distinction.",
    src: "/landing/show-your-work.webp", width: 1393, height: 802,
    alt: "Show Your Work feedback beside the highlighted transformer lecture slide. Step five holds up; step six needs another look.",
    caption: "Show Your Work", reference: "Lecture 2 · Slide 14",
  },
  teacher: {
    title: "See what the student was thinking.",
    text: "The teacher sees the student’s own words beside the slide on parallel processing. They can follow up on that specific idea with practice, instead of asking the student to repeat the whole topic.",
    src: "/landing/teacher-today.webp", width: 1224, height: 795,
    alt: "Teacher overview showing the student’s comparison with an RNN, the highlighted course passage, and an assigned practice activity.",
    caption: "Teacher overview", reference: "Lecture 2 · Page 11",
  },
} as const;

const questions = [
  ["Where do tutor answers come from?", "The tutor uses the materials uploaded to your course and cites the passage it used. If it can’t find enough support there, it says so instead of looking up an answer on the internet."],
  ["What can I practise as a student?", "Ask about a lecture, take a quiz on a weak topic, or explain a concept in your own words. When your teacher enables Show Your Work, you can also submit your working for step-by-step feedback."],
  ["What can teachers review?", "See where students are getting stuck, look for patterns across the class, and assign follow-up practice. A suspected mistake in uploaded work stays out of the student’s record unless the teacher agrees."],
  ["Which course materials work best?", "Use lecture slides and PDFs with selectable text. A scanned or handwritten page is not a reliable source for indexing a course."],
];

function Actions({ onNavigate }: { onNavigate: Navigate }) {
  return <div className="ebl-actions">
    <button type="button" className="ebl-button ebl-solid" onClick={() => onNavigate("auth", "student")}>I’m a student <ArrowRight size={17} /></button>
    <button type="button" className="ebl-button ebl-outline" onClick={() => onNavigate("auth", "teacher")}>I teach a course <ArrowRight size={17} /></button>
  </div>;
}

export default function Landing({ onNavigate }: { onNavigate: Navigate }) {
  const [role, setRole] = useState<Role>("student");
  const view = views[role];
  return <div className="ebl" id="top">
    <a href="#main-story" className="ebl-skip">Skip to content</a>
    <header className="ebl-nav">
      <nav className="ebl-wrap" aria-label="Main navigation">
        <a href="#top" aria-label="EduBridge home"><Wordmark width={152} /></a>
        <div className="ebl-navlinks"><a href="#screens">Inside EduBridge</a><a href="#how">How it works</a></div>
        <button className="ebl-sign" type="button" onClick={() => onNavigate("auth")}>Sign in <ArrowUpRight size={16} /></button>
      </nav>
    </header>
    <main id="main-story">
      <section className="ebl-hero" aria-labelledby="ebl-title">
        <div className="ebl-still"><img src="/landing/chalkboard.webp" alt="A lecturer’s hand working through an equation in chalk." width={1720} height={968} fetchPriority="high" /></div>
        <div className="ebl-wrap ebl-hero-inner">
          <div className="ebl-intro">
            <h1 id="ebl-title">A wrong answer<br /><em>has a reason.</em></h1>
            <p>Study with an AI tutor that works from your lecture notes. Students can trace an answer to the page. Teachers can see where the reasoning went off track.</p>
            <Actions onNavigate={onNavigate} />
          </div>
          <div className="ebl-hero-foot"><a href="#screens"><ArrowDown size={15} /> Explore a real course</a><a className="ebl-credit" href={photograph}>Classroom still by Vitaly Gariev</a></div>
        </div>
      </section>
      <section className="ebl-case" id="screens" aria-labelledby="ebl-case-title">
        <div className="ebl-wrap">
          <div className="ebl-case-intro"><h2 id="ebl-case-title">One misconception.<br /><em>Two perspectives.</em></h2>
            <p>A university class on transformers, seen from both sides of the desk. These are actual EduBridge screens; the student’s name has been changed.</p></div>
          <div className="ebl-case-body">
            <div className="ebl-case-notes">
              <div className="ebl-selector" role="group" aria-label="Choose a course perspective">
                {(["student", "teacher"] as const).map(item => <button key={item} type="button" aria-pressed={role === item} aria-controls="ebl-example" onClick={() => setRole(item)}>{item === "student" ? "Student view" : "Teacher view"}</button>)}
              </div>
              <div aria-live="polite" aria-atomic="true"><h3>{view.title}</h3><p>{view.text}</p></div>
              <button type="button" className="ebl-inline" onClick={() => onNavigate("auth", role)}>Enter as a {role} <ArrowRight size={15} /></button>
            </div>
            <figure id="ebl-example" className="ebl-exhibit">
              <div className="ebl-mat"><a href={view.src} target="_blank" rel="noreferrer" aria-label={'Open full-size ' + view.caption + ' screenshot in a new tab'}><img src={view.src} width={view.width} height={view.height} alt={view.alt} loading="lazy" /></a></div>
              <figcaption><span><BookOpen size={15} />{view.caption}<span className="ebl-page-ref"> / {view.reference}</span></span><a href={view.src} target="_blank" rel="noreferrer" aria-label="Open full-size screenshot in a new tab"><Maximize2 size={16} /> Full size</a></figcaption>
            </figure>
          </div>
        </div>
      </section>
      <section id="how" className="ebl-how ebl-wrap" aria-labelledby="ebl-how-title">
        <div><h2 id="ebl-how-title">Start with the<br /><em>course material.</em></h2><p>Teachers create a course, upload their slides and share a join code. Students enter the code and can start asking questions once their teacher approves them.</p></div>
        <div className="ebl-faq">{questions.map(([q,a]) => <details key={q}><summary>{q}<Plus size={18} aria-hidden="true" /></summary><p>{a}</p></details>)}</div>
      </section>
      <section className="ebl-close"><div className="ebl-wrap"><h2>Bring your next question.</h2><Actions onNavigate={onNavigate} /></div></section>
    </main>
    <footer className="ebl-footer"><div className="ebl-wrap"><a href="#top" aria-label="EduBridge, back to top"><Wordmark width={140} /></a><span>© {new Date().getFullYear()} EduBridge AI</span></div></footer>
  </div>;
}
