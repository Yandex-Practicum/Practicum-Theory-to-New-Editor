export function defaultScheduleTask(callback) {
  callback();
}

export async function mapInBatches(items, batchSize, iteratee) {
  const normalizedItems = Array.isArray(items) ? items : [];
  const normalizedBatchSize = Math.max(1, Number(batchSize) || 1);
  const results = new Array(normalizedItems.length);

  for (let start = 0; start < normalizedItems.length; start += normalizedBatchSize) {
    const batch = normalizedItems.slice(start, start + normalizedBatchSize);
    const batchResults = await Promise.all(
      batch.map((item, offset) => iteratee(item, start + offset))
    );

    for (let offset = 0; offset < batchResults.length; offset += 1) {
      results[start + offset] = batchResults[offset];
    }
  }

  return results;
}

export function toErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/Receiving end does not exist/i.test(message) || /Could not establish connection/i.test(message)) {
    return "Перезагрузите страницу: bridge-скрипт еще не подключен.";
  }

  if (/message (?:channel|port) closed before a response was received/i.test(message)) {
    return "Страница была закрыта или перезагружена до ответа. Повторите действие.";
  }

  return message || "Неизвестная ошибка.";
}

export function buildBusyTaskError() {
  return "Фоновая задача уже выполняется.";
}

export function normalizeDate(input) {
  const date = input instanceof Date ? input : new Date(input);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export function estimateBlockCount(markdown) {
  return String(markdown || "")
    .trim()
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean).length;
}
