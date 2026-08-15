export async function getSandboxSession(chatId: string) {
  const { requireUnlocked } = await import("./gate.server");
  await requireUnlocked();
  const { getSandboxApiKey, getSandboxForChat } = await import("./daytona.server");
  const apiKey = await getSandboxApiKey();
  if (!apiKey) throw new Error("No Daytona API key. Add one in Settings → Sandbox.");
  return getSandboxForChat(chatId, apiKey);
}
