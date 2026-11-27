import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Download,
  FileText,
  Loader2,
  Send,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import { exportResponsesToExcel, type ResponseRecord } from "@/lib/excel";
import { exportResponsesToPdf } from "@/lib/pdf";
import { fetchFormResponseRecords } from "@/lib/responses";
import type { FormRow, Question } from "@/lib/form-types";

interface SharedResponseRow {
  id: string;
  form_id: string;
  sender_id: string;
  recipient_id: string;
  sender_email: string;
  sender_name: string | null;
  shared_at: string;
}

export const Route = createFileRoute("/_authenticated/shared/$shareId")({
  head: () => ({
    meta: [
      { title: "Shared Responses — NIET FormHub" },
      { name: "description", content: "View form responses shared with you on NIET FormHub." },
    ],
  }),
  component: SharedResponses,
});

function SharedResponses() {
  const { shareId } = Route.useParams();
  const { user } = Route.useRouteContext();
  const [search, setSearch] = useState("");
  const [sortAsc, setSortAsc] = useState(false);
  const [detail, setDetail] = useState<ResponseRecord | null>(null);

  const query = useQuery({
    queryKey: ["shared-responses", shareId, user.id],
    queryFn: async () => {
      // Fetch the share record
      const { data: shareData, error: sErr } = await supabase
        .from("shared_responses" as any)
        .select("*")
        .eq("id", shareId)
        .eq("recipient_id", user.id)
        .maybeSingle();
      if (sErr) throw sErr;
      const share = shareData as unknown as SharedResponseRow | null;
      if (!share) throw new Error("This shared response was not found or you don't have access.");

      // Fetch the form
      const { data: f, error: fErr } = await supabase
        .from("forms")
        .select("*")
        .eq("id", share.form_id)
        .maybeSingle();
      if (fErr) throw fErr;

      // Fetch questions
      const { data: qs, error: qErr } = await supabase
        .from("questions")
        .select("*")
        .eq("form_id", share.form_id)
        .order("position");
      if (qErr) throw qErr;

      const records = await fetchFormResponseRecords(share.form_id);

      return {
        share,
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

  if (query.isLoading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 p-12">
        <Loader2 className="size-4 animate-spin" /> Loading shared responses…
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
            : "You do not have permission to view these shared responses."}
        </p>
        <Button asChild variant="outline">
          <Link to="/dashboard">Back to Dashboard</Link>
        </Button>
      </div>
    );
  }

  const { form, share } = query.data;

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
          {form?.description && (
            <p className="text-muted-foreground mt-1 text-sm line-clamp-2">{form.description}</p>
          )}
          <div className="flex flex-wrap items-center gap-3 mt-2">
            <p className="text-muted-foreground text-sm">
              {query.data?.records.length ?? 0} total responses
            </p>
            <Badge className="bg-sky-500/20 text-sky-400 border-sky-500/30 flex items-center gap-1">
              <Send className="size-3" /> Sent by {share.sender_name || share.sender_email}
            </Badge>
          </div>
          <p className="text-muted-foreground text-xs mt-1">
            Shared on {new Date(share.shared_at).toLocaleString()}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
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
              This form has no responses to display.
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={r.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setDetail(r)}>
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
    </main>
  );
}
