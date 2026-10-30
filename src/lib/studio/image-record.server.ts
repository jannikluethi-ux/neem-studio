import { readFile } from "node:fs/promises";
import { sessionObjectStore, type StoredObject } from "./architecture.ts";
import { fingerprint } from "./engine.ts";
import type { RecordedImageInstall } from "./image.ts";

const metaUrl = new URL("./generated/meethi-candidate.json", import.meta.url);

interface FileEntry {
  storageRef: string;
  mediaType: string;
  checksum: string;
  byteLength: number;
  file: string;
  version: number;
}

function safeFile(name: string): boolean {
  return /^meethi-candidate(?:-v\d+)?\.jpg$/.test(name);
}

async function readManifest(): Promise<FileEntry[]> {
  try {
    const raw = JSON.parse(await readFile(metaUrl, "utf8")) as FileEntry & { files?: FileEntry[] };
    const files = Array.isArray(raw.files) ? raw.files : raw.storageRef ? [{ ...raw, file: raw.file || "meethi-candidate.jpg", version: raw.version || 1 }] : [];
    return files.filter((item) => item.storageRef && item.checksum && item.byteLength >= 32 && safeFile(item.file));
  } catch {
    return [];
  }
}

async function readEntry(entry: FileEntry): Promise<{ entry: FileEntry; bytes: Uint8Array } | null> {
  try {
    const bytes = new Uint8Array(await readFile(new URL(`./generated/${entry.file}`, import.meta.url)));
    if (bytes.byteLength !== entry.byteLength) return null;
    if (fingerprint(Array.from(bytes)) !== entry.checksum) return null;
    return { entry, bytes };
  } catch {
    return null;
  }
}

async function records(): Promise<RecordedImageInstall[]> {
  const mod = await import("./generated/meethi-recorded.ts");
  return mod.RECORDED_CHARACTER_IMAGES ?? [];
}

export async function ensureRecordedImage(storageRef: string): Promise<StoredObject | null> {
  const existing = sessionObjectStore().get(storageRef);
  if (existing) return existing;
  const entry = (await readManifest()).find((item) => item.storageRef === storageRef);
  if (!entry) return null;
  const loaded = await readEntry(entry);
  if (!loaded) return null;
  sessionObjectStore().put({ storageRef, mediaType: entry.mediaType, bytes: loaded.bytes });
  return sessionObjectStore().get(storageRef);
}

export async function bytesForCandidateVersion(version: number): Promise<{ mediaType: string; bytes: Uint8Array } | null> {
  const recorded = (await records()).find((item) => item.objectRecord.version === version);
  const entry = (await readManifest()).find((item) => item.version === version);
  if (!recorded || !entry || entry.storageRef !== recorded.objectRecord.storageRef || entry.checksum !== recorded.objectRecord.checksum) return null;
  const loaded = await readEntry(entry);
  if (!loaded) return null;
  return { mediaType: entry.mediaType, bytes: loaded.bytes };
}

export async function readRecordedCandidate(characterId: string): Promise<{
  characterId: string;
  storageRef: string;
  mediaType: string;
  checksum: string;
  byteLength: number;
  retrieval: "VERIFIED" | "FAILED";
  dataUrl: string | null;
  assetId: string;
  assetVersion: number;
  executionId: string;
  providerId: string;
  model: string;
  externalReference: string | null;
  templateKey: string;
  templateVersion: number;
  canonSnapshotHash: string;
  cost: number | null;
  costNote: string;
  rightsStatus: "UNKNOWN";
  storage: "BLOCKED";
  approved: false;
} | null> {
  const list = (await records()).filter((item) => item.characterId === characterId);
  const recorded = list.at(-1);
  if (!recorded) return null;
  const manifest = await readManifest();
  let verified = true;
  for (const item of list) {
    const entry = manifest.find((file) => file.storageRef === item.objectRecord.storageRef);
    const loaded = entry ? await readEntry(entry) : null;
    if (!loaded) verified = false;
    else if (!sessionObjectStore().get(entry!.storageRef)) sessionObjectStore().put({ storageRef: entry!.storageRef, mediaType: entry!.mediaType, bytes: loaded.bytes });
  }
  const version = recorded.asset.versions.at(-1);
  const latest = manifest.find((file) => file.storageRef === recorded.objectRecord.storageRef);
  const loaded = latest ? await readEntry(latest) : null;
  return {
    characterId,
    storageRef: recorded.objectRecord.storageRef,
    mediaType: recorded.objectRecord.mediaType,
    checksum: recorded.objectRecord.checksum,
    byteLength: recorded.objectRecord.byteLength,
    retrieval: verified && loaded ? "VERIFIED" : "FAILED",
    dataUrl: loaded ? `data:${loaded.entry.mediaType};base64,${Buffer.from(loaded.bytes).toString("base64")}` : null,
    assetId: recorded.asset.id,
    assetVersion: version?.version ?? recorded.asset.currentVersion,
    executionId: recorded.execution.id,
    providerId: recorded.execution.providerId,
    model: recorded.execution.model,
    externalReference: recorded.result.externalReference,
    templateKey: version?.snapshot.promptKey ?? recorded.result.templateKey,
    templateVersion: version?.snapshot.promptVersion ?? recorded.result.templateVersion,
    canonSnapshotHash: version?.snapshot.canonSnapshotHash ?? "",
    cost: recorded.result.cost,
    costNote: recorded.result.costNote,
    rightsStatus: "UNKNOWN",
    storage: "BLOCKED",
    approved: false,
  };
}
