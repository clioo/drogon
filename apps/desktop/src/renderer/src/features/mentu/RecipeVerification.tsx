// MIT Copyright (c) 2026 Lovecast Inc.
// Ported literally from the read-only reference
// `src/renderer/src/components/mentu/RecipeVerification.tsx`: the per-step
// verification summary over the recorded error/warning issues. Only the
// import path is adapted (this repo's mentu contract).

function issueMessages(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.map((issue: unknown) => {
    if (typeof issue === "string") {
      return issue;
    }
    if (
      issue &&
      typeof issue === "object" &&
      "message" in issue &&
      typeof issue.message === "string"
    ) {
      return issue.message;
    }
    return "Unrecognized verification issue; inspect the raw run record.";
  });
}

export function RecipeVerification({ verification }: { verification: unknown }): React.JSX.Element {
  if (!verification || typeof verification !== "object") {
    return <p className="mt-1 text-muted-foreground">Verification: not recorded</p>;
  }
  const errors = issueMessages("errors" in verification ? verification.errors : undefined);
  const warnings = issueMessages("warnings" in verification ? verification.warnings : undefined);
  const messages = [...(errors ?? []), ...(warnings ?? [])];
  return (
    <div className="mt-1 text-muted-foreground">
      <p>
        Verification:{" "}
        {errors === null
          ? "errors unavailable"
          : `${errors.length} error${errors.length === 1 ? "" : "s"}`}
        ,{" "}
        {warnings === null
          ? "warnings unavailable"
          : `${warnings.length} warning${warnings.length === 1 ? "" : "s"}`}
      </p>
      {messages.length > 0 ? (
        <details className="mt-1">
          <summary className="cursor-pointer focus-visible:ring-[3px] focus-visible:ring-ring/50">
            Verification details
          </summary>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-foreground">
            {messages.map((message, index) => (
              <li key={`${index}:${message}`} className="whitespace-pre-wrap break-words">
                {message}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
