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
