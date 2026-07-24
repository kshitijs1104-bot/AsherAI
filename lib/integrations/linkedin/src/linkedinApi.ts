// LinkedIn's current Posts API (replaces the older ugcPosts/shares
// endpoints) — requires the LinkedIn-Version header pinned to a specific
// monthly release; this connector never reads posts back, only creates
// them, so there's exactly one call here.
const LINKEDIN_API_VERSION = "202506";

export async function createPost(accessToken: string, authorUrn: string, text: string): Promise<{ postId: string }> {
  const res = await fetch("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "LinkedIn-Version": LINKEDIN_API_VERSION,
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify({
      author: authorUrn,
      commentary: text,
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LinkedIn post creation failed: ${res.status} ${body}`);
  }
  // The Posts API returns the new post's URN in the x-restli-id header,
  // not the JSON body (a 201 with no body is normal here).
  const postId = res.headers.get("x-restli-id") ?? "";
  return { postId };
}
