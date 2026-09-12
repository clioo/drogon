/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/SidebarToolbar.tsx (footer recipe:
   settings + help on the left, reveal/board on the right) and
   SidebarSettingsHelpMenu.tsx (adapter: props instead of the zustand
   store; the help menu carries only Keyboard Shortcuts, which opens this
   repo's shortcuts settings section — the feedback, milestones,
   onboarding, external-link, update and restart items need Orca runtime
   and are omitted, not stubbed; the workspace board button is omitted
   until the board surface lands). */
import { useState } from "react";
import { CircleHelp, Crosshair, Keyboard, Settings } from "lucide-react";
import { DropdownMenu, Tooltip } from "radix-ui";
import { Button } from "../../components/ui/button";
import type { SettingsSectionId } from "../settings/settings-sections";

function FooterIconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          type="button"
          className="size-6 text-muted-foreground"
          aria-label={label}
          onClick={onClick}
        >
          {children}
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip" side="top" sideOffset={4}>
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function SidebarFooter({
  onOpenSettings,
  onRevealActiveWorkspace,
}: {
  onOpenSettings: (initialSection?: SettingsSectionId) => void;
  onRevealActiveWorkspace: () => void;
}): React.JSX.Element {
  const [helpOpen, setHelpOpen] = useState(false);
  return (
    <div className="shell-sidebar-footer mt-auto shrink-0">
      <div className="flex items-center justify-between border-t border-worktree-sidebar-border px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-1">
          <FooterIconButton
            label="Settings"
            onClick={() => onOpenSettings()}
          >
            <Settings className="size-3.5" />
          </FooterIconButton>
          <DropdownMenu.Root open={helpOpen} onOpenChange={setHelpOpen}>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <DropdownMenu.Trigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    className="size-6 text-muted-foreground"
                    aria-label="Help"
                  >
                    <CircleHelp className="size-3.5" />
                  </Button>
                </DropdownMenu.Trigger>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content className="tooltip" side="top" sideOffset={4}>
                  Help
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="sidebar-menu"
                side="top"
                align="start"
                sideOffset={8}
              >
                <DropdownMenu.Item
                  className="sidebar-menu-item"
                  onSelect={() => onOpenSettings("shortcuts")}
                >
                  <Keyboard className="size-3.5" />
                  Keyboard Shortcuts
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
        <div className="flex items-center gap-1">
          <FooterIconButton
            label="Reveal active workspace"
            onClick={onRevealActiveWorkspace}
          >
            <Crosshair className="size-3.5" />
          </FooterIconButton>
        </div>
      </div>
    </div>
  );
}
