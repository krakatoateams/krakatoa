import { isMissingDbObject } from "@/lib/generation-db-errors";
import { supabaseServer } from "@/lib/supabase-server";
import { STORAGE_BUCKET } from "@/lib/storage-buckets";
import {
  parseWorkflowFinalizeResult,
  type WorkflowFinalizeResult,
} from "./finalization-pure";

function finalizeMissingHint(): Error {
  return new Error(
    "Database function krakatoa_finalize_workflow_generation_success is missing. Run: npm run db:setup — or apply supabase/migrations/068_workflow_success_finalization.sql.",
  );
}

export async function atomicFinalizeWorkflowSuccess(params: {
  profileId: string;
  jobId: string;
  generationRequestId: string;
  userId: string;
  storagePath: string;
  assetId: string | null;
  videoUrl: string;
  jobOutput: Record<string, unknown>;
  costCredits: number;
  assetMetadata: Record<string, unknown>;
  creationTool: string;
  creationToolLabel: string;
  creationTitle: string;
  creationMetadata: Record<string, unknown>;
}): Promise<WorkflowFinalizeResult> {
  const { data, error } = await supabaseServer.rpc("krakatoa_finalize_workflow_generation_success", {
    p_profile_id: params.profileId,
    p_job_id: params.jobId,
    p_generation_request_id: params.generationRequestId,
    p_user_id: params.userId,
    p_storage_path: params.storagePath,
    p_asset_id: params.assetId,
    p_video_url: params.videoUrl,
    p_job_output: params.jobOutput,
    p_cost_credits: params.costCredits,
    p_asset_metadata: params.assetMetadata,
    p_creation_tool: params.creationTool,
    p_creation_tool_label: params.creationToolLabel,
    p_creation_title: params.creationTitle,
    p_creation_metadata: params.creationMetadata,
  });

  if (error) {
    if (isMissingDbObject(error.message, "krakatoa_finalize_workflow_generation_success")) {
      throw finalizeMissingHint();
    }
    throw new Error(error.message || "atomicFinalizeWorkflowSuccess RPC failed");
  }

  return parseWorkflowFinalizeResult((data ?? {}) as Record<string, unknown>);
}

/** Persist processing asset storage_path checkpoint before atomic finalize. */
export async function checkpointProcessingAssetPath(params: {
  profileId: string;
  assetId: string;
  storagePath: string;
}): Promise<void> {
  const { error } = await supabaseServer
    .from("assets")
    .update({ storage_path: params.storagePath })
    .eq("id", params.assetId)
    .eq("profile_id", params.profileId)
    .eq("status", "processing");

  if (error) {
    throw new Error(error.message || "checkpointProcessingAssetPath failed");
  }
}

export async function deleteStoragePathIfPresent(
  storagePath: string,
  userId: string,
): Promise<void> {
  const safeUser = userId.replace(/[^a-zA-Z0-9-]/g, "");
  if (!storagePath.startsWith(`${safeUser}/`)) {
    throw new Error("deleteStoragePathIfPresent: path is outside user scope");
  }
  const { error } = await supabaseServer.storage.from(STORAGE_BUCKET).remove([storagePath]);
  if (error) {
    throw new Error(error.message || "deleteStoragePathIfPresent failed");
  }
}
