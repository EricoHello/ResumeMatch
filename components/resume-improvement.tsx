export function ResumeImprovement({
  recommendation,
}: {
  recommendation: string;
}) {
  return (
    <section
      className="resume-improvement-card"
      aria-labelledby="resume-improvement-heading"
    >
      <div className="card-heading resume-improvement-heading">
        <div>
          <p className="step-label">Step 5 of 5</p>
          <h2 id="resume-improvement-heading">Resume Improvement</h2>
        </div>
        <span className="format-badge">Gemini</span>
      </div>

      <div className="resume-improvement-recommendation">
        <span className="resume-improvement-icon" aria-hidden="true">
          ✦
        </span>
        <div>
          <p className="success-label">Focused recommendation</p>
          <p>{recommendation}</p>
        </div>
      </div>

      <p className="resume-improvement-source">
        Generated during Step 3 using only your uploaded resume and the candidate
        profile inferred from it.
      </p>
    </section>
  );
}
