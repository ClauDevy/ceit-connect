export type Role = "Admin" | "Co-Admin" | "Member";

export type CommitteeSlug =
  | "President"
  | "CIA"
  | "COEXA"
  | "COMRECS"
  | "COFBUM"
  | "CARA"
  | "COPI"
  | "COPR"
  | "COBAP"
  | "COSEA"
  | "COSCA"
  | "COSRAW";

export interface CurrentUser {
  id: string;
  name: string;
  role: Role;
  committeeId: string | null;
  avatarUrl: string | null;
  passwordSet: boolean;
}

export interface Committee {
  id: string;
  name: string;
}

export interface Member {
  id: string;
  full_name: string;
  email: string;
  role: string;
  committee_id: string | null;
  avatar_url: string | null;
  is_active: boolean;
  anonymized_at: string | null;
}

export interface PendingOfficerInvite {
  id: string;
  auth_user_id: string | null;
  email: string;
  full_name: string;
  officer_role: "Admin" | "Co-Admin";
  committee_id: string | null;
  status: "preparing" | "sent" | "cleanup_pending";
  created_at: string;
  cleanup_pending: boolean;
}
