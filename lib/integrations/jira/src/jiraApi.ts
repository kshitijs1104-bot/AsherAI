export interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  updated: string;
}

async function jiraSearch(accessToken: string, cloudId: string, jql: string, maxResults: number): Promise<JiraIssue[]> {
  const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search`;
  const params = new URLSearchParams({ jql, maxResults: String(maxResults), fields: "summary,status,updated" });
  const res = await fetch(`${url}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Jira search failed: ${res.status} ${body}`);
  }
  const data: any = await res.json();
  return (data.issues ?? []).map((issue: any) => ({
    key: issue.key,
    summary: issue.fields.summary,
    status: issue.fields.status?.name ?? "Unknown",
    updated: issue.fields.updated,
  }));
}

export async function listAssignedIssues(accessToken: string, cloudId: string, maxResults = 10): Promise<JiraIssue[]> {
  return jiraSearch(accessToken, cloudId, "assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC", maxResults);
}

// "Stale" = assigned, unresolved, and untouched for over a week — the
// signal worth nudging on, not every open ticket.
export async function listStaleIssues(accessToken: string, cloudId: string, maxResults = 10): Promise<JiraIssue[]> {
  return jiraSearch(
    accessToken,
    cloudId,
    "assignee = currentUser() AND resolution = Unresolved AND updated <= -7d ORDER BY updated ASC",
    maxResults,
  );
}
