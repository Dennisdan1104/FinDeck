/**
 * The roster vocabulary the roundtable engine and its Remote share: the named
 * tables a user can seat, and the resolved identities one of them stands for.
 *
 * A roster is a NAMED list of members in speaking order. The shipped rosters
 * live in `./identities.ts`; the user's own rosters live in the `roundtable`
 * settings namespace, and a user roster sharing a shipped id replaces it —
 * so editing the classic table stores an edited `classic`, and the four
 * shipped contracts stay the fallback for any member that names one by id.
 *
 * @module @deepseek-ai/dsh-roundtable/rosters
 */

import {
  BUILTIN_IDENTITIES, BUILTIN_ROSTERS, DEFAULT_ROSTER_ID,
  resolveMembers,
  type RoundtableIdentity,
  type RoundtableMember,
  type RoundtableRoster,
  type StoredRoster,
} from './identities.ts'

export type { StoredRoster } from './identities.ts'

/**
 * Normalize a display name into a stable kebab-case roster id.
 * @param name - the display name the user typed, or the id it will stand for.
 * @returns the id, with whitespace collapsed to hyphens; a name with nothing
 *   to hyphenate becomes `custom-roster`.
 */
export function rosterIdFrom(name: string): string {
  const dashed = name.trim().toLowerCase().replaceAll(/\s+/g, '-')
  return dashed === '' ? 'custom-roster' : dashed
}

/**
 * Every roster the deployment offers: the shipped ones, with any user roster
 * of the same id replacing its shipped namesake, then the user's own in
 * storage order.
 * @param stored - the user-authored rosters from the settings document.
 * @returns the rosters in list order, shipped-first.
 */
export function resolveRosters(stored: readonly StoredRoster[]): RoundtableRoster[] {
  const usable = stored
    .filter(row => row.id.trim() !== '')
    .map(roster => ({
      id: roster.id,
      name: roster.name.trim() === '' ? roster.id : roster.name,
      builtin: false,
      members: roster.members.map((member, index): RoundtableMember => ({
        id: member.id,
        name: member.name,
        prompt: member.prompt,
        // A roster's last member harvests the round when none is marked: a
        // list of names always reads with somebody closing it.
        ...(member.moderator || (index === roster.members.length - 1 && !roster.members.some(row => row.moderator)))
          ? { moderator: true }
          : {},
      })),
    }))
  const replaced = new Set(usable.map(roster => roster.id))
  return [...BUILTIN_ROSTERS.filter(roster => !replaced.has(roster.id)), ...usable]
}

/**
 * The roster one id names, falling back to the default roster.
 * @param rosters - every roster the deployment offers.
 * @param id - the requested roster id, or null for the default.
 * @returns the roster to seat.
 */
export function rosterFor(
  rosters: readonly RoundtableRoster[],
  id: string | null,
): RoundtableRoster {
  // resolveRosters always returns the shipped rosters, so one of them answers.
  /* v8 ignore next -- the fallback keeps the return total for a roster set that dropped its shipped entries */
  return rosters.find(roster => roster.id === id)
    ?? rosters.find(roster => roster.id === DEFAULT_ROSTER_ID)
    ?? BUILTIN_ROSTERS[0] as RoundtableRoster
}

/**
 * The speakers one roster seats, resolved and in speaking order.
 * @param roster - the roster to resolve.
 * @returns the identities the engine drives, with `builtin` marking shipped ones.
 */
export function rosterIdentities(roster: RoundtableRoster): (RoundtableIdentity & { builtin: boolean })[] {
  return resolveMembers(roster.members).map(identity => ({
    ...identity,
    builtin: BUILTIN_IDENTITIES.some(builtin => builtin.id === identity.id),
  }))
}
