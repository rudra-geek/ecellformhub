import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  Download,
  Eye,
  FileText,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { exportResponsesToExcel, type ResponseRecord } from "@/lib/excel";
import { exportResponsesToPdf } from "@/lib/pdf";
import type { FormRow, Question } from "@/lib/form-types";

export const Route = createFileRoute("/_authenticated/forms/$formId/responses")({
  head: () => ({
    meta: [
      { title: "Responses — NIET FormHub" },
      { name: "description", content: "View, filter and export responses on NIET FormHub." },
      { property: "og:title", content: "Responses — NIET FormHub" },
      { property: "og:description", content: "View, filter and export your form responses." },
    ],
  }),
  component: Responses,
});

function Responses() {
  const { formId } = Route.useParams();
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [sortAsc, setSortAsc] = useState(false);
  const [detail, setDetail] = useState<ResponseRecord | null>(null);
  const [toDelete, setToDelete] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["responses", formId, user.id],
    queryFn: async () => {
      const { data: f, error: fErr } = await supabase
        .from("forms")
        .select("*")
        .eq("id", formId)
        .maybeSingle();
      if (fErr) throw fErr;
      if (!f) throw new Error("Form not found or you do not have permission to access it");
      if (f.user_id !== user.id) {
        throw new Error("You do not have permission to view responses for this form");
      }
      const { data: qs, error: qErr } = await supabase
        .from("questions")
        .select("*")
        .eq("form_id", formId)
        .order("position");
      if (qErr) throw qErr;
      const PAGE_SIZE = 1000;
      const rs: { id: string; submitted_at: string; respondent_email: string | null }[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data: page, error: rErr } = await supabase
          .from("responses")
          .select("id, submitted_at, respondent_email")
          .eq("form_id", formId)
          .order("submitted_at", { ascending: false })
          .range(from, from + PAGE_SIZE - 1);
        if (rErr) throw rErr;
        if (!page?.length) break;
        rs.push(...page);
        if (page.length < PAGE_SIZE) break;
      }

      const ids = rs.map((r) => r.id);
      const answers: { response_id: string; question_id: string; answer: string | null }[] = [];
      const CHUNK_SIZE = 50;
      for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
        const chunk = ids.slice(i, i + CHUNK_SIZE);
        for (let from = 0; ; from += PAGE_SIZE) {
          const { data: as_, error: aErr } = await supabase
            .from("response_answers")
            .select("response_id, question_id, answer")
            .in("response_id", chunk)
            .order("id")
            .range(from, from + PAGE_SIZE - 1);
          if (aErr) throw aErr;
          if (!as_?.length) break;
          answers.push(...as_);
          if (as_.length < PAGE_SIZE) break;
        }
      }
      const records: ResponseRecord[] = (rs ?? []).map((r) => ({
        id: r.id,
        submitted_at: r.submitted_at,
        respondent_email: r.respondent_email,
        answers: Object.fromEntries(
          answers
            .filter((a) => a.response_id === r.id)
            .map((a) => [a.question_id, a.answer ?? ""]),
        ),
      }));
      return {
        form: f as unknown as FormRow | null,
        questions: (qs ?? []) as unknown as Question[],
        records,
      };
    },
  });

  const visibleQuestions = useMemo(
    () =>
      (query.data?.questions ?? []).filter(
        (q) => q.question_type !== "section" && q.question_type !== "url_display",
      ),
    [query.data],
  );

  const rows = useMemo(() => {
    const list = (query.data?.records ?? []).filter((r) => {
      if (!search) return true;
      const hay = [r.respondent_email ?? "", ...Object.values(r.answers)].join(" ").toLowerCase();
      return hay.includes(search.toLowerCase());
    });
    return [...list].sort((a, b) =>
      sortAsc
        ? a.submitted_at.localeCompare(b.submitted_at)
        : b.submitted_at.localeCompare(a.submitted_at),
    );
  }, [query.data, search, sortAsc]);

  async function remove(id: string) {
    const { error } = await supabase.from("responses").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Response deleted");
    qc.invalidateQueries({ queryKey: ["responses", formId] });
    qc.invalidateQueries({ queryKey: ["response-counts"] });
  }

  if (query.isLoading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 p-12">
        <Loader2 className="size-4 animate-spin" /> Loading responses…
      </div>
    );
  }

  if (query.isError || !query.data?.form) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center p-8">
        <h2 className="text-xl font-bold text-destructive">Access Denied</h2>
        <p className="text-muted-foreground max-w-md text-sm">
          {query.error instanceof Error
            ? query.error.message
            : "You do not have permission to access responses for this form."}
        </p>
        <Button asChild variant="outline">
          <Link to="/dashboard">Back to Dashboard</Link>
        </Button>
      </div>
    );
  }

  const form = query.data?.form;

  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <Button asChild variant="ghost" size="sm">
        <Link to="/dashboard">
          <ArrowLeft className="size-4" /> Dashboard
        </Link>
      </Button>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{form?.title ?? "Form"}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {query.data?.records.length ?? 0} total responses
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/forms/$formId/edit" params={{ formId }}>
              Edit form
            </Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => qc.invalidateQueries({ queryKey: ["responses", formId] })}
          >
            <RefreshCw className="size-4" /> Refresh
          </Button>
          <Button
            size="sm"
            disabled={!rows.length}
            onClick={() =>
              exportResponsesToPdf(
                form?.title ?? "form",
                form?.description,
                query.data?.questions ?? [],
                rows,
              )
            }
          >
            <FileText className="size-4" /> Download PDF
          </Button>
          <Button
            size="sm"
            disabled={!rows.length}
            onClick={() =>
              exportResponsesToExcel(form?.title ?? "form", query.data?.questions ?? [], rows)
            }
          >
            <Download className="size-4" /> Download Excel
          </Button>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Input
          placeholder="Search responses…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <Button variant="outline" size="sm" onClick={() => setSortAsc((s) => !s)}>
          Sort: {sortAsc ? "Oldest first" : "Newest first"}
        </Button>
      </div>

      {rows.length === 0 ? (
        <Card className="mt-6 border-dashed">
          <CardContent className="py-16 text-center">
            <h2 className="text-lg font-semibold">No responses yet</h2>
            <p className="text-muted-foreground mt-2 text-sm">
              Share your form link and answers will appear here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead className="whitespace-nowrap">Submitted</TableHead>
                <TableHead>Email</TableHead>
                {visibleQuestions.map((q) => (
                  <TableHead key={q.id} className="min-w-40">
                    {q.question_text || "Question"}
                  </TableHead>
                ))}
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={r.id}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {new Date(r.submitted_at).toLocaleString()}
                  </TableCell>
                  <TableCell>{r.respondent_email ?? "—"}</TableCell>
                  {visibleQuestions.map((q) => (
                    <TableCell key={q.id} className="max-w-xs truncate">
                      {r.answers[q.id] || "—"}
                    </TableCell>
                  ))}
                  <TableCell className="text-right whitespace-nowrap">
                    <Button size="icon" variant="ghost" onClick={() => setDetail(r)}>
                      <Eye className="size-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => setToDelete(r.id)}>
                      <Trash2 className="text-destructive size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Response details</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4 text-sm">
              <p className="text-muted-foreground">
                Submitted {new Date(detail.submitted_at).toLocaleString()}
              </p>
              {detail.respondent_email && (
                <p>
                  <strong>Email:</strong> {detail.respondent_email}
                </p>
              )}
              {visibleQuestions.map((q) => (
                <div key={q.id}>
                  <p className="font-medium">{q.question_text || "Question"}</p>
                  <p className="text-muted-foreground break-words">
                    {detail.answers[q.id] || "—"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this response?</AlertDialogTitle>
            <AlertDialogDescription>
              The submitted answers will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (toDelete) void remove(toDelete);
                setToDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}