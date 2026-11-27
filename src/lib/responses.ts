import { supabase } from "@/integrations/supabase/client";
import type { ResponseRecord } from "./excel";

const PAGE_SIZE = 1000;
const CHUNK_SIZE = 50;

/** Fetch all responses and their answers for a form, paginating past Supabase's 1,000-row cap. */
export async function fetchFormResponseRecords(formId: string): Promise<ResponseRecord[]> {
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

  return rs.map((r) => ({
    id: r.id,
    submitted_at: r.submitted_at,
    respondent_email: r.respondent_email,
    answers: Object.fromEntries(
      answers
        .filter((a) => a.response_id === r.id)
        .map((a) => [a.question_id, a.answer ?? ""]),
    ),
  }));
}
