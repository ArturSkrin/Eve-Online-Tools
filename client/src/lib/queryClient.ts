import { QueryClient, QueryFunction } from "@tanstack/react-query";

/** The reason a request failed: the server's { message } when it sent one, else the raw body. */
export async function responseError(res: Response): Promise<Error> {
  const text = (await res.text()) || res.statusText;
  // An HTML page means a proxy in front of the app answered (Cloudflare, nginx), not the app itself.
  if (/^\s*</.test(text)) {
    const timeout = [502, 504, 522, 524].includes(res.status);
    return new Error(
      timeout
        ? `Сервер не ответил вовремя (${res.status}), запрос оборвал прокси. Попробуйте ещё раз через минуту.`
        : `Ошибка ${res.status} от прокси перед сервером.`,
    );
  }
  try {
    const message = JSON.parse(text)?.message;
    if (typeof message === "string" && message) return new Error(message);
  } catch {
    // not JSON
  }
  return new Error(`${res.status}: ${text}`);
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) throw await responseError(res);
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
