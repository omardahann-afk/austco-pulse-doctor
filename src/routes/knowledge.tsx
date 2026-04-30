import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { knowledgeBase } from "@/data/mockSite";
import { BookOpen } from "lucide-react";

export const Route = createFileRoute("/knowledge")({ head: () => ({ meta: [{ title: "Knowledge Base — Austco Site Doctor" }] }), component: () => (
  <div className="space-y-6">
    <PageHeader eyebrow="Field-tested fixes" title="Knowledge Base / Fix History" description="Patterns we've seen and confirmed fixes from prior site visits." />
    <div className="grid gap-4 lg:grid-cols-2">
      {knowledgeBase.map(a => (
        <Card key={a.id} className="bg-card/70">
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><BookOpen className="h-4 w-4 text-info"/>{a.title}</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div><span className="text-xs uppercase tracking-wider text-muted-foreground">Symptom</span><p>{a.symptom}</p></div>
            <div><span className="text-xs uppercase tracking-wider text-muted-foreground">Fix</span><p className="text-foreground/90">{a.fix}</p></div>
            <div className="flex flex-wrap gap-1.5">{a.tags.map(t=> <span key={t} className="rounded-md border border-border/60 bg-muted/30 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">{t}</span>)}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  </div>
)});
