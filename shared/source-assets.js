const DB_NAME = "practicum-helper-source-assets";
const STORE_NAME = "sourceAssets";
const DB_VERSION = 1;

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("Браузер не поддерживает IndexedDB."));
      return;
    }

    const request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, {
          keyPath: "id"
        });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error || new Error("Не удалось открыть IndexedDB."));
    };
  });
}

function runTransaction(mode, callback) {
  return new Promise((resolve, reject) => {
    openDatabase()
      .then(database => {
        const transaction = database.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);

        let result;
        try {
          result = callback(store, transaction);
        } catch (error) {
          transaction.abort();
          database.close();
          reject(error);
          return;
        }

        transaction.oncomplete = () => {
          database.close();
          resolve(result);
        };

        transaction.onerror = () => {
          const transactionError = transaction.error || new Error("Ошибка IndexedDB-транзакции.");
          database.close();
          reject(transactionError);
        };

        transaction.onabort = () => {
          const transactionError = transaction.error || new Error("IndexedDB-транзакция была отменена.");
          database.close();
          reject(transactionError);
        };
      })
      .catch(reject);
  });
}

function normalizeArrayBuffer(bytes) {
  if (bytes instanceof ArrayBuffer) {
    return bytes;
  }

  if (ArrayBuffer.isView(bytes)) {
    const view = bytes;
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
  }

  return new Uint8Array().buffer;
}

export async function replaceSourceAssets(sourceStorageId, assets) {
  const normalizedAssets = Array.isArray(assets) ? assets : [];
  const normalizedSourceStorageId = String(sourceStorageId || "").trim();

  await runTransaction("readwrite", store => {
    store.clear();

    normalizedAssets.forEach(asset => {
      const assetId = String(asset && asset.id ? asset.id : "").trim();
      if (!assetId) {
        return;
      }

      store.put({
        id: assetId,
        sourceStorageId: normalizedSourceStorageId,
        bytes: normalizeArrayBuffer(asset.bytes)
      });
    });
  });
}

export async function loadSourceAssetBytes(sourceStorageId, assetId) {
  const normalizedSourceStorageId = String(sourceStorageId || "").trim();
  const normalizedAssetId = String(assetId || "").trim();

  if (!normalizedSourceStorageId || !normalizedAssetId) {
    return null;
  }

  return runTransaction("readonly", store => {
    return new Promise((resolve, reject) => {
      const request = store.get(normalizedAssetId);
      request.onsuccess = () => {
        const record = request.result;
        if (!record || record.sourceStorageId !== normalizedSourceStorageId || !(record.bytes instanceof ArrayBuffer)) {
          resolve(null);
          return;
        }

        resolve(record.bytes.slice(0));
      };
      request.onerror = () => {
        reject(request.error || new Error("Не удалось прочитать binary asset."));
      };
    });
  });
}

export async function clearSourceAssets() {
  await runTransaction("readwrite", store => {
    store.clear();
  });
}
