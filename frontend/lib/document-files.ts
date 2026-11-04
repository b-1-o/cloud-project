"use client";

export type StoredDocumentFile = {
  documentId: string;
  fileName: string;
  mimeType: string;
  size: number;
  updatedAt: string;
  blob: Blob;
};

const DATABASE_NAME = "collab-docs-files";
const STORE_NAME = "document-files";
const DATABASE_VERSION = 1;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("Browser file storage is not available in this environment."));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "documentId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open document file storage."));
    request.onblocked = () => reject(new Error("Document file storage is blocked by another browser tab."));
  });
}

export async function putLocalDocumentFile(
  documentId: string,
  file: File,
): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const stored: StoredDocumentFile = {
      documentId,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      updatedAt: new Date().toISOString(),
      blob: file,
    };
    tx.objectStore(STORE_NAME).put(stored);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Could not save the original file on this device."));
    tx.onabort = () => reject(tx.error || new Error("Saving the original file was cancelled."));
  }).finally(() => db.close());
}

export async function getLocalDocumentFile(
  documentId: string,
): Promise<StoredDocumentFile | null> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(documentId);
      request.onsuccess = () => resolve((request.result as StoredDocumentFile | undefined) || null);
      request.onerror = () => reject(request.error || new Error("Could not read the original file."));
    });
  } finally {
    db.close();
  }
}

export async function deleteLocalDocumentFile(documentId: string): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(documentId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Could not delete the local file."));
      tx.onabort = () => reject(tx.error || new Error("Deleting the local file was cancelled."));
    });
  } finally {
    db.close();
  }
}
