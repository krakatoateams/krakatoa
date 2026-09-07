"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import CreationsHistory from "@/components/CreationsHistory";
import { useCreditBalance } from "@/app/(app)/credit-balance-context";
import { useCurrentUser } from "@/lib/auth-context";
import type { MentionAsset } from "@/lib/mention-assets";
import {
  composerHasEnabledModels,
  mapVideoComposerEnablement,
  type VideoComposerKey,
  type VideoComposerEnablement,
} from "@/lib/video-composer-features";
import { parseVideoStudioDeepLink, type VideoCreationType } from "@/lib/video-studio-deep-link";
import TextToVideoComposer from "./composers/TextToVideoComposer";
import ViralTemplateComposer from "./composers/ViralTemplateComposer";
import ImageToVideoComposer from "./composers/ImageToVideoComposer";
import MotionControlComposer from "./composers/MotionControlComposer";
import StoryboardToVideoComposer from "./composers/StoryboardToVideoComposer";
import ReelsCreatorComposer from "./composers/ReelsCreatorComposer";
import { loadMentionAssetsFromApi } from "./composers/shared";
import { CREATION_TYPES, composerKeyForCreationType } from "./composers/types";

export default function VideoStudioShell({
  historyRefreshKey,
  onHistoryRefresh,
}: {
  historyRefreshKey: number;
  onHistoryRefresh: () => void;
}) {
  const searchParams = useSearchParams();
  const { status } = useCurrentUser();
  const { refetch: refetchCredits } = useCreditBalance();
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminResolved, setAdminResolved] = useState(false);

  const [deepLink] = useState(() => parseVideoStudioDeepLink(searchParams));
  const {
    initialType,
    initialStoryboardId,
    initialStartImageCreationId,
    initialTemplateVideo,
    initialViralTemplate,
    initialPrompt,
  } = deepLink;

  useEffect(() => {
    if (status !== "authenticated") {
      setIsAdmin(false);
      setAdminResolved(true);
      return;
    }
    let active = true;
    fetch("/api/admin/me")
      .then((res) => (res.ok ? res.json() : { isAdmin: false }))
      .then((d: { isAdmin?: boolean }) => {
        if (!active) return;
        setIsAdmin(Boolean(d.isAdmin));
        setAdminResolved(true);
      })
      .catch(() => {
        if (!active) return;
        setIsAdmin(false);
        setAdminResolved(true);
      });
    return () => {
      active = false;
    };
  }, [status]);

  const [creationType, setCreationType] = useState<VideoCreationType>(initialType);
  const [mentionAssets, setMentionAssets] = useState<MentionAsset[]>([]);

  const [composerEnablement, setComposerEnablement] =
    useState<Record<VideoComposerKey, VideoComposerEnablement> | null>(null);
  const [devBlank, setDevBlank] = useState(false);

  useEffect(() => {
    let active = true;
    const loadEnablement = () => {
      fetch("/api/tools/video/features")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!active || !data?.composers) return;
          const raw = {} as Record<VideoComposerKey, { enabledTiers: string[]; defaultTier: string }>;
          for (const c of data.composers) {
            if (c.key) {
              raw[c.key as VideoComposerKey] = {
                enabledTiers: c.enabledModelIds ?? [],
                defaultTier: c.defaultModelId ?? "",
              };
            }
          }
          setComposerEnablement(mapVideoComposerEnablement(raw));
        })
        .catch(() => {});
    };

    loadEnablement();
    const onVisible = () => {
      if (document.visibilityState === "visible") loadEnablement();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const availableCreationTypes = CREATION_TYPES.filter((c) =>
    composerHasEnabledModels(
      composerKeyForCreationType(c.id as VideoCreationType),
      composerEnablement
    )
  );

  useEffect(() => {
    void loadMentionAssetsFromApi().then(setMentionAssets);
  }, [historyRefreshKey]);

  const handleCreationType = useCallback((id: string) => {
    if (id === "reels-creator" && !isAdmin) return;
    if (
      id === "text2video" ||
      id === "image2video" ||
      id === "viral_template" ||
      id === "motion_control" ||
      id === "storyboard" ||
      id === "reels-creator"
    ) {
      setCreationType(id as VideoCreationType);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!adminResolved) return;
    if (!isAdmin && creationType === "reels-creator") {
      setCreationType("text2video");
    }
  }, [adminResolved, isAdmin, creationType]);

  useEffect(() => {
    if (availableCreationTypes.length === 0) return;
    if (availableCreationTypes.some((c) => c.id === creationType)) return;
    setCreationType(availableCreationTypes[0].id as VideoCreationType);
  }, [availableCreationTypes, creationType]);

  const onGenerated = useCallback(() => {
    onHistoryRefresh();
    refetchCredits();
  }, [onHistoryRefresh, refetchCredits]);

  return (
    <div className="min-h-screen text-text-primary selection:bg-white/20">
      <div className="relative z-10 mx-auto max-w-5xl px-6 py-10">
        <div className="mb-8">
          <h1 className="mb-3 bg-gradient-to-b from-N900 to-N500 bg-clip-text font-display text-4xl font-bold tracking-tight text-transparent">
            Video studio
          </h1>
        </div>

        <div className={creationType === "text2video" ? undefined : "hidden"}>
          <TextToVideoComposer
            initialPrompt={initialType === "text2video" ? initialPrompt : null}
            mentionAssets={mentionAssets}
            creationTypes={availableCreationTypes}
            isAdmin={isAdmin}
            devBlank={devBlank}
            onDevBlankChange={setDevBlank}
            composerEnablement={composerEnablement}
            onSelectCreation={handleCreationType}
            onGenerated={onGenerated}
          />
        </div>

        {creationType === "viral_template" && (
          <ViralTemplateComposer
            initialTemplate={initialViralTemplate}
            creationTypes={availableCreationTypes}
            isAdmin={isAdmin}
            devBlank={devBlank}
            onDevBlankChange={setDevBlank}
            composerEnablement={composerEnablement}
            onSelectCreation={handleCreationType}
            onGenerated={onGenerated}
          />
        )}

        {creationType === "image2video" && (
          <ImageToVideoComposer
            initialStartImageCreationId={initialStartImageCreationId}
            initialPrompt={initialPrompt}
            mentionAssets={mentionAssets}
            creationTypes={availableCreationTypes}
            isAdmin={isAdmin}
            devBlank={devBlank}
            onDevBlankChange={setDevBlank}
            composerEnablement={composerEnablement}
            onSelectCreation={handleCreationType}
            onGenerated={onGenerated}
          />
        )}

        {creationType === "motion_control" && (
          <MotionControlComposer
            initialTemplateVideo={initialTemplateVideo}
            creationTypes={availableCreationTypes}
            isAdmin={isAdmin}
            devBlank={devBlank}
            onDevBlankChange={setDevBlank}
            composerEnablement={composerEnablement}
            onSelectCreation={handleCreationType}
            onGenerated={onGenerated}
          />
        )}

        {creationType === "storyboard" && (
          <StoryboardToVideoComposer
            initialStoryboardId={initialStoryboardId}
            creationTypes={availableCreationTypes}
            isAdmin={isAdmin}
            devBlank={devBlank}
            onDevBlankChange={setDevBlank}
            composerEnablement={composerEnablement}
            onSelectCreation={handleCreationType}
            onGenerated={onGenerated}
          />
        )}

        {creationType === "reels-creator" && isAdmin && (
          <ReelsCreatorComposer
            creationTypes={availableCreationTypes}
            isAdmin={isAdmin}
            devBlank={devBlank}
            onDevBlankChange={setDevBlank}
            composerEnablement={composerEnablement}
            onSelectCreation={handleCreationType}
            onGenerated={onGenerated}
          />
        )}

        {status === "authenticated" && (
          <div className="mt-0 lg:mt-[120px]">
            <CreationsHistory
              className="!mt-0"
              title="Generation history"
              tools={["video_text2video", "video_image2video"]}
              productFeatureTabs="video"
              refreshKey={historyRefreshKey}
              showActions
              showMeta={false}
              limit={20}
            />
          </div>
        )}
      </div>
    </div>
  );
}
