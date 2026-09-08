/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/DeleteWorktreeDialogDescription.tsx
   (verbatim structure and copy shape; props only.) */
export function DeleteWorktreeDialogDescription({
  targetClassName,
  targetLabel,
  descriptionSuffix,
}: {
  targetClassName: string;
  targetLabel: string | undefined;
  descriptionSuffix: string;
}) {
  return (
    <p className="shell-delete-dialog-description">
      Remove <span className={targetClassName}>{targetLabel}</span>{" "}
      {descriptionSuffix}
    </p>
  );
}
