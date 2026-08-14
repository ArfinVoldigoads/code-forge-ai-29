export async function getSandboxSession(chatId: string) {
  const { requireUnlocked } = await import("./gate.server");
  await requireUnlocked();
  const { getE2BKey, getSandboxForChat } = await import("./e2b.server");
  const apiKey = await getE2BKey();
  if (!apiKey) throw new Error("No E2B API key. Add one in Settings → E2B.");
  return getSandboxForChat(chatId, apiKey);
}