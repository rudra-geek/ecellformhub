import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BarChart3,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FileText,
  FilePlus2,
  Inbox,
  Loader2,
  Pencil,
  Send,
  Settings,
  Share2,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { makeSlug, type FormRow, type Question } from "@/lib/form-types";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "My forms — NIET FormHub" },
      { name: "description", content: "Your private dashboard of forms and responses on NIET FormHub." },
      { property: "og:title", content: "My forms — NIET FormHub" },
      { property: "og:description", content: "Your private dashboard of forms and responses on NIET FormHub." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [toDelete, setToDelete] = useState<FormRow | null>(null);
  const [approvalsModalOpen, setApprovalsModalOpen] = useState(false);
  const [toSendForm, setToSendForm] = useState<FormRow | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string>("");

  const isSuperAdmin = user.email === "ecellniet@niet.co.in";
  const displayName = user.user_metadata?.["name"] || (isSuperAdmin ? "Technical Head" : "User");

  // Fetch only forms created by current user
  const formsQuery = useQuery({
    queryKey: ["forms", user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("forms")
        .select("*")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data as unknown as FormRow[];
    },
  });

  // Admin query to fetch all pending forms for approval
  const pendingFormsQuery = useQuery({
    queryKey: ["pending-forms"],
    enabled: isSuperAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("forms")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).filter(
        (f: any) => (f.settings as any)?.approval_status === "pending"
      ) as FormRow[];
    },
  });

  const pendingForms = pendingFormsQuery.data ?? [];

  const countsQuery = useQuery({
    queryKey: ["response-counts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("responses").select("form_id");
      if (error) throw error;
      const map: Record<string, number> = {};
      (data ?? []).forEach((r: { form_id: string }) => {
        map[r.form_id] = (map[r.form_id] ?? 0) + 1;
      });
      return map;
    },
  });

  // Fetch responses shared WITH the current user
  const sharedWithMeQuery = useQuery({
    queryKey: ["shared-with-me", user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shared_responses" as any)
        .select("id, form_id, sender_email, sender_name, shared_at")
        .eq("recipient_id", user.id)
        .order("shared_at", { ascending: false });
      if (error) throw error;
      if (!data || data.length === 0) return [];
      // Fetch form details for each shared item
      const formIds = [...new Set((data as any[]).map((s: any) => s.form_id))];
      const { data: forms, error: fErr } = await supabase
        .from("forms")
        .select("id, title, description")
        .in("id", formIds);
      if (fErr) throw fErr;
      const formMap = Object.fromEntries((forms ?? []).map((f) => [f.id, f]));
      return (data as any[]).map((s: any) => ({
        ...s,
        form_title: formMap[s.form_id]?.title ?? "Unknown Form",
        form_description: formMap[s.form_id]?.description ?? "",
      }));
    },
  });

  const sharedItems = sharedWithMeQuery.data ?? [];

  // Fetch all active users except current user for the Send dropdown
  const usersQuery = useQuery({
    queryKey: ["all-users", user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, name, email")
        .neq("id", user.id)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const sendFormMutation = useMutation({
    mutationFn: async ({ formId, recipientId }: { formId: string; recipientId: string }) => {
      const { error } = await supabase
        .from("shared_responses" as any)
        .insert({
          form_id: formId,
          sender_id: user.id,
          recipient_id: recipientId,
          sender_email: user.email ?? "",
          sender_name: displayName,
        } as never);
      if (error) {
        if (error.code === "23505") throw new Error("Already sent to this user");
        throw error;
      }
    },
    onSuccess: () => {
      toast.success("Form responses sent successfully!");
      setToSendForm(null);
      setSelectedUserId("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Admin: Approve Form
  const approveMutation = useMutation({
    mutationFn: async (form: FormRow) => {
      const updatedSettings = {
        ...(form.settings ?? {}),
        approval_status: "approved",
      };
      const { error } = await supabase
        .from("forms")
        .update({
          accepting_responses: true,
          settings: updatedSettings as never,
        })
        .eq("id", form.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Form approved! Link is now active and ready to share.");
      qc.invalidateQueries({ queryKey: ["pending-forms"] });
      qc.invalidateQueries({ queryKey: ["forms"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Admin: Reject Form
  const rejectMutation = useMutation({
    mutationFn: async (form: FormRow) => {
      const updatedSettings = {
        ...(form.settings ?? {}),
        approval_status: "rejected",
      };
      const { error } = await supabase
        .from("forms")
        .update({
          accepting_responses: false,
          settings: updatedSettings as never,
        })
        .eq("id", form.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.info("Form marked as rejected.");
      qc.invalidateQueries({ queryKey: ["pending-forms"] });
      qc.invalidateQueries({ queryKey: ["forms"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Create Form with approval status check
  const createForm = useMutation({
    mutationFn: async () => {
      const isApproved = isSuperAdmin;
      const { data, error } = await supabase
        .from("forms")
        .insert({
          user_id: user.id,
          title: "Untitled form",
          description: "",
          slug: makeSlug("form"),
          accepting_responses: false,
          settings: {
            confirmationMessage: "Thanks! Your response has been recorded.",
            approval_status: isApproved ? "approved" : "draft",
            creator_email: user.email,
            creator_name: displayName,
          } as never,
        })
        .select()
        .single();
      if (error) throw error;
      return data as unknown as FormRow;
    },
    onSuccess: (form) => {
      qc.invalidateQueries({ queryKey: ["forms"] });
      qc.invalidateQueries({ queryKey: ["pending-forms"] });
      navigate({ to: "/forms/$formId/edit", params: { formId: form.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const duplicateForm = useMutation({
    mutationFn: async (form: FormRow) => {
      const isApproved = isSuperAdmin;
      const { data: newForm, error } = await supabase
        .from("forms")
        .insert({
          user_id: user.id,
          title: `${form.title} (copy)`,
          description: form.description,
          slug: makeSlug(form.title),
          settings: {
            ...(form.settings ?? {}),
            approval_status: isApproved ? "approved" : "draft",
            creator_email: user.email,
            creator_name: displayName,
          } as never,
          accepting_responses: false,
        })
        .select()
        .single();
      if (error) throw error;
      const { data: qs, error: qErr } = await supabase
        .from("questions")
        .select("*")
        .eq("form_id", form.id)
        .order("position");
      if (qErr) throw qErr;
      const rows = (qs as unknown as Question[]).map((q) => ({
        form_id: (newForm as unknown as FormRow).id,
        question_type: q.question_type,
        question_text: q.question_text,
        description: q.description,
        options: q.options,
        required: q.required,
        position: q.position,
      }));
      if (rows.length) {
        const { error: insErr } = await supabase.from("questions").insert(rows);
        if (insErr) throw insErr;
      }
    },
    onSuccess: () => {
      toast.success("Form duplicated");
      qc.invalidateQueries({ queryKey: ["forms"] });
      qc.invalidateQueries({ queryKey: ["pending-forms"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteForm = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("forms").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Form deleted");
      qc.invalidateQueries({ queryKey: ["forms"] });
      qc.invalidateQueries({ queryKey: ["pending-forms"] });
      qc.invalidateQueries({ queryKey: ["response-counts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function copyLink(slug: string) {
    navigator.clipboard.writeText(`${window.location.origin}/form/${slug}`);
    toast.success("Share link copied");
  }

  const forms = (formsQuery.data ?? []).filter((f) =>
    f.title.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      {/* HEADER SECTION */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">
            Welcome, {displayName}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">{user.email}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Admin Form Approvals & Settings */}
          {isSuperAdmin && (
            <>
              <Button
                variant="outline"
                onClick={() => setApprovalsModalOpen(true)}
                className="relative border-amber-500/40 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300 flex items-center gap-2"
              >
                <ShieldCheck className="size-4" />
                <span>Form Approvals</span>
                {pendingForms.length > 0 && (
                  <Badge className="ml-1 bg-amber-500 text-black px-1.5 py-0 text-[10px] font-bold">
                    {pendingForms.length}
                  </Badge>
                )}
              </Button>
              <Button asChild variant="outline">
                <Link to="/settings" className="flex items-center gap-2">
                  <Settings className="size-4" />
                  <span>Settings</span>
                </Link>
              </Button>
            </>
          )}

          {/* Create new form button */}
          <Button onClick={() => createForm.mutate()} disabled={createForm.isPending}>
            {createForm.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <FilePlus2 className="size-4" />
            )}
            Create new form
          </Button>
        </div>
      </div>

      {/* SEARCH BAR */}
      <div className="mt-8">
        <Input
          placeholder="Search your forms…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>

      {/* FORMS GRID */}
      {formsQuery.isLoading ? (
        <div className="text-muted-foreground flex items-center gap-2 py-16">
          <Loader2 className="size-4 animate-spin" /> Loading your forms…
        </div>
      ) : forms.length === 0 ? (
        <div className="bg-card mt-8 rounded-xl border border-dashed p-12 text-center">
          <h2 className="text-lg font-semibold">No forms yet</h2>
          <p className="text-muted-foreground mx-auto mt-2 max-w-sm text-sm">
            Create your first form to start collecting responses.
          </p>
          <Button className="mt-5" onClick={() => createForm.mutate()}>
            <FilePlus2 className="size-4" /> Create new form
          </Button>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {forms.map((form) => {
            const approvalStatus = (form.settings as any)?.approval_status ?? "approved";
            const isPending = approvalStatus === "pending";
            const isDraft = approvalStatus === "draft";
            const isRejected = approvalStatus === "rejected";

            return (
              <Card key={form.id} className="flex flex-col">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base leading-snug">{form.title}</CardTitle>
                    {isPending ? (
                      <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 flex items-center gap-1 shrink-0">
                        <Clock className="size-3" /> Approval Pending
                      </Badge>
                    ) : isDraft ? (
                      <Badge className="bg-zinc-500/20 text-zinc-400 border-zinc-500/30 shrink-0">
                        Draft
                      </Badge>
                    ) : isRejected ? (
                      <Badge variant="destructive" className="shrink-0">
                        Rejected
                      </Badge>
                    ) : (
                      <Badge variant={form.accepting_responses ? "default" : "secondary"} className="shrink-0">
                        {form.accepting_responses ? "Open" : "Closed"}
                      </Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground line-clamp-2 text-sm">
                    {form.description || "No description"}
                  </p>
                </CardHeader>
                <CardContent className="mt-auto space-y-3">
                  <div className="text-muted-foreground space-y-0.5 text-xs">
                    <p>
                      <strong className="text-foreground">
                        {countsQuery.data?.[form.id] ?? 0}
                      </strong>{" "}
                      responses
                    </p>
                    <p>Created {new Date(form.created_at).toLocaleDateString()}</p>
                    <p>Updated {new Date(form.updated_at).toLocaleDateString()}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {/* Edit */}
                    {isRejected ? (
                      <Button
                        size="sm" variant="secondary"
                        onClick={() => toast.error("This form was rejected. Delete it or contact admin.")}
                        className="opacity-50 cursor-not-allowed"
                      >
                        <Pencil className="size-3.5" /> Edit
                      </Button>
                    ) : (
                      <Button asChild size="sm" variant="secondary">
                        <Link to="/forms/$formId/edit" params={{ formId: form.id }}>
                          <Pencil className="size-3.5" /> Edit
                        </Link>
                      </Button>
                    )}

                    {/* Responses */}
                    {isRejected ? (
                      <Button
                        size="sm" variant="secondary"
                        onClick={() => toast.error("Rejected forms cannot collect or view responses.")}
                        className="opacity-50 cursor-not-allowed"
                      >
                        <BarChart3 className="size-3.5" /> Responses
                      </Button>
                    ) : (
                      <Button asChild size="sm" variant="secondary">
                        <Link to="/forms/$formId/responses" params={{ formId: form.id }}>
                          <BarChart3 className="size-3.5" /> Responses
                        </Link>
                      </Button>
                    )}

                    {/* Share button: disabled if pending, draft, or rejected */}
                    {isPending || isDraft || isRejected ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          toast.warning(
                            isRejected
                              ? "This form was rejected and cannot be shared."
                              : isDraft
                              ? "Submit this form for approval first before sharing."
                              : "This form is pending admin approval and cannot be shared yet."
                          )
                        }
                        className="text-muted-foreground opacity-60"
                      >
                        <Share2 className="size-3.5" /> Share
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => copyLink(form.slug)}>
                        <Share2 className="size-3.5" /> Share
                      </Button>
                    )}

                    {/* View public link: disabled if pending, draft, or rejected */}
                    {isPending || isDraft || isRejected ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          toast.warning(
                            isRejected
                              ? "This form was rejected and is not publicly accessible."
                              : isDraft
                              ? "Submit this form for approval first to get a public link."
                              : "This form cannot be viewed publicly until approved by Admin."
                          )
                        }
                        className="text-muted-foreground opacity-60"
                      >
                        <ExternalLink className="size-3.5" /> View
                      </Button>
                    ) : (
                      <Button asChild size="sm" variant="ghost">
                        <a href={`/form/${form.slug}`} target="_blank" rel="noreferrer">
                          <ExternalLink className="size-3.5" /> View
                        </a>
                      </Button>
                    )}

                    {/* Duplicate: disabled if rejected */}
                    {isRejected ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => toast.error("Rejected forms cannot be duplicated.")}
                        className="text-muted-foreground opacity-50 cursor-not-allowed"
                      >
                        <Copy className="size-3.5" /> Duplicate
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => duplicateForm.mutate(form)}
                        disabled={duplicateForm.isPending}
                      >
                        <Copy className="size-3.5" /> Duplicate
                      </Button>
                    )}

                    {/* Send responses to another user */}
                    {isPending || isDraft || isRejected ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          toast.warning(
                            isRejected
                              ? "Rejected forms cannot be sent."
                              : isDraft
                              ? "Submit this form for approval first before sending responses."
                              : "This form is pending admin approval."
                          )
                        }
                        className="text-muted-foreground opacity-60"
                      >
                        <Send className="size-3.5" /> Send
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setToSendForm(form)}
                        className="text-sky-400 hover:text-sky-300 hover:bg-sky-500/10"
                      >
                        <Send className="size-3.5" /> Send
                      </Button>
                    )}

                    <Button size="sm" variant="ghost" onClick={() => setToDelete(form)}>
                      <Trash2 className="text-destructive size-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* SHARED WITH ME SECTION */}
      {sharedItems.length > 0 && (
        <>
          <div className="mt-12 flex items-center gap-2">
            <Inbox className="size-5 text-sky-400" />
            <h2 className="text-xl font-semibold">Shared with me</h2>
            <Badge className="bg-sky-500/20 text-sky-400 border-sky-500/30 text-xs">
              {sharedItems.length}
            </Badge>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sharedItems.map((item) => (
              <Card key={item.id} className="flex flex-col border-sky-500/20">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base leading-snug">{item.form_title}</CardTitle>
                    <Badge className="bg-sky-500/20 text-sky-400 border-sky-500/30 flex items-center gap-1 shrink-0 text-[10px]">
                      <Send className="size-3" /> Shared
                    </Badge>
                  </div>
                  {item.form_description && (
                    <p className="text-muted-foreground line-clamp-2 text-sm">
                      {item.form_description}
                    </p>
                  )}
                </CardHeader>
                <CardContent className="mt-auto space-y-3">
                  <div className="text-muted-foreground space-y-0.5 text-xs">
                    <p>
                      Sent by{" "}
                      <strong className="text-foreground">
                        {item.sender_name || item.sender_email}
                      </strong>
                    </p>
                    <p>Received {new Date(item.shared_at).toLocaleDateString()}</p>
                  </div>
                  <Button asChild size="sm" variant="secondary" className="w-full">
                    <Link to="/shared/$shareId" params={{ shareId: item.id }}>
                      <BarChart3 className="size-3.5" /> View Responses
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* ADMIN: FORM APPROVALS DIALOG */}
      {isSuperAdmin && (
        <Dialog open={approvalsModalOpen} onOpenChange={setApprovalsModalOpen}>
          <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <div className="flex items-center gap-2">
                <div className="flex size-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
                  <ShieldCheck className="size-5" />
                </div>
                <div>
                  <DialogTitle className="text-xl">Form Approvals</DialogTitle>
                  <DialogDescription className="text-xs">
                    Review and approve form creation requests submitted by team members.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="mt-4 space-y-3">
              {pendingFormsQuery.isLoading ? (
                <div className="text-muted-foreground flex items-center justify-center gap-2 py-10">
                  <Loader2 className="size-4 animate-spin" /> Loading pending forms…
                </div>
              ) : pendingForms.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/70 p-10 text-center space-y-2">
                  <CheckCircle2 className="mx-auto size-10 text-emerald-500/80" />
                  <h3 className="font-semibold text-foreground">No Pending Approvals</h3>
                  <p className="text-muted-foreground text-xs max-w-sm mx-auto">
                    All forms are reviewed! When team members create new forms, they will appear here for your approval.
                  </p>
                </div>
              ) : (
                pendingForms.map((pf) => {
                  const creator = (pf.settings as any)?.creator_email || "Team Member";
                  const creatorName = (pf.settings as any)?.creator_name;
                  return (
                    <div
                      key={pf.id}
                      className="rounded-xl border border-border/60 bg-card p-4 space-y-3 transition-all hover:border-primary/40"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-semibold text-base text-foreground">{pf.title}</h4>
                            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px]">
                              Pending Approval
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                            {pf.description || "No description provided."}
                          </p>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-2">
                            <span>
                              Created by:{" "}
                              <strong className="text-foreground">
                                {creatorName ? `${creatorName} (${creator})` : creator}
                              </strong>
                            </span>
                            <span>•</span>
                            <span>{new Date(pf.created_at).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-border/40">
                        <Button asChild size="sm" variant="ghost" className="text-xs">
                          <Link to="/forms/$formId/edit" params={{ formId: pf.id }}>
                            <Pencil className="size-3.5 mr-1" /> Inspect
                          </Link>
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive hover:bg-destructive/10 text-xs"
                          onClick={() => rejectMutation.mutate(pf)}
                          disabled={rejectMutation.isPending || approveMutation.isPending}
                        >
                          <X className="size-3.5 mr-1" /> Reject
                        </Button>
                        <Button
                          size="sm"
                          className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs shadow-sm"
                          onClick={() => approveMutation.mutate(pf)}
                          disabled={rejectMutation.isPending || approveMutation.isPending}
                        >
                          {approveMutation.isPending ? (
                            <Loader2 className="size-3.5 animate-spin mr-1" />
                          ) : (
                            <Check className="size-3.5 mr-1" />
                          )}
                          Approve Form
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* DELETE FORM CONFIRMATION */}
      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{toDelete?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the form, its questions and all of its responses. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (toDelete) deleteForm.mutate(toDelete.id);
                setToDelete(null);
              }}
            >
              Delete form
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* SEND FORM RESPONSES DIALOG */}
      <Dialog
        open={!!toSendForm}
        onOpenChange={(o) => {
          if (!o) {
            setToSendForm(null);
            setSelectedUserId("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="size-5 text-sky-400" /> Send Form Responses
            </DialogTitle>
            <DialogDescription className="text-xs">
              Send the responses of <strong>{toSendForm?.title}</strong> to another user on the platform. They will be able to view and download the responses.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Select user</label>
              {usersQuery.isLoading ? (
                <div className="text-muted-foreground flex items-center gap-2 text-sm py-3">
                  <Loader2 className="size-4 animate-spin" /> Loading users…
                </div>
              ) : (usersQuery.data ?? []).length === 0 ? (
                <p className="text-muted-foreground text-sm py-3">No other active users found.</p>
              ) : (
                <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a user…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(usersQuery.data ?? []).map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name || u.email} {u.email ? `(${u.email})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setToSendForm(null);
                  setSelectedUserId("");
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!selectedUserId || sendFormMutation.isPending}
                onClick={() =>
                  toSendForm &&
                  sendFormMutation.mutate({ formId: toSendForm.id, recipientId: selectedUserId })
                }
                className="bg-sky-600 hover:bg-sky-500 text-white"
              >
                {sendFormMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4" />
                )}
                Send Responses
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
