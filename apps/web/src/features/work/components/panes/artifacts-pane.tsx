export function ArtifactsPane() {
  return (
    <section
      className="work-capability-unavailable"
      data-testid="artifacts-unavailable"
    >
      <p className="work-shell-kicker">Artifacts</p>
      <h2>Artifact delivery is not available in the current Product API.</h2>
      <p>
        This surface stays intentionally empty. Assistant text, arbitrary files,
        and tool output are not promoted to delivered Artifacts by the browser.
      </p>
    </section>
  );
}
