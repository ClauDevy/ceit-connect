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
}
