import { api } from "./api";

const OFFLINE_QUEUE_KEY = "gdt_offline_queue_v1";

type QueuedCheckout = {
  id: string;
  type: "pos.checkout";
  createdAt: string;
  attempts: number;
  payload: unknown;
  receipt: {
    temporaryNumber: string;
    total: number;
    sellerName: string;
    customerName: string;
  };
  lastError?: string;
};

type OfflineQueueItem = QueuedCheckout;

function readQueue(): OfflineQueueItem[] {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(items: OfflineQueueItem[]) {
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent("gdt-offline-queue-changed", { detail: { pending: items.length } }));
}

export function getOfflineQueueCount() {
  return readQueue().length;
}

export function isNetworkError(error: unknown) {
  return error instanceof TypeError || (error instanceof Error && /failed to fetch|network|fetch/i.test(error.message));
}

export function queueOfflineCheckout(payload: unknown, receipt: Omit<QueuedCheckout["receipt"], "temporaryNumber">) {
  const queue = readQueue();
  const temporaryNumber = `OFF-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${String(queue.length + 1).padStart(4, "0")}`;
  const item: QueuedCheckout = {
    id: `offline-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: "pos.checkout",
    createdAt: new Date().toISOString(),
    attempts: 0,
    payload,
    receipt: { ...receipt, temporaryNumber }
  };
  writeQueue([...queue, item]);
  return item;
}

export async function syncOfflineQueue() {
  if (!navigator.onLine) return { synced: 0, pending: getOfflineQueueCount() };

  const queue = readQueue();
  const remaining: OfflineQueueItem[] = [];
  let synced = 0;

  for (const item of queue) {
    try {
      if (item.type === "pos.checkout") {
        await api("/pos/checkout", {
          method: "POST",
          body: JSON.stringify(item.payload)
        });
        synced += 1;
      }
    } catch (error) {
      remaining.push({
        ...item,
        attempts: item.attempts + 1,
        lastError: error instanceof Error ? error.message : "Synchronisation impossible."
      });
    }
  }

  writeQueue(remaining);
  return { synced, pending: remaining.length };
}
