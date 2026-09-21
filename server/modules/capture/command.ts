export type CaptureCommand = "document" | "update";

export interface ParsedCaptureCommand {
  command: CaptureCommand;
  botName: string;
}

export function parseCaptureCommand(text: string, expectedBotName: string): ParsedCaptureCommand | null {
  const escapedName = expectedBotName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.trim().match(new RegExp(`^@${escapedName}\\s+(document|update)$`, "i"));
  if (!match) return null;
  return { command: match[1].toLowerCase() as CaptureCommand, botName: expectedBotName };
}

