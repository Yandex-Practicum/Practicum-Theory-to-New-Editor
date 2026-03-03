import { STORAGE_KEY, TASK_STORAGE_KEY } from "./constants.js";

export function chromeStorageGet(key) {
  return new Promise(resolve => {
    chrome.storage.local.get([key], result => resolve(result[key]));
  });
}

export function chromeStorageSet(value) {
  return new Promise(resolve => {
    chrome.storage.local.set(value, resolve);
  });
}

export function chromeStorageRemove(key) {
  return new Promise(resolve => {
    chrome.storage.local.remove(key, resolve);
  });
}

export async function loadStoredSource() {
  return chromeStorageGet(STORAGE_KEY);
}

export async function saveStoredSource(payload) {
  await chromeStorageSet({ [STORAGE_KEY]: payload });
}

export async function loadActiveTask() {
  return (await chromeStorageGet(TASK_STORAGE_KEY)) || null;
}

export async function saveActiveTask(task) {
  await chromeStorageSet({ [TASK_STORAGE_KEY]: task });
  return task;
}

export async function clearActiveTask() {
  await chromeStorageRemove(TASK_STORAGE_KEY);
}

export async function updateActiveTask(patch) {
  const current = await loadActiveTask();
  if (!current) {
    return null;
  }

  const next = {
    ...current,
    ...(patch || {})
  };

  await saveActiveTask(next);
  return next;
}

export function subscribeToStorageChanges(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }

  const wrappedListener = (changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    listener(changes);
  };

  chrome.storage.onChanged.addListener(wrappedListener);
  return () => {
    chrome.storage.onChanged.removeListener(wrappedListener);
  };
}
