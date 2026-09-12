export interface ResolvedTenant {
  id: string;
  slug: string;
  host: string;
  name: string;
  primaryColor: string;
  logoUrl: string | null;
  featureFlags: Record<string, boolean>;
}

export interface TenantConfigDto {
  id: string;
  name: string;
  primaryColor: string;
  logoUrl: string | null;
  featureFlags: Record<string, boolean>;
}
