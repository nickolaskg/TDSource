export type TeamRole = "basic" | "moderator" | "admin";
export type AccountStatus = "inactive" | "active" | "suspended";

export interface TeamGrant {
  teamId: string;
  role: TeamRole;
}

export interface Principal {
  id: string;
  email: string;
  displayName: string;
  status: AccountStatus;
  teamGrants: TeamGrant[];
}

export interface ResourceScope {
  teamIds: string[];
  staffOnly: boolean;
}

const roleRank: Record<TeamRole, number> = {
  basic: 1,
  moderator: 2,
  admin: 3,
};

export function hasTeamRole(
  principal: Principal,
  teamId: string,
  minimumRole: TeamRole,
): boolean {
  if (principal.status !== "active") return false;
  const grant = principal.teamGrants.find((candidate) => candidate.teamId === teamId);
  return grant ? roleRank[grant.role] >= roleRank[minimumRole] : false;
}

export function canReadResource(principal: Principal, scope: ResourceScope): boolean {
  if (principal.status !== "active") return false;
  return scope.teamIds.some((teamId) =>
    hasTeamRole(principal, teamId, scope.staffOnly ? "moderator" : "basic"),
  );
}

export function canModerateResource(principal: Principal, scope: ResourceScope): boolean {
  return scope.teamIds.some((teamId) => hasTeamRole(principal, teamId, "moderator"));
}

export function canAccessReviewQueue(grants: readonly Pick<TeamGrant, "role">[]): boolean {
  return grants.some(({ role }) => role === "moderator" || role === "admin");
}

export function canAdministerTeams(grants: readonly Pick<TeamGrant, "role">[]): boolean {
  return grants.some(({ role }) => role === "admin");
}
