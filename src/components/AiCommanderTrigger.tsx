/**
 * Small "Open in AI Commander" trigger button.
 * Stashes a sanitized context blob in sessionStorage and navigates to /ai-commander.
 * AI failure on the destination page never breaks the originating page.
 */
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Brain } from "lucide-react";
import { setHandoff } from "@/lib/aiCommanderHandoff";
import type { CommanderContext, CommanderMode } from "@/lib/agentClient";

export type AiCommanderTriggerProps = {
  source: "root-cause" | "trace" | "autopilot" | "execution" | "deep-evidence";
  mode?: CommanderMode;
  context: CommanderContext;
  label?: string;
  size?: "sm" | "default";
  variant?: "default" | "outline" | "secondary" | "ghost";
  className?: string;
};

export function AiCommanderTrigger({
  source, mode = "explain_on_site", context,
  label = "Open in AI Commander",
  size = "sm", variant = "outline", className,
}: AiCommanderTriggerProps) {
  return (
    <Button asChild size={size} variant={variant} className={className}
      onClick={() => setHandoff({ source, mode, context })}>
      <Link to="/ai-commander">
        <Brain className="mr-1.5 h-3.5 w-3.5" />
        {label}
      </Link>
    </Button>
  );
}