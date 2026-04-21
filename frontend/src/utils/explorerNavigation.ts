export type ExplorerModuleId = 'tess' | 'kmtnet' | 'explorer';

export interface ExplorerRouteContext {
  moduleId: ExplorerModuleId;
  topicId: string | null;
  siteId: string | null;
}

interface ExplorerDefaults {
  moduleId?: ExplorerModuleId | null;
  topicId?: string | null;
  siteId?: string | null;
}

const VALID_TOPICS = new Set([
  'eclipsing_binary',
  'variable_star',
  'exoplanet_transit',
  'microlensing',
]);

const VALID_MODULES = new Set<ExplorerModuleId>(['tess', 'kmtnet', 'explorer']);
const VALID_SITES = new Set(['ctio', 'saao', 'sso']);

function normalizeTopic(topicId: string | null | undefined): string | null {
  return topicId && VALID_TOPICS.has(topicId) ? topicId : null;
}

function normalizeModule(moduleId: string | null | undefined): ExplorerModuleId | null {
  return moduleId && VALID_MODULES.has(moduleId as ExplorerModuleId)
    ? (moduleId as ExplorerModuleId)
    : null;
}

function normalizeSite(siteId: string | null | undefined): string | null {
  return siteId && VALID_SITES.has(siteId) ? siteId : null;
}

function inferModuleFromTopic(topicId: string | null): ExplorerModuleId {
  return topicId === 'exoplanet_transit' ? 'tess' : 'explorer';
}

export function alignExplorerContext(
  context: ExplorerRouteContext,
  topicId: string | null
): ExplorerRouteContext {
  return {
    ...context,
    moduleId: context.moduleId === 'kmtnet' ? 'kmtnet' : inferModuleFromTopic(topicId),
    topicId,
  };
}

export function getExplorerContext(
  searchParams: URLSearchParams,
  defaults: ExplorerDefaults = {}
): ExplorerRouteContext {
  const topicId = normalizeTopic(searchParams.get('topic')) ?? normalizeTopic(defaults.topicId) ?? null;
  const moduleId =
    normalizeModule(searchParams.get('module')) ??
    normalizeModule(defaults.moduleId ?? null) ??
    inferModuleFromTopic(topicId);
  const siteId = normalizeSite(searchParams.get('site')) ?? normalizeSite(defaults.siteId ?? null);

  return {
    moduleId,
    topicId,
    siteId,
  };
}

export function buildExplorerContextSearchParams(
  context: ExplorerRouteContext,
  extraEntries?: Array<[string, string]>
): URLSearchParams {
  const params = new URLSearchParams();
  params.set('module', context.moduleId);

  if (context.topicId) {
    params.set('topic', context.topicId);
  }

  if (context.siteId) {
    params.set('site', context.siteId);
  }

  extraEntries?.forEach(([key, value]) => {
    params.set(key, value);
  });

  return params;
}

export function buildExplorerHref(context: ExplorerRouteContext): string {
  const params = buildExplorerContextSearchParams(context);
  const query = params.toString();
  const basePath = context.moduleId === 'kmtnet' ? '/kmtnet/explorer' : '/explorer';
  return query ? `${basePath}?${query}` : basePath;
}

export function buildTargetHref(targetId: string, context: ExplorerRouteContext): string {
  const query = buildExplorerContextSearchParams(context).toString();
  return query ? `/target/${targetId}?${query}` : `/target/${targetId}`;
}

export function buildLabHref(
  targetId: string,
  context: ExplorerRouteContext,
  extraEntries?: Array<[string, string]>
): string {
  const query = buildExplorerContextSearchParams(context, extraEntries).toString();
  return query ? `/lab/${targetId}?${query}` : `/lab/${targetId}`;
}

export function getExplorerBackLabel(context: ExplorerRouteContext): string {
  if (context.moduleId === 'kmtnet') return 'Back to KMTNet Explorer';
  if (context.moduleId === 'tess') return 'Back to TESS Explorer';
  return 'Back to Explorer';
}
