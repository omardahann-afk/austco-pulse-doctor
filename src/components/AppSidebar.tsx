import { Link, useRouterState } from "@tanstack/react-router";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter } from "@/components/ui/sidebar";
import { Activity, Workflow, FileText, Stethoscope, GitBranch, ShieldCheck, Microscope, History } from "lucide-react";
import { useEffect, useState } from "react";
import { loadSiteConfig } from "@/lib/siteConfig";

const NAV = [
  { to: "/",           label: "Command Center", icon: Activity },
  { to: "/trace",      label: "Trace Signal Path", icon: GitBranch },
  { to: "/autopilot",  label: "Autopilot", icon: ShieldCheck },
  { to: "/evidence",   label: "Deep Evidence", icon: Microscope },
  { to: "/evidence/playback", label: "Evidence Playback", icon: History },
  { to: "/diagnosis",  label: "Diagnosis Result", icon: Workflow },
  { to: "/escalation", label: "Escalation Report", icon: FileText },
];

export function AppSidebar() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const [siteName, setSiteName] = useState("");
  useEffect(() => { setSiteName(loadSiteConfig().siteName); }, [path]);
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border/60">
        <div className="flex items-center gap-2.5 px-1.5 py-1.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-gradient-to-br from-info to-insight text-info-foreground"><Stethoscope className="h-5 w-5" /></div>
          <div className="min-w-0 leading-tight">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Tacera</div>
            <div className="truncate text-sm font-semibold">Doctor</div>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup><SidebarGroupContent><SidebarMenu>
          {NAV.map((it) => {
            const active = it.to === "/" ? path === "/" : path.startsWith(it.to);
            return (
              <SidebarMenuItem key={it.to}>
                <SidebarMenuButton asChild isActive={active} tooltip={it.label}>
                  <Link to={it.to} className="flex items-center gap-2"><it.icon className="h-4 w-4" /><span className="truncate">{it.label}</span></Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu></SidebarGroupContent></SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border/60">
        <div className="space-y-0.5 px-2 py-1.5 text-[11px] leading-snug">
          <div className="truncate font-medium">{siteName || "No site configured"}</div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
