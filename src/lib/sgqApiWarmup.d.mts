export declare const WARMUP_DELAYS_MS: readonly number[]
export declare function fetchWithApiWarmup(
  url: string,
  init?: RequestInit,
  options?: {
    fetchImpl?: (url: string, init: RequestInit) => Promise<Response>,
    sleep?: (ms: number) => Promise<void>,
  },
): Promise<Response>
