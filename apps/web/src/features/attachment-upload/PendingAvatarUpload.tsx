import { useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { useSession } from "../../entities/session/session.store";
import { resumeUpload, setAvatar, type PendingUpload } from "./upload-client";

export function PendingAvatarUpload({
  pending,
  ownerId,
  onFinished,
}: {
  readonly pending: PendingUpload;
  readonly ownerId: string;
  readonly onFinished: () => void;
}) {
  const { t } = useTranslation();
  const status = useQuery({
    queryKey: ["upload", ownerId, pending.uploadId],
    queryFn: () => resumeUpload(pending),
    retry: false,
    refetchInterval: (query) => {
      const state = query.state.data?.status;
      return query.state.error || state === "ready" || state === "rejected" || state === "expired"
        ? false
        : 500;
    },
  });
  const assignment = useMutation({
    mutationFn: () => setAvatar(pending.uploadId),
    onSuccess: (user) => {
      if (useSession.getState().user?.id === ownerId) useSession.getState().updateUser(user);
      onFinished();
    },
    onError: (error) =>
      console.error("Avatar assignment failed", { error, uploadId: pending.uploadId, ownerId }),
  });
  const { mutate, status: assignmentStatus } = assignment;
  useEffect(() => {
    if (status.data?.status === "ready" && assignmentStatus === "idle") mutate();
  }, [status.data?.status, assignmentStatus, mutate]);
  useEffect(() => {
    if (status.error)
      console.error("Upload status failed", {
        error: status.error,
        uploadId: pending.uploadId,
        ownerId,
      });
  }, [status.error, pending.uploadId, ownerId]);

  const rejected = status.data?.status === "rejected" || status.data?.status === "expired";
  const failed = rejected || status.isError || assignment.isError;
  return (
    <div className="mt-3 text-xs">
      <p role={failed ? "alert" : "status"}>
        {t(failed ? "settings.avatarFailed" : "settings.processingAvatar")}
      </p>
      {failed ? (
        <div className="mt-2 flex gap-3">
          {!rejected ? (
            <button
              type="button"
              onClick={() => {
                if (assignment.isError) assignment.mutate();
                else void status.refetch();
              }}
            >
              {t("settings.retryAvatar")}
            </button>
          ) : null}
          <button type="button" onClick={onFinished}>
            {t("common.close")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
