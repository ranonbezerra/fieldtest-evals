/**
 * Tenant ids are DNS subdomains: lowercase alphanumerics and hyphens in
 * dot-separated labels (e.g. `operator-x`).
 */
const TENANT_ID_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

export function assertTenantId(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 253 || !TENANT_ID_PATTERN.test(value)) {
    throw new TypeError(`Invalid tenant id: ${JSON.stringify(value)}`);
  }
  return value;
}
