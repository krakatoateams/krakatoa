import { supabaseServer } from "@/lib/supabase-server";
import type {
  CanvasCollaborator,
  CanvasCollaboratorRole,
  CanvasCollaboratorStatus,
} from "@/lib/canvas-document";
import type { Profile } from "@/lib/profiles-db";

const TABLE = "canvas_collaborators";

export type { CanvasCollaborator, CanvasCollaboratorRole, CanvasCollaboratorStatus };

type CollaboratorRow = {
  id: string;
  canvas_id: string;
  invited_email: string;
  invitee_profile_id: string | null;
  role: CanvasCollaboratorRole;
  invited_by_profile_id: string;
  status: CanvasCollaboratorStatus;
  created_at: string;
  accepted_at: string | null;
};

function missingTableError(): Error {
  return new Error(
    "Database table canvas_collaborators is missing. Apply supabase/migrations/108_canvas_collaborators.sql."
  );
}

function handleError(error: { message: string } | null, fallback: string): void {
  if (!error) return;
  if (error.message.includes("canvas_collaborators") && error.message.includes("schema cache")) {
    throw missingTableError();
  }
  throw new Error(error.message || fallback);
}

export function normalizeCollaboratorEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toCollaborator(row: CollaboratorRow): CanvasCollaborator {
  return {
    id: row.id,
    canvasId: row.canvas_id,
    invitedEmail: row.invited_email,
    inviteeProfileId: row.invitee_profile_id,
    role: row.role,
    invitedByProfileId: row.invited_by_profile_id,
    status: row.status,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidInviteEmail(email: string): boolean {
  const normalized = normalizeCollaboratorEmail(email);
  return normalized.length > 0 && normalized.length <= 320 && EMAIL_RE.test(normalized);
}

/** Link pending rows to the signed-in profile when emails match. */
export async function acceptPendingCanvasInvites(profile: Profile): Promise<void> {
  if (!profile.email) return;
  const email = normalizeCollaboratorEmail(profile.email);
  const { error } = await supabaseServer
    .from(TABLE)
    .update({
      invitee_profile_id: profile.id,
      status: "accepted",
      accepted_at: new Date().toISOString(),
    })
    .eq("invited_email", email)
    .eq("status", "pending");

  handleError(error, "Failed to accept canvas invites.");
}

export async function getCanvasCollaboratorAccess(
  profile: Profile,
  canvasId: string
): Promise<CanvasCollaborator | null> {
  await acceptPendingCanvasInvites(profile);

  const email = profile.email ? normalizeCollaboratorEmail(profile.email) : null;

  let query = supabaseServer
    .from(TABLE)
    .select("*")
    .eq("canvas_id", canvasId)
    .eq("status", "accepted");

  if (email) {
    query = query.or(`invitee_profile_id.eq.${profile.id},invited_email.eq.${email}`);
  } else {
    query = query.eq("invitee_profile_id", profile.id);
  }

  const { data, error } = await query.maybeSingle();
  handleError(error, "Failed to resolve canvas access.");
  if (!data) return null;
  return toCollaborator(data as CollaboratorRow);
}

export async function listCanvasCollaborators(
  canvasId: string,
  ownerProfileId: string
): Promise<CanvasCollaborator[]> {
  const { data: owned, error: ownedError } = await supabaseServer
    .from("canvases")
    .select("id")
    .eq("id", canvasId)
    .eq("profile_id", ownerProfileId)
    .maybeSingle();

  handleError(ownedError, "Failed to verify canvas owner.");
  if (!owned) return [];

  const { data, error } = await supabaseServer
    .from(TABLE)
    .select("*")
    .eq("canvas_id", canvasId)
    .order("created_at", { ascending: true });

  handleError(error, "Failed to list collaborators.");
  return ((data as CollaboratorRow[] | null) ?? []).map(toCollaborator);
}

export async function inviteCanvasCollaborator(params: {
  canvasId: string;
  ownerProfileId: string;
  ownerEmail: string | null;
  email: string;
  role: CanvasCollaboratorRole;
}): Promise<CanvasCollaborator> {
  const invitedEmail = normalizeCollaboratorEmail(params.email);
  if (!isValidInviteEmail(invitedEmail)) {
    throw new Error("Enter a valid email address.");
  }
  if (params.ownerEmail && normalizeCollaboratorEmail(params.ownerEmail) === invitedEmail) {
    throw new Error("You can't invite yourself.");
  }

  const { data: owned, error: ownedError } = await supabaseServer
    .from("canvases")
    .select("id")
    .eq("id", params.canvasId)
    .eq("profile_id", params.ownerProfileId)
    .maybeSingle();

  handleError(ownedError, "Failed to verify canvas owner.");
  if (!owned) throw new Error("Canvas not found.");

  const { data: invitee } = await supabaseServer
    .from("profiles")
    .select("id, email")
    .eq("email", invitedEmail)
    .maybeSingle();

  const now = new Date().toISOString();
  const status: CanvasCollaboratorStatus = invitee ? "accepted" : "pending";

  const { data, error } = await supabaseServer
    .from(TABLE)
    .upsert(
      {
        canvas_id: params.canvasId,
        invited_email: invitedEmail,
        invitee_profile_id: invitee?.id ?? null,
        role: params.role,
        invited_by_profile_id: params.ownerProfileId,
        status,
        accepted_at: status === "accepted" ? now : null,
      },
      { onConflict: "canvas_id,invited_email" }
    )
    .select("*")
    .single();

  handleError(error, "Failed to invite collaborator.");
  return toCollaborator(data as CollaboratorRow);
}

export async function removeCanvasCollaborator(params: {
  canvasId: string;
  ownerProfileId: string;
  collaboratorId: string;
}): Promise<boolean> {
  const { data: owned, error: ownedError } = await supabaseServer
    .from("canvases")
    .select("id")
    .eq("id", params.canvasId)
    .eq("profile_id", params.ownerProfileId)
    .maybeSingle();

  handleError(ownedError, "Failed to verify canvas owner.");
  if (!owned) return false;

  const { data, error } = await supabaseServer
    .from(TABLE)
    .delete()
    .eq("id", params.collaboratorId)
    .eq("canvas_id", params.canvasId)
    .select("id")
    .maybeSingle();

  handleError(error, "Failed to remove collaborator.");
  return Boolean(data);
}

export async function listSharedCanvasIds(profile: Profile): Promise<
  Array<{ canvasId: string; role: CanvasCollaboratorRole }>
> {
  await acceptPendingCanvasInvites(profile);
  const email = profile.email ? normalizeCollaboratorEmail(profile.email) : null;

  let query = supabaseServer
    .from(TABLE)
    .select("canvas_id, role")
    .eq("status", "accepted");

  if (email) {
    query = query.or(`invitee_profile_id.eq.${profile.id},invited_email.eq.${email}`);
  } else {
    query = query.eq("invitee_profile_id", profile.id);
  }

  const { data, error } = await query;
  handleError(error, "Failed to list shared canvases.");
  return ((data as Array<{ canvas_id: string; role: CanvasCollaboratorRole }> | null) ?? []).map(
    (row) => ({ canvasId: row.canvas_id, role: row.role })
  );
}
