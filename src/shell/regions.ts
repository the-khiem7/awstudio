// Commercial AWS Regions as the console's region selector groups them. The emulator keeps a
// separate state per Region, so switching Regions shows a different set of local resources.

export interface Region {
  code: string;
  name: string;
}

export const REGIONS_BY_LOCATION: Record<string, Region[]> = {
  "United States": [
    { code: "us-east-1", name: "N. Virginia" },
    { code: "us-east-2", name: "Ohio" },
    { code: "us-west-1", name: "N. California" },
    { code: "us-west-2", name: "Oregon" },
  ],
  "Asia Pacific": [
    { code: "ap-south-1", name: "Mumbai" },
    { code: "ap-northeast-3", name: "Osaka" },
    { code: "ap-northeast-2", name: "Seoul" },
    { code: "ap-southeast-1", name: "Singapore" },
    { code: "ap-southeast-2", name: "Sydney" },
    { code: "ap-northeast-1", name: "Tokyo" },
  ],
  Canada: [{ code: "ca-central-1", name: "Central" }],
  Europe: [
    { code: "eu-central-1", name: "Frankfurt" },
    { code: "eu-west-1", name: "Ireland" },
    { code: "eu-west-2", name: "London" },
    { code: "eu-west-3", name: "Paris" },
    { code: "eu-north-1", name: "Stockholm" },
  ],
  "Middle East": [
    { code: "me-south-1", name: "Bahrain" },
    { code: "me-central-1", name: "UAE" },
  ],
  "South America": [{ code: "sa-east-1", name: "São Paulo" }],
};

export const REGIONS: Region[] = Object.values(REGIONS_BY_LOCATION).flat();

export const DEFAULT_REGION = "us-east-1";

export function regionName(code: string): string {
  return REGIONS.find((r) => r.code === code)?.name ?? code;
}

export function isRegion(code: unknown): code is string {
  return typeof code === "string" && REGIONS.some((r) => r.code === code);
}
