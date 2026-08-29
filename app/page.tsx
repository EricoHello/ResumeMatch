import { ResumeUploader } from "@/components/resume-uploader";

export default function Home() {
  return (
    <main className="page-shell">
      <nav className="site-nav" aria-label="Primary navigation">
        <a className="brand" href="#top" aria-label="ResumeMatch home">
          <span className="brand-mark" aria-hidden="true">
            R
          </span>
          <span>ResumeMatch</span>
        </a>
        <span className="version-pill">Text extraction</span>
      </nav>

      <div className="page-content" id="top">
        <header className="hero">
          <p className="eyebrow">Resume ingestion, simplified</p>
          <h1>See what your resume says, in plain text.</h1>
          <p className="hero-copy">
            Upload a PDF or DOCX resume and review the text we can extract from it.
            No AI interpretation—just the source text, ready for the next step.
          </p>
        </header>

        <ResumeUploader />

        <p className="privacy-note">
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M10 1.75a4 4 0 0 0-4 4v2H5A1.75 1.75 0 0 0 3.25 9.5v6.75A1.75 1.75 0 0 0 5 18h10a1.75 1.75 0 0 0 1.75-1.75V9.5A1.75 1.75 0 0 0 15 7.75h-1v-2a4 4 0 0 0-4-4Zm2.5 6h-5v-2a2.5 2.5 0 0 1 5 0v2Z" />
          </svg>
          Files are processed in memory and are not saved. This version extracts raw text
          only—it does not evaluate or score your resume.
        </p>
      </div>
    </main>
  );
}
