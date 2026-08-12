import type {
  AEmotionObserverResolverPortV1,
  AEmotionPresentationPortV1,
} from "../a-emotion/ports";
import { AEmotionFeedServiceV1 } from "../a-emotion/feed.service";
import { AEmotionViewerProjectorV1 } from "../a-emotion/projector";
import type {
  AEmotionSeatDeliveryBindingPortV1,
  AEmotionStoryDayPortV1,
} from "./contracts";
import type { AEmotionPersistencePrismaClient } from "./prisma-adapters";
import {
  PrismaAEmotionFeedRepositoryV1,
  PrismaAEmotionInteractionJournalV1,
} from "./prisma-adapters";
import { AEmotionAuthorityFeedPipelineV1 } from "./pipeline";

export function createPrismaAEmotionPersistenceV1(input: {
  prisma: AEmotionPersistencePrismaClient;
  bindings: AEmotionSeatDeliveryBindingPortV1;
  storyDay: AEmotionStoryDayPortV1;
  observerResolver: AEmotionObserverResolverPortV1;
  presentation: AEmotionPresentationPortV1;
}) {
  const journal = new PrismaAEmotionInteractionJournalV1(input.prisma);
  const repository = new PrismaAEmotionFeedRepositoryV1(
    input.prisma,
    input.bindings,
    input.storyDay,
  );
  const projector = new AEmotionViewerProjectorV1(
    input.observerResolver,
    input.presentation,
  );
  const feed = new AEmotionFeedServiceV1(repository);
  const pipeline = new AEmotionAuthorityFeedPipelineV1(journal, projector, feed);
  return { journal, repository, projector, feed, pipeline };
}

export function createPrismaAEmotionFeedServiceV1(input: {
  prisma: AEmotionPersistencePrismaClient;
  bindings: AEmotionSeatDeliveryBindingPortV1;
  storyDay: AEmotionStoryDayPortV1;
}) {
  return new AEmotionFeedServiceV1(
    new PrismaAEmotionFeedRepositoryV1(input.prisma, input.bindings, input.storyDay),
  );
}
