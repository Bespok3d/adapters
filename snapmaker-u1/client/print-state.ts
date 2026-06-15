const MOONRAKER_PORT = 7125

export function isPrinting(printStatsJson: string): boolean {
  try {
    const state = JSON.parse(printStatsJson)?.result?.status?.print_stats?.state
    return state === 'printing' || state === 'paused'
  } catch {
    return false
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<string | null> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: abort.signal })
    return response.ok ? await response.text() : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// Ask Moonraker for the live print state over plain HTTP. Tries the direct API port, then the
// nginx-proxied path (a Moonraker bound to localhost is still reachable through the web server).
// Unreachable on both is treated as idle (allow), matching the daemon guard.
export async function printerIsPrinting(host: string): Promise<boolean> {
  const direct = await fetchWithTimeout(`http://${host}:${MOONRAKER_PORT}/printer/objects/query?print_stats`, 3000)
  if (direct !== null) return isPrinting(direct)
  const proxied = await fetchWithTimeout(`http://${host}/printer/objects/query?print_stats`, 3000)
  return proxied !== null ? isPrinting(proxied) : false
}
