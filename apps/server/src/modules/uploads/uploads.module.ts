import { UploadPreviewService } from "./upload-preview.service.js";
import { RasterImageInspector } from "./raster-image-inspector.js";
import { UploadInspectorService } from "./upload-inspector.service.js";
import { Module } from "@nestjs/common";
import { ProcessModule } from "../../infra/process/process.module.js";
import { QueueModule } from "../../infra/queue/queue.module.js";
import { StorageModule } from "../../infra/storage/storage.module.js";

import { AuthModule } from "../auth/auth.module.js";
import { PermissionsModule } from "../permissions/permissions.module.js";
import { RelationshipsModule } from "../relationships/relationships.module.js";
import { AttachmentAccessGuard } from "./attachment-access.guard.js";
import { AttachmentAccessPolicy } from "./attachment-access.policy.js";
import { AttachmentDownloadService } from "./attachment-download.service.js";
import { AttachmentsController } from "./attachments.controller.js";
import { AvatarContentService } from "./avatar-content.service.js";
import { AvatarService } from "./avatar.service.js";
import { OutboxDispatcherService } from "./outbox-dispatcher.service.js";
import { UploadCleanupService } from "./upload-cleanup.service.js";
import { UploadCleanupQuery } from "./upload-cleanup.query.js";
import { UploadObjectCleanupService } from "./upload-object-cleanup.service.js";
import { UploadLifecycleService } from "./upload-lifecycle.service.js";
import { UploadPolicyService } from "./upload-policy.service.js";
import { UploadProcessorService } from "./upload-processor.service.js";
import { UploadPresenter } from "./upload.presenter.js";
import { UploadService } from "./upload.service.js";
import { UploadWorkerService } from "./upload-worker.service.js";
import {
  AvatarContentController,
  AvatarController,
  UploadsController,
} from "./uploads.controller.js";

@Module({
  imports: [
    AuthModule,
    PermissionsModule,
    RelationshipsModule,
    ProcessModule,
    QueueModule,
    StorageModule,
  ],
  controllers: [
    UploadsController,
    AvatarController,
    AvatarContentController,
    AttachmentsController,
  ],
  providers: [
    RasterImageInspector,
    UploadInspectorService,
    AttachmentAccessGuard,
    AttachmentAccessPolicy,
    AttachmentDownloadService,
    AvatarContentService,
    AvatarService,
    OutboxDispatcherService,
    UploadCleanupService,
    UploadCleanupQuery,
    UploadObjectCleanupService,
    UploadLifecycleService,
    UploadPolicyService,
    UploadPresenter,
    UploadPreviewService,
    UploadProcessorService,
    UploadService,
    UploadWorkerService,
  ],
  exports: [UploadLifecycleService, UploadPresenter],
})
export class UploadsModule {}
