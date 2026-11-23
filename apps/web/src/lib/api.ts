import type { SessionUser } from './types';

let accessToken: string | null = null;
let refreshing: Promise<LoginResponse | null> | null = null;

interface LoginResponse {
  accessToken: string;
  expiresIn: number;
  user: SessionUser;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public correlationId?: string,
  ) {
    super(message);
  }
}

export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

async function rawFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  try {
    return await fetch(`/api/v1${path}`, { ...init, headers, credentials: 'include' });
  } catch {
    throw new ApiError(0, 'NETWORK', 'No fue posible comunicarse con el servidor.');
  }
}

/** Renueva la sesión con la cookie httpOnly; las solicitudes concurrentes comparten una sola renovación. */
export function refreshSession(): Promise<LoginResponse | null> {
  refreshing ??= (async () => {
    try {
      const res = await rawFetch('/auth/refresh', { method: 'POST' });
      if (!res.ok) return null;
      const data = (await res.json()) as LoginResponse;
      accessToken = data.accessToken;
      return data;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function toError(res: Response): Promise<ApiError> {
  let body: { code?: string; message?: string; correlationId?: string } = {};
  try {
    body = await res.json();
  } catch {
    /* respuesta sin cuerpo JSON */
  }
  return new ApiError(res.status, body.code ?? 'ERROR', body.message ?? 'Ocurrió un error.', body.correlationId);
}

async function send(path: string, init: RequestInit): Promise<Response> {
  let res = await rawFetch(path, init);
  if (res.status === 401 && !path.startsWith('/auth/')) {
    if (await refreshSession()) res = await rawFetch(path, init);
  }
  if (!res.ok) throw await toError(res);
  return res;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await send(path, init);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const res = await rawFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (!res.ok) throw await toError(res);
  const data = (await res.json()) as LoginResponse;
  accessToken = data.accessToken;
  return data;
}

export async function logout(): Promise<void> {
  try {
    await send('/auth/logout', { method: 'POST' });
  } finally {
    accessToken = null;
  }
}

/** Descarga un archivo autenticado (CSV, JSON o Markdown) y lo entrega al navegador. */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const res = await send(path, {});
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
