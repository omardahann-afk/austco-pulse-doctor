import { Link, useRouterState } from "@tanstack/react-router";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter } from "@/components/ui/sidebar";
import { Activity, ScanLine, Map as MapIcon, Search, ShieldCheck, Cpu, MonitorSmartphone, Radio, Lightbulb, Network, ListChecks, Clock, FileText, BookOpen, Stethoscope } from "lucide-react";
import { LAPTOP_IP, SITE_NAME, TECHNICIAN } from "@/data/mockSite";

const NAV = [
  { group: "Overview", items: [
    { to: "/", label: "Command Center", icon: Activity },
    { to: "/diagnose", label: "Run Full Diagnosis", icon: ScanLine },
    { to: "/site-map", label: "Live Site Map", icon: MapIcon },
    { to: "/trace", label: "Trace This Call", icon: Search },
  ]},
  { group: "Doctors", items: [
    { to: "/redundancy", label: "Redundancy Doctor", icon: ShieldCheck },
    { to: "/controllers", label: "Controller Doctor", icon: Cpu },
    { to: "/ip-app1", label: "IP-APP1 Doctor", icon: MonitorSmartphone },
    { to: "/ip-in8", label: "IP-IN8 Input Doctor", icon: Radio },
    { to: "/signal-lights", label: "Signal / Zone Light Doctor", icon: Lightbulb },
    { to: "/network", label: "Switch / Network Doctor", icon: Network },
  ]},
  { group: "Evidence", items: [
    { to: "/cct-reality", label: "CCT Logic vs Reality", icon: ListChecks },
    { to: "/events", label: "Event Timeline", icon: Clock },
    { to: "/escalation", label: "Escalation Report", icon: FileText },
    { to: "/knowledge", label: "Knowledge Base", icon: BookOpen },
  ]},
];

export function AppSidebar() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border/60">
        <div className="flex items-center gap-2.5 px-1.5 py-1.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-gradient-to-br from-info to-insight text-info-foreground"><Stethoscope className="h-5 w-5" /></div>
          <div className="min-w-0 leading-tight">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Austco</div>
            <div className="truncate text-sm font-semibold">Site Doctor</div>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {NAV.map((group) => (
          <SidebarGroup key={group.group}>
            <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.18em]">{group.group}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((it) => {
                  const active = it.to === "/" ? path === "/" : path.startsWith(it.to);
                  return (
                    <SidebarMenuItem key={it.to}>
                      <SidebarMenuButton asChild isActive={active} tooltip={it.label}>
                        <Link to={it.to} className="flex items-center gap-2"><it.icon className="h-4 w-4" /><span className="truncate">{it.label}</span></Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border/60">
        <div className="space-y-0.5 px-2 py-1.5 text-[11px] leading-snug">
          <div className="truncate font-medium">{SITE_NAME}</div>
          <div className="font-mono text-muted-foreground">Tech: {TECHNICIAN}</div>
          <div className="font-mono text-muted-foreground">Laptop: {LAPTOP_IP}</div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
