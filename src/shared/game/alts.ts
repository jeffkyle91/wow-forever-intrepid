// Structural, so this file has no imports and can be tested directly by Node. PlayerRecord (guildApi.ts) satisfies it.
type PlayerLike = { id: string; mainId?: string }

// A character is an alt when it links to a main that exists and is not itself an alt. This is the same rule the roster uses
// to group alts under their main. A link to a missing character, to itself, or to another alt is ignored.
export function altIds(players: PlayerLike[]) {
  const mains = new Set(players.filter((player) => !player.mainId).map((player) => player.id))
  return new Set(players.filter((player) => player.mainId && player.mainId !== player.id && mains.has(player.mainId)).map((player) => player.id))
}
