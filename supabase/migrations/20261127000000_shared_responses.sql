-- Table to track form responses shared between users
CREATE TABLE IF NOT EXISTS public.shared_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id uuid NOT NULL REFERENCES public.forms(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_email text NOT NULL,
  sender_name text,
  shared_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(form_id, sender_id, recipient_id)
);

CREATE INDEX IF NOT EXISTS shared_responses_recipient_idx ON public.shared_responses(recipient_id);
CREATE INDEX IF NOT EXISTS shared_responses_sender_idx ON public.shared_responses(sender_id);
CREATE INDEX IF NOT EXISTS shared_responses_form_idx ON public.shared_responses(form_id);

-- Grants
GRANT SELECT, INSERT, DELETE ON public.shared_responses TO authenticated;
GRANT ALL ON public.shared_responses TO service_role;

-- Enable RLS
ALTER TABLE public.shared_responses ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read profiles so they can pick a recipient in the Send dropdown
DROP POLICY IF EXISTS "profiles_select_authenticated" ON public.profiles;
CREATE POLICY "profiles_select_authenticated" ON public.profiles
FOR SELECT TO authenticated
USING (true);

-- Helper functions (SECURITY DEFINER) to check if current user is a recipient of a shared form
CREATE OR REPLACE FUNCTION private.is_shared_recipient(_form_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.shared_responses sr
    WHERE sr.form_id = _form_id
    AND sr.recipient_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION private.is_shared_response(_response_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.responses r
    JOIN public.shared_responses sr ON sr.form_id = r.form_id
    WHERE r.id = _response_id
    AND sr.recipient_id = auth.uid()
  );
$$;

-- Sender can insert and delete their own shares
DROP POLICY IF EXISTS "shared_sender_insert" ON public.shared_responses;
CREATE POLICY "shared_sender_insert" ON public.shared_responses
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = sender_id);

DROP POLICY IF EXISTS "shared_sender_delete" ON public.shared_responses;
CREATE POLICY "shared_sender_delete" ON public.shared_responses
FOR DELETE TO authenticated
USING (auth.uid() = sender_id);

-- Sender and recipient can read
DROP POLICY IF EXISTS "shared_read" ON public.shared_responses;
CREATE POLICY "shared_read" ON public.shared_responses
FOR SELECT TO authenticated
USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

-- Allow recipients to read the shared form, its questions, responses, and answers
DROP POLICY IF EXISTS "forms_shared_read" ON public.forms;
CREATE POLICY "forms_shared_read" ON public.forms
FOR SELECT TO authenticated
USING (private.is_shared_recipient(id));

DROP POLICY IF EXISTS "questions_shared_read" ON public.questions;
CREATE POLICY "questions_shared_read" ON public.questions
FOR SELECT TO authenticated
USING (private.is_shared_recipient(form_id));

DROP POLICY IF EXISTS "responses_shared_read" ON public.responses;
CREATE POLICY "responses_shared_read" ON public.responses
FOR SELECT TO authenticated
USING (private.is_shared_recipient(form_id));

DROP POLICY IF EXISTS "answers_shared_read" ON public.response_answers;
CREATE POLICY "answers_shared_read" ON public.response_answers
FOR SELECT TO authenticated
USING (private.is_shared_response(response_id));
