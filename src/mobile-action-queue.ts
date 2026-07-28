export interface QueuedAction {
  id: string
  url: string
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: string
  createdAt: number
}

const MAX_ACTIONS = 25
const queue: QueuedAction[] = []

export function enqueueMobileAction(action: Omit<QueuedAction, 'id' | 'createdAt'>) {
  const parsed = new URL(action.url, window.location.origin)
  if (parsed.origin !== window.location.origin) throw new Error('Only same-origin actions may be queued.')
  if (queue.length >= MAX_ACTIONS) throw new Error('Offline action queue is full.')

  const queued: QueuedAction = {
    ...action,
    url: `${parsed.pathname}${parsed.search}`,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
  }
  queue.push(queued)
  window.dispatchEvent(new CustomEvent('finance-planner:queue-change', { detail: queue.length }))
  return queued.id
}

export function queuedMobileActionCount() {
  return queue.length
}

export async function flushMobileActions(fetcher: typeof fetch = fetch) {
  if (!navigator.onLine) return { completed: 0, remaining: queue.length }
  let completed = 0

  while (queue.length > 0) {
    const action = queue[0]
    const response = await fetcher(action.url, {
      method: action.method,
      body: action.body,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': action.id,
      },
    }).catch(() => null)

    if (!response?.ok) break
    queue.shift()
    completed += 1
  }

  window.dispatchEvent(new CustomEvent('finance-planner:queue-change', { detail: queue.length }))
  return { completed, remaining: queue.length }
}
