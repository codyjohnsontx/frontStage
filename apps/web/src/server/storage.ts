import { createS3Storage, storageConfigFromEnv, type ObjectStorage } from "@frontstage/storage";

let storage: ObjectStorage | undefined;

/** Singleton object-storage client (MinIO in dev, any S3 store in prod). */
export function getStorage(): ObjectStorage {
  if (!storage) {
    storage = createS3Storage(storageConfigFromEnv());
  }
  return storage;
}
