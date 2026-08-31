import { ThemeToggle } from "@/components/theme-toggle";
import { ResumeMatchApp } from "@/components/resume-match-app";
import { isMaintenanceMode } from "@/lib/maintenance";

export const dynamic = "force-dynamic";

function MaintenancePage() {
  return (
    <main className="page-shell maintenance-shell">
      <nav className="site-nav" aria-label="Primary navigation">
        <div className="brand" aria-label="ResumeMatch home">
          <span className="brand-mark" aria-hidden="true">R</span>
          <span>ResumeMatch</span>
        </div>
        <div className="nav-actions">
          <span className="version-pill">Coming soon</span>
          <ThemeToggle />
        </div>
      </nav>

      <section className="maintenance-content" aria-labelledby="maintenance-heading">
        <div className="maintenance-card">
          <div className="maintenance-mark" aria-hidden="true">
            <span />
          </div>
          <p className="eyebrow">ResumeMatch</p>
          <h1 id="maintenance-heading">Currently in development</h1>
          <p className="maintenance-copy">
            We’re putting the finishing touches on a simpler way to turn your
            resume into relevant job opportunities. Please check back soon.
          </p>
          <p className="maintenance-status">
            <span aria-hidden="true" />
            ResumeMatch will be available soon
          </p>
        </div>
      </section>
    </main>
  );
}

export default function Home() {
  if (isMaintenanceMode()) {
    return <MaintenancePage />;
  }

  return <ResumeMatchApp />;
}
