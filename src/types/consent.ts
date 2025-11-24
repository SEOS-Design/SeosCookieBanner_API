export type ConsentStatus = "all" | "necessary_only" | "custom";

export interface ConsentPayload {
  necessary: boolean;
  analytics: boolean;
  marketing: boolean;
  functional: boolean;
  status: ConsentStatus;
  timestamp: string;
  policyVersion?: string;
  userAgent?: string;
}
