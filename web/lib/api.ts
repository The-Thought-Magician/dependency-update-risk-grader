// Same-origin relative calls to /api/proxy/<path>. Each path maps 1:1 to the
// backend /api/v1/<path>. The proxy route injects X-User-Id after resolving the
// Neon Auth session server-side.

async function req(path: string, init?: RequestInit) {
  const res = await fetch(`/api/proxy/${path}`, init)
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const message = (data && (data.error || data.message)) || `Request failed (${res.status})`
    throw new Error(message)
  }
  return data
}

const get = (path: string) => req(path)
const post = (path: string, body?: unknown) =>
  req(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const put = (path: string, body?: unknown) =>
  req(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const del = (path: string) => req(path, { method: 'DELETE' })

function qs(params: Record<string, string | number | undefined | null>) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

const api = {
  // Workspaces & members
  listWorkspaces: () => get('workspaces'),
  getWorkspace: (id: string) => get(`workspaces/${id}`),
  createWorkspace: (body: unknown) => post('workspaces', body),
  updateWorkspace: (id: string, body: unknown) => put(`workspaces/${id}`, body),
  deleteWorkspace: (id: string) => del(`workspaces/${id}`),
  reseedWorkspace: (id: string) => post(`workspaces/${id}/reseed`),
  listMembers: (workspaceId: string) => get(`members${qs({ workspace_id: workspaceId })}`),
  addMember: (body: unknown) => post('members', body),
  updateMember: (id: string, body: unknown) => put(`members/${id}`, body),
  removeMember: (id: string) => del(`members/${id}`),

  // Projects, manifests, inventory
  listProjects: (workspaceId: string) => get(`projects${qs({ workspace_id: workspaceId })}`),
  getProject: (id: string) => get(`projects/${id}`),
  createProject: (body: unknown) => post('projects', body),
  updateProject: (id: string, body: unknown) => put(`projects/${id}`, body),
  deleteProject: (id: string) => del(`projects/${id}`),
  getProjectDependencies: (id: string) => get(`projects/${id}/dependencies`),
  getProjectSummary: (id: string) => get(`projects/${id}/summary`),
  listManifests: (projectId: string) => get(`manifests${qs({ project_id: projectId })}`),
  getManifest: (id: string) => get(`manifests/${id}`),
  uploadManifest: (body: unknown) => post('manifests', body),
  deleteManifest: (id: string) => del(`manifests/${id}`),

  // Packages & maintainers
  listPackages: (params: { ecosystem?: string; q?: string } = {}) =>
    get(`packages${qs({ ecosystem: params.ecosystem, q: params.q })}`),
  getPackage: (id: string) => get(`packages/${id}`),
  getPackageVersions: (id: string) => get(`packages/${id}/versions`),
  getPackageMaintainers: (id: string) => get(`packages/${id}/maintainers`),
  listMaintainers: (q?: string) => get(`maintainers${qs({ q })}`),
  getMaintainer: (id: string) => get(`maintainers/${id}`),

  // Updates & analysis
  listUpdates: (params: { workspace_id?: string; status?: string; project_id?: string } = {}) =>
    get(`updates${qs({ workspace_id: params.workspace_id, status: params.status, project_id: params.project_id })}`),
  getUpdate: (id: string) => get(`updates/${id}`),
  createUpdate: (body: unknown) => post('updates', body),
  importUpdates: (body: unknown) => post('updates/import', body),
  deleteUpdate: (id: string) => del(`updates/${id}`),
  reevaluateUpdate: (id: string) => post(`updates/${id}/reevaluate`),
  getRisk: (updateId: string) => get(`risk/${updateId}`),
  getRiskFactors: (updateId: string) => get(`risk/${updateId}/factors`),
  getScriptDiff: (updateId: string) => get(`script-diffs/${updateId}`),
  getDependencyDelta: (updateId: string) => get(`dependency-deltas/${updateId}`),

  // Queue / triage
  getQueue: (workspaceId: string) => get(`queue${qs({ workspace_id: workspaceId })}`),
  transitionUpdate: (updateId: string, body: unknown) => post(`queue/${updateId}/transition`, body),
  bulkTransition: (body: unknown) => post('queue/bulk', body),
  autoClear: (workspaceId: string) => post(`queue/auto-clear${qs({ workspace_id: workspaceId })}`),
  assignUpdate: (updateId: string, body: unknown) => post(`queue/${updateId}/assign`, body),

  // Policies & evaluation
  listPolicies: (workspaceId: string) => get(`policies${qs({ workspace_id: workspaceId })}`),
  getPolicy: (id: string) => get(`policies/${id}`),
  createPolicy: (body: unknown) => post('policies', body),
  updatePolicy: (id: string, body: unknown) => put(`policies/${id}`, body),
  deletePolicy: (id: string) => del(`policies/${id}`),
  simulatePolicy: (id: string, body: unknown) => post(`policies/${id}/simulate`, body),
  listPolicyRules: (policyId: string) => get(`policy-rules${qs({ policy_id: policyId })}`),
  createPolicyRule: (body: unknown) => post('policy-rules', body),
  updatePolicyRule: (id: string, body: unknown) => put(`policy-rules/${id}`, body),
  deletePolicyRule: (id: string) => del(`policy-rules/${id}`),
  getPolicyEvaluations: (updateId: string) => get(`policy-evaluations/${updateId}`),
  runPolicyEvaluation: (updateId: string) => post(`policy-evaluations/${updateId}/run`),

  // Pinning
  listPinningAdvice: (params: { workspace_id?: string; project_id?: string } = {}) =>
    get(`pinning${qs({ workspace_id: params.workspace_id, project_id: params.project_id })}`),
  generatePinningAdvice: (body: unknown) => post('pinning/generate', body),

  // Ledger
  listLedger: (params: { workspace_id?: string; package?: string; actor?: string } = {}) =>
    get(`ledger${qs({ workspace_id: params.workspace_id, package: params.package, actor: params.actor })}`),
  getLedgerEntry: (id: string) => get(`ledger/${id}`),
  exportLedger: (params: { workspace_id?: string; format?: string } = {}) =>
    get(`ledger/export${qs({ workspace_id: params.workspace_id, format: params.format })}`),
  verifyLedger: (workspaceId: string) => get(`ledger/verify${qs({ workspace_id: workspaceId })}`),

  // Incidents
  listIncidents: () => get('incidents'),
  getIncident: (id: string) => get(`incidents/${id}`),
  replayIncident: (id: string, body: unknown) => post(`incidents/${id}/replay`, body),

  // Rules (weights/bands)
  getRules: (workspaceId: string) => get(`rules${qs({ workspace_id: workspaceId })}`),
  updateRules: (body: unknown) => put('rules', body),
  resetRules: (body: unknown) => post('rules/reset', body),

  // Alerts & notifications
  listAlerts: (workspaceId: string) => get(`alerts${qs({ workspace_id: workspaceId })}`),
  resolveAlert: (id: string) => post(`alerts/${id}/resolve`),
  listAlertRules: (workspaceId: string) => get(`alert-rules${qs({ workspace_id: workspaceId })}`),
  createAlertRule: (body: unknown) => post('alert-rules', body),
  updateAlertRule: (id: string, body: unknown) => put(`alert-rules/${id}`, body),
  deleteAlertRule: (id: string) => del(`alert-rules/${id}`),
  listNotifications: () => get('notifications'),
  readNotification: (id: string) => post(`notifications/${id}/read`),
  readAllNotifications: () => post('notifications/read-all'),

  // Dashboard, reports, webhooks, billing
  getDashboard: (workspaceId: string) => get(`dashboard${qs({ workspace_id: workspaceId })}`),
  listReports: (workspaceId: string) => get(`reports${qs({ workspace_id: workspaceId })}`),
  getReport: (id: string) => get(`reports/${id}`),
  generateReport: (body: unknown) => post('reports/generate', body),
  exportReport: (id: string, format: string) => get(`reports/${id}/export${qs({ format })}`),
  deleteReport: (id: string) => del(`reports/${id}`),
  listWebhooks: (workspaceId: string) => get(`webhooks${qs({ workspace_id: workspaceId })}`),
  createWebhook: (body: unknown) => post('webhooks', body),
  updateWebhook: (id: string, body: unknown) => put(`webhooks/${id}`, body),
  deleteWebhook: (id: string) => del(`webhooks/${id}`),
  getWebhookDeliveries: (id: string) => get(`webhooks/${id}/deliveries`),
  testWebhook: (id: string) => post(`webhooks/${id}/test`),
  getBillingPlan: () => get('billing/plan'),
  startCheckout: () => post('billing/checkout'),
  openPortal: () => post('billing/portal'),
}

export default api
