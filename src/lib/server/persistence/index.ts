import { getEnv, hasSpacetimeConfig } from "@/lib/env";
import { InMemoryRepository } from "./in-memory-repository";
import { PersistenceRepository } from "./repository";
import { SpacetimeRepository } from "./spacetimedb-repository";

declare global {
  var __glmOcrRepository: PersistenceRepository | undefined;
}

export function getRepository(): PersistenceRepository {
  if (globalThis.__glmOcrRepository) {
    return globalThis.__glmOcrRepository;
  }

  const env = getEnv();

  if (hasSpacetimeConfig(env)) {
    globalThis.__glmOcrRepository = new SpacetimeRepository();
    return globalThis.__glmOcrRepository;
  }

  globalThis.__glmOcrRepository = new InMemoryRepository();
  return globalThis.__glmOcrRepository;
}
