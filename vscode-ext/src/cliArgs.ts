/**
 * Append user-configured or ad-hoc CLI flags to a saifctl subcommand string.
 * The extension does not parse or escape `extraArgs`; the shell receives them verbatim.
 */
export function appendCliExtraArgs(baseSubcommand: string, extraArgs: string): string {
  const t = extraArgs.trim();
  if (!t) return baseSubcommand;
  return `${baseSubcommand} ${t}`;
}
