import type {
  Topic,
  Target,
  Observation,
  TransitTargetFilters,
} from '../types/target';
import type {
  PhotometryRequest,
  PhotometryResponse,
  LightCurveRequest,
  LightCurveResponse,
} from '../types/photometry';
import type {
  TransitCutoutPreview,
  TransitPreviewJob,
  TransitPhotometryRequest,
  TransitPhotometryResponse,
} from '../types/transit';
import type {
  TransitFitRequest,
  TransitFitResponse,
} from '../types/transitFit';
import type {
  RecordListItem,
  RecordSubmissionRequest,
  RecordSubmissionResponse,
  RecordTemplate,
} from '../types/record';

const BASE = '/api';

async function get<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    throw new Error(await buildApiErrorMessage(res, `GET ${path} failed`));
  }
  return res.json();
}

async function post<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(await buildApiErrorMessage(res, `POST ${path} failed`));
  }
  return res.json();
}

async function buildApiErrorMessage(
  response: Response,
  fallback: string
): Promise<string> {
  try {
    const payload = (await response.json()) as { detail?: string };
    if (payload.detail) {
      return `${fallback}: ${payload.detail}`;
    }
  } catch {
    // Ignore parse failures and keep the status-based fallback.
  }

  return `${fallback}: ${response.status}`;
}

export async function fetchTopics(): Promise<Topic[]> {
  const data = await get<{ topics: Topic[] }>('/topics');
  return data.topics;
}

export async function fetchTargets(
  topicId?: string,
  transitFilters?: TransitTargetFilters
): Promise<Target[]> {
  const params = new URLSearchParams();

  if (topicId) {
    params.set('topic', topicId);
  }

  if (topicId === 'exoplanet_transit' && transitFilters) {
    params.set('max_targets', String(transitFilters.maxTargets));
    params.set('min_depth_pct', String(transitFilters.minDepthPct));
    params.set('max_period_days', String(transitFilters.maxPeriodDays));
    params.set('max_host_vmag', String(transitFilters.maxHostVmag));
  }

  const query = params.size > 0 ? `?${params.toString()}` : '';
  const data = await get<{ targets: Target[] }>(`/targets${query}`);
  return data.targets;
}

export async function fetchTarget(
  targetId: string
): Promise<{ target: Target; observation_count: number }> {
  return get(`/targets/${targetId}`);
}

export async function fetchObservations(
  targetId: string
): Promise<Observation[]> {
  const data = await get<{ observations: Observation[] }>(
    `/targets/${targetId}/observations`
  );
  return data.observations;
}

export async function runPhotometry(
  req: PhotometryRequest
): Promise<PhotometryResponse> {
  return post('/photometry', req);
}

export async function buildLightCurve(
  req: LightCurveRequest
): Promise<LightCurveResponse> {
  return post('/lightcurve', req);
}

export async function fetchTransitCutoutPreview(
  targetId: string,
  observationId: string,
  sizePx = 35,
  frameIndex?: number | null,
  signal?: AbortSignal
): Promise<TransitCutoutPreview> {
  const params = new URLSearchParams({ size_px: String(sizePx) });
  if (frameIndex !== undefined && frameIndex !== null) {
    params.set('frame_index', String(frameIndex));
  }
  return get(
    `/transit/targets/${targetId}/observations/${observationId}/preview?${params.toString()}`,
    {
      signal,
    }
  );
}

export async function runTransitPhotometry(
  req: TransitPhotometryRequest,
  signal?: AbortSignal
): Promise<TransitPhotometryResponse> {
  return post('/transit/photometry', req, { signal });
}

export async function fitTransitModel(
  req: TransitFitRequest,
  signal?: AbortSignal
): Promise<TransitFitResponse> {
  return post('/transit/fit', req, { signal });
}

export async function createTransitPreviewJob(
  targetId: string,
  observationId: string,
  sizePx = 35,
  frameIndex?: number | null
): Promise<TransitPreviewJob> {
  const params = new URLSearchParams({ size_px: String(sizePx) });
  if (frameIndex !== undefined && frameIndex !== null) {
    params.set('frame_index', String(frameIndex));
  }
  return post(
    `/transit/targets/${targetId}/observations/${observationId}/preview-jobs?${params.toString()}`,
    {}
  );
}

export async function fetchTransitPreviewJob(jobId: string): Promise<TransitPreviewJob> {
  return get(`/transit/preview-jobs/${jobId}`);
}

export async function cancelTransitPreviewJob(jobId: string): Promise<TransitPreviewJob> {
  return post(`/transit/preview-jobs/${jobId}/cancel`, {});
}

// ===== Auth =====

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  picture: string | null;
}

export async function fetchCurrentUser(): Promise<AuthUser | null> {
  try {
    return await get<AuthUser>('/auth/me');
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  await post('/auth/logout', {});
}

export async function fetchRecordTemplate(templateId: string): Promise<RecordTemplate> {
  return get(`/records/templates/${templateId}`);
}

export async function submitRecordTemplate(
  templateId: string,
  req: RecordSubmissionRequest
): Promise<RecordSubmissionResponse> {
  return post(`/records/templates/${templateId}/submissions`, req);
}

export async function fetchMyRecordSubmissions(): Promise<RecordListItem[]> {
  const data = await get<{ records: RecordListItem[] }>('/records/mine');
  return data.records;
}

export async function fetchMyRecordSubmission(recordId: number): Promise<RecordListItem | null> {
  const data = await get<{ records: RecordListItem[] }>(`/records/mine/${recordId}`);
  return data.records[0] ?? null;
}
