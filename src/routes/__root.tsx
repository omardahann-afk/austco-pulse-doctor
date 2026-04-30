import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Stethoscope } from "lucide-react";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Austco Site Doctor — Field Diagnostic Copilot" },
      { name: "description", content: "Internal Austco diagnostic platform for Pulse / Tacera / IP-based nurse call systems. Trace failures across the full signal chain." },
      { name: "author", content: "Austco" },
      { property: "og:title", content: "Austco Site Doctor — Field Diagnostic Copilot" },
      { property: "og:description", content: "Internal Austco diagnostic platform for Pulse / Tacera / IP-based nurse call systems. Trace failures across the full signal chain." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Austco" },
      { name: "twitter:title", content: "Austco Site Doctor — Field Diagnostic Copilot" },
      { name: "twitter:description", content: "Internal Austco diagnostic platform for Pulse / Tacera / IP-based nurse call systems. Trace failures across the full signal chain." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/30ec29e8-aee5-47e1-99b5-3804e4635bef/id-preview-f0cf50bb--dda9de3d-fa10-4191-b012-911ba475ae99.lovable.app-1777509201530.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/30ec29e8-aee5-47e1-99b5-3804e4635bef/id-preview-f0cf50bb--dda9de3d-fa10-4191-b012-911ba475ae99.lovable.app-1777509201530.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background text-foreground">
        <AppSidebar />
        <SidebarInset className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-border/60 bg-background/80 px-3 backdrop-blur">
            <SidebarTrigger className="-ml-1" />
            <div className="flex items-center gap-2 text-sm">
              <Stethoscope className="h-4 w-4 text-info" />
              <span className="font-semibold">AUSTCO SITE DOCTOR</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">Field Diagnostic Copilot</span>
            </div>
            <div className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="hidden sm:inline">Pulse · Tacera · IP-Connect</span>
              <span className="hidden sm:inline">·</span>
              <span className="font-mono">v1.0 internal</span>
            </div>
          </header>
          <main className="min-h-[calc(100vh-3rem)] p-6">
            <Outlet />
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}

// Keep Link import alive — used by NotFoundComponent.
void Link;
