export type TeamScopedRole = "basic" | "moderator" | "admin";

export interface TeamRoleGrant {
  teamId: string;
  role: TeamScopedRole;
}

export function isStaffRole(role: TeamScopedRole): boolean {
  return role === "moderator" || role === "admin";
}

export function resolveCaptureReviewTeam(
  defaultReviewTeamId: string,
  actorGrants: readonly TeamRoleGrant[],
  sharedRecipientTeamIds: readonly string[],
): string | null {
  const staffTeamIds = new Set(actorGrants.filter(({ role }) => isStaffRole(role)).map(({ teamId }) => teamId));
  if (staffTeamIds.has(defaultReviewTeamId)) return defaultReviewTeamId;
  return sharedRecipientTeamIds.some((teamId) => staffTeamIds.has(teamId)) ? defaultReviewTeamId : null;
}

export function canSeePendingReview(reviewTeamId: string, actorGrants: readonly TeamRoleGrant[]): boolean {
  return actorGrants.some(({ teamId, role }) => teamId === reviewTeamId && isStaffRole(role));
}

export function canReviseSharedKnowledge(recipientTeamId: string, actorGrants: readonly TeamRoleGrant[]): boolean {
  return actorGrants.some(({ teamId, role }) => teamId === recipientTeamId && isStaffRole(role));
}
